// Hisaab live groups. One Durable Object per group: strongly consistent, merges on write.
// The group key never leaves the client in a URL the server sees; only its SHA-256 is stored.
import { DurableObject } from 'cloudflare:workers';
import { cleanGroup, mergeGroup } from '../js/merge.js';
import { diffEntry } from '../js/history.js';

const ORIGINS = [/^https:\/\/([\w-]+\.)?(hisaab-s4u|gethisaab)\.pages\.dev$/, /^https:\/\/nmtjn1997\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/];
const MAX_BODY = 2_000_000;

const cors = (origin) => ({
  'Access-Control-Allow-Origin': ORIGINS.some((r) => r.test(origin || '')) ? origin : 'https://gethisaab.pages.dev',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Key, X-New-Key, X-Device, Authorization',
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
  // Durable Objects run one request at a time per group (input gate), so read-merge-write
  // below is atomic: two phones pushing at the same instant cannot overwrite each other.
  async sync(keyHash, incoming, newHash, histSince = 0, dev = '') {
    const cur = await this.ctx.storage.get('g');
    if (cur && cur.keyHash !== keyHash) return { status: 403, body: { error: 'wrong key' } };
    // Only real changes count against the 120-a-minute write budget; re-sends of known data are free.
    const budget = () => {
      const now = Date.now();
      this.writes = this.writes.filter((t) => now - t < 60000);
      if (this.writes.length >= 120) return false;
      this.writes.push(now);
      return true;
    };
    if (newHash && !budget()) return { status: 429, body: { error: 'slow down' } };
    if (newHash && cur) { cur.keyHash = newHash; await this.ctx.storage.put('g', cur); return { status: 200, body: { rev: cur.rev, data: cur.data } }; }
    const inc = incoming ? cleanGroup(incoming) : null;
    const before = cur?.data?.expenses || {};
    const data = mergeGroup(cur?.data || null, inc) || cleanGroup(null);
    const hist = (await this.ctx.storage.get('hist')) || { seq: 0, items: [] };
    let wrote = false;
    // History is written HERE, from what the server actually accepted. Phones never send it.
    if (inc) for (const id in inc.expenses) {
      const n = data.expenses[id];
      if (n !== inc.expenses[id]) continue; // the stored copy was newer: nothing changed
      const h = diffEntry(before[id], n, { at: Date.now(), dev });
      if (!h) continue;
      h.seq = ++hist.seq;
      hist.items.push(h);
      wrote = true;
    }
    if (hist.items.length > 3000) hist.items.splice(0, hist.items.length - 3000);
    const changed = !cur || JSON.stringify(data) !== JSON.stringify(cur.data);
    if (changed && cur && !budget()) return { status: 429, body: { error: 'slow down' } };
    const rev = (cur?.rev || 0) + (changed ? 1 : 0);
    if (changed) await this.ctx.storage.put('g', { keyHash, data, rev, updatedAt: Date.now() });
    if (wrote) await this.ctx.storage.put('hist', hist);
    return { status: 200, body: { rev, data, hist: hist.items.filter((h) => h.seq > histSince) } };
  }
}

const day = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);
const clip = (v, n) => String(v ?? '').slice(0, n);
const EV = /^[a-z_]{2,24}$/;

// Admin: constant-time compare of a bearer token set with `wrangler secret put ADMIN_TOKEN`.
function isAdmin(req, env) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const a = env.ADMIN_TOKEN || '';
  if (!a || t.length !== a.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ t.charCodeAt(i);
  return d === 0;
}

async function limited(req, env) {
  if (!env.LIMIT) return false;
  const { success } = await env.LIMIT.limit({ key: req.headers.get('CF-Connecting-IP') || 'x' });
  return !success;
}

// Anonymous usage events: {uid, platform, version, ref, events:[{type, route, n}]}
async function track(req, env, origin) {
  if (await limited(req, env)) return json({ ok: false }, 429, origin);
  const text = await req.text();
  if (text.length > 20000) return json({ error: 'too large' }, 413, origin);
  let b; try { b = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400, origin); }
  const uid = clip(b.uid, 24);
  if (!/^[\w-]{8,24}$/.test(uid) || !Array.isArray(b.events)) return json({ error: 'bad' }, 400, origin);
  const ts = Date.now(), d = day(ts);
  const rows = b.events.slice(0, 50).filter((e) => EV.test(e?.type || ''));
  if (rows.length) {
    const st = env.DB.prepare('INSERT INTO events (ts, day, uid, type, route, platform, version, ref, n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    await env.DB.batch(rows.map((e) => st.bind(ts, d, uid, e.type, clip(e.route, 40), clip(b.platform, 12), clip(b.version, 20), clip(b.ref, 60), Math.max(1, Math.min(1000, +e.n || 1)))));
  }
  return json({ ok: true, n: rows.length }, 200, origin);
}

async function report(req, env, origin) {
  if (await limited(req, env)) return json({ ok: false }, 429, origin);
  const text = await req.text();
  if (text.length > 8000) return json({ error: 'too large' }, 413, origin);
  let b; try { b = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400, origin); }
  await env.DB.prepare('INSERT INTO errors (ts, day, uid, msg, stack, route, version, ua) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(Date.now(), day(), clip(b.uid, 24), clip(b.msg, 300), clip(b.stack, 2000), clip(b.route, 40), clip(b.version, 20), clip(req.headers.get('User-Agent'), 160)).run();
  return json({ ok: true }, 200, origin);
}

async function stats(env, days) {
  const since = day(Date.now() - (days - 1) * 864e5);
  const today = day(), d7 = day(Date.now() - 6 * 864e5);
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a).all().then((r) => r.results);
  const one = (sql, ...a) => env.DB.prepare(sql).bind(...a).first();
  const [kpi, dau, byType, daily, routes, platforms, versions, refs, errs, syncDaily, syncKpi, groups, retention] = await Promise.all([
    one(`SELECT
      (SELECT COUNT(DISTINCT uid) FROM events WHERE day = ?) AS dau,
      (SELECT COUNT(DISTINCT uid) FROM events WHERE day >= ?) AS wau,
      (SELECT COUNT(DISTINCT uid) FROM events WHERE day >= ?) AS mau,
      (SELECT COUNT(DISTINCT uid) FROM events) AS users,
      (SELECT COUNT(DISTINCT uid) FROM events WHERE type = 'first_open' AND day >= ?) AS new_users,
      (SELECT COALESCE(SUM(n),0) FROM events WHERE day = ?) AS events_today,
      (SELECT COALESCE(SUM(n),0) FROM events WHERE type = 'expense_add' AND day >= ?) AS expenses,
      (SELECT COUNT(*) FROM errors WHERE day = ?) AS errors_today,
      (SELECT COUNT(*) FROM errors WHERE day >= ?) AS errors_period`, today, d7, since, since, today, since, today, since),
    q('SELECT day, COUNT(DISTINCT uid) AS users, COALESCE(SUM(n),0) AS events FROM events WHERE day >= ? GROUP BY day ORDER BY day', since),
    q('SELECT type, COALESCE(SUM(n),0) AS n, COUNT(DISTINCT uid) AS users FROM events WHERE day >= ? GROUP BY type ORDER BY n DESC', since),
    q("SELECT day, type, COALESCE(SUM(n),0) AS n FROM events WHERE day >= ? AND type IN ('expense_add','voice_done','scan_ok','settle','live_create','join') GROUP BY day, type ORDER BY day", since),
    q("SELECT route, COUNT(*) AS n, COUNT(DISTINCT uid) AS users FROM events WHERE day >= ? AND type = 'view' GROUP BY route ORDER BY n DESC LIMIT 15", since),
    q('SELECT platform, COUNT(DISTINCT uid) AS users FROM events WHERE day >= ? GROUP BY platform ORDER BY users DESC', since),
    q('SELECT version, COUNT(DISTINCT uid) AS users FROM events WHERE day >= ? GROUP BY version ORDER BY users DESC LIMIT 8', since),
    q("SELECT ref, COUNT(DISTINCT uid) AS users FROM events WHERE day >= ? AND ref != '' GROUP BY ref ORDER BY users DESC LIMIT 10", since),
    q('SELECT day, COUNT(*) AS n FROM errors WHERE day >= ? GROUP BY day ORDER BY day', since),
    q('SELECT day, COUNT(*) AS n, SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS bad, CAST(AVG(ms) AS INTEGER) AS avg_ms, MAX(ms) AS max_ms FROM syncs WHERE day >= ? GROUP BY day ORDER BY day', since),
    one('SELECT COUNT(*) AS n, COUNT(DISTINCT gid) AS groups, SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS bad, CAST(AVG(ms) AS INTEGER) AS avg_ms FROM syncs WHERE day >= ?', since),
    q('SELECT gid, MAX(ts) AS last, COUNT(*) AS syncs, SUM(write) AS writes, MAX(expenses) AS expenses, MAX(members) AS members, MAX(bytes) AS bytes FROM syncs GROUP BY gid ORDER BY last DESC LIMIT 25'),
    q(`SELECT f.day AS cohort, COUNT(DISTINCT f.uid) AS users,
         COUNT(DISTINCT CASE WHEN e.day > f.day THEN e.uid END) AS returned
       FROM (SELECT uid, MIN(day) AS day FROM events GROUP BY uid) f
       LEFT JOIN events e ON e.uid = f.uid
       WHERE f.day >= ? GROUP BY f.day ORDER BY f.day`, since),
  ]);
  return { generatedAt: Date.now(), days, kpi, dau, byType, daily, routes, platforms, versions, refs, errs, syncDaily, syncKpi, groups, retention };
}

async function logs(env, kind, limit) {
  const n = Math.max(1, Math.min(500, limit || 100));
  const sql = {
    errors: 'SELECT ts, uid, route, version, msg, stack, ua FROM errors ORDER BY ts DESC LIMIT ?',
    events: 'SELECT ts, uid, type, route, platform, version, n FROM events ORDER BY ts DESC LIMIT ?',
    syncs: 'SELECT ts, gid, status, ms, bytes, expenses, members, write FROM syncs ORDER BY ts DESC LIMIT ?',
  }[kind];
  if (!sql) return null;
  return (await env.DB.prepare(sql).bind(n).all()).results;
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === '/t' && req.method === 'POST') return track(req, env, origin);
    if (path === '/e' && req.method === 'POST') return report(req, env, origin);
    if (path.startsWith('/admin/')) {
      if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401, origin);
      if (path === '/admin/stats') return json(await stats(env, Math.max(1, Math.min(90, +url.searchParams.get('days') || 30))), 200, origin);
      if (path === '/admin/logs') { const r = await logs(env, url.searchParams.get('kind'), +url.searchParams.get('limit')); return r ? json(r, 200, origin) : json({ error: 'kind' }, 400, origin); }
      return json({ error: 'not found' }, 404, origin);
    }
    const m = path.match(/^\/g\/([\w-]{8,40})$/);
    if (!m || req.method !== 'POST') return json({ error: 'not found' }, 404, origin);
    const t0 = Date.now();
    const key = req.headers.get('X-Key') || '';
    if (key.length < 16 || key.length > 64) return json({ error: 'bad key' }, 401, origin);
    const len = +req.headers.get('Content-Length') || 0;
    if (len > MAX_BODY) return json({ error: 'too large' }, 413, origin);
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: 'too large' }, 413, origin);
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { return json({ error: 'bad json' }, 400, origin); }
    const stub = env.GROUPS.get(env.GROUPS.idFromName(m[1]));
    if (await limited(req, env)) return json({ error: 'slow down' }, 429, origin);
    const nk = req.headers.get('X-New-Key');
    if (nk && (nk.length < 16 || nk.length > 64)) return json({ error: 'bad key' }, 400, origin);
    const dev = (await sha256('d:' + (req.headers.get('X-Device') || req.headers.get('CF-Connecting-IP') || ''))).slice(0, 6);
    const r = await stub.sync(await sha256(key), body.data || null, nk ? await sha256(nk) : null, Math.max(0, +body.histSince || 0), dev);
    // Sync health, keyed by a one-way hash of the group id: counts and timings, never content.
    if (env.DB) ctx.waitUntil((async () => {
      const gid = (await sha256('g:' + m[1])).slice(0, 12);
      const d = r.body?.data;
      await env.DB.prepare('INSERT INTO syncs (ts, day, gid, status, ms, bytes, expenses, members, write) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(t0, day(t0), gid, r.status, Date.now() - t0, text.length, d ? Object.keys(d.expenses || {}).length : null, d ? (d.members || []).length : null, body.data ? 1 : 0).run();
    })().catch(() => {}));
    return json(r.body, r.status, origin);
  },
  async scheduled(_e, env) {
    const cut = day(Date.now() - 90 * 864e5);
    await env.DB.batch(['events', 'errors', 'syncs'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE day < ?`).bind(cut)));
  },
};
