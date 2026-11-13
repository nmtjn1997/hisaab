// Optional account. Hisaab works fully without it; signing in only adds a backup of this phone's
// data to your Google account, which any phone you sign in on merges with what it already has.
// Google's script is loaded only when you tap sign in, so a signed-out phone talks to nobody.
import * as S from './store.js';
import { mergeState, backupPayload } from './backup.js';

const API = 'https://hisaab-sync.backinstock.workers.dev';
export const CLIENT_ID = '406542648201-28sa9k04p7gbkqt71hupko90rerb39ad.apps.googleusercontent.com';

export const account = () => S.state.settings.account || null;
export const signedIn = () => !!account()?.session;

const auth = () => ({ Authorization: 'Bearer ' + account().session });

/** Load Google's script once, on demand. */
function gis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return (gis.p ||= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = ok;
    s.onerror = () => { gis.p = null; fail(new Error('Could not reach Google')); };
    document.head.appendChild(s);
  }));
}

/** Google's own button, rendered into `el`. Resolves once the sign-in finishes. */
export async function renderButton(el, onDone) {
  await gis();
  google.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: async (res) => {
      try {
        const r = await fetch(API + '/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: res.credential }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'sign-in failed');
        S.state.settings.account = { session: d.session, email: d.email, name: d.name, rev: 0 };
        S.save();
        await pull();
        await push();
        onDone(null);
      } catch (e) { onDone(e); }
    },
  });
  google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: Math.min(360, el.clientWidth || 300) });
}

export function signOut() {
  delete S.state.settings.account;
  S.save();
  try { google?.accounts?.id?.disableAutoSelect(); } catch {}
}

/** Fetch the account copy and merge it into this phone. */
export async function pull() {
  if (!signedIn()) return { ok: false };
  const r = await fetch(API + '/me/backup', { headers: auth() });
  if (r.status === 401) { signOut(); return { ok: false, signedOut: true }; }
  if (!r.ok) return { ok: false };
  const d = await r.json();
  if (d.data) S.replaceState(mergeState(S.state, d.data));
  S.state.settings.account = { ...account(), rev: d.rev, at: d.at };
  S.save();
  S.flush();
  return { ok: true, rev: d.rev };
}

/**
 * Upload this phone's copy. The server refuses it if another phone saved in between, so we
 * merge that newer copy first and retry; no phone's entries can be overwritten.
 */
export async function push(retries = 2) {
  if (!signedIn()) return { ok: false };
  const a = account();
  const r = await fetch(API + '/me/backup', { method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ rev: a.rev || 0, data: backupPayload(S.state) }) });
  if (r.status === 401) { signOut(); return { ok: false, signedOut: true }; }
  if (r.status === 409 && retries > 0) { await pull(); return push(retries - 1); }
  if (r.status === 413) return { ok: false, error: 'Too much data to back up' };
  if (!r.ok) return { ok: false };
  const d = await r.json();
  S.state.settings.account = { ...account(), rev: d.rev, at: d.at };
  S.save();
  return { ok: true, rev: d.rev };
}

/** Back up after a change, batched so typing an expense is one upload, not ten. */
let timer = null;
export function schedulePush(ms = 4000) {
  if (!signedIn()) return;
  clearTimeout(timer);
  timer = setTimeout(() => push().catch(() => {}), ms);
}
