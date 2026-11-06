// Shared-group merge, used by the browser and the sync Worker alike.
// Every record carries updatedAt; the newer copy wins. Deletes are soft (deleted: true)
// so a delete on one phone beats an older edit on another.

const ID = /^[\w:-]{1,40}$/;
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
    category: str(e.category, 20),
    paid: idMap(e.paid),
    owed: idMap(e.owed),
    split: e.split && typeof e.split === 'object' ? { mode: str(e.split.mode, 10), parts: idMap(e.split.parts, (v) => (Number.isFinite(+v) ? +v : 0)) } : { mode: 'exact', parts: {} },
    items: Array.isArray(e.items) ? e.items.slice(0, 100).map((i) => ({ name: str(i.name, 40), amount: int(i.amount), who: (Array.isArray(i.who) ? i.who : []).filter((w) => ID.test(w)).slice(0, 50) })) : null,
    note: str(e.note, 200),
    text: e.text ? str(e.text, 300) : undefined,
    deleted: !!e.deleted,
    createdAt: int(e.createdAt),
    updatedAt: int(e.updatedAt),
  };
}

/** Validate and trim untrusted group data. */
export function cleanGroup(g) {
  if (!g || typeof g !== 'object') return { name: '', nameAt: 0, members: [], people: {}, expenses: {} };
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
  return {
    name: str(g.name, 50),
    nameAt: int(g.nameAt),
    members: (Array.isArray(g.members) ? g.members : []).filter((m) => ID.test(m)).slice(0, 200),
    people,
    expenses,
  };
}

const newer = (x, y) => (!x ? y : !y ? x : (y.updatedAt || 0) > (x.updatedAt || 0) ? y : x);

export function mergeGroup(a, b) {
  if (!a) return b;
  if (!b) return a;
  const expenses = { ...a.expenses };
  for (const id in b.expenses) expenses[id] = newer(expenses[id], b.expenses[id]);
  const people = { ...a.people };
  for (const id in b.people) people[id] = newer(people[id], b.people[id]);
  const named = (b.nameAt || 0) > (a.nameAt || 0) ? b : a;
  return { name: named.name || a.name || b.name, nameAt: named.nameAt || 0, members: [...new Set([...(a.members || []), ...(b.members || [])])], people, expenses };
}
