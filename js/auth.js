// Optional Google sign-in, checked on our server. Google's ID token proves who the person is;
// we then hand out our own signed session so the phone does not need Google again for 90 days.
// The account id we store is a hash of Google's user id, never the email.

const b64uDecode = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = (s) => new TextEncoder().encode(s);
const json = (s) => JSON.parse(new TextDecoder().decode(b64uDecode(s)));

/**
 * Verify a Google ID token (RS256). `keys` is Google's JWKS `keys` array.
 * Returns {sub, email, name} or throws.
 */
export async function verifyGoogleToken(jwt, clientId, keys, now = Date.now()) {
  const [h, p, s] = String(jwt).split('.');
  if (!s) throw new Error('malformed');
  const head = json(h), claims = json(p);
  const jwk = keys.find((k) => k.kid === head.kid);
  if (head.alg !== 'RS256' || !jwk) throw new Error('unknown key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uDecode(s), utf8(`${h}.${p}`)))) throw new Error('bad signature');
  if (claims.aud !== clientId) throw new Error('wrong audience');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('wrong issuer');
  if (!(claims.exp * 1000 > now)) throw new Error('expired');
  if (!claims.sub) throw new Error('no subject');
  return { sub: String(claims.sub), email: String(claims.email || ''), name: String(claims.name || '') };
}

const hmacKey = (secret) => crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/** Our session: base64url(JSON {u, exp}) + '.' + HMAC. `u` is the account id. */
export async function makeSession(uidHash, secret, days = 90, now = Date.now()) {
  const body = b64u(utf8(JSON.stringify({ u: uidHash, exp: now + days * 864e5 })));
  return `${body}.${b64u(await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(body)))}`;
}

/** Account id from a session, or null if it is forged or expired. */
export async function readSession(token, secret, now = Date.now()) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), b64uDecode(sig), utf8(body)))) return null;
    const d = json(body);
    return d.exp > now && /^[0-9a-f]{32}$/.test(d.u) ? d.u : null;
  } catch { return null; }
}
