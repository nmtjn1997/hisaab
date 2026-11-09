// One simulated phone in its own thread: real store.js + sync.js + parse.js, its own storage,
// its own clock skew. Driven by messages from tests/sim/run.mjs.
import { parentPort, workerData } from 'node:worker_threads';

const real = Date.now;
Date.now = () => real() + (workerData.skew || 0); // this phone's clock is wrong on purpose
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const S = await import('../../js/store.js');
const Sync = await import('../../js/sync.js');
const { parseExpense } = await import('../../js/parse.js');
const { computeOwed, balances } = await import('../../js/money.js');
const st = () => S.state;
let gid = null;
const stats = { requests: 0, failed: 0, busy: 0, ms: [] };

const syncTimed = async (opts) => {
  const t = performance.now();
  const r = await Sync.sync(gid, opts);
  stats.requests++; stats.ms.push(performance.now() - t);
  if (!r.ok) { stats.failed++; if (/Busy/.test(r.error || '')) stats.busy++; }
  return r;
};
// Let chained follow-up syncs finish.
const settle = async () => { for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 450)); await syncTimed(); } };

function members() { return st().groups[gid].members; }
function addFromText(text) {
  const d = parseExpense(text, { people: Object.values(st().people), members: members(), me: st().me });
  const map = {};
  for (const n of d.newNames) map[n.id] = S.addPerson(n.name);
  const fix = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [map[k] || k, v]));
  const g = st().groups[gid];
  const paid = fix(d.paid), owed = fix(computeOwed(d.amount, d.split));
  for (const id of [...Object.keys(paid), ...Object.keys(owed)]) if (!g.members.includes(id)) g.members.push(id);
  return S.upsertExpense({ gid, desc: d.desc, amount: d.amount, date: d.date, category: d.category, paid, owed, split: { mode: 'exact', parts: owed }, text });
}

const handlers = {
  async create({ name, me, others }) {
    const id = S.uid();
    st().people[id] = { id, name: me, phone: '', upi: '', createdAt: Date.now() };
    st().me = id;
    gid = S.addGroup(name, others.map((n) => S.addPerson(n)));
    st().groups[gid].live = { key: Sync.newKey(), map: {} };
    const r = await syncTimed();
    if (!r.ok) throw new Error('go live failed: ' + r.error);
    return { gid, key: st().groups[gid].live.key, people: Object.fromEntries(Object.values(st().people).map((p) => [p.name, p.id])) };
  },
  async join({ gid: g, key, as }) {
    const d = await Sync.peek(g, key);
    st().me = as;
    st().people[as] = { id: as, name: d.people[as].name, phone: '', upi: '', createdAt: Date.now() };
    gid = g;
    st().groups[gid] = { id: gid, name: d.name, nameAt: d.nameAt, members: [as], createdAt: Date.now(), live: { key, map: {} } };
    Sync.apply(gid, d);
    await syncTimed();
    return { me: as };
  },
  async add({ text }) { const id = addFromText(text); await syncTimed(); return { id }; },
  async edit({ id, amount, removeMe, desc }) {
    const e = st().expenses[id];
    if (!e) return { missing: true };
    const owed = { ...e.owed };
    if (removeMe) delete owed[st().me];
    const total = amount ?? e.amount;
    const ids = Object.keys(owed);
    const split = computeOwed(total, { mode: 'equal', parts: Object.fromEntries(ids.map((k) => [k, 1])) });
    const payer = Object.keys(e.paid)[0];
    S.upsertExpense({ id, amount: total, desc: desc ?? e.desc, paid: { [payer]: total }, owed: split, split: { mode: 'exact', parts: split } });
    await syncTimed();
    return { ok: true };
  },
  async revert({ id }) {
    const { revertPatch } = await import('../../js/history.js');
    const h = [...S.historyFor(gid)].reverse().find((x) => x.eid === id && x.by !== st().me && x.kind !== 'add');
    if (!h) return { none: true };
    S.upsertExpense({ id, ...revertPatch(h) });
    await syncTimed();
    return { reverted: h.seq };
  },
  async rename({ name }) { const g = st().groups[gid]; g.name = name; g.nameAt = Date.now() + 1; S.save(); await syncTimed(); return {}; },
  async promote({ name }) { const g = st().groups[gid]; const pid = Object.values(st().people).find((p) => p.name === name).id; g.live.pendingRoles = { admins: { [Sync.remoteId(gid, pid)]: true } }; await Sync.sync(gid, { push: 'force' }); return {}; },
  async role() { const g = st().groups[gid]; return { admin: g.live.admin, admins: g.live.admins, name: g.name, wants: g.live.wants, pending: g.live.pending }; },
  async approveAll() { const g = st().groups[gid]; await syncTimed({ push: false }); g.live.pendingRoles = { approve: (g.live.pending || []).map((p) => p.id) }; await Sync.sync(gid, { push: 'force' }); return { approved: g.live.pendingRoles ? 0 : 1 }; },
  async del({ id }) { S.softDelete(id); await syncTimed(); return { ok: true }; },
  async pull() { await syncTimed({ push: false }); return {}; },
  async settle() { await settle(); return {}; },
  async ids() { return Object.values(st().expenses).filter((e) => e.gid === gid && !e.deleted).map((e) => e.id); },
  async dump() {
    const exps = Object.values(st().expenses).filter((e) => e.gid === gid).sort((a, b) => a.id.localeCompare(b.id));
    const live = exps.filter((e) => !e.deleted);
    const canon = exps.map((e) => [e.id, e.deleted ? 1 : 0, e.amount, e.desc, JSON.stringify(Object.entries(e.paid).sort()), JSON.stringify(Object.entries(e.owed).sort()), e.updatedAt].join('|'));
    const names = Object.fromEntries(Object.values(st().people).map((p) => [p.id, p.name]));
    const b = balances(live);
    return { canon, balances: Object.fromEntries(Object.entries(b).map(([k, v]) => [names[k] || k, v])), count: live.length, total: live.filter((e) => e.kind !== 'settle').reduce((a, e) => a + e.amount, 0), history: S.historyFor(gid), stats: { ...stats, avg: stats.ms.reduce((a, b) => a + b, 0) / (stats.ms.length || 1), max: Math.max(0, ...stats.ms) } };
  },
};

parentPort.on('message', async ({ id, op, args }) => {
  try { parentPort.postMessage({ id, ok: true, res: await handlers[op](args || {}) }); }
  catch (e) { parentPort.postMessage({ id, ok: false, err: e.stack || String(e) }); }
});
parentPort.postMessage({ ready: true });
