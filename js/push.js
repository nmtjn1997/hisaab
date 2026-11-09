// Push notifications. The phone subscribes once; the server wakes it with an empty push and the
// service worker fetches the text from /push/inbox. Settings keep `push` = endpoint ('' = off).
import * as S from './store.js';
import { VAPID_PUBLIC } from './push-key.js';
import { nextNudgeAt } from './webpush.js';

const BASE = 'https://hisaab-sync.backinstock.workers.dev/push/';
const key = () => Uint8Array.from(atob(VAPID_PUBLIC.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** 'on' | 'off' | 'blocked' | 'unsupported' | 'install' (iPhone outside the home screen app) */
export function status() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return ios && !navigator.standalone ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return S.state.settings.push && Notification.permission === 'granted' ? 'on' : 'off';
}

const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Tell the server the subscription and the weekly nudge line (null = nothing owed, no nudge). */
export async function register(nudgeText) {
  const endpoint = S.state.settings.push;
  if (!endpoint) return;
  await post('sub', { endpoint, nudgeAt: nudgeText ? nextNudgeAt() : null, nudgeText: nudgeText || '' });
  S.state.settings.pushAt = Date.now();
  S.save();
}

export async function enable(nudgeText) {
  if (await Notification.requestPermission() !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key() }));
  S.state.settings.push = sub.endpoint;
  await register(nudgeText);
  return true;
}

export async function disable() {
  const endpoint = S.state.settings.push;
  if (!endpoint) return; // never switched on here
  S.state.settings.push = ''; // live groups learn it on their next sync
  S.save();
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription().catch(() => null);
  await sub?.unsubscribe().catch(() => {});
  if (endpoint) await post('sub', { endpoint, off: true }).catch(() => {});
}
