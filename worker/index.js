// Hisaab live groups. One Durable Object per group: strongly consistent, merges on write.
// The group key never leaves the client in a URL the server sees; only its SHA-256 is stored.
import { DurableObject } from 'cloudflare:workers';
import { cleanGroup, mergeGroup } from '../js/merge.js';

const ORIGINS = [/^https:\/\/([\w-]+\.)?hisaab-s4u\.pages\.dev$/, /^https:\/\/nmtjn1997\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/];
const MAX_BODY = 2_000_000;

const cors = (origin) => ({
  'Access-Control-Allow-Origin': ORIGINS.some((r) => r.test(origin || '')) ? origin : 'https://hisaab-s4u.pages.dev',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Key, X-New-Key',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});
const json = (data, status, origin) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) } });

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export class GroupDO extends DurableObject {
  writes = [];
  async sync(keyHash, incoming, newHash) {
    const cur = await this.ctx.storage.get('g');
    if (cur && cur.keyHash !== keyHash) return { status: 403, body: { error: 'wrong key' } };
    if (incoming || newHash) {
      // At most 60 writes a minute per group: plenty for people, a wall for scripts.
      const now = Date.now();
      this.writes = this.writes.filter((t) => now - t < 60000);
      if (this.writes.length >= 60) return { status: 429, body: { error: 'slow down' } };
      this.writes.push(now);
    }
    if (newHash && cur) { cur.keyHash = newHash; await this.ctx.storage.put('g', cur); return { status: 200, body: { rev: cur.rev, data: cur.data } }; }
    const data = mergeGroup(cur?.data || null, incoming ? cleanGroup(incoming) : null) || cleanGroup(null);
    const rev = (cur?.rev || 0) + (incoming ? 1 : 0);
    if (incoming || !cur) await this.ctx.storage.put('g', { keyHash, data, rev, updatedAt: Date.now() });
    return { status: 200, body: { rev, data } };
  }
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const m = new URL(req.url).pathname.match(/^\/g\/([\w-]{8,40})$/);
    if (!m || req.method !== 'POST') return json({ error: 'not found' }, 404, origin);
    const key = req.headers.get('X-Key') || '';
    if (key.length < 16 || key.length > 64) return json({ error: 'bad key' }, 401, origin);
    const len = +req.headers.get('Content-Length') || 0;
    if (len > MAX_BODY) return json({ error: 'too large' }, 413, origin);
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: 'too large' }, 413, origin);
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { return json({ error: 'bad json' }, 400, origin); }
    const stub = env.GROUPS.get(env.GROUPS.idFromName(m[1]));
    const ip = req.headers.get('CF-Connecting-IP') || 'x';
    if (env.LIMIT) { const { success } = await env.LIMIT.limit({ key: ip }); if (!success) return json({ error: 'slow down' }, 429, origin); }
    const nk = req.headers.get('X-New-Key');
    if (nk && (nk.length < 16 || nk.length > 64)) return json({ error: 'bad key' }, 400, origin);
    const r = await stub.sync(await sha256(key), body.data || null, nk ? await sha256(nk) : null);
    return json(r.body, r.status, origin);
  },
};
