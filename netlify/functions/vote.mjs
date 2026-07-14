// Live "did it hit the cable?" vote counter.
// Storage: Netlify Blobs (no external DB). GET returns tally; POST updates it.
// Anti-abuse (launch requirements):
//   • 1 vote per browser is enforced client-side (localStorage `cableVerdict`
//     + disabled re-vote); this function adds a server-side per-IP rate limit
//     so a single client cannot flood the counter.
//   • Only the anonymous {hit, no} counts are ever stored — no names/handles/
//     country are persisted here (those live client-side in the session feed).
//   • No secrets in code: Blobs auth is injected by the Netlify runtime; any
//     future keys must come from environment variables (repo stays public).
import { getStore } from '@netlify/blobs';

const KEY = 'tally';
const CHOICES = ['hit', 'no'];
const WINDOW_MS = 60_000;   // per-IP rate-limit window
const MAX_PER_WINDOW = 8;   // max writes per IP per window (casual/bot padding guard)

const CORS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};

function clientIp(req, context) {
  return (
    (context && context.ip) ||
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method-not-allowed' }), { status: 405, headers: CORS });
  }

  const store = getStore('votes');
  let tally = (await store.get(KEY, { type: 'json' })) || { hit: 0, no: 0 };
  // Netlify edge geo — returned for the client's optional language default; never stored.
  const country = (context && context.geo && context.geo.country && context.geo.country.code) || null;

  if (req.method === 'POST') {
    // ---- per-IP rate limit (sliding window kept in a separate Blobs store) ----
    const ip = clientIp(req, context);
    const rl = getStore('votes-rl');
    const now = Date.now();
    let bucket = (await rl.get(ip, { type: 'json' })) || { n: 0, t: now };
    if (now - bucket.t > WINDOW_MS) bucket = { n: 0, t: now };
    if (bucket.n >= MAX_PER_WINDOW) {
      return new Response(JSON.stringify({ ...tally, country, rateLimited: true }), { status: 429, headers: CORS });
    }
    bucket.n++;
    await rl.setJSON(ip, bucket);

    // ---- apply the vote (strictly validated) ----
    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const { choice, prev } = body;
    // Switching an existing vote: remove the previous choice, add the new one.
    if (CHOICES.includes(prev) && prev !== choice && tally[prev] > 0) tally[prev]--;
    if (CHOICES.includes(choice) && choice !== prev) tally[choice]++;
    tally.hit = Math.max(0, tally.hit | 0);
    tally.no = Math.max(0, tally.no | 0);
    await store.setJSON(KEY, tally);
  }

  return new Response(JSON.stringify({ ...tally, country }), { headers: CORS });
};

export const config = { path: '/api/vote' };
