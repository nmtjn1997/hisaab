// Hisaab live groups. One Durable Object per group: strongly consistent, merges on write.
// The group key never leaves the client in a URL the server sees; only its SHA-256 is stored.
import { DurableObject } from 'cloudflare:workers';
import { cleanGroup, mergeGroup } from '../js/merge.js';
import { diffEntry } from '../js/history.js';
import { admit, guard, applyRoleOps, adminPids, pendingClaims } from '../js/access.js';
import { sendPush, allowedEndpoint, pushLines } from '../js/webpush.js';
import { verifyGoogleToken, makeSession, readSession } from '../js/auth.js';

const ORIGINS = [/^https:\/\/([\w-]+\.)?(hisaab-s4u|gethisaab)\.pages\.dev$/, /^https:\/\/nmtjn1997\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/];
const MAX_BODY = 2_000_000;

const cors = (origin) => ({
  'Access-Control-Allow-Origin': ORIGINS.some((r) => r.test(origin || '')) ? origin : 'https://gethisaab.pages.dev',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Key, X-New-Key, X-Device, X-Me, Authorization',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});
const BUILD = 'account-1';
const json = (data, status, origin) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Hisaab-Build': BUILD, ...cors(origin) } });

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const CHUNK = 96 * 1024, MAX_PHOTO = 1_500_000, MAX_PHOTOS = 300, MAX_BACKUP = 4_000_000;
export class GroupDO extends DurableObject {
  writes = [];
  // Bill photos live with their group, in chunks (storage values are size-limited), behind the group key.
  // Account backups use their own object (named "acct:<account id>"), never a group's.
  async getBackup() {
    const meta = await this.ctx.storage.get('bm');
    if (!meta) return { rev: 0, at: null, data: null };
    const parts = await this.ctx.storage.get(Array.from({ length: meta.n }, (_, i) => `bc:${i}`));
    return { rev: meta.rev, at: meta.at, data: JSON.parse(Array.from({ length: meta.n }, (_, i) => parts.get(`bc:${i}`)).join('')) };
  }
  /** Compare-and-swap: only accepted if the phone merged on top of the latest copy. */
  async putBackup(rev, text) {
    const meta = (await this.ctx.storage.get('bm')) || { rev: 0, n: 0 };
    if (rev !== meta.rev) return { status: 409, body: { error: 'stale', rev: meta.rev } };
    const n = Math.ceil(text.length / CHUNK) || 1;
    const puts = { bm: { rev: meta.rev + 1, n, at: Date.now() } };
    for (let i = 0; i < n; i++) puts[`bc:${i}`] = text.slice(i * CHUNK, (i + 1) * CHUNK);
    await this.ctx.storage.put(puts);
    if (meta.n > n) await this.ctx.storage.delete(Array.from({ length: meta.n - n }, (_, i) => `bc:${n + i}`));
    return { status: 200, body: { rev: meta.rev + 1, at: puts.bm.at } };
  }
  async putPhoto(keyHash, rid, bytes, type) {
    const cur = await this.ctx.storage.get('g');
    if (!cur || cur.keyHash !== keyHash) return { status: 403, body: { error: 'wrong key' } };
    if (bytes.byteLength > MAX_PHOTO) return { status: 413, body: { error: 'too large' } };
    const index = (await this.ctx.storage.get('photos')) || [];
    if (!index.includes(rid)) {
      if (index.length >= MAX_PHOTOS) return { status: 507, body: { error: 'photo limit reached' } };
      index.push(rid);
    }
    const n = Math.ceil(bytes.byteLength / CHUNK);
    const puts = { photos: index, ['pm:' + rid]: { n, size: bytes.byteLength, type, at: Date.now() } };
    for (let i = 0; i < n; i++) puts[`pc:${rid}:${i}`] = bytes.slice(i * CHUNK, (i + 1) * CHUNK);
    await this.ctx.storage.put(puts);
    return { status: 200, body: { ok: true, size: bytes.byteLength } };
  }
  async getPhoto(keyHash, rid) {
    const cur = await this.ctx.storage.get('g');
    if (!cur || cur.keyHash !== keyHash) return { status: 403 };
    const meta = await this.ctx.storage.get('pm:' + rid);
    if (!meta) return { status: 404 };
    const parts = await this.ctx.storage.get(Array.from({ length: meta.n }, (_, i) => `pc:${rid}:${i}`));
    const out = new Uint8Array(meta.size);
    let off = 0;
    for (let i = 0; i < meta.n; i++) { const c = new Uint8Array(parts.get(`pc:${rid}:${i}`)); out.set(c, off); off += c.byteLength; }
    return { status: 200, bytes: out.buffer, type: meta.type };
  }
  // Durable Objects run one request at a time per group (input gate), so read-merge-write
  // below is atomic: two phones pushing at the same instant cannot overwrite each other.
  async sync(keyHash, incoming, newHash, histSince = 0, dev = '', devFull = '', me = '', roleOps = null, pushSub = null) {
    const cur = await this.ctx.storage.get('g');
    if (cur && cur.keyHash !== keyHash) return { status: 403, body: { error: 'wrong key' } };
    // Roles: the first device (creator, or first one seen on an older group) is admin.
    const prevAccess = await this.ctx.storage.get('access');
    let access = admit(prevAccess, devFull, me, !prevAccess || !Object.keys(prevAccess).length);
    const who = devFull && access[devFull] ? { pid: access[devFull].pid, admin: access[devFull].admin } : { pid: null, admin: false };
    if (roleOps) access = applyRoleOps(access, roleOps, who);
    // This phone's push subscription id ('' = turned off), so the server can wake it when others write.
    if (devFull && access[devFull] && pushSub !== null && (access[devFull].push || '') !== pushSub) access = { ...access, [devFull]: { ...access[devFull], push: pushSub || undefined } };
    const accessChanged = JSON.stringify(access) !== JSON.stringify(prevAccess || {});
    if (accessChanged) await this.ctx.storage.put('access', access);
    const mine = devFull ? access[devFull] : null;
    const roles = { me: { ...who, wants: mine?.wants || null, rejected: !!mine?.rejected }, admins: adminPids(access), ...(who.admin ? { pending: pendingClaims(access) } : {}) };
    if (newHash && !who.admin) return { status: 403, body: { error: 'only admins can reset the link' } };
    // Only real changes count against the 120-a-minute write budget; re-sends of known data are free.
    const budget = () => {
      const now = Date.now();
      this.writes = this.writes.filter((t) => now - t < 60000);
      if (this.writes.length >= 120) return false;
      this.writes.push(now);
      return true;
    };
    if (newHash && !budget()) return { status: 429, body: { error: 'slow down' } };
    if (newHash && cur) { cur.keyHash = newHash; await this.ctx.storage.put('g', cur); return { status: 200, body: { rev: cur.rev, data: cur.data, roles } }; }
    const g0 = incoming ? guard(cur?.data || null, cleanGroup(incoming), who) : { inc: null, denied: [] };
    const inc = g0.inc;
    const before = cur?.data?.expenses || {};
    const data = mergeGroup(cur?.data || null, inc) || cleanGroup(null);
    const hist = (await this.ctx.storage.get('hist')) || { seq: 0, items: [] };
    const seq0 = hist.seq;
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
    const fresh = hist.items.filter((h) => h.seq > seq0);
    const notify = fresh.length ? { subs: Object.entries(access).filter(([d, v]) => d !== devFull && v.push && !v.seat && !(data.meta?.removed || []).includes(v.pid)).map(([, v]) => v.push), lines: pushLines(fresh, data) } : null;
    return { status: 200, body: { rev, data, hist: hist.items.filter((h) => h.seq > histSince), roles, denied: g0.denied }, notify };
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

// ---- Optional Google sign-in and account backup ----
let jwks = null;
async function googleKeys() {
  if (jwks && jwks.until > Date.now()) return jwks.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const maxAge = +(/max-age=(\d+)/.exec(r.headers.get('Cache-Control') || '')?.[1] || 3600);
  jwks = { keys: (await r.json()).keys, until: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 };
  return jwks.keys;
}
const accountId = async (sub) => (await sha256('U:' + sub)).slice(0, 32);

async function googleSignIn(req, env, origin) {
  if (await limited(req, env)) return json({ error: 'slow down' }, 429, origin);
  const b = await readJSON(req, 8000);
  if (!b?.credential || !env.SESSION_SECRET) return json({ error: 'bad request' }, 400, origin);
  let who;
  try { who = await verifyGoogleToken(b.credential, env.GOOGLE_CLIENT_ID, await googleKeys()); }
  catch (e) { return json({ error: 'sign-in failed' }, 401, origin); }
  const u = await accountId(who.sub);
  const meta = await env.GROUPS.get(env.GROUPS.idFromName('acct:' + u)).getBackup().then((r) => ({ rev: r.rev, at: r.at }));
  return json({ session: await makeSession(u, env.SESSION_SECRET), email: who.email, name: who.name, ...meta }, 200, origin);
}

async function backup(req, env, origin) {
  if (await limited(req, env)) return json({ error: 'slow down' }, 429, origin);
  const u = await readSession((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env.SESSION_SECRET || '');
  if (!u) return json({ error: 'signed out' }, 401, origin);
  const stub = env.GROUPS.get(env.GROUPS.idFromName('acct:' + u));
  if (req.method === 'GET') return json(await stub.getBackup(), 200, origin);
  if (req.method !== 'PUT') return json({ error: 'method' }, 405, origin);
  if ((+req.headers.get('Content-Length') || 0) > MAX_BACKUP) return json({ error: 'too large' }, 413, origin);
  const text = await req.text();
  if (text.length > MAX_BACKUP) return json({ error: 'too large' }, 413, origin);
  let b;
  try { b = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400, origin); }
  if (!b || !Number.isInteger(b.rev) || !b.data || typeof b.data !== 'object' || b.data.v !== 1) return json({ error: 'bad backup' }, 400, origin);
  const r = await stub.putBackup(b.rev, JSON.stringify(b.data));
  return json(r.body, r.status, origin);
}

// ---- Web Push ----
const SUBJECT = 'https://gethisaab.pages.dev';
const subId = async (endpoint) => (await sha256('P:' + endpoint)).slice(0, 32);
async function readJSON(req, max = 4000) { const t = await req.text(); if (t.length > max) return null; try { return JSON.parse(t); } catch { return null; } }

/** A phone registers (or drops) its subscription, with its next weekly nudge time and text. */
async function pushSub(req, env, origin) {
  if (await limited(req, env)) return json({ error: 'slow down' }, 429, origin);
  const b = await readJSON(req);
  if (!b || !allowedEndpoint(b.endpoint)) return json({ error: 'bad subscription' }, 400, origin);
  const id = await subId(b.endpoint);
  if (b.off) { await env.DB.batch([env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(id), env.DB.prepare('DELETE FROM push_inbox WHERE sub = ?').bind(id)]); return json({ ok: true }, 200, origin); }
  const at = Number.isFinite(+b.nudgeAt) && +b.nudgeAt > Date.now() - 864e5 && +b.nudgeAt < Date.now() + 30 * 864e5 ? Math.round(+b.nudgeAt) : null;
  await env.DB.prepare('INSERT INTO push_subs (id, endpoint, nudge_at, nudge_text, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET endpoint = excluded.endpoint, nudge_at = excluded.nudge_at, nudge_text = excluded.nudge_text, at = excluded.at')
    .bind(id, b.endpoint, at, at ? clip(b.nudgeText, 200) || null : null, Date.now()).run();
  return json({ ok: true }, 200, origin);
}

/** A woken phone collects its messages. Knowing the endpoint is the proof that it is that phone. */
async function pushInbox(req, env, origin) {
  if (await limited(req, env)) return json({ error: 'slow down' }, 429, origin);
  const b = await readJSON(req);
  if (!b || !allowedEndpoint(b.endpoint)) return json({ error: 'bad subscription' }, 400, origin);
  const id = await subId(b.endpoint);
  const rows = (await env.DB.prepare('SELECT tag, title, body, url FROM push_inbox WHERE sub = ? ORDER BY ts LIMIT 20').bind(id).all()).results;
  if (rows.length) await env.DB.prepare('DELETE FROM push_inbox WHERE sub = ?').bind(id).run();
  return json({ items: rows }, 200, origin);
}

/** Queue a message per subscription, then wake those phones with an empty push. */
async function deliver(env, ids, msg) {
  const subs = (await env.DB.prepare(`SELECT id, endpoint FROM push_subs WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
  if (!subs.length) return;
  // One waiting message per group per phone: a newer one replaces it, so a busy trip stays one notification.
  await env.DB.batch(subs.flatMap((s) => [env.DB.prepare('DELETE FROM push_inbox WHERE sub = ? AND tag = ?').bind(s.id, msg.tag), env.DB.prepare('INSERT INTO push_inbox (sub, ts, tag, title, body, url) VALUES (?, ?, ?, ?, ?, ?)').bind(s.id, Date.now(), msg.tag, msg.title, msg.body, msg.url)]));
  const gone = [];
  await Promise.all(subs.map(async (s) => { const code = await sendPush(s.endpoint, env.VAPID_PUBLIC, env.VAPID_PRIVATE, SUBJECT).catch(() => 0); if (code === 404 || code === 410) gone.push(s.id); }));
  if (gone.length) await env.DB.batch(gone.flatMap((id) => [env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(id), env.DB.prepare('DELETE FROM push_inbox WHERE sub = ?').bind(id)]));
}

/** Hourly: send weekly "time to nudge" reminders that are due. Each phone re-sets its next one when opened. */
async function nudges(env) {
  if (!env.VAPID_PRIVATE) return;
  const due = (await env.DB.prepare('SELECT id, nudge_text FROM push_subs WHERE nudge_at IS NOT NULL AND nudge_at <= ? LIMIT 500').bind(Date.now()).all()).results;
  for (const s of due) {
    await env.DB.prepare('UPDATE push_subs SET nudge_at = nudge_at + ? WHERE id = ?').bind(7 * 864e5, s.id).run();
    await deliver(env, [s.id], { tag: 'nudge', title: 'Time to nudge', body: s.nudge_text || 'Some friends still owe you. Tap to remind them.', url: '#/people' });
  }
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === '/version') return json({ build: BUILD }, 200, origin);
    if (path === '/t' && req.method === 'POST') return track(req, env, origin);
    if (path === '/e' && req.method === 'POST') return report(req, env, origin);
    if (path === '/auth/google' && req.method === 'POST') return googleSignIn(req, env, origin);
    if (path === '/me/backup') return backup(req, env, origin);
    if (path === '/push/sub' && req.method === 'POST') return pushSub(req, env, origin);
    if (path === '/push/inbox' && req.method === 'POST') return pushInbox(req, env, origin);
    if (path.startsWith('/admin/')) {
      if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401, origin);
      if (path === '/admin/stats') return json(await stats(env, Math.max(1, Math.min(90, +url.searchParams.get('days') || 30))), 200, origin);
      if (path === '/admin/logs') { const r = await logs(env, url.searchParams.get('kind'), +url.searchParams.get('limit')); return r ? json(r, 200, origin) : json({ error: 'kind' }, 400, origin); }
      return json({ error: 'not found' }, 404, origin);
    }
    const pm = path.match(/^\/g\/([\w-]{8,40})\/photo\/([\w-]{6,40})$/);
    if (pm) {
      const key = req.headers.get('X-Key') || '';
      if (key.length < 16 || key.length > 64) return json({ error: 'bad key' }, 401, origin);
      if (await limited(req, env)) return json({ error: 'slow down' }, 429, origin);
      const stub = env.GROUPS.get(env.GROUPS.idFromName(pm[1]));
      if (req.method === 'PUT') {
        const type = req.headers.get('Content-Type') || '';
        if (!/^image\/(jpeg|png|webp)$/.test(type)) return json({ error: 'images only' }, 415, origin);
        if ((+req.headers.get('Content-Length') || 0) > MAX_PHOTO) return json({ error: 'too large' }, 413, origin);
        const r = await stub.putPhoto(await sha256(key), pm[2], await req.arrayBuffer(), type);
        return json(r.body, r.status, origin);
      }
      if (req.method === 'GET') {
        const r = await stub.getPhoto(await sha256(key), pm[2]);
        if (r.status !== 200) return json({ error: r.status === 404 ? 'not found' : 'wrong key' }, r.status, origin);
        return new Response(r.bytes, { headers: { 'Content-Type': r.type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', ...cors(origin) } });
      }
      return json({ error: 'method' }, 405, origin);
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
    const devFull = req.headers.get('X-Device') ? await sha256('D:' + req.headers.get('X-Device')) : '';
    const me = /^[\w:-]{1,40}$/.test(req.headers.get('X-Me') || '') ? req.headers.get('X-Me') : '';
    const ps = typeof body.push === 'string' ? (allowedEndpoint(body.push) ? await subId(body.push) : '') : null;
    const r = await stub.sync(await sha256(key), body.data || null, nk ? await sha256(nk) : null, Math.max(0, +body.histSince || 0), dev, devFull, me, body.roles && typeof body.roles === 'object' ? body.roles : null, ps);
    if (r.notify?.subs.length && env.DB && env.VAPID_PRIVATE) ctx.waitUntil(deliver(env, r.notify.subs, { tag: 'g:' + m[1], url: '#/g/' + m[1], ...r.notify.lines }).catch(() => {}));
    // Sync health, keyed by a one-way hash of the group id: counts and timings, never content.
    if (env.DB) ctx.waitUntil((async () => {
      const gid = (await sha256('g:' + m[1])).slice(0, 12);
      const d = r.body?.data;
      await env.DB.prepare('INSERT INTO syncs (ts, day, gid, status, ms, bytes, expenses, members, write) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(t0, day(t0), gid, r.status, Date.now() - t0, text.length, d ? Object.keys(d.expenses || {}).length : null, d ? (d.members || []).length : null, body.data ? 1 : 0).run();
    })().catch(() => {}));
    return json(r.body, r.status, origin);
  },
  async scheduled(e, env) {
    if (e.cron !== '17 3 * * *') return nudges(env);
    await env.DB.prepare('DELETE FROM push_inbox WHERE ts < ?').bind(Date.now() - 7 * 864e5).run();
    const cut = day(Date.now() - 90 * 864e5);
    await env.DB.batch(['events', 'errors', 'syncs'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE day < ?`).bind(cut)));
  },
};
