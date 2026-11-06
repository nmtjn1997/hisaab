// Local-first state: one JSON blob in localStorage, receipts as blobs in IndexedDB.
import { balances, sumVals } from './money.js';

const KEY = 'hisaab:v1';
const listeners = new Set();

export const uid = () => {
  const a = crypto.getRandomValues(new Uint8Array(6));
  return Date.now().toString(36).slice(-4) + [...a].map((b) => (b % 36).toString(36)).join('');
};

const empty = () => ({ v: 1, me: null, people: {}, groups: {}, expenses: {}, comments: {}, settings: { theme: 'system', cur: '₹' }, lastGroup: null });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) return { ...empty(), ...s, settings: { ...empty().settings, ...s.settings } };
  } catch {}
  return empty();
}

export let state = load();
let t;
export function save() {
  clearTimeout(t);
  t = setTimeout(flush, 120);
  listeners.forEach((f) => f());
}
export function flush() {
  clearTimeout(t);
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { listeners.forEach((f) => f('quota')); }
}
export const onChange = (f) => listeners.add(f);
addEventListener('storage', (e) => { if (e.key === KEY) { state = load(); listeners.forEach((f) => f('external')); } });
addEventListener('pagehide', flush);

export function replaceState(s) { state = { ...empty(), ...s, settings: { ...empty().settings, ...(s.settings || {}) } }; flush(); listeners.forEach((f) => f()); }

// ---------- people ----------
export function addPerson(name, extra = {}) {
  name = String(name).trim().slice(0, 40);
  const existing = Object.values(state.people).find((p) => p.name.toLowerCase() === name.toLowerCase() && !p.deleted);
  if (existing) return existing.id;
  const id = uid();
  state.people[id] = { id, name, phone: '', upi: '', createdAt: Date.now(), ...extra };
  save();
  return id;
}
export const person = (id) => state.people[id] || { id, name: 'Unknown', missing: true };
export const pname = (id, you = true) => (id === state.me && you ? 'You' : person(id).name);
export const firstName = (id) => (id === state.me ? 'You' : person(id).name.split(' ')[0]);

// ---------- groups ----------
export function addGroup(name, memberIds = []) {
  const id = uid();
  state.groups[id] = { id, name: String(name).trim().slice(0, 50) || 'Group', members: [...new Set([state.me, ...memberIds])], createdAt: Date.now(), simplify: true, hue: Math.floor(Math.random() * 360) };
  state.lastGroup = id;
  save();
  return id;
}
export const groupList = () => Object.values(state.groups).filter((g) => !g.deleted && !g.archived).sort((a, b) => lastActivity(b) - lastActivity(a));
export function lastActivity(g) {
  let m = g.createdAt;
  for (const e of Object.values(state.expenses)) if (e.gid === g.id && !e.deleted && e.updatedAt > m) m = e.updatedAt;
  return m;
}

// ---------- expenses ----------
export const groupExpenses = (gid) => Object.values(state.expenses).filter((e) => e.gid === gid && !e.deleted).sort((a, b) => b.date - a.date || b.createdAt - a.createdAt);
export const allExpenses = () => Object.values(state.expenses).filter((e) => !e.deleted && state.groups[e.gid] && !state.groups[e.gid].deleted);
export function upsertExpense(e) {
  const now = Date.now();
  const id = e.id || uid();
  const prev = state.expenses[id];
  state.expenses[id] = { ...prev, ...e, id, by: prev?.by || e.by || state.me, editedBy: state.me, createdAt: prev?.createdAt || now, updatedAt: now };
  if (e.gid) state.lastGroup = e.gid;
  save();
  return id;
}
export function softDelete(id, flag = true) { if (state.expenses[id]) { state.expenses[id].deleted = flag; state.expenses[id].editedBy = state.me; state.expenses[id].updatedAt = Date.now(); save(); } }

// ---------- comments ----------
export function addComment(gid, eid, text) {
  const id = uid(), now = Date.now();
  (state.comments ||= {})[id] = { id, gid, eid, by: state.me, text: String(text).trim().slice(0, 300), createdAt: now, updatedAt: now };
  save();
  return id;
}
export const commentsFor = (eid) => Object.values(state.comments || {}).filter((c) => c.eid === eid && !c.deleted).sort((a, b) => a.createdAt - b.createdAt);
export function deleteComment(id) { const c = state.comments?.[id]; if (c) { c.deleted = true; c.updatedAt = Date.now(); save(); } }

export const groupBalances = (gid) => balances(groupExpenses(gid));
export function myTotals() {
  const b = balances(allExpenses());
  return { net: b[state.me] || 0 };
}
export function spendOf(exps, pid) {
  // what pid consumed (their share), what they paid, excluding settlements
  let share = 0, paid = 0, total = 0;
  for (const e of exps) {
    if (e.kind === 'settle') continue;
    total += e.amount;
    share += e.owed[pid] || 0;
    paid += e.paid[pid] || 0;
  }
  return { share, paid, total };
}
export { sumVals };

// ---------- receipts (IndexedDB) ----------
let dbp;
function db() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('hisaab', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('receipts');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
export async function putReceipt(id, blob) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('receipts', 'readwrite'); tx.objectStore('receipts').put(blob, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
export async function getReceipt(id) { const d = await db(); return new Promise((res) => { const r = d.transaction('receipts').objectStore('receipts').get(id); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); }
