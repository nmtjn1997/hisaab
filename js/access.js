// Group roles, enforced by the sync server. Pure: the Worker and the tests run this same code.
//   admin:  add/remove people, rename, trip settings, edit or delete anyone's entry, make admins
//   member: add new entries, edit or delete their own, comment
// Identity is the phone's device key (no accounts). A device claims one person when it joins;
// the group creator's device starts as admin.

/** Register a device on first contact. Returns the (possibly new) access map. */
export function admit(access, dev, pid, isCreator) {
  const a = { ...(access || {}) };
  if (!dev) return a;
  // A person already used by another phone cannot be taken over: the new phone waits for an
  // admin to confirm it is really them (new phone, or someone pretending).
  const taken = (p) => p && Object.entries(a).some(([d, v]) => d !== dev && v.pid === p);
  if (!a[dev]) a[dev] = taken(pid) ? { pid: null, wants: pid, admin: false, at: Date.now() } : { pid: pid || null, admin: !!isCreator, at: Date.now() };
  else if (!a[dev].pid && !a[dev].wants && pid) a[dev] = taken(pid) ? { ...a[dev], wants: pid } : { ...a[dev], pid };
  return a;
}

/** Phones waiting for approval, as admins see them. `id` is a short handle, not the device key. */
export const pendingClaims = (access) => Object.entries(access || {}).filter(([, v]) => v.wants && !v.pid).map(([d, v]) => ({ id: d.slice(0, 10), wants: v.wants, at: v.at }));

export const adminPids = (access) => [...new Set(Object.values(access || {}).filter((d) => d.admin && d.pid).map((d) => d.pid))];

const refs = (e) => [...Object.keys(e.paid || {}), ...Object.keys(e.owed || {}), ...(e.items || []).flatMap((i) => i.who || [])];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Strip what this device may not change. `stored` is the server copy (or null for a new group),
 * `inc` the cleaned incoming group. Returns the filtered copy and the expense ids refused, so the
 * phone can put the server's version back.
 */
export function guard(stored, inc, who) {
  if (!stored || !inc || who?.admin) return { inc, denied: [] };
  const pid = who?.pid;
  const out = { ...inc, expenses: {}, comments: {}, people: { ...inc.people } };
  const denied = [];
  // Group-level settings are admin-only.
  out.name = stored.name; out.nameAt = stored.nameAt;
  out.meta = stored.meta || null;
  const known = new Set([...(stored.members || []), ...Object.keys(stored.people || {})]);
  out.members = (inc.members || []).filter((m) => (stored.members || []).includes(m) || m === pid);
  // People: a member may only rename themselves.
  for (const id in out.people) if (id !== pid && stored.people?.[id] && !same(out.people[id].name, stored.people[id].name)) out.people[id] = stored.people[id];
  for (const id in inc.expenses) {
    const n = inc.expenses[id], s = stored.expenses?.[id];
    if (!s) {
      // New entry: fine, as long as it only involves people already in the group (or yourself).
      if (refs(n).every((r) => known.has(r) || r === pid)) out.expenses[id] = n;
      else denied.push(id);
    } else if (same(n, s) || (n.updatedAt || 0) <= (s.updatedAt || 0)) {
      out.expenses[id] = n; // not a change, merge keeps the stored copy
    } else if (s.by && s.by === pid) {
      out.expenses[id] = n; // your own entry
    } else denied.push(id);
  }
  for (const id in inc.comments || {}) {
    const n = inc.comments[id], s = stored.comments?.[id];
    if (!s ? n.by === pid : s.by === pid || same(n, s)) out.comments[id] = n;
  }
  return { inc: out, denied };
}

/** Admin actions sent with a sync: {admins: {pid: true|false}}. Ignored unless the sender is admin. */
export function applyRoleOps(access, ops, who) {
  if (!who?.admin || (!ops?.admins && !ops?.approve && !ops?.reject)) return access;
  const a = { ...access };
  for (const id of ops.approve || []) for (const d in a) if (d.slice(0, 10) === id && a[d].wants) a[d] = { ...a[d], pid: a[d].wants, wants: undefined };
  for (const id of ops.reject || []) for (const d in a) if (d.slice(0, 10) === id && a[d].wants) a[d] = { ...a[d], wants: undefined, rejected: true };
  for (const [pid, on] of Object.entries(ops.admins || {})) {
    for (const dev in a) if (a[dev].pid === pid) a[dev] = { ...a[dev], admin: !!on };
  }
  // Never leave a group with no admin.
  if (!Object.values(a).some((d) => d.admin)) return access;
  return a;
}
