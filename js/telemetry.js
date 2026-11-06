// Anonymous usage stats: a random install id, screen names with ids stripped, feature counts
// and crash messages. Never names, amounts, notes, bill text or group keys.
const BASE = 'https://hisaab-sync.backinstock.workers.dev';
const VERSION = '2026.11.06';
let queue = [], timer = null, enabledFn = () => true;

function uid() {
  try {
    let id = localStorage.getItem('hisaab:uid');
    if (!id) {
      id = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
      localStorage.setItem('hisaab:uid', id);
      queue.push({ type: 'first_open', route: '/' });
    }
    return id;
  } catch { return 'nostorage0000'; }
}
const platform = () => (/iphone|ipad|ios/i.test(navigator.userAgent) ? 'ios' : /android/i.test(navigator.userAgent) ? 'android' : 'desktop') + (matchMedia('(display-mode: standalone)').matches ? '-app' : '');
const ref = (() => { try { const h = document.referrer && new URL(document.referrer).hostname; return h && h !== location.hostname ? h : ''; } catch { return ''; } })();

// "/g/abc123/balances" -> "/g/:id/balances"; keys and queries never leave the phone.
export const routeOf = (path) => String(path || '/').split('?')[0].replace(/\/(g|e|p|join|import)\/[^/]+/g, '/$1/:id').slice(0, 40);

export function initTelemetry(isEnabled) {
  enabledFn = isEnabled;
  uid();
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}

export function track(type, route, n = 1) {
  if (!enabledFn()) return;
  queue.push({ type, route: route ? routeOf(route) : undefined, n });
  if (queue.length >= 25) flush();
  else { clearTimeout(timer); timer = setTimeout(flush, 8000); }
}

export function flush() {
  if (!queue.length || !enabledFn()) { queue = []; return; }
  const body = JSON.stringify({ uid: uid(), platform: platform(), version: VERSION, ref, events: queue.splice(0, 50) });
  // text/plain keeps it a simple request (no CORS preflight) and sendBeacon survives page close.
  const blob = new Blob([body], { type: 'text/plain' });
  if (!navigator.sendBeacon?.(BASE + '/t', blob)) fetch(BASE + '/t', { method: 'POST', body, keepalive: true }).catch(() => {});
}

let sent = 0;
export function reportError(err, route) {
  if (!enabledFn() || sent >= 5) return; // a crash loop must not flood
  sent++;
  const e = err instanceof Error ? err : new Error(String(err?.message || err));
  const body = JSON.stringify({ uid: uid(), msg: e.message, stack: (e.stack || '').split('\n').slice(0, 8).join('\n'), route: routeOf(route), version: VERSION });
  fetch(BASE + '/e', { method: 'POST', body, keepalive: true }).catch(() => {});
}
