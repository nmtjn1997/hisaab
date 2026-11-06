// Live groups: push local changes, pull everyone else's, merge by updatedAt.
// The group key lives only on devices and in the link's #fragment.
import * as S from './store.js';
import { mergeGroup } from './merge.js';

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
  for (const e of exps) { const { gid: _g, receiptId: _r, imported: _i, ...rest } = mapExp(e, f); expenses[rest.id] = rest; }
  const comments = {};
  for (const c of Object.values(st.comments || {})) if (c.gid === gid) { const { gid: _g, ...rest } = c; comments[c.id] = { ...rest, by: f(c.by) }; }
  return { name: g.name, nameAt: g.nameAt || g.createdAt || 0, members: g.members.map(f), people, expenses, comments };
}

/** Write merged remote data into local state. Returns how many expenses changed. */
export function apply(gid, data) {
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
    if (!le || (re.updatedAt || 0) > (le.updatedAt || 0)) {
      st.expenses[id] = { ...re, gid, receiptId: le?.receiptId };
      changed++;
    }
  }
  st.comments ||= {};
  for (const id in data.comments || {}) {
    const rc = data.comments[id], lc = st.comments[id];
    if (!lc || (rc.updatedAt || 0) > (lc.updatedAt || 0)) { st.comments[id] = { ...rc, gid, by: f(rc.by) }; changed++; }
  }
  const members = data.members.map(f);
  for (const m of members) if (!g.members.includes(m)) { g.members.push(m); changed++; }
  if ((data.nameAt || 0) > (g.nameAt || 0)) { g.name = data.name; g.nameAt = data.nameAt; changed++; }
  return changed;
}

const inflight = new Map();
/** Push + pull one live group. Resolves to {ok, changed} and never throws. */
export function sync(gid, { push = true } = {}) {
  if (inflight.has(gid)) return inflight.get(gid);
  const g = S.state.groups[gid];
  if (!g?.live?.key) return Promise.resolve({ ok: false });
  const p = (async () => {
    try {
      const body = push ? JSON.stringify({ data: payload(gid) }) : '{}';
      const r = await fetch(API + gid, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Key': g.live.key }, body });
      if (r.status === 403) { g.live.error = 'This live link was replaced'; S.save(); return { ok: false, error: g.live.error }; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { data } = await r.json();
      const changed = apply(gid, data);
      g.live.syncedAt = Date.now();
      g.live.error = null;
      S.save();
      return { ok: true, changed };
    } catch (e) {
      g.live.error = navigator.onLine ? 'Could not sync' : 'Offline';
      return { ok: false, error: g.live.error };
    } finally { inflight.delete(gid); }
  })();
  inflight.set(gid, p);
  return p;
}

/** Fetch a group someone shared, without saving anything locally. */
export async function peek(gid, key) {
  const r = await fetch(API + gid, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Key': key }, body: '{}' });
  if (r.status === 403) throw new Error('This link is not valid any more. Ask for a new one.');
  if (!r.ok) throw new Error('Could not reach the group. Check your connection.');
  return (await r.json()).data;
}

export const remoteId = (gid, localId) => toRemote(S.state.groups[gid])(localId);
export const liveLink = (gid) => `${location.origin}${location.pathname}#/join/${gid}~${S.state.groups[gid].live.key}`;
export { mergeGroup };
