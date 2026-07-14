// Live "did it hit the cable?" vote counter.
// Storage: Netlify Blobs (no external DB). GET returns tally; POST updates it.
// Anti-abuse (launch requirements):
//   • Server-side dedup: an HttpOnly `cgv` token cookie identifies the browser;
//     the server remembers each token's current choice, so repeat POSTs from
//     the same browser only ever move one vote (no double counting).
//   • Per-IP rate limit (3 writes/min) caps direct-API padding.
//   • Only anonymous counts are stored — global {hit, no} plus per-country
//     {hit, no} derived from Netlify edge geo. No names/handles/IPs persisted.
//   • No secrets in code: Blobs auth is injected by the Netlify runtime; any
//     future keys must come from environment variables (repo stays public).
import { getStore } from '@netlify/blobs';

const KEY = 'tally';
const CHOICES = ['hit', 'no'];
const WINDOW_MS = 60_000;   // per-IP rate-limit window
const MAX_PER_WINDOW = 3;   // max writes per IP per window (casual/bot padding guard)
const CAS_RETRIES = 5;      // optimistic-concurrency retries on the shared counter
const COOKIE = 'cgv';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

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

function readToken(req) {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)cgv=([A-Za-z0-9-]{8,64})/);
  return m ? m[1] : null;
}

function geoCountry(context) {
  const code = (context && context.geo && context.geo.country && context.geo.country.code) || '';
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function normTally(t) {
  const out = { hit: Math.max(0, t && t.hit | 0), no: Math.max(0, t && t.no | 0), byCountry: {} };
  const bc = (t && t.byCountry) || {};
  for (const k of Object.keys(bc)) {
    if (!/^[A-Z]{2,3}$/.test(k)) continue;
    const hit = Math.max(0, bc[k].hit | 0), no = Math.max(0, bc[k].no | 0);
    if (hit || no) out.byCountry[k] = { hit, no };
  }
  return out;
}

// One vote move: remove `prev` (if any), add `next`. Mutates a fresh copy.
function applyDelta(tally, prev, next) {
  const t = normTally(tally);
  const bump = (choice, cc, d) => {
    if (!CHOICES.includes(choice)) return;
    t[choice] = Math.max(0, t[choice] + d);
    const key = cc || 'OTH';
    const row = t.byCountry[key] || { hit: 0, no: 0 };
    row[choice] = Math.max(0, row[choice] + d);
    if (row.hit || row.no) t.byCountry[key] = row; else delete t.byCountry[key];
  };
  if (prev) bump(prev.choice, prev.country, -1);
  bump(next.choice, next.country, +1);
  return t;
}

// Compare-and-swap update of the shared tally blob (Blobs etag conditional write).
// Returns the applied tally on success, or null if all retries lost the race.
async function casUpdate(store, prev, next) {
  for (let i = 0; i < CAS_RETRIES; i++) {
    const cur = await store.getWithMetadata(KEY, { type: 'json' });
    const applied = applyDelta(cur ? cur.data : null, prev, next);
    const opts = cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
    const res = await store.setJSON(KEY, applied, opts);
    // Blobs returns { modified: false } when the condition failed → retry; otherwise the write landed.
    if (!res || res.modified !== false) return applied;
    await new Promise(r => setTimeout(r, 30 + Math.floor(Math.random() * 70) * (i + 1)));
  }
  return null;
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method-not-allowed' }), { status: 405, headers: CORS });
  }

  const store = getStore('votes');
  // Netlify edge geo — used to attribute the vote to a country; nothing else kept.
  const country = geoCountry(context);

  if (req.method === 'GET') {
    const tally = normTally(await store.get(KEY, { type: 'json' }));
    return new Response(JSON.stringify({ ...tally, country }), { headers: CORS });
  }

  // ---- POST ----
  // per-IP rate limit (fixed window kept in a separate Blobs store)
  const ip = clientIp(req, context);
  const rl = getStore('votes-rl');
  const now = Date.now();
  let bucket = (await rl.get(ip, { type: 'json' })) || { n: 0, t: now };
  if (now - bucket.t > WINDOW_MS) bucket = { n: 0, t: now };
  if (bucket.n >= MAX_PER_WINDOW) {
    const tally = normTally(await store.get(KEY, { type: 'json' }));
    return new Response(JSON.stringify({ ...tally, country, rateLimited: true }), { status: 429, headers: CORS });
  }
  bucket.n++;
  await rl.setJSON(ip, bucket);

  // strictly validated input: only `choice` is read from the body
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const choice = body.choice;
  if (!CHOICES.includes(choice)) {
    return new Response(JSON.stringify({ error: 'bad-choice' }), { status: 400, headers: CORS });
  }

  // browser token: the server's memory of this browser's current vote
  const tokens = getStore('votes-token');
  let token = readToken(req);
  let setCookie = null;
  if (!token) {
    token = crypto.randomUUID();
    setCookie = `${COOKIE}=${token}; Max-Age=${COOKIE_MAX_AGE}; Path=/api/vote; Secure; HttpOnly; SameSite=Lax`;
  }
  const prev = token ? await tokens.get(token, { type: 'json' }) : null;

  // Use the tally returned by the write so the client sees its own vote immediately
  // (a re-read here can lag behind the write under Blobs read-after-write consistency).
  let tally;
  if (!prev || prev.choice !== choice) {
    const applied = await casUpdate(store, prev && CHOICES.includes(prev.choice) ? prev : null, { choice, country });
    if (!applied) {
      const cur = normTally(await store.get(KEY, { type: 'json' }));
      return new Response(JSON.stringify({ ...cur, country, busy: true }), { status: 503, headers: CORS });
    }
    await tokens.setJSON(token, { choice, country });
    tally = applied;
  } else {
    tally = normTally(await store.get(KEY, { type: 'json' }));
  }

  const headers = setCookie ? { ...CORS, 'set-cookie': setCookie } : CORS;
  return new Response(JSON.stringify({ ...tally, country }), { headers });
};

export const config = { path: '/api/vote' };
