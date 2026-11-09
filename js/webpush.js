// Web Push without payloads: we only wake the phone; its service worker fetches the text from
// our server. So push services never see bill details, and no payload encryption is needed.
// VAPID (RFC 8292): an ES256 JWT signed with our private key proves the push came from us.

import { fmt } from './money.js';

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = (s) => new TextEncoder().encode(s);

let keyCache = null;
async function signingKey(jwk) {
  if (keyCache?.jwk === jwk) return keyCache.key;
  const key = await crypto.subtle.importKey('jwk', JSON.parse(jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  keyCache = { jwk, key };
  return key;
}

/** VAPID JWT for one push service origin. WebCrypto returns r||s, exactly what ES256 wants. */
export async function vapidJWT(audience, privateJwk, subject, now = Date.now()) {
  const header = b64u(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(utf8(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(privateJwk), utf8(`${header}.${claims}`));
  return `${header}.${claims}.${b64u(sig)}`;
}

/**
 * Send an empty push. Resolves to the HTTP status: 201 ok, 404/410 mean the subscription is gone.
 * Only https endpoints on the known push services are allowed (no turning us into a request proxy).
 */
const PUSH_HOSTS = /(^|\.)(googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com|web\.push\.apple\.com)$/;
export function allowedEndpoint(endpoint) {
  try { const u = new URL(endpoint); return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname); } catch { return false; }
}
export async function sendPush(endpoint, publicKey, privateJwk, subject, urgency = 'normal') {
  if (!allowedEndpoint(endpoint)) return 400;
  const jwt = await vapidJWT(new URL(endpoint).origin, privateJwk, subject);
  const r = await fetch(endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: urgency, Authorization: `vapid t=${jwt}, k=${publicKey}`, 'Content-Length': '0' } });
  return r.status;
}

/** Notification text for entries just written: who, what, how much. */
export function pushLines(items, data) {
  const name = (id) => String(data.people?.[id]?.name || 'Someone').split(' ')[0];
  const cur = data.meta?.cur || '₹';
  const verb = { add: 'added', edit: 'changed', delete: 'deleted', restore: 'restored' };
  const lines = items.slice(-4).map((h) => `${name(h.by)} ${verb[h.kind] || 'changed'} ${String(h.desc || 'an entry').slice(0, 40)} · ${fmt(h.amount || 0, cur)}`);
  return { title: String(data.name || 'Hisaab').slice(0, 60), body: lines.join('\n') + (items.length > 4 ? `\nand ${items.length - 4} more` : '') };
}

/** Next Sunday 10:00 on this phone's clock (today counts if it is still before 10). */
export function nextNudgeAt(now = new Date()) {
  const d = new Date(now);
  d.setHours(10, 0, 0, 0);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  if (d <= now) d.setDate(d.getDate() + 7);
  return d.getTime();
}
