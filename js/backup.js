// Account backup merge. Two phones signed in to the same account each hold a full copy; merging
// keeps every record from both, and where both have one, the newer edit wins (ties keep this phone's).
// Settings and push stay per phone. A live group's sync position is per phone too.

const COLLECTIONS = ['people', 'groups', 'expenses', 'comments', 'history'];
const when = (r) => Math.max(r?.updatedAt || 0, r?.nameAt || 0, r?.metaAt || 0, r?.createdAt || 0);

/** What gets uploaded: everything except this phone's own settings. */
export function backupPayload(state) {
  const { settings, ...rest } = state;
  return rest;
}

export function mergeState(local, remote) {
  if (!remote) return local;
  const out = { ...local };
  for (const k of COLLECTIONS) {
    const a = local[k] || {}, b = remote[k] || {};
    const m = { ...a };
    for (const id in b) {
      if (!(id in a)) { m[id] = k === 'groups' && b[id].live ? { ...b[id], live: { key: b[id].live.key, map: b[id].live.map || {} } } : b[id]; continue; }
      if (when(b[id]) > when(a[id])) m[id] = k === 'groups' ? { ...b[id], live: a[id].live ?? b[id].live } : b[id];
    }
    out[k] = m;
  }
  // A fresh phone (nothing recorded yet) takes the account's identity instead of its own.
  const fresh = !Object.keys(local.expenses || {}).length;
  if (remote.me && (!local.me || (fresh && local.me !== remote.me))) {
    if (local.me && local.me !== remote.me && !Object.keys(remote.people || {}).includes(local.me)) {
      delete out.people[local.me];
      for (const id in out.groups) out.groups[id] = { ...out.groups[id], members: out.groups[id].members.map((m) => (m === local.me ? remote.me : m)) };
    }
    out.me = remote.me;
  }
  out.settings = local.settings;
  return out;
}

