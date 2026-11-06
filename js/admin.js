// Hisaab admin dashboard. Reads anonymous aggregates from the sync Worker with a bearer token
// kept only on this device. Shows counts and timings, never names, amounts or bills.
const API = 'https://hisaab-sync.backinstock.workers.dev';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('en-IN');
const num = (n) => nf.format(+n || 0);
const SERIES = [
  ['expense_add', 'Expenses added', 'var(--s1)'],
  ['voice_done', 'Voice used', 'var(--s2)'],
  ['scan_ok', 'Bills scanned', 'var(--s3)'],
  ['settle', 'Settle ups', 'var(--s4)'],
  ['live_create', 'Live groups made', 'var(--s5)'],
  ['join', 'Joins', 'var(--s6)'],
];
const NAMES = { open: 'App opened', first_open: 'New install', view: 'Screen views', expense_add: 'Expenses added', add_by_text: 'Added by typing', add_by_scan: 'Added from a bill', add_by_form: 'Added with the form', voice_start: 'Mic opened', voice_done: 'Voice used', voice_cancel: 'Voice cancelled', scan_ok: 'Bill scanned', scan_empty: 'Scan read nothing', settle: 'Settle up', live_create: 'Live group made', join: 'Joined a live group', share_card: 'Shared balance image', share_pdf: 'Opened PDF report', repeat_set: 'Repeating expense set' };

let token = localStorage.getItem('hisaab:admin') || '';
let days = +(localStorage.getItem('hisaab:admin:days') || 30);
let logKind = 'errors', auto = true, timer = null;

async function get(path) {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 401) { token = ''; localStorage.removeItem('hisaab:admin'); throw new Error('unauthorized'); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const dayList = (n) => { const out = []; for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)); return out; };
const short = (d) => { const [, m, dd] = d.split('-'); return `${+dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]}`; };
const ago = (ts) => { const s = (Date.now() - ts) / 1000; return s < 60 ? `${Math.floor(s)}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : new Date(ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); };

// ---------- charts (plain SVG, one y-axis each, hover tooltips) ----------
const W = 600, H = 190, L = 36, B = 22, T = 8;
function niceMax(v) { if (v <= 4) return 4; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; }
function axes(max, labels) {
  const gl = [0, 0.25, 0.5, 0.75, 1].map((k) => { const y = T + (H - T - B) * (1 - k); return `<line class="gl" x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 6}" y="${y + 4}" text-anchor="end">${num(Math.round(max * k))}</text>`; }).join('');
  const step = Math.max(1, Math.ceil(labels.length / 7));
  const xs = labels.map((l, i) => (i % step === 0 || i === labels.length - 1 ? `<text class="ax" x="${xAt(i, labels.length)}" y="${H - 5}" text-anchor="middle">${esc(short(l))}</text>` : '')).join('');
  return gl + xs;
}
const xAt = (i, n) => L + ((W - L) * (i + 0.5)) / n;
const yAt = (v, max) => T + (H - T - B) * (1 - v / max);

function lineChart(el, labels, values, color, unit = '') {
  const max = niceMax(Math.max(...values, 1));
  const pts = values.map((v, i) => `${xAt(i, labels.length)},${yAt(v, max)}`);
  const area = `M${xAt(0, labels.length)},${yAt(0, max)} L${pts.join(' L')} L${xAt(labels.length - 1, labels.length)},${yAt(0, max)} Z`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${axes(max, labels)}
    <path d="${area}" fill="${color}" opacity=".12"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${values.map((v, i) => `<circle cx="${xAt(i, labels.length)}" cy="${yAt(v, max)}" r="${labels.length <= 31 ? 3 : 0}" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`).join('')}
    <line class="xh" y1="${T}" y2="${H - B}" x1="-10" x2="-10"/>
    ${labels.map((_, i) => `<rect class="hit" data-i="${i}" x="${L + ((W - L) * i) / labels.length}" y="0" width="${(W - L) / labels.length}" height="${H}"/>`).join('')}
  </svg><div class="tip" hidden></div>`;
  hover(el, (i) => `<b>${esc(short(labels[i]))}</b><br><span class="sw" style="background:${color}"></span>${num(values[i])}${unit}`, true);
}

function stackChart(el, labels, series) {
  const totals = labels.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
  const max = niceMax(Math.max(...totals, 1));
  const bw = Math.max(3, ((W - L) / labels.length) * 0.62);
  let bars = '';
  labels.forEach((_, i) => {
    let acc = 0;
    series.forEach((s, si) => {
      const v = s.values[i]; if (!v) return;
      const y0 = yAt(acc, max), y1 = yAt(acc + v, max);
      const top = series.slice(si + 1).every((x) => !x.values[i]);
      bars += `<rect x="${xAt(i, labels.length) - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1 - 2)}" rx="${top ? 4 : 0}" fill="${s.color}"/>`;
      acc += v;
    });
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${axes(max, labels)}${bars}
    ${labels.map((_, i) => `<rect class="hit" data-i="${i}" x="${L + ((W - L) * i) / labels.length}" y="0" width="${(W - L) / labels.length}" height="${H}"/>`).join('')}
  </svg><div class="tip" hidden></div><div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  hover(el, (i) => `<b>${esc(short(labels[i]))}</b> · ${num(totals[i])}<br>${series.filter((s) => s.values[i]).map((s) => `<span class="sw" style="background:${s.color}"></span>${esc(s.name)} ${num(s.values[i])}`).join('<br>') || 'nothing'}`);
}

function barChart(el, labels, values, color) {
  const max = niceMax(Math.max(...values, 1));
  const bw = Math.max(3, ((W - L) / labels.length) * 0.62);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${axes(max, labels)}
    ${values.map((v, i) => (v ? `<rect x="${xAt(i, labels.length) - bw / 2}" y="${yAt(v, max)}" width="${bw}" height="${yAt(0, max) - yAt(v, max)}" rx="4" fill="${color}"/>` : '')).join('')}
    ${labels.map((_, i) => `<rect class="hit" data-i="${i}" x="${L + ((W - L) * i) / labels.length}" y="0" width="${(W - L) / labels.length}" height="${H}"/>`).join('')}
  </svg><div class="tip" hidden></div>`;
  hover(el, (i) => `<b>${esc(short(labels[i]))}</b><br><span class="sw" style="background:${color}"></span>${num(values[i])}`);
}

function hover(el, html, crosshair) {
  const tip = $('.tip', el), svg = $('svg', el), xh = $('.xh', el);
  svg.addEventListener('pointermove', (e) => {
    const r = e.target.closest('.hit'); if (!r) return;
    const i = +r.dataset.i, box = svg.getBoundingClientRect(), n = svg.querySelectorAll('.hit').length;
    const x = (xAt(i, n) / W) * box.width;
    tip.hidden = false; tip.innerHTML = html(i);
    tip.style.left = Math.min(Math.max(x, 70), box.width - 70) + 'px'; tip.style.top = '24px';
    if (crosshair && xh) { xh.setAttribute('x1', xAt(i, n)); xh.setAttribute('x2', xAt(i, n)); }
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; if (xh) { xh.setAttribute('x1', -10); xh.setAttribute('x2', -10); } });
}

// ---------- tables ----------
function table(rows, cols, empty = 'No data yet') {
  if (!rows?.length) return `<p class="faint small">${empty}</p>`;
  const maxes = Object.fromEntries(cols.filter((c) => c.bar).map((c) => [c.k, Math.max(...rows.map((r) => +r[c.k] || 0), 1)]));
  return `<div class="scroll"><table class="t"><thead><tr>${cols.map((c) => `<th class="${c.n ? 'n' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => {
    const v = c.f ? c.f(r[c.k], r) : esc(r[c.k] ?? '');
    return c.bar ? `<td class="bar-cell"><i style="width:${((+r[c.k] || 0) / maxes[c.k]) * 100}%"></i><span>${v}</span></td>` : `<td class="${c.n ? 'n' : ''} ${c.cls || ''}">${v}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ---------- views ----------
function login(msg) {
  $('#root').innerHTML = `<form class="login card" id="lf"><div style="display:flex;gap:10px;align-items:center;margin-bottom:12px"><span class="logo">h</span><b style="font:800 20px var(--display)">Hisaab admin</b></div>
    <label class="field"><span>Admin token</span><input class="input mono" name="t" type="password" autocomplete="off" required></label>
    ${msg ? `<p class="small neg">${esc(msg)}</p>` : ''}
    <button class="btn primary block">Open dashboard</button>
    <p class="faint small" style="margin-top:12px">The token stays on this device only.</p></form>`;
  $('#lf').onsubmit = (e) => { e.preventDefault(); token = e.target.t.value.trim(); localStorage.setItem('hisaab:admin', token); load(); };
}

async function load() {
  if (!token) return login();
  clearInterval(timer);
  let d;
  try { d = await get(`/admin/stats?days=${days}`); } catch (e) { return login(e.message === 'unauthorized' ? 'That token was not accepted.' : 'Could not reach the server: ' + e.message); }
  const labels = dayList(days);
  const byDay = (arr, key) => { const m = Object.fromEntries((arr || []).map((r) => [r.day, +r[key] || 0])); return labels.map((l) => m[l] || 0); };
  const k = d.kpi || {}, s = d.syncKpi || {};
  const featureSeries = SERIES.map(([type, name, color]) => ({ name, color, values: labels.map((l) => +(d.daily.find((r) => r.day === l && r.type === type)?.n || 0)) }));
  const syncBadPct = s.n ? ((s.bad || 0) / s.n) * 100 : 0;
  $('#root').innerHTML = `
    <div class="adm-top"><h1><span class="logo">h</span>Hisaab admin <span class="live-dot" title="Auto refresh"></span></h1>
      <nav class="seg">${[7, 30, 90].map((n) => `<button data-days="${n}" aria-selected="${days === n}">${n} days</button>`).join('')}</nav>
      <button class="btn sm" id="refresh">Refresh</button><button class="btn sm ghost" id="logout">Lock</button>
      <span class="muted small">Updated ${new Date(d.generatedAt).toLocaleTimeString('en-IN', { timeStyle: 'short' })}</span></div>
    <div class="kpis">
      ${[['Active today', k.dau, 'people opened the app'], ['Active 7 days', k.wau, 'weekly users'], [`Active ${days} days`, k.mau, 'in this range'], ['All users', k.users, 'installs ever seen'], ['New users', k.new_users, `first open in ${days}d`], ['Expenses added', k.expenses, `in ${days} days`], ['Events today', k.events_today, 'all tracked actions'], ['Live groups', s.groups, `synced in ${days}d`], ['Sync requests', s.n, `${s.avg_ms ?? 0} ms average`], ['Sync errors', `${syncBadPct.toFixed(1)}%`, `${num(s.bad || 0)} failed`], ['Crashes today', k.errors_today, `${num(k.errors_period)} in ${days}d`]].map(([l, v, sub]) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${typeof v === 'string' ? esc(v) : num(v)}</div><div class="d">${esc(sub)}</div></div>`).join('')}
    </div>
    <div class="grid2">
      <section class="panel"><h2>Daily active users</h2><div class="sub">Distinct installs that opened the app each day</div><div class="chart" id="c-dau"></div></section>
      <section class="panel"><h2>What people do</h2><div class="sub">Key actions per day</div><div class="chart" id="c-feat"></div></section>
      <section class="panel"><h2>Live group syncs</h2><div class="sub">Requests per day</div><div class="chart" id="c-sync"></div></section>
      <section class="panel"><h2>Sync speed</h2><div class="sub">Average server time per day, ms</div><div class="chart" id="c-ms"></div></section>
      <section class="panel"><h2>Crashes</h2><div class="sub">Error reports per day</div><div class="chart" id="c-err"></div></section>
      <section class="panel"><h2>Retention</h2><div class="sub">Of people who first opened on a day, how many came back later</div>${table([...(d.retention || [])].reverse(), [{ h: 'First day', k: 'cohort', f: (v) => esc(short(v)) }, { h: 'Users', k: 'users', n: 1 }, { h: 'Came back', k: 'returned', n: 1 }, { h: 'Rate', k: 'returned', n: 1, f: (v, r) => `${Math.round(((+v || 0) / (+r.users || 1)) * 100)}%` }])}</section>
    </div>
    <div class="grid2">
      <section class="panel"><h2>Features</h2><div class="sub">Every tracked action in ${days} days</div>${table(d.byType, [{ h: 'Action', k: 'type', f: (v) => esc(NAMES[v] || v) }, { h: 'Count', k: 'n', bar: 1, f: num }, { h: 'Users', k: 'users', n: 1, f: num }])}</section>
      <section class="panel"><h2>Top screens</h2><div class="sub">Screen views, ids removed</div>${table(d.routes, [{ h: 'Screen', k: 'route', cls: 'mono' }, { h: 'Views', k: 'n', bar: 1, f: num }, { h: 'Users', k: 'users', n: 1, f: num }])}</section>
      <section class="panel"><h2>Devices</h2><div class="sub">Users by platform (-app means installed to the home screen)</div>${table(d.platforms, [{ h: 'Platform', k: 'platform' }, { h: 'Users', k: 'users', bar: 1, f: num }])}</section>
      <section class="panel"><h2>Versions & sources</h2><div class="sub">App versions in use, and sites that sent people</div>${table(d.versions, [{ h: 'Version', k: 'version', cls: 'mono' }, { h: 'Users', k: 'users', bar: 1, f: num }])}<div style="height:12px"></div>${table(d.refs, [{ h: 'Came from', k: 'ref' }, { h: 'Users', k: 'users', bar: 1, f: num }], 'No referrers yet (direct opens and WhatsApp links show none)')}</section>
    </div>
    <section class="panel" style="margin-top:14px"><h2>Live groups</h2><div class="sub">Hashed ids only. Sizes and counts, never names or amounts.</div>${table(d.groups, [{ h: 'Group', k: 'gid', cls: 'mono' }, { h: 'Last sync', k: 'last', f: ago }, { h: 'People', k: 'members', n: 1 }, { h: 'Expenses', k: 'expenses', n: 1 }, { h: 'Syncs', k: 'syncs', n: 1, f: num }, { h: 'Writes', k: 'writes', n: 1, f: num }, { h: 'Size', k: 'bytes', n: 1, f: (v) => `${((+v || 0) / 1024).toFixed(1)} KB` }])}</section>
    <section class="panel" style="margin-top:14px"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="flex:1">Logs</h2>
      <nav class="seg">${[['errors', 'Crashes'], ['events', 'Events'], ['syncs', 'Syncs']].map(([k_, l]) => `<button data-log="${k_}" aria-selected="${logKind === k_}">${l}</button>`).join('')}</nav>
      <label class="small muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="auto" ${auto ? 'checked' : ''}> Live (every 30s)</label></div>
      <div id="logs" style="margin-top:10px"><div class="sk" style="height:120px"></div></div></section>
    <p class="note-priv">Hisaab stores anonymous usage only: a random install id, screen names with ids removed, feature counts, crash messages and sync timings. Kept 90 days. People can switch it off in Settings &gt; Features.</p>`;

  lineChart($('#c-dau'), labels, byDay(d.dau, 'users'), 'var(--accent)', ' users');
  stackChart($('#c-feat'), labels, featureSeries);
  lineChart($('#c-sync'), labels, byDay(d.syncDaily, 'n'), 'var(--s1)', ' requests');
  lineChart($('#c-ms'), labels, byDay(d.syncDaily, 'avg_ms'), 'var(--s6)', ' ms');
  barChart($('#c-err'), labels, byDay(d.errs, 'n'), 'var(--critical)');

  document.querySelectorAll('[data-days]').forEach((b) => (b.onclick = () => { days = +b.dataset.days; localStorage.setItem('hisaab:admin:days', days); load(); }));
  document.querySelectorAll('[data-log]').forEach((b) => (b.onclick = () => { logKind = b.dataset.log; document.querySelectorAll('[data-log]').forEach((x) => x.setAttribute('aria-selected', x === b)); loadLogs(); }));
  $('#refresh').onclick = load;
  $('#logout').onclick = () => { localStorage.removeItem('hisaab:admin'); token = ''; login(); };
  $('#auto').onchange = (e) => { auto = e.target.checked; };
  loadLogs();
  timer = setInterval(() => { if (auto && document.visibilityState === 'visible') loadLogs(); }, 30000);
}

async function loadLogs() {
  const box = $('#logs'); if (!box) return;
  let rows;
  try { rows = await get(`/admin/logs?kind=${logKind}&limit=150`); } catch (e) { box.innerHTML = `<p class="small neg">${esc(e.message)}</p>`; return; }
  const when = { h: 'When', k: 'ts', f: ago };
  box.innerHTML = logKind === 'errors'
    ? table(rows, [when, { h: 'Screen', k: 'route', cls: 'mono' }, { h: 'Error', k: 'msg', cls: 'err-msg', f: (v, r) => `${esc(v)}${r.stack ? `<details><summary class="faint small">stack</summary><pre class="mono faint" style="white-space:pre-wrap">${esc(r.stack)}</pre></details>` : ''}` }, { h: 'Version', k: 'version', cls: 'mono' }, { h: 'User', k: 'uid', cls: 'mono' }], 'No crashes reported. Nice.')
    : logKind === 'events'
      ? table(rows, [when, { h: 'Action', k: 'type', f: (v) => esc(NAMES[v] || v) }, { h: 'Screen', k: 'route', cls: 'mono' }, { h: 'Platform', k: 'platform' }, { h: 'User', k: 'uid', cls: 'mono' }])
      : table(rows, [when, { h: 'Group', k: 'gid', cls: 'mono' }, { h: 'Result', k: 'status', f: (v) => `<span class="tag-st ${v < 400 ? 'ok-c' : 'bad-c'}">${v < 400 ? 'ok' : esc(v)}</span>` }, { h: 'Type', k: 'write', f: (v) => (v ? 'push' : 'pull') }, { h: 'Time', k: 'ms', n: 1, f: (v) => `${v} ms` }, { h: 'Expenses', k: 'expenses', n: 1 }, { h: 'Size', k: 'bytes', n: 1, f: (v) => `${((+v || 0) / 1024).toFixed(1)} KB` }]);
}

load();
