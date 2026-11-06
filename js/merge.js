// Shared-group merge, used by the browser and the sync Worker alike.
// Every record carries updatedAt; the newer copy wins. Deletes are soft (deleted: true)
// so a delete on one phone beats an older edit on another.

// Ids become object keys and HTML attributes: word chars only, never a prototype key.
const ID = /^(?!__proto__$|constructor$|prototype$)[\w:-]{1,40}$/;
const CATS = new Set(['general', 'food', 'groceries', 'travel', 'fuel', 'home', 'fun', 'shopping', 'health', 'settle']);
const MODES = new Set(['equal', 'exact', 'percent', 'shares', 'items']);
const str = (s, n) => String(s ?? '').slice(0, n);
const int = (n) => (Number.isFinite(+n) ? Math.round(+n) : 0);
const idMap = (o, num = int) => {
  const out = {};
  if (o && typeof o === 'object') for (const k in o) if (ID.test(k)) out[k] = num(o[k]);
  return out;
};

function cleanExpense(e) {
  if (!e || !ID.test(e.id)) return null;
  return {
    id: e.id,
    kind: e.kind === 'settle' ? 'settle' : 'expense',
    desc: str(e.desc, 80),
    amount: int(e.amount),
    date: int(e.date),
    category: CATS.has(e.category) ? e.category : 'general',
    paid: idMap(e.paid),
    owed: idMap(e.owed),
    split: e.split && typeof e.split === 'object' ? { mode: MODES.has(e.split.mode) ? e.split.mode : 'exact', parts: idMap(e.split.parts, (v) => (Number.isFinite(+v) ? +v : 0)) } : { mode: 'exact', parts: {} },
    items: Array.isArray(e.items) ? e.items.slice(0, 100).map((i) => ({ name: str(i.name, 40), amount: int(i.amount), who: (Array.isArray(i.who) ? i.who : []).filter((w) => ID.test(w)).slice(0, 50) })) : null,
    note: str(e.note, 200),
    text: e.text ? str(e.text, 300) : undefined,
    deleted: !!e.deleted,
    repeat: e.repeat && (e.repeat.every === 'month' || e.repeat.every === 'week') ? { every: e.repeat.every, until: e.repeat.until ? int(e.repeat.until) : undefined } : null,
    repeatOf: ID.test(e.repeatOf || '') ? e.repeatOf : undefined,
    by: ID.test(e.by || '') ? e.by : undefined,
    editedBy: ID.test(e.editedBy || '') ? e.editedBy : undefined,
    createdAt: int(e.createdAt),
    updatedAt: int(e.updatedAt),
  };
}

/** Validate and trim untrusted group data. */
export function cleanGroup(g) {
  if (!g || typeof g !== 'object') return { name: '', nameAt: 0, members: [], people: {}, expenses: {}, comments: {} };
  const people = {};
  for (const id in g.people || {}) {
    if (!ID.test(id) || Object.keys(people).length >= 200) continue;
    const p = g.people[id];
    people[id] = { id, name: str(p?.name, 40) || '?', upi: str(p?.upi, 60), updatedAt: int(p?.updatedAt) };
  }
  const expenses = {};
  for (const id in g.expenses || {}) {
    if (Object.keys(expenses).length >= 5000) break;
    const e = cleanExpense(g.expenses[id]);
    if (e && e.id === id) expenses[id] = e;
  }
  const comments = {};
  for (const id in g.comments || {}) {
    const c = g.comments[id];
    if (!ID.test(id) || !c || !ID.test(c.eid || '') || !ID.test(c.by || '') || Object.keys(comments).length >= 5000) continue;
    comments[id] = { id, eid: c.eid, by: c.by, text: str(c.text, 300), deleted: !!c.deleted, createdAt: int(c.createdAt), updatedAt: int(c.updatedAt) };
  }
  return {
    comments,
    name: str(g.name, 50),
    nameAt: int(g.nameAt),
    members: (Array.isArray(g.members) ? g.members : []).filter((m) => ID.test(m)).slice(0, 200),
    people,
    expenses,
  };
}

// Total order on versions so every phone and the server pick the same winner: later time wins;
// on an exact tie (two slow clocks), the editor id then the content decide. Never "first arrived".
export function isNewer(y, x) {
  if (!x) return true;
  if (!y) return false;
  const a = y.updatedAt || 0, b = x.updatedAt || 0;
  if (a !== b) return a > b;
  const ea = y.editedBy || y.by || '', eb = x.editedBy || x.by || '';
  if (ea !== eb) return ea > eb;
  return canon(y) > canon(x);
}

// Same bytes on every phone and the server for the same expense, whatever the key order.
const stable = (v) => (v && typeof v === 'object' ? (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',')}}`) : JSON.stringify(v ?? null));
export const canon = (e) => stable(e && e.amount !== undefined ? cleanExpense(e) : e);
const newer = (x, y) => (isNewer(y, x) ? y : x);

export function mergeGroup(a, b) {
  if (!a) return b;
  if (!b) return a;
  const expenses = { ...a.expenses };
  for (const id in b.expenses) expenses[id] = newer(expenses[id], b.expenses[id]);
  const people = { ...a.people };
  for (const id in b.people) people[id] = newer(people[id], b.people[id]);
  const comments = { ...(a.comments || {}) };
  for (const id in b.comments || {}) comments[id] = newer(comments[id], b.comments[id]);
  const named = (b.nameAt || 0) > (a.nameAt || 0) ? b : a;
  return { name: named.name || a.name || b.name, nameAt: named.nameAt || 0, members: [...new Set([...(a.members || []), ...(b.members || [])])], people, expenses, comments };
}
