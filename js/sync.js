// Live groups: push local changes, pull everyone else's, merge by updatedAt.
// The group key lives only on devices and in the link's #fragment.
import * as S from './store.js';
import { mergeGroup, cleanGroup, isNewer } from './merge.js';

export const API = 'https://hisaab-sync.backinstock.workers.dev/g/';

const b64url = (a) => btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const newKey = () => b64url(crypto.getRandomValues(new Uint8Array(18)));

// remote id <-> local id. Only "me" usually differs: Deepak's phone calls Deepak "me".
const toRemote = (g) => { const r = {}; for (const k in g.live.map || {}) r[g.live.map[k]] = k; return (id) => r[id] || id; };
const toLocal = (g) => (id) => g.live.map?.[id] || id;
const mapObj = (o, f) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [f(k), v]));
const mapExp = (e, f) => ({
  ...e,
  paid: mapObj(e.paid, f),
  owed: mapObj(e.owed, f),
  split: e.split ? { ...e.split, parts: mapObj(e.split.parts, f) } : e.split,
  items: e.items ? e.items.map((i) => ({ ...i, who: i.who.map(f) })) : e.items,
  by: e.by ? f(e.by) : e.by,
  editedBy: e.editedBy ? f(e.editedBy) : e.editedBy,
});

export function payload(gid) {
  const st = S.state, g = st.groups[gid], f = toRemote(g);
  const exps = Object.values(st.expenses).filter((e) => e.gid === gid);
  const ids = new Set([...g.members, ...exps.flatMap((e) => [...Object.keys(e.paid), ...Object.keys(e.owed)])]);
  const people = {};
  for (const id of ids) { const p = st.people[id]; if (p) people[f(id)] = { id: f(id), name: p.name, upi: p.upi || '', updatedAt: p.updatedAt || p.createdAt || 0 }; }
  const expenses = {};
  for (const e of exps) { const { gid: _g, imported: _i, ...rest } = mapExp(e, f); expenses[rest.id] = rest; }
  const comments = {};
  for (const c of Object.values(st.comments || {})) if (c.gid === gid) { const { gid: _g, ...rest } = c; comments[c.id] = { ...rest, by: f(c.by) }; }
  const meta = g.metaAt ? { removed: (g.removed || []).map(f), cur: g.cur || null, budget: g.budget || null, start: g.start || null, end: g.end || null, at: g.metaAt } : null;
  return { name: g.name, nameAt: g.nameAt || g.createdAt || 0, members: g.members.map(f), people, expenses, comments, meta };
}

/** Write merged remote data into local state. Returns how many expenses changed. */
export function apply(gid, raw) {
  const data = cleanGroup(raw); // the server cleans too; never trust the wire
  const st = S.state, g = st.groups[gid], f = toLocal(g);
  let changed = 0;
  for (const rid in data.people) {
    const lid = f(rid), rp = data.people[rid];
    const lp = st.people[lid];
    if (!lp) { st.people[lid] = { id: lid, name: rp.name, phone: '', upi: rp.upi || '', createdAt: rp.updatedAt || Date.now(), updatedAt: rp.updatedAt || 0 }; changed++; }
    else if (lid !== st.me && (rp.updatedAt || 0) > (lp.updatedAt || 0)) { lp.name = rp.name; lp.upi = rp.upi; lp.updatedAt = rp.updatedAt; }
    if (lp?.deleted && lid !== st.me) lp.deleted = false;
  }
  for (const id in data.expenses) {
    const re = mapExp(data.expenses[id], f);
    const le = st.expenses[id];
    // Compare in the shared (remote id) form so every phone breaks ties the same way.
    if (isNewer(data.expenses[id], le && mapExp(le, toRemote(g)))) {
      st.expenses[id] = { ...re, gid, receiptId: re.receiptId || le?.receiptId };
      changed++;
    }
  }
  st.comments ||= {};
  for (const id in data.comments || {}) {
    const rc = data.comments[id], lc = st.comments[id];
    if (!lc || (rc.updatedAt || 0) > (lc.updatedAt || 0) || ((rc.updatedAt || 0) === (lc.updatedAt || 0) && JSON.stringify(rc) > JSON.stringify({ ...lc, gid: undefined }))) { st.comments[id] = { ...rc, gid, by: f(rc.by) }; changed++; }
  }
  const members = data.members.map(f);
  for (const m of members) if (!g.members.includes(m)) { g.members.push(m); changed++; }
  // Members cannot change group settings, so the server's copy always wins on their phones.
  const member = g.live?.admin === false;
  if (data.meta && (member ? JSON.stringify(data.meta) !== JSON.stringify(g.metaSeen || null) : (data.meta.at || 0) > (g.metaAt || 0))) { g.metaSeen = data.meta; Object.assign(g, { removed: (data.meta.removed || []).map(f), cur: data.meta.cur, budget: data.meta.budget, start: data.meta.start, end: data.meta.end, metaAt: data.meta.at }); changed++; }
  if ((data.nameAt || 0) > (g.nameAt || 0) || (member && (data.name !== g.name || data.nameAt !== g.nameAt))) { g.name = data.name; g.nameAt = data.nameAt; changed++; }
  return changed;
}

// Fingerprint of everything this phone could push for a group. Hashes every row's id and
// version, so an edit stamped with an older time (slow phone clock) still changes it.
export function sig(gid) {
  const st = S.state, g = st.groups[gid];
  let h = 0x811c9dc5;
  const mix = (str) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
  const rows = [];
  for (const e of Object.values(st.expenses)) if (e.gid === gid) rows.push(e.id + ':' + e.updatedAt);
  for (const c of Object.values(st.comments || {})) if (c.gid === gid) rows.push(c.id + ':' + c.updatedAt);
  rows.sort().forEach(mix);
  mix(`${g.name}|${g.nameAt || 0}|${g.members.join(',')}|${g.metaAt || 0}`);
  return `${rows.length}:${h.toString(36)}`;
}

let devId;
const device = () => (devId ||= (() => { try { let d = localStorage.getItem('hisaab:dev'); if (!d) { d = newKey().slice(0, 16); localStorage.setItem('hisaab:dev', d); } return d; } catch { return 'unknown-device'; } })());

const inflight = new Map(), again = new Set();
/**
 * Push + pull one live group. Resolves to {ok, changed} and never throws.
 * If called while a sync is running, one more sync runs right after it, so an edit made
 * mid-flight is never marked as sent without being sent.
 */
export function sync(gid, { push = true } = {}) {
  if (inflight.has(gid)) { if (push) again.add(gid); return inflight.get(gid); }
  const g = S.state.groups[gid];
  if (!g?.live?.key) return Promise.resolve({ ok: false });
  let wait = 400;
  const p = (async () => {
    try {
      const sent = sig(gid);
      // Push only when this phone has something new; otherwise just pull (cheap, never rate-limited).
      const roles = g.live.pendingRoles || null;
      push = push === 'force' || !!roles || (push && sent !== g.live.sig);
      const body = JSON.stringify({ ...(push ? { data: payload(gid) } : {}), ...(roles ? { roles } : {}), ...(typeof S.state.settings.push === 'string' ? { push: g.deleted ? '' : S.state.settings.push } : {}), histSince: g.live.histSeq || 0 });
      const r = await fetch(API + gid, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Key': g.live.key, 'X-Device': device(), 'X-Me': toRemote(g)(S.state.me) }, body });
      if (r.status === 429) { again.add(gid); wait = 3000; return { ok: false, error: 'Busy, will retry' }; }
      if (r.status === 403) { g.live.error = 'This live link was replaced'; S.save(); return { ok: false, error: g.live.error }; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { data, hist, roles: rr, denied } = await r.json();
      if (roles) delete g.live.pendingRoles;
      if (rr) {
        g.live.admin = !!rr.me?.admin; g.live.admins = (rr.admins || []).map(toLocal(g));
        g.live.wants = rr.me?.wants ? toLocal(g)(rr.me.wants) : null; g.live.rejected = !!rr.me?.rejected;
        g.live.pending = (rr.pending || []).map((p) => ({ ...p, wants: toLocal(g)(p.wants) }));
      }
      const refused = revertDenied(gid, data, denied);
      const changed = apply(gid, data) + applyHistory(gid, hist) + refused;
      if (refused) g.live.denied = { n: refused, at: Date.now() };
      if (push) g.live.sig = sent;
      if (sig(gid) !== g.live.sig) again.add(gid); // something changed while we were away
      g.live.syncedAt = Date.now();
      g.live.error = null;
      S.save();
      return { ok: true, changed };
    } catch (e) {
      g.live.error = navigator.onLine ? 'Could not sync' : 'Offline';
      return { ok: false, error: g.live.error };
    } finally {
      inflight.delete(gid);
      if (again.delete(gid)) setTimeout(() => sync(gid), wait);
    }
  })();
  inflight.set(gid, p);
  return p;
}

// The server refused some of this phone's changes (not allowed by group roles): put its copy back.
function revertDenied(gid, data, denied) {
  if (!Array.isArray(denied) || !denied.length) return 0;
  const st = S.state, g = st.groups[gid], f = toLocal(g);
  for (const id of denied) {
    const srv = data.expenses?.[id];
    if (srv) st.expenses[id] = { ...mapExp(srv, f), gid, receiptId: srv.receiptId || st.expenses[id]?.receiptId };
    else delete st.expenses[id];
  }
  return denied.length;
}

// Server-written history, translated to this phone's ids.
function applyHistory(gid, hist) {
  if (!Array.isArray(hist) || !hist.length) return 0;
  const g = S.state.groups[gid], f = toLocal(g);
  const mapIds = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v])) : o);
  const list = ((S.state.history ||= {})[gid] ||= []);
  const have = new Set(list.map((h) => h.seq).filter(Boolean));
  let n = 0;
  for (const h of hist) {
    if (!h || have.has(h.seq)) continue;
    const ch = {};
    for (const k in h.changes || {}) ch[k] = k === 'paid' || k === 'owed' ? h.changes[k].map(mapIds) : h.changes[k];
    list.push({ ...h, by: h.by ? f(h.by) : h.by, paid: mapIds(h.paid), owed: mapIds(h.owed), changes: ch });
    g.live.histSeq = Math.max(g.live.histSeq || 0, h.seq);
    n++;
  }
  if (list.length > 3000) list.splice(0, list.length - 3000);
  return n;
}

/** Fetch a group someone shared, without saving anything locally. */
export async function peek(gid, key) {
  const r = await fetch(API + gid, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Key': key }, body: '{}' });
  if (r.status === 403) throw new Error('This link is not valid any more. Ask for a new one.');
  if (!r.ok) throw new Error('Could not reach the group. Check your connection.');
  return cleanGroup((await r.json()).data);
}

export const remoteId = (gid, localId) => toRemote(S.state.groups[gid])(localId);
/** New key for a live group: everyone holding the old link loses access. */
export async function rotate(gid) {
  const g = S.state.groups[gid];
  const next = newKey();
  const r = await fetch(API + gid, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Key': g.live.key, 'X-New-Key': next }, body: '{}' });
  if (!r.ok) throw new Error('Could not reset the link. Check your connection.');
  g.live.key = next;
  S.save();
}
/** Upload one bill photo for a live group. Resolves true when the server has it. */
export async function uploadPhoto(gid, rid, blob) {
  const g = S.state.groups[gid];
  if (!g?.live?.key || !blob) return false;
  try {
    const r = await fetch(`${API}${gid}/photo/${rid}`, { method: 'PUT', headers: { 'Content-Type': blob.type || 'image/jpeg', 'X-Key': g.live.key }, body: blob });
    return r.ok;
  } catch { return false; }
}
/** Fetch a bill photo someone else in the group took. */
export async function downloadPhoto(gid, rid) {
  const g = S.state.groups[gid];
  if (!g?.live?.key) return null;
  try {
    const r = await fetch(`${API}${gid}/photo/${rid}`, { headers: { 'X-Key': g.live.key } });
    return r.ok ? await r.blob() : null;
  } catch { return null; }
}
export const liveLink = (gid) => `${location.origin}${location.pathname}#/join/${gid}~${S.state.groups[gid].live.key}`;
export { mergeGroup };
