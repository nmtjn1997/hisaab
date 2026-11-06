// Edit history. In live groups the SERVER writes these entries when it accepts a change, so a
// phone cannot hide or rewrite what it did. Shared by the Worker and the app; no DOM here.

const FIELDS = ['amount', 'desc', 'date', 'category', 'paid', 'owed', 'kind'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** One history entry for a change from `o` (before, may be undefined) to `n` (after). */
export function diffEntry(o, n, extra = {}) {
  const kind = !o ? (n.deleted ? 'delete' : 'add') : n.deleted && !o.deleted ? 'delete' : !n.deleted && o.deleted ? 'restore' : 'edit';
  const changes = {};
  if (o) for (const f of FIELDS) if (!same(o[f], n[f])) changes[f] = [o[f] ?? null, n[f] ?? null];
  if (kind === 'edit' && !Object.keys(changes).length) return null; // only metadata moved
  return {
    eid: n.id,
    kind,
    by: n.editedBy || n.by || null,
    desc: n.desc,
    amount: n.amount,
    ...(kind === 'add' ? { paid: n.paid, owed: n.owed } : {}),
    changes,
    ...extra,
  };
}

/**
 * Human words plus warning flags for an entry.
 * Flags: amount_down, self_removed, self_share_down, someone_removed, payer_changed, deleted.
 */
export function describe(h, nameOf, money) {
  const who = nameOf(h.by);
  const flags = [];
  const parts = [];
  const c = h.changes || {};
  if (h.kind === 'add') return { text: `${who} added ${h.desc} · ${money(h.amount)}`, flags };
  if (h.kind === 'delete') { flags.push('deleted'); return { text: `${who} deleted ${h.desc} · ${money(h.amount)}`, flags }; }
  if (h.kind === 'restore') return { text: `${who} restored ${h.desc}`, flags };
  if (c.amount) {
    parts.push(`amount ${money(c.amount[0])} → ${money(c.amount[1])}`);
    if (c.amount[1] < c.amount[0]) flags.push('amount_down');
  }
  if (c.desc) parts.push(`name “${c.desc[0]}” → “${c.desc[1]}”`);
  if (c.date) parts.push('date');
  if (c.category) parts.push('category');
  if (c.paid) {
    const a = Object.keys(c.paid[0] || {}).sort().join(), b = Object.keys(c.paid[1] || {}).sort().join();
    parts.push(a !== b ? `paid by ${Object.keys(c.paid[1] || {}).map(nameOf).join(', ')}` : 'who paid how much');
    if (a !== b) flags.push('payer_changed');
  }
  if (c.owed) {
    const before = c.owed[0] || {}, after = c.owed[1] || {};
    const removed = Object.keys(before).filter((k) => !(k in after));
    const added = Object.keys(after).filter((k) => !(k in before));
    if (removed.length) parts.push(`removed ${removed.map(nameOf).join(', ')} from the split`);
    if (added.length) parts.push(`added ${added.map(nameOf).join(', ')} to the split`);
    if (!removed.length && !added.length) parts.push('shares');
    if (h.by && removed.includes(h.by)) flags.push('self_removed');
    else if (removed.length) flags.push('someone_removed');
    if (h.by && h.by in before && h.by in after && after[h.by] < before[h.by]) flags.push('self_share_down');
  }
  return { text: `${who} changed ${h.desc}: ${parts.join(', ') || 'details'}`, flags };
}

export const FLAG_TEXT = {
  amount_down: 'Amount lowered',
  self_removed: 'Removed themselves',
  self_share_down: 'Lowered own share',
  someone_removed: 'Removed someone',
  payer_changed: 'Payer changed',
  deleted: 'Deleted',
};

/** The fields to write to undo one history entry (puts the "before" values back). */
export function revertPatch(h) {
  if (h.kind === 'delete') return { deleted: false };
  if (h.kind === 'add') return { deleted: true };
  const patch = {};
  for (const [k, [before]] of Object.entries(h.changes || {})) patch[k] = before;
  if (patch.owed) patch.split = { mode: 'exact', parts: { ...patch.owed } };
  return patch;
}
