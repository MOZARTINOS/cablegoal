// Live "did it hit the cable?" vote counter.
// Storage: Netlify Blobs (no external DB). GET returns tally; POST updates it.
// Anti-abuse (launch requirements):
//   • Server-side dedup: an HttpOnly `cgv` token cookie identifies the browser;
//     the server remembers each token's current choice, so repeat POSTs from
//     the same browser only ever move one vote (no double counting).
//   • Per-IP rate limit (3 writes/min) caps direct-API padding. The limiter is
//     a compare-and-swap loop on a Blobs key — parallel bursts from one IP
//     lose the CAS race and fail closed (429) instead of slipping through.
//   • POST requires an allowlisted Origin (browser writes from our site only)
//     and an application/json body ≤ 1 KB. GET stays public.
//   • Privacy: no raw IPs persisted anywhere — the rate-limit key is a salted
//     SHA-256 hash of the IP (salt from VOTE_IP_SALT env when set), one small
//     bucket per hash, overwritten in place each 1-minute window. Only
//     anonymous counts are stored — global {hit, no} plus per-country {hit, no}
//     derived from Netlify edge geo. No names/handles persisted.
//   • No secrets in code: Blobs auth is injected by the Netlify runtime; any
//     future keys must come from environment variables (repo stays public).
// Known residual risk (accepted for a sentiment counter): token write and
// tally write are two separate Blob stores and cannot be transactional; a
// crash between them can drift one vote. The origin allowlist + atomic IP
// limit cap deliberate abuse at 3 writes/min per IP.
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';

const KEY = 'tally';
const CHOICES = ['hit', 'no'];
const WINDOW_MS = 60_000;   // per-IP rate-limit window
const MAX_PER_WINDOW = 3;   // max writes per IP per window (casual/bot padding guard)
const CAS_RETRIES = 5;      // optimistic-concurrency retries on the shared counter
const RL_RETRIES = 3;       // CAS retries on the rate-limit bucket (then fail closed)
const MAX_BODY_BYTES = 1024;
const COOKIE = 'cgv';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Browsers may only POST from these origins (site itself + netlify dev).
const POST_ORIGINS = [
  'https://cablegoal.com',
  'https://www.cablegoal.com',
  'https://cablegoal.netlify.app',
  'http://localhost:8888',
  'http://127.0.0.1:8888',
];

const CORS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};

function json(status, obj, extra) {
  return new Response(JSON.stringify(obj), { status, headers: extra ? { ...CORS, ...extra } : CORS });
}

function clientIp(req, context) {
  return (
    (context && context.ip) ||
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

// Rate-limit key: salted hash so no raw network identifier is ever stored.
function ipKey(ip) {
  const salt = process.env.VOTE_IP_SALT || 'cablegoal-rl-v1';
  return createHash('sha256').update(ip + '|' + salt).digest('hex').slice(0, 32);
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

// Atomic fixed-window rate limit. Returns true when this request is allowed.
// A lost CAS race means the same IP is writing in parallel → fail closed.
async function rateLimitOk(rl, key) {
  for (let i = 0; i < RL_RETRIES; i++) {
    const cur = await rl.getWithMetadata(key, { type: 'json' });
    const now = Date.now();
    let bucket = (cur && cur.data) || { n: 0, t: now };
    if (now - bucket.t > WINDOW_MS) bucket = { n: 0, t: now };
    if (bucket.n >= MAX_PER_WINDOW) return false;
    bucket = { n: bucket.n + 1, t: bucket.t };
    const opts = cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
    const res = await rl.setJSON(key, bucket, opts);
    if (!res || res.modified !== false) return true;
    await new Promise(r => setTimeout(r, 20 + Math.floor(Math.random() * 40)));
  }
  return false;
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(405, { error: 'method-not-allowed' });
  }

  const store = getStore('votes');
  // Netlify edge geo — used to attribute the vote to a country; nothing else kept.
  const country = geoCountry(context);

  if (req.method === 'GET') {
    const tally = normTally(await store.get(KEY, { type: 'json' }));
    return json(200, { ...tally, country });
  }

  // ---- POST ----
  // Browser writes must come from the site itself (curl/bots send no or a
  // foreign Origin). Not an auth mechanism — just kills drive-by cross-site writes.
  const origin = req.headers.get('origin') || '';
  if (!POST_ORIGINS.includes(origin)) {
    return json(403, { error: 'bad-origin' });
  }
  const postCors = { 'access-control-allow-origin': origin, vary: 'Origin' };

  const contentType = (req.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return json(415, { error: 'bad-content-type' }, postCors);
  }

  // per-IP rate limit (atomic CAS on a salted-hash key; no raw IP persisted)
  const ip = clientIp(req, context);
  const rl = getStore('votes-rl');
  if (!(await rateLimitOk(rl, ipKey(ip)))) {
    const tally = normTally(await store.get(KEY, { type: 'json' }));
    return json(429, { ...tally, country, rateLimited: true }, postCors);
  }

  // strictly validated input: capped body size, JSON only, only `choice` is read
  let body = {};
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'body-too-large' }, postCors);
    body = JSON.parse(raw);
  } catch { body = {}; }
  const choice = body && body.choice;
  if (!CHOICES.includes(choice)) {
    return json(400, { error: 'bad-choice' }, postCors);
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
      return json(503, { ...cur, country, busy: true }, postCors);
    }
    await tokens.setJSON(token, { choice, country });
    tally = applied;
  } else {
    tally = normTally(await store.get(KEY, { type: 'json' }));
  }

  const headers = setCookie ? { ...postCors, 'set-cookie': setCookie } : postCors;
  return json(200, { ...tally, country }, headers);
};

export const config = { path: '/api/vote' };
