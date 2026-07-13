// Live "did it hit the cable?" vote counter.
// Storage: Netlify Blobs (no external DB). GET returns tally; POST updates it.
import { getStore } from '@netlify/blobs';

const KEY = 'tally';
const CHOICES = ['hit', 'no'];
const CORS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });

  const store = getStore('votes');
  let tally = (await store.get(KEY, { type: 'json' })) || { hit: 0, no: 0 };

  if (req.method === 'POST') {
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

  return new Response(JSON.stringify(tally), { headers: CORS });
};

export const config = { path: '/api/vote' };
