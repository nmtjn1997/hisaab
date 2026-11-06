import * as S from './store.js';
import { fmt, toPaise, computeOwed, allocate, sumVals, simplify, pairwise, balances } from './money.js';
import { parseExpense, findPeople, assignItems, CATEGORIES } from './parse.js';
import { icon, catIcon } from './icons.js';
import { waLink, upiLink, packGroup, unpackGroup, groupSummaryText, splitwiseRows } from './share.js';

// ---------- tiny helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const st = () => S.state;
const cur = () => st().settings.cur || '₹';
const money = (p) => fmt(p, cur());
const buzz = () => navigator.vibrate?.(8);
const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (n) => String(n).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const av = (id, cls = '') => { const p = S.person(id); return `<span class="av ${cls}" style="--h:${hue(p.name)}" aria-hidden="true">${esc(initials(p.name))}</span>`; };
const avName = (name, cls = '') => `<span class="av ${cls}" style="--h:${hue(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayKey = (ts) => new Date(ts).toDateString();
const fmtDate = (ts) => { const d = new Date(ts), t = new Date(); if (dayKey(ts) === dayKey(t)) return 'Today'; t.setDate(t.getDate() - 1); if (dayKey(ts) === dayKey(t)) return 'Yesterday'; return `${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`; };
const isoDate = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const go = (h) => { if (location.hash === '#' + h) render(); else location.hash = h; };
const CAT_NAMES = { general: 'General', food: 'Food & drinks', groceries: 'Groceries', travel: 'Travel', fuel: 'Fuel', home: 'Home & bills', fun: 'Fun', shopping: 'Shopping', health: 'Health', settle: 'Settlement' };
const EXAMPLES = ['Dinner 1200 split with everyone', 'Uber 340 paid by Rahul', 'Petrol 2k, I paid 1500 Deepak paid 500, split 50-50', 'Groceries 900 only me and Priya', 'Rahul owes me 250 for chai', 'Hotel 6000 split 70-30 between me and Deepak'];

// ---------- toast / sheet / busy ----------
let toastT;
function toast(msg, opts = {}) {
  $('.toast')?.remove();
  clearTimeout(toastT);
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span>${opts.action ? `<button type="button">${esc(opts.action)}</button>` : ''}`;
  if (opts.action) el.querySelector('button').onclick = () => { el.remove(); opts.onAction(); };
  document.body.appendChild(el);
  toastT = setTimeout(() => el.remove(), opts.ms || 4000);
}
let closeSheet = null;
function sheet(html, mount) {
  closeSheet?.();
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const el = document.createElement('div');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = html;
  const prevFocus = document.activeElement;
  const close = () => { scrim.remove(); el.remove(); closeSheet = null; removeEventListener('keydown', onKey); prevFocus?.focus?.(); };
  const onKey = (e) => e.key === 'Escape' && close();
  scrim.onclick = close;
  addEventListener('keydown', onKey);
  document.body.append(scrim, el);
  closeSheet = close;
  mount?.(el, close);
  setTimeout(() => (el.querySelector('[autofocus]') || el.querySelector('button, input'))?.focus(), 60);
  return close;
}
const busy = async (btn, fn) => {
  if (!btn || btn.classList.contains('busy')) return;
  btn.classList.add('busy');
  try { await fn(); } catch (e) { console.error(e); toast(e.message || 'Something went wrong'); } finally { btn.classList.remove('busy'); }
};
function confirmSheet(title, body, okLabel, onOk, danger = true) {
  sheet(`<h3>${esc(title)}</h3><p class="muted">${esc(body)}</p><div class="btns" style="margin-top:18px"><button class="btn" data-x>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`, (el, close) => {
    el.querySelector('[data-x]').onclick = close;
    el.querySelector('[data-ok]').onclick = () => { close(); onOk(); };
  });
}

// ---------- domain helpers ----------
const memberList = (gid) => (st().groups[gid]?.members || []).filter((id) => st().people[id] && !st().people[id].deleted);
const peopleArr = () => Object.values(st().people).filter((p) => !p.deleted).map((p) => (p.id === st().me ? { ...p, aliases: ['me'] } : p));
function myGroupNet(gid) { return S.groupBalances(gid)[st().me] || 0; }
function personNets() { return pairwise(S.allExpenses(), st().me); }
function pairwiseInGroup(gid, other) { return pairwise(S.groupExpenses(gid), st().me)[other] || 0; }
function transfersFor(gid) {
  const g = st().groups[gid];
  const b = S.groupBalances(gid);
  if (g.simplify !== false) return simplify(b);
  // unsimplified: every pairwise debt, from each person's perspective
  const out = [];
  const ids = Object.keys(b).length ? memberList(gid) : [];
  const exps = S.groupExpenses(gid);
  for (const a of ids) {
    const pw = pairwise(exps, a);
    for (const k in pw) if (pw[k] > 0) out.push({ from: k, to: a, amount: pw[k] });
  }
  return out;
}
function impactLine(e) {
  const me = st().me;
  if (e.kind === 'settle') {
    const from = Object.keys(e.paid)[0], to = Object.keys(e.owed)[0];
    return { k: '', v: money(e.amount), cls: 'faint', s: `${S.firstName(from)} paid ${S.firstName(to)}` };
  }
  const net = (e.paid[me] || 0) - (e.owed[me] || 0);
  const payers = Object.keys(e.paid);
  const s = `${payers.length > 1 ? payers.length + ' people' : S.firstName(payers[0])} paid ${money(e.amount)}`;
  if (!(me in e.paid) && !(me in e.owed)) return { k: 'not involved', v: '', cls: 'faint', s };
  if (net > 0) return { k: 'you lent', v: money(net), cls: 'pos', s };
  if (net < 0) return { k: 'you borrowed', v: money(-net), cls: 'neg', s };
  return { k: 'no balance', v: '', cls: 'faint', s };
}
function expenseRow(e, showGroup = false) {
  const d = new Date(e.date);
  const im = impactLine(e);
  const g = st().groups[e.gid];
  return `<a class="row" href="#/e/${e.id}">
    <div class="datebox"><b>${d.getDate()}</b><span>${MON[d.getMonth()]}</span></div>
    <span class="cat ${e.kind === 'settle' ? 'settle' : ''}">${e.kind === 'settle' ? icon('swap') : catIcon(e.category)}</span>
    <div class="main"><div class="t">${esc(e.desc)}</div><div class="s">${esc(im.s)}${showGroup && g ? ' · ' + esc(g.name) : ''}</div></div>
    <div class="end ${im.cls}"><div class="k">${im.k}</div><div class="v">${im.v}</div></div></a>`;
}
function netLabel(n, settled = 'settled up') {
  if (n > 0) return `<div class="end pos"><div class="k">you get</div><div class="v">${money(n)}</div></div>`;
  if (n < 0) return `<div class="end neg"><div class="k">you owe</div><div class="v">${money(-n)}</div></div>`;
  return `<div class="end faint"><div class="k">${settled}</div><div class="v"></div></div>`;
}
function ensureEveryday() {
  let g = S.groupList().find((x) => x.name === 'Everyday');
  return g ? g.id : S.addGroup('Everyday');
}

// ---------- speech ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen(onText) {
  if (!SR) { toast('Voice input is not supported here. Use the mic on your keyboard.'); return; }
  const r = new SR();
  r.lang = 'en-IN';
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  const ov = document.createElement('div');
  ov.className = 'listen';
  ov.innerHTML = `<div class="orb">${icon('mic', 'lg')}</div><div class="said" aria-live="polite">Listening…</div><p class="muted small" style="max-width:320px">Try “Dinner 1200 paid by Rahul, split with me and Priya”</p><div class="btns" style="margin-top:20px;width:100%;max-width:320px"><button class="btn" data-c>Cancel</button><button class="btn primary" data-d>Done</button></div>`;
  document.body.appendChild(ov);
  let text = '', cancelled = false, finished = false;
  const end = () => { if (finished) return; finished = true; ov.remove(); if (!cancelled && text.trim()) onText(text.trim()); };
  ov.querySelector('[data-c]').onclick = () => { cancelled = true; try { r.abort(); } catch {} end(); };
  ov.querySelector('[data-d]').onclick = () => { try { r.stop(); } catch {} setTimeout(end, 400); };
  r.onresult = (e) => { text = [...e.results].map((x) => x[0].transcript).join(' '); ov.querySelector('.said').textContent = text; };
  r.onerror = (e) => { if (e.error === 'not-allowed') toast('Allow microphone access to use voice'); else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Voice error: ' + e.error); cancelled = !text; end(); };
  r.onend = end;
  try { r.start(); buzz(); } catch { end(); }
}

// ---------- router ----------
const routes = [
  [/^\/welcome$/, viewWelcome],
  [/^\/$/, viewHome],
  [/^\/groups$/, viewGroups],
  [/^\/g\/(\w+)\/report$/, viewReport],
  [/^\/g\/(\w+)(?:\/(expenses|balances|insights|members))?$/, viewGroup],
  [/^\/add$/, viewAdd],
  [/^\/e\/(\w+)\/edit$/, (id) => viewAdd(id)],
  [/^\/e\/(\w+)$/, viewExpense],
  [/^\/people$/, viewPeople],
  [/^\/p\/(\w+)$/, viewPerson],
  [/^\/stats$/, viewStats],
  [/^\/settings$/, viewSettings],
  [/^\/import\/([\w-]+)$/, viewImport],
];
let current = '';
function parseHash() {
  const h = location.hash.slice(1) || '/';
  const [path, qs] = h.split('?');
  return { path, q: new URLSearchParams(qs || '') };
}
let Q = new URLSearchParams();
async function render() {
  closeSheet?.();
  const { path, q } = parseHash();
  Q = q;
  if (!st().me && !/^\/(welcome|import\/)/.test(path)) { sessionStorage.setItem('after-welcome', location.hash); return go('/welcome'); }
  let v = null;
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) { v = await fn(...m.slice(1)); break; }
  }
  if (!v) return go('/');
  const top = $('#top'), view = $('#view'), nav = $('#nav');
  document.title = v.title && v.title !== 'Hisaab' ? `${v.title} · Hisaab` : 'Hisaab: split bills by just saying it';
  top.hidden = !!v.bare;
  nav.hidden = !!v.bare || v.nav === false;
  document.body.classList.toggle('no-nav', nav.hidden);
  top.innerHTML = v.back
    ? `<a class="icon-btn" href="#${v.back}" aria-label="Back" data-back>${icon('back')}</a><h1>${esc(v.title)}</h1>${v.actions || ''}`
    : `<div class="brand" style="flex:1"><span class="logo">h</span><h1>${esc(v.title || 'Hisaab')}</h1></div>${v.actions || ''}`;
  const tab = v.tab || '';
  nav.innerHTML = [
    ['home', '/', 'home', 'Home'], ['groups', '/groups', 'users', 'Groups'], ['add', '/add', 'plus', 'Add'], ['people', '/people', 'user', 'People'], ['stats', '/stats', 'chart', 'Insights'],
  ].map(([k, h, ic, l]) => k === 'add'
    ? `<a href="#/add${st().lastGroup ? '?g=' + st().lastGroup : ''}" aria-label="Add expense"><span class="fab">${icon(ic)}</span></a>`
    : `<a href="#${h}" ${tab === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></a>`).join('');
  view.innerHTML = v.html;
  if (path !== current) { view.classList.remove('view-enter'); void view.offsetWidth; view.classList.add('view-enter'); scrollTo(0, 0); }
  current = path;
  v.mount?.(view);
}
addEventListener('hashchange', render);

// Back buttons use history when we came from inside the app, so scroll/state is kept.
let navDepth = 0;
addEventListener('hashchange', () => navDepth++);
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-back]');
  if (b && navDepth > 0) { e.preventDefault(); navDepth -= 2; history.back(); }
});

S.onChange((why) => {
  if (why === 'external') render();
  if (why === 'quota') toast('Storage is full. Export a backup and delete old receipts.');
});

// ---------- views ----------
function viewWelcome() {
  return {
    bare: true,
    html: `<div class="welcome">
      <span class="logo" style="width:52px;height:52px;border-radius:16px;font-size:28px">h</span>
      <h1>Split bills by <em>just saying it.</em></h1>
      <p class="muted" style="font-size:17px;margin:0 0 18px">“Dinner 1200, Rahul paid, split with me and Priya.” Done. No forms, no sign-up, works offline.</p>
      <div class="feat"><span class="cat">${icon('mic')}</span><div><b>Talk or type</b><div class="muted small">Who paid, how much, who shares. Uneven splits too.</div></div></div>
      <div class="feat"><span class="cat">${icon('camera')}</span><div><b>Scan the bill</b><div class="muted small">Items read from the photo, then say who had what.</div></div></div>
      <div class="feat"><span class="cat">${icon('wallet')}</span><div><b>Settle with UPI, nudge on WhatsApp</b><div class="muted small">Fewest payments, one tap reminders and PDF summaries.</div></div></div>
      <form id="wf" style="margin-top:16px">
        <label class="field"><span>Your name</span><input class="input" name="n" required maxlength="40" autocomplete="given-name" placeholder="e.g. Namit" autofocus></label>
        <button class="btn primary block" type="submit">Get started ${icon('right', 'sm')}</button>
      </form>
      <p class="faint small" style="text-align:center;margin-top:14px">Your data stays on this phone. Nothing is uploaded.</p>
    </div>`,
    mount(v) {
      $('#wf', v).onsubmit = (e) => {
        e.preventDefault();
        const n = e.target.n.value.trim();
        if (!n) return;
        const id = S.uid();
        st().people[id] = { id, name: n, phone: '', upi: '', createdAt: Date.now() };
        st().me = id;
        S.save(); S.flush();
        const next = sessionStorage.getItem('after-welcome');
        sessionStorage.removeItem('after-welcome');
        location.hash = next && next !== '#/welcome' ? next : '#/';
      };
    },
  };
}

function quickBar(gid) {
  return `<form class="quick" data-quick="${gid || ''}" role="search">
    <input name="q" placeholder="${esc(EXAMPLES[Math.floor(Date.now() / 60000) % EXAMPLES.length])}" aria-label="Describe an expense" enterkeyhint="go" autocomplete="off">
    <button type="button" class="mic ghost" data-scan="${gid || ''}" aria-label="Scan a bill">${icon('camera')}</button>
    <button type="button" class="mic" data-mic="${gid || ''}" aria-label="Speak an expense">${icon('mic')}</button>
  </form>`;
}
function bindQuick(root) {
  $$('[data-quick]', root).forEach((f) => {
    const gid = f.dataset.quick || st().lastGroup || '';
    f.onsubmit = (e) => { e.preventDefault(); const t = f.q.value.trim(); go(`/add?${new URLSearchParams({ g: gid, q: t })}`); };
    f.querySelector('[data-mic]').onclick = () => listen((t) => go(`/add?${new URLSearchParams({ g: gid, q: t })}`));
    f.querySelector('[data-scan]').onclick = () => go(`/add?${new URLSearchParams({ g: gid, scan: 1 })}`);
  });
  $$('[data-hint]', root).forEach((b) => (b.onclick = () => { const i = $('[data-quick] input', root); i.value = b.dataset.hint; i.focus(); }));
}

function viewHome() {
  const me = st().me;
  const nets = personNets();
  let get = 0, pay = 0;
  for (const k in nets) nets[k] > 0 ? (get += nets[k]) : (pay -= nets[k]);
  const net = get - pay;
  const groups = S.groupList();
  const recent = S.allExpenses().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  const name = S.person(me).name.split(' ')[0];
  const hr = new Date().getHours();
  const greet = hr < 5 ? 'Up late' : hr < 12 ? 'Morning' : hr < 17 ? 'Afternoon' : 'Evening';
  return {
    tab: 'home', title: 'Hisaab',
    actions: `<a class="icon-btn" href="#/settings" aria-label="Settings">${icon('settings')}</a>`,
    html: `
    <section class="hero">
      <div class="muted small" style="font-weight:600">${greet}, ${esc(name)}</div>
      <div class="big ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}" style="margin-top:6px">${net === 0 ? 'All square' : money(Math.abs(net))}</div>
      <div class="muted small">${net > 0 ? 'overall, you are owed' : net < 0 ? 'overall, you owe' : 'nobody owes anybody'}</div>
      <div class="row2"><div class="pill"><span>You get</span><b class="pos">${money(get)}</b></div><div class="pill"><span>You pay</span><b class="neg">${money(pay)}</b></div></div>
    </section>
    ${quickBar('')}
    <div class="hints">${EXAMPLES.map((x) => `<button class="hint" data-hint="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <h2 class="h2">Groups <a href="#/groups">See all</a></h2>
    ${groups.length ? `<div class="list">${groups.slice(0, 5).map((g) => `<a class="row" href="#/g/${g.id}"><span class="av" style="--h:${g.hue}">${esc(initials(g.name))}</span><div class="main"><div class="t">${esc(g.name)}</div><div class="s">${memberList(g.id).length} people</div></div>${netLabel(myGroupNet(g.id))}</a>`).join('')}</div>`
      : `<div class="card empty"><div class="art">${icon('users', 'lg')}</div><h3>No groups yet</h3><p>A trip, a flat, office lunch. Add names only, nobody needs to sign up.</p><button class="btn primary" data-act="newGroup">${icon('plus', 'sm')} New group</button></div>`}
    ${recent.length ? `<h2 class="h2">Recent</h2><div class="list">${recent.map((e) => expenseRow(e, true)).join('')}</div>` : ''}
    `,
    mount: bindQuick,
  };
}

function viewGroups() {
  const groups = S.groupList();
  const archived = Object.values(st().groups).filter((g) => g.archived && !g.deleted);
  return {
    tab: 'groups', title: 'Groups',
    actions: `<button class="icon-btn" data-act="newGroup" aria-label="New group">${icon('plus')}</button>`,
    html: groups.length ? `<div class="list" style="margin-top:8px">${groups.map((g) => `<a class="row" href="#/g/${g.id}"><span class="av" style="--h:${g.hue}">${esc(initials(g.name))}</span><div class="main"><div class="t">${esc(g.name)}</div><div class="s">${memberList(g.id).map((id) => esc(S.firstName(id))).join(', ')}</div></div>${netLabel(myGroupNet(g.id))}</a>`).join('')}</div>
      <button class="btn block" style="margin-top:14px" data-act="newGroup">${icon('plus', 'sm')} New group</button>
      ${archived.length ? `<h2 class="h2">Archived</h2><div class="list">${archived.map((g) => `<a class="row" href="#/g/${g.id}"><span class="av" style="--h:${g.hue};opacity:.5">${esc(initials(g.name))}</span><div class="main"><div class="t">${esc(g.name)}</div></div>${netLabel(myGroupNet(g.id))}</a>`).join('')}</div>` : ''}`
      : `<div class="card empty" style="margin-top:8px"><div class="art">${icon('users', 'lg')}</div><h3>Start a group</h3><p>Goa trip, flatmates, office chai fund…</p><button class="btn primary" data-act="newGroup">${icon('plus', 'sm')} New group</button></div>`,
  };
}

function newGroupSheet(onDone) {
  const others = peopleArr().filter((p) => p.id !== st().me);
  const picked = new Set();
  sheet(`<h3>New group</h3>
    <form id="ng">
      <label class="field"><span>Name</span><input class="input" name="n" required maxlength="50" placeholder="Goa trip, Flat 302, Office lunch" autofocus></label>
      <div class="field"><span>People</span>
        <div class="chips" id="ngc">${others.map((p) => `<button type="button" class="chip" aria-pressed="false" data-id="${p.id}">${av(p.id)}${esc(p.name)}</button>`).join('')}</div>
        <input class="input" name="add" style="margin-top:10px" placeholder="Add names: Rahul, Priya, Deepak" autocomplete="off">
        <div class="faint small" style="margin:6px 2px 0">Just names. Add phone numbers later for WhatsApp reminders.</div>
      </div>
      <button class="btn primary block" type="submit">Create group</button>
    </form>`, (el, close) => {
    $$('#ngc .chip', el).forEach((c) => (c.onclick = () => { const on = c.getAttribute('aria-pressed') !== 'true'; c.setAttribute('aria-pressed', on); on ? picked.add(c.dataset.id) : picked.delete(c.dataset.id); }));
    $('#ng', el).onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      const ids = [...picked, ...f.add.value.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean).map((n) => S.addPerson(n))];
      const gid = S.addGroup(f.n.value, ids);
      close();
      buzz();
      onDone ? onDone(gid) : go('/g/' + gid);
    };
  });
}

function viewGroup(gid, tab = 'expenses') {
  const g = st().groups[gid];
  if (!g || g.deleted) return null;
  const exps = S.groupExpenses(gid);
  const me = st().me;
  const myNet = myGroupNet(gid);
  const total = exps.filter((e) => e.kind !== 'settle').reduce((s, e) => s + e.amount, 0);
  const tabs = [['expenses', 'Expenses'], ['balances', 'Balances'], ['insights', 'Insights'], ['members', 'People']];
  let body = '';
  if (tab === 'expenses') {
    const qtxt = (Q.get('s') || '').toLowerCase();
    const list = qtxt ? exps.filter((e) => e.desc.toLowerCase().includes(qtxt) || CAT_NAMES[e.category]?.toLowerCase().includes(qtxt)) : exps;
    let lastM = '';
    body = `${quickBar(gid)}
      ${exps.length > 6 ? `<div class="quick" style="margin-top:10px">${icon('search', 'sm')}<input id="gs" placeholder="Search expenses" value="${esc(Q.get('s') || '')}" aria-label="Search expenses"></div>` : ''}
      ${list.length ? list.map((e) => { const d = new Date(e.date); const m = `${MON[d.getMonth()]} ${d.getFullYear()}`; const head = m !== lastM ? `${lastM ? '</div>' : ''}<div class="month">${m}</div><div class="list">` : ''; lastM = m; return head + expenseRow(e); }).join('') + '</div>'
        : `<div class="empty"><div class="art">${icon('receipt', 'lg')}</div><h3>${qtxt ? 'No matches' : 'No expenses yet'}</h3><p>${qtxt ? 'Try another word.' : 'Type or say the first one above, or scan a bill.'}</p></div>`}`;
  } else if (tab === 'balances') {
    const b = S.groupBalances(gid);
    const tr = transfersFor(gid);
    const ids = memberList(gid);
    body = `<div class="list" style="margin-top:14px">${ids.map((id) => { const n = b[id] || 0; return `<a class="row" href="#/p/${id}">${av(id)}<div class="main"><div class="t">${esc(S.pname(id))}</div><div class="s">${n > 0 ? (id === me ? 'get back' : 'gets back') : n < 0 ? (id === me ? 'owe' : 'owes') : 'settled up'}</div></div><div class="end ${n > 0 ? 'pos' : n < 0 ? 'neg' : 'faint'}"><div class="v">${n ? money(Math.abs(n)) : ''}</div></div></a>`; }).join('')}</div>
      <h2 class="h2">Who pays whom <button class="btn sm ghost" data-act="toggleSimplify" data-g="${gid}">${g.simplify !== false ? 'Simplified' : 'All debts'} ${icon('swap', 'sm')}</button></h2>
      ${tr.length ? `<div class="stack">${tr.map((t) => transferCard(t, gid)).join('')}</div>` : `<div class="card empty"><div class="art">${icon('check', 'lg')}</div><h3>All settled up</h3><p>Nobody owes anything in this group.</p></div>`}
      ${tr.length ? `<button class="btn block" style="margin-top:14px" data-act="shareGroup" data-g="${gid}">${icon('whatsapp', 'sm')} Send summary on WhatsApp</button>` : ''}`;
  } else if (tab === 'insights') {
    body = insightsHTML(exps.filter((e) => e.kind !== 'settle'), { gid });
  } else {
    const ids = memberList(gid);
    const b = S.groupBalances(gid);
    body = `<div class="list" style="margin-top:14px">${ids.map((id) => { const p = S.person(id); return `<a class="row" href="#/p/${id}">${av(id)}<div class="main"><div class="t">${esc(S.pname(id))}${id === me ? ' <span class="faint small">(you)</span>' : ''}</div><div class="s">${p.phone ? esc(p.phone) : 'no phone'}${p.upi ? ' · UPI ✓' : ''}</div></div><div class="end ${b[id] > 0 ? 'pos' : b[id] < 0 ? 'neg' : 'faint'}"><div class="v">${b[id] ? money(Math.abs(b[id])) : ''}</div></div></a>`; }).join('')}</div>
      <form class="quick" id="addm" style="margin-top:14px"><input name="n" placeholder="Add people: Amit, Sneha" autocomplete="off" aria-label="Add people"><button class="mic" type="submit" aria-label="Add">${icon('plus')}</button></form>
      <div class="chips" style="margin-top:10px">${peopleArr().filter((p) => !ids.includes(p.id)).slice(0, 12).map((p) => `<button class="chip new" data-act="addMember" data-g="${gid}" data-id="${p.id}">${av(p.id)}${esc(p.name)}</button>`).join('')}</div>
      <button class="btn block" style="margin-top:16px" data-act="inviteGroup" data-g="${gid}">${icon('link', 'sm')} Share a live copy link</button>
      <p class="faint small" style="margin:8px 4px">People do not need to join. Add names, track everything yourself, and share a summary or link when you want.</p>`;
  }
  return {
    tab: 'groups', title: g.name, back: '/groups',
    actions: `<button class="icon-btn" data-act="shareGroup" data-g="${gid}" aria-label="Share">${icon('share')}</button><button class="icon-btn" data-act="groupMenu" data-g="${gid}" aria-label="Group options">${icon('more')}</button>`,
    html: `<section class="hero" style="padding:16px 18px">
        <div style="display:flex;align-items:center;gap:12px"><span class="av lg" style="--h:${g.hue}">${esc(initials(g.name))}</span><div style="flex:1;min-width:0"><div class="small muted" style="font-weight:600">${myNet > 0 ? 'You get back' : myNet < 0 ? 'You owe' : 'You are'}</div><div style="font:800 28px var(--display);letter-spacing:-.02em" class="${myNet > 0 ? 'pos' : myNet < 0 ? 'neg' : ''} num">${myNet ? money(Math.abs(myNet)) : 'settled up'}</div></div><div style="text-align:right"><div class="small muted" style="font-weight:600">Total spend</div><div style="font:700 17px var(--display)" class="num">${money(total)}</div></div></div>
      </section>
      <nav class="seg" style="margin-top:14px" aria-label="Group sections">${tabs.map(([k, l]) => `<a href="#/g/${gid}${k === 'expenses' ? '' : '/' + k}" ${tab === k ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      ${body}`,
    mount(v) {
      bindQuick(v);
      const gs = $('#gs', v);
      if (gs) { let t; gs.oninput = () => { clearTimeout(t); t = setTimeout(() => { history.replaceState(null, '', `#/g/${gid}${gs.value ? '?s=' + encodeURIComponent(gs.value) : ''}`); const pos = gs.selectionStart; render().then(() => { const n = $('#gs'); n?.focus(); n?.setSelectionRange(pos, pos); }); }, 200); }; }
      const am = $('#addm', v);
      if (am) am.onsubmit = (e) => { e.preventDefault(); const names = am.n.value.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean); names.forEach((n) => { const id = S.addPerson(n); if (!g.members.includes(id)) g.members.push(id); }); S.save(); render(); if (names.length) toast(`Added ${names.join(', ')}`); };
    },
  };
}

function transferCard(t, gid) {
  const me = st().me;
  const to = S.person(t.to), from = S.person(t.from);
  const canUpi = t.from === me && to.upi;
  return `<div class="card" style="padding:14px">
    <div style="display:flex;align-items:center;gap:10px">${av(t.from, 'sm')}<span class="small"><b>${esc(S.pname(t.from))}</b> ${t.from === me ? 'pay' : 'pays'} <b>${esc(S.pname(t.to))}</b></span><span style="flex:1"></span><b class="num" style="font:700 17px var(--display)">${money(t.amount)}</b></div>
    <div class="btns" style="margin-top:12px">
      ${canUpi ? `<a class="btn sm primary" href="${esc(upiLink({ upi: to.upi, name: to.name, amount: t.amount, note: st().groups[gid]?.name }))}">${icon('wallet', 'sm')} Pay via UPI</a>` : ''}
      ${t.from !== me ? `<button class="btn sm" data-act="remind" data-from="${t.from}" data-to="${t.to}" data-amt="${t.amount}" data-g="${gid}">${icon('bell', 'sm')} Remind</button>` : ''}
      <button class="btn sm ${canUpi ? '' : 'primary'}" data-act="settle" data-from="${t.from}" data-to="${t.to}" data-amt="${t.amount}" data-g="${gid}">${icon('check', 'sm')} Mark paid</button>
    </div>
    ${t.from !== me && !from.phone ? '' : ''}
  </div>`;
}

function insightsHTML(exps, { gid, mine } = {}) {
  const me = st().me;
  if (!exps.length) return `<div class="empty"><div class="art">${icon('chart', 'lg')}</div><h3>Nothing to analyse yet</h3><p>Add a few expenses and the patterns show up here.</p></div>`;
  const val = (e) => (mine ? e.owed[me] || 0 : e.amount);
  const total = exps.reduce((s, e) => s + val(e), 0);
  const byCat = {};
  exps.forEach((e) => (byCat[e.category] = (byCat[e.category] || 0) + val(e)));
  const cats = Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push([d.getFullYear() * 12 + d.getMonth(), MON[d.getMonth()], 0]); }
  exps.forEach((e) => { const d = new Date(e.date); const k = d.getFullYear() * 12 + d.getMonth(); const m = months.find((x) => x[0] === k); if (m) m[2] += val(e); });
  const maxM = Math.max(...months.map((m) => m[2]), 1);
  const thisM = months[5][2], lastM = months[4][2];
  const top = [...exps].sort((a, b) => val(b) - val(a)).slice(0, 3);
  let people = '';
  if (gid) {
    const ids = memberList(gid);
    const rows = ids.map((id) => ({ id, ...S.spendOf(exps, id) })).sort((a, b) => b.paid - a.paid);
    const maxP = Math.max(...rows.map((r) => Math.max(r.paid, r.share)), 1);
    people = `<h2 class="h2">Paid vs share</h2><div class="card bars">${rows.map((r) => `<div class="bar-row"><div class="lbl"><span>${esc(S.pname(r.id))}</span><span class="muted num small">paid ${money(r.paid)} · share ${money(r.share)}</span></div><div class="track"><i style="width:${(r.paid / maxP) * 100}%"></i></div><div class="track" style="margin-top:4px;height:6px"><i style="width:${(r.share / maxP) * 100}%;background:var(--info)"></i></div></div>`).join('')}<div class="faint small">Green: paid. Blue: their share.</div></div>`;
  }
  const avgDay = (() => { const first = Math.min(...exps.map((e) => e.date)); const days = Math.max(1, Math.ceil((Date.now() - first) / 864e5)); return Math.round(total / days); })();
  return `<div class="stat-grid" style="margin-top:14px">
      <div class="card"><div class="muted small">${mine ? 'Your share' : 'Total'}</div><div style="font:800 22px var(--display)" class="num">${money(total)}</div></div>
      <div class="card"><div class="muted small">This month</div><div style="font:800 22px var(--display)" class="num">${money(thisM)}</div><div class="small ${thisM > lastM ? 'neg' : 'pos'}">${lastM ? (thisM >= lastM ? '▲ ' : '▼ ') + Math.abs(Math.round(((thisM - lastM) / lastM) * 100)) + '% vs last' : 'first month'}</div></div>
      <div class="card"><div class="muted small">Per day</div><div style="font:800 22px var(--display)" class="num">${money(avgDay)}</div></div>
      <div class="card"><div class="muted small">Expenses</div><div style="font:800 22px var(--display)" class="num">${exps.length}</div></div>
    </div>
    <h2 class="h2">Last 6 months</h2>
    <div class="card"><div class="cols">${months.map((m) => `<div class="c" title="${money(m[2])}"><span class="num" style="font-size:10px">${m[2] ? fmt(m[2], '').replace(/\.\d+$/, '') : ''}</span><i style="height:${(m[2] / maxM) * 100}%"></i>${m[1]}</div>`).join('')}</div></div>
    <h2 class="h2">By category</h2>
    <div class="card bars">${cats.map(([c, v]) => `<div class="bar-row"><div class="lbl"><span style="display:flex;gap:8px;align-items:center">${catIcon(c)} ${CAT_NAMES[c] || c}</span><span class="num">${money(v)} <span class="faint">${Math.round((v / total) * 100)}%</span></span></div><div class="track"><i style="width:${(v / cats[0][1]) * 100}%"></i></div></div>`).join('')}</div>
    ${people}
    <h2 class="h2">Biggest</h2><div class="list">${top.map((e) => expenseRow(e, !gid)).join('')}</div>`;
}

function viewStats() {
  const range = Q.get('r') || 'all';
  const since = range === 'month' ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() : range === '3m' ? Date.now() - 92 * 864e5 : 0;
  const me = st().me;
  const exps = S.allExpenses().filter((e) => e.kind !== 'settle' && e.date >= since && (me in e.owed || me in e.paid));
  const byGroup = {};
  exps.forEach((e) => (byGroup[e.gid] = (byGroup[e.gid] || 0) + (e.owed[me] || 0)));
  const gs = Object.entries(byGroup).sort((a, b) => b[1] - a[1]);
  return {
    tab: 'stats', title: 'Insights',
    html: `<nav class="seg" aria-label="Range">${[['month', 'This month'], ['3m', '3 months'], ['all', 'All time']].map(([k, l]) => `<a href="#/stats?r=${k}" ${range === k ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      <p class="faint small" style="margin:10px 4px 0">Counts only your share of each bill, so a ₹3000 dinner split 3 ways is ₹1000 here.</p>
      ${insightsHTML(exps, { mine: true })}
      ${gs.length ? `<h2 class="h2">By group</h2><div class="card bars">${gs.map(([g, v]) => `<div class="bar-row"><div class="lbl"><span>${esc(st().groups[g]?.name)}</span><span class="num">${money(v)}</span></div><div class="track"><i style="width:${(v / gs[0][1]) * 100}%"></i></div></div>`).join('')}</div>` : ''}`,
  };
}

function viewPeople() {
  const nets = personNets();
  const ps = peopleArr().filter((p) => p.id !== st().me).sort((a, b) => Math.abs(nets[b.id] || 0) - Math.abs(nets[a.id] || 0) || a.name.localeCompare(b.name));
  return {
    tab: 'people', title: 'People',
    actions: `<button class="icon-btn" data-act="newPerson" aria-label="Add person">${icon('plus')}</button>`,
    html: ps.length ? `<div class="list" style="margin-top:8px">${ps.map((p) => `<a class="row" href="#/p/${p.id}">${av(p.id)}<div class="main"><div class="t">${esc(p.name)}</div><div class="s">${(nets[p.id] || 0) > 0 ? 'owes you' : (nets[p.id] || 0) < 0 ? 'you owe' : 'settled up'}</div></div>${netLabel(nets[p.id] || 0)}</a>`).join('')}</div>`
      : `<div class="card empty" style="margin-top:8px"><div class="art">${icon('user', 'lg')}</div><h3>No people yet</h3><p>Add names when you create a group or an expense. Nobody has to sign up.</p><button class="btn primary" data-act="newPerson">${icon('plus', 'sm')} Add person</button></div>`,
  };
}

function viewPerson(id) {
  const p = st().people[id];
  if (!p) return null;
  const me = st().me;
  const isMe = id === me;
  const net = personNets()[id] || 0;
  const groups = S.groupList().filter((g) => g.members.includes(id));
  const shared = isMe ? [] : groups.filter((g) => g.members.includes(me)).map((g) => ({ g, n: pairwiseInGroup(g.id, id) })).filter((x) => x.n);
  const exps = S.allExpenses().filter((e) => id in e.paid || id in e.owed).sort((a, b) => b.date - a.date).slice(0, 20);
  return {
    tab: 'people', title: p.name, back: '/people',
    actions: `<button class="icon-btn" data-act="editPerson" data-id="${id}" aria-label="Edit">${icon('edit')}</button>`,
    html: `<section class="hero" style="text-align:center">
        <div style="display:flex;justify-content:center">${av(id, 'lg')}</div>
        <div style="font:700 20px var(--display);margin-top:8px">${esc(p.name)}${isMe ? ' (you)' : ''}</div>
        <div class="muted small">${[p.phone, p.upi].filter(Boolean).map(esc).join(' · ') || (isMe ? 'Add your UPI ID so friends can pay you' : 'Add a phone number for WhatsApp reminders')}</div>
        ${isMe ? '' : `<div class="big ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}" style="margin-top:12px;font-size:34px">${net ? money(Math.abs(net)) : 'All square'}</div><div class="muted small">${net > 0 ? `${esc(p.name.split(' ')[0])} owes you` : net < 0 ? `you owe ${esc(p.name.split(' ')[0])}` : ''}</div>`}
        ${!isMe && net ? `<div class="btns" style="margin-top:14px">
          ${net < 0 && p.upi ? `<a class="btn primary" href="${esc(upiLink({ upi: p.upi, name: p.name, amount: -net }))}">${icon('wallet', 'sm')} Pay UPI</a>` : ''}
          ${net > 0 ? `<button class="btn" data-act="remindPerson" data-id="${id}">${icon('bell', 'sm')} Remind</button>` : ''}
          <button class="btn ${net < 0 && p.upi ? '' : 'primary'}" data-act="settleAll" data-id="${id}">${icon('check', 'sm')} Settle up</button></div>` : ''}
        ${isMe ? `<button class="btn" style="margin-top:12px" data-act="editPerson" data-id="${id}">${icon('edit', 'sm')} Edit profile & UPI</button>` : ''}
      </section>
      ${shared.length ? `<h2 class="h2">By group</h2><div class="list">${shared.map(({ g, n }) => `<a class="row" href="#/g/${g.id}/balances"><span class="av" style="--h:${g.hue}">${esc(initials(g.name))}</span><div class="main"><div class="t">${esc(g.name)}</div></div>${netLabel(n)}</a>`).join('')}</div>` : ''}
      ${exps.length ? `<h2 class="h2">Activity</h2><div class="list">${exps.map((e) => expenseRow(e, true)).join('')}</div>` : ''}`,
  };
}

function personSheet(id, onDone) {
  const p = id ? st().people[id] : { name: '', phone: '', upi: '' };
  sheet(`<h3>${id ? 'Edit ' + esc(p.name) : 'Add person'}</h3>
    <form id="pf">
      <label class="field"><span>Name</span><input class="input" name="name" required maxlength="40" value="${esc(p.name)}" autofocus></label>
      <label class="field"><span>WhatsApp number (optional)</span><input class="input" name="phone" type="tel" inputmode="tel" maxlength="16" placeholder="98765 43210" value="${esc(p.phone)}"></label>
      <label class="field"><span>UPI ID (optional)</span><input class="input" name="upi" maxlength="60" placeholder="name@okhdfcbank" autocapitalize="off" spellcheck="false" value="${esc(p.upi)}"></label>
      <div class="btns">${id && id !== st().me ? `<button type="button" class="btn danger" data-del>${icon('trash', 'sm')}</button>` : ''}<button class="btn primary" type="submit">Save</button></div>
    </form>`, (el, close) => {
    $('#pf', el).onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      const upi = f.upi.value.trim();
      if (upi && !/^[\w.\-]{2,}@[a-z][a-z0-9.]{1,}$/i.test(upi)) { toast('That UPI ID looks wrong (like name@bank)'); return; }
      const data = { name: f.name.value.trim().slice(0, 40), phone: f.phone.value.replace(/[^\d+]/g, '').slice(0, 15), upi };
      let pid = id;
      if (id) Object.assign(st().people[id], data); else pid = S.addPerson(data.name, data);
      S.save();
      close();
      onDone ? onDone(pid) : render();
    };
    el.querySelector('[data-del]')?.addEventListener('click', () => {
      const n = personNets()[id] || 0;
      if (n || S.allExpenses().some((e) => id in e.paid || id in e.owed)) { toast('This person has expenses. Settle and delete those first.'); return; }
      close();
      st().people[id].deleted = true;
      Object.values(st().groups).forEach((g) => (g.members = g.members.filter((m) => m !== id)));
      S.save();
      go('/people');
    });
  });
}

function viewExpense(id) {
  const e = st().expenses[id];
  if (!e) return null;
  const g = st().groups[e.gid];
  const me = st().me;
  const settle = e.kind === 'settle';
  const im = impactLine(e);
  return {
    tab: 'groups', title: settle ? 'Payment' : 'Expense', back: g ? '/g/' + g.id : '/',
    actions: e.deleted ? '' : `<a class="icon-btn" href="#/e/${id}/edit" aria-label="Edit">${icon('edit')}</a>`,
    html: `${e.deleted ? `<div class="note warn" style="margin-top:8px">This expense was deleted. <button class="btn sm" data-act="restore" data-id="${id}">Restore</button></div>` : ''}
      <section class="hero" style="margin-top:8px">
        <div style="display:flex;gap:12px;align-items:center"><span class="cat ${settle ? 'settle' : ''}" style="width:52px;height:52px">${settle ? icon('swap') : catIcon(e.category)}</span><div style="min-width:0"><div style="font:700 20px var(--display)">${esc(e.desc)}</div><div class="muted small">${fmtDate(e.date)} · ${esc(g?.name || '')} · ${CAT_NAMES[e.category] || ''}</div></div></div>
        <div class="big" style="margin-top:14px">${money(e.amount)}</div>
        ${im.v ? `<div class="small ${im.cls}" style="font-weight:600">${im.k} ${im.v}</div>` : ''}
      </section>
      <h2 class="h2">Paid by</h2>
      <div class="list">${Object.entries(e.paid).map(([pid, a]) => `<a class="row" href="#/p/${pid}">${av(pid, 'sm')}<div class="main"><div class="t">${esc(S.pname(pid))}</div></div><div class="end"><div class="v">${money(a)}</div></div></a>`).join('')}</div>
      <h2 class="h2">${settle ? 'Paid to' : 'Split'} <span class="faint small" style="font-weight:600">${settle ? '' : esc(splitLabel(e.split))}</span></h2>
      <div class="list">${Object.entries(e.owed).map(([pid, a]) => `<a class="row" href="#/p/${pid}">${av(pid, 'sm')}<div class="main"><div class="t">${esc(S.pname(pid))}</div>${!settle && e.paid[pid] ? `<div class="s">paid ${money(e.paid[pid])}, share ${money(a)}</div>` : ''}</div><div class="end"><div class="v">${money(a)}</div></div></a>`).join('')}</div>
      ${e.items?.length ? `<h2 class="h2">Items</h2><div class="list">${e.items.map((it) => `<div class="row" style="cursor:default"><div class="main"><div class="t">${esc(it.name)}</div><div class="s">${it.who.map((w) => esc(S.firstName(w))).join(', ')}</div></div><div class="end"><div class="v">${money(it.amount)}</div></div></div>`).join('')}</div>` : ''}
      ${e.note ? `<h2 class="h2">Note</h2><div class="card">${esc(e.note)}</div>` : ''}
      ${e.receiptId ? `<h2 class="h2">Bill</h2><div id="rimg"><div class="sk" style="height:220px;border-radius:14px"></div></div>` : ''}
      ${e.text ? `<p class="faint small" style="margin:14px 4px">Added from: “${esc(e.text)}”</p>` : ''}
      ${e.deleted ? '' : `<div class="btns" style="margin-top:18px">
        ${settle ? '' : `<button class="btn" data-act="notifyBill" data-id="${id}">${icon('whatsapp', 'sm')} Share bill</button>`}
        <button class="btn danger" data-act="delExpense" data-id="${id}">${icon('trash', 'sm')} Delete</button></div>`}
      <p class="faint small" style="margin:14px 4px">Added ${new Date(e.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}${e.updatedAt - e.createdAt > 2000 ? ' · edited ' + new Date(e.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}${e.imported ? ' · imported' : ''}</p>`,
    async mount(v) {
      if (e.receiptId) {
        const b = await S.getReceipt(e.receiptId);
        const box = $('#rimg', v);
        if (!box) return;
        if (!b) { box.innerHTML = '<p class="faint small">Bill image is on the phone that scanned it.</p>'; return; }
        const url = URL.createObjectURL(b);
        box.innerHTML = `<a href="${url}" target="_blank" rel="noopener"><img class="receipt-img" src="${url}" alt="Scanned bill"></a>`;
      }
    },
  };
}
function splitLabel(sp) {
  if (!sp) return '';
  return { equal: 'equally', exact: 'by amount', percent: 'by %', shares: 'by shares', items: 'by items' }[sp.mode] || '';
}

// ---------- add / edit ----------
let draft = null;
function newDraft(gid) {
  const g = gid && st().groups[gid] ? gid : st().lastGroup && st().groups[st().lastGroup] && !st().groups[st().lastGroup].deleted ? st().lastGroup : null;
  const members = g ? memberList(g) : [st().me];
  return { gid: g, text: '', desc: '', amount: '', date: Date.now(), category: 'general', paid: { [st().me]: 0 }, multiPay: false, split: { mode: 'equal', parts: Object.fromEntries(members.map((m) => [m, 1])) }, items: null, newPeople: [], touched: {}, note: '', receiptBlob: null, receiptId: null };
}
const draftMembers = () => {
  const base = draft.gid ? memberList(draft.gid) : [st().me];
  const extra = [...Object.keys(draft.paid), ...Object.keys(draft.split.parts), ...(draft.items || []).flatMap((i) => i.who)].filter((id) => !base.includes(id));
  return [...new Set([...base, ...extra])];
};
const dname = (id) => (id.startsWith('new:') ? draft.newPeople.find((n) => n.id === id)?.name || id.slice(4) : S.pname(id));
const davatar = (id, cls = '') => (id.startsWith('new:') ? avName(dname(id), cls) : av(id, cls));
const draftAmount = () => toPaise(parseFloat(String(draft.amount).replace(/[^\d.]/g, '')) || 0);

function draftOwed() {
  const total = draftAmount();
  if (draft.split.mode === 'items' && draft.items) {
    const w = {};
    const all = draftMembers();
    for (const it of draft.items) {
      const who = it.who.length ? it.who : all;
      const al = allocate(Math.max(0, it.amount), Object.fromEntries(who.map((p) => [p, 1])));
      for (const k in al) w[k] = (w[k] || 0) + al[k];
    }
    return allocate(total, w); // tax, service and discounts spread in proportion
  }
  return computeOwed(total, draft.split);
}
function draftPaid() {
  const total = draftAmount();
  if (!draft.multiPay) { const id = Object.keys(draft.paid)[0] || st().me; return { [id]: total }; }
  const o = {};
  for (const k in draft.paid) if (draft.paid[k] > 0) o[k] = draft.paid[k];
  return o;
}
function draftProblems() {
  const total = draftAmount();
  const p = [];
  if (!draft.gid) p.push('Pick a group');
  if (!total) p.push('Enter an amount');
  const paid = sumVals(draftPaid());
  if (total && paid !== total) p.push(`Paid adds to ${money(paid)}, not ${money(total)}`);
  const owed = draftOwed();
  const os = sumVals(owed);
  if (total && !Object.keys(owed).length) p.push('Pick who shares this');
  else if (total && os !== total) p.push(`Split adds to ${money(os)}, ${os < total ? money(total - os) + ' left' : money(os - total) + ' over'}`);
  if (draft.split.mode === 'percent') { const s = Object.values(draft.split.parts).reduce((a, b) => a + (+b || 0), 0); if (Math.abs(s - 100) > 0.01) p.push(`Percentages add to ${+s.toFixed(2)}%`); }
  return p;
}

function applyParse() {
  const t = draft.text.trim();
  if (!t) return;
  const members = draft.gid ? memberList(draft.gid) : [st().me];
  const r = parseExpense(t, { people: peopleArr(), members, me: st().me });
  draft.parsed = r;
  draft.newPeople = r.newNames;
  if (!draft.touched.amount && r.amount != null) draft.amount = String(r.amount / 100);
  if (!draft.touched.desc) draft.desc = r.desc;
  if (!draft.touched.category) draft.category = r.category;
  if (!draft.touched.date) draft.date = r.date;
  if (!draft.touched.paid) { draft.paid = { ...r.paid }; draft.multiPay = Object.keys(r.paid).length > 1; if (!Object.keys(draft.paid).length) draft.paid = { [st().me]: 0 }; }
  if (!draft.touched.split && !(draft.items && draft.split.mode === 'items')) {
    draft.split = r.split.mode === 'exact' ? { mode: 'exact', parts: { ...r.split.parts } } : { mode: r.split.mode, parts: { ...r.split.parts } };
  }
}

function viewAdd(editId) {
  const editing = editId ? st().expenses[editId] : null;
  if (editId && !editing) return null;
  const key = editId || 'new:' + (Q.get('g') || '') + (Q.get('q') || '') + (Q.get('scan') || '');
  if (!draft || draft.key !== key) {
    if (editing) {
      draft = { ...newDraft(editing.gid), id: editing.id, kind: editing.kind, text: editing.text || '', desc: editing.desc, amount: String(editing.amount / 100), date: editing.date, category: editing.category, paid: { ...editing.paid }, multiPay: Object.keys(editing.paid).length > 1, split: editing.split ? JSON.parse(JSON.stringify(editing.split)) : { mode: 'exact', parts: { ...editing.owed } }, items: editing.items ? JSON.parse(JSON.stringify(editing.items)) : null, note: editing.note || '', receiptId: editing.receiptId || null, touched: { amount: 1, desc: 1, category: 1, date: 1, paid: 1, split: 1 } };
    } else {
      draft = newDraft(Q.get('g'));
      if (Q.get('q')) { draft.text = Q.get('q'); applyParse(); }
    }
    draft.key = key;
  }
  const groups = S.groupList();
  return {
    tab: 'add', title: editing ? (editing.kind === 'settle' ? 'Edit payment' : 'Edit expense') : 'Add expense', back: editing ? '/e/' + editId : draft.gid ? '/g/' + draft.gid : '/', nav: false,
    html: `
    ${editing?.kind === 'settle' ? '' : `<div class="smart">
      <textarea id="smart" rows="2" placeholder="Say or type it: “Pizza 900 paid by Deepak, split with me and Rahul”" aria-label="Describe the expense">${esc(draft.text)}</textarea>
      <div class="bar">
        <button class="btn sm" data-act="scan">${icon('camera', 'sm')} Scan bill</button>
        <span class="sp"></span>
        ${draft.text ? `<button class="icon-btn" data-act="clearSmart" aria-label="Clear">${icon('x', 'sm')}</button>` : ''}
        <button class="mic" data-act="speak" aria-label="Speak">${icon('mic')}</button>
      </div>
      <div class="preview" id="pv"></div>
    </div>
    <input type="file" id="file" accept="image/*" capture="environment" hidden>
    <div id="scanbox"></div>
    ${draft.text || draft.scan || editing ? '' : `<p class="faint small" id="samplehint" style="margin:8px 4px 0">No bill handy? <button class="link" style="background:none;border:0;padding:0;text-decoration:underline;cursor:pointer" data-act="sampleBill">Try a sample bill</button></p>`}`}
    <div id="form"></div>
    <div class="sticky-cta"><button class="btn primary block" id="save" style="min-height:54px;font-size:17px"></button><div id="probs" class="small neg" style="text-align:center;margin-top:6px;min-height:20px" aria-live="polite"></div></div>
    `,
    mount(v) {
      const ta = $('#smart', v);
      if (ta) {
        let t;
        ta.oninput = () => { draft.text = ta.value; clearTimeout(t); t = setTimeout(() => { if (draft.text.trim()) applyParse(); renderPreview(); renderForm(); }, 160); };
        if (!draft.text && !editing && !Q.get('scan') && matchMedia('(hover:hover)').matches) ta.focus();
      }
      $('#file', v)?.addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) scanFile(f); });
      if (Q.get('scan') && !draft.scanned) { draft.scanned = 1; setTimeout(() => (Q.get('scan') === 'demo' ? ACT.sampleBill() : $('#file')?.click()), 50); }
      $('#save', v).onclick = (e) => saveDraft(e.currentTarget);
      if (!groups.length && !draft.gid) { draft.gid = ensureEveryday(); draft.split.parts = { [st().me]: 1 }; }
      renderPreview(); renderForm(); renderScan();
    },
  };
}

function renderPreview() {
  const pv = $('#pv');
  if (!pv) return;
  const r = draft.text.trim() ? draft.parsed : null;
  if (!r) { pv.innerHTML = `<span class="faint small">I understand: who paid, amounts, “split with”, “only me”, 70-30, 90%, “except Priya”, “Rahul owes me 200”, yesterday.</span>`; return; }
  const total = draftAmount();
  const paid = draftPaid();
  const owed = draftOwed();
  const tags = [];
  if (total) tags.push(`<span class="tag a">${money(total)}</span>`);
  tags.push(`<span class="tag">${esc(draft.desc || 'Expense')}</span>`);
  tags.push(`<span class="tag">paid by ${Object.keys(paid).map((id) => esc(dname(id).split(' ')[0]) + (Object.keys(paid).length > 1 ? ' ' + money(paid[id]) : '')).join(', ')}</span>`);
  const n = Object.keys(owed).length;
  tags.push(`<span class="tag">${draft.split.mode === 'equal' ? (n === 1 ? 'only ' + esc(dname(Object.keys(owed)[0]).split(' ')[0]) : `split equally · ${n}`) : 'split ' + splitLabel(draft.split)}</span>`);
  if (dayKey(draft.date) !== dayKey(Date.now())) tags.push(`<span class="tag">${fmtDate(draft.date)}</span>`);
  r.newNames.forEach((nn) => tags.push(`<span class="tag a">+ new: ${esc(nn.name)}</span>`));
  r.warnings.filter((w) => !/How much/.test(w) || !total).forEach((w) => tags.push(`<span class="tag w">${esc(w)}</span>`));
  pv.innerHTML = tags.join('');
}

function renderForm() {
  const f = $('#form');
  if (!f) return;
  const members = draftMembers();
  const total = draftAmount();
  const owed = draftOwed();
  const paid = draftPaid();
  const groups = S.groupList();
  const payer = Object.keys(draft.paid)[0];
  const sm = draft.split.mode;
  const modes = [['equal', 'Equal'], ['exact', '₹'], ['percent', '%'], ['shares', 'Shares']].concat(draft.items ? [['items', 'Items']] : []);
  const isSettle = draft.kind === 'settle';
  f.innerHTML = `
    <div class="card" style="margin-top:14px">
      <div class="amount-in"><span class="faint">${esc(cur())}</span><input id="amt" inputmode="decimal" placeholder="0" value="${esc(draft.amount)}" aria-label="Amount" autocomplete="off"></div>
      ${isSettle ? '' : `<input class="input" id="desc" style="margin-top:10px" placeholder="What was it for?" value="${esc(draft.desc)}" maxlength="80" aria-label="Description">`}
      <div style="display:flex;gap:8px;margin-top:10px">
        <select class="input" id="grp" style="flex:1.4" aria-label="Group">${draft.gid ? '' : '<option value="">Pick a group</option>'}${groups.map((g) => `<option value="${g.id}" ${g.id === draft.gid ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}<option value="__new">+ New group</option></select>
        <input class="input" type="date" id="dt" style="flex:1" value="${isoDate(draft.date)}" max="${isoDate(Date.now() + 864e5 * 365)}" aria-label="Date">
      </div>
      ${isSettle ? '' : `<div class="hints" style="padding-top:12px">${[draft.category, ...Object.keys(CATEGORIES).concat('general').filter((c) => c !== draft.category)].map((c) => `<button class="chip plain" data-cat="${c}" aria-pressed="${draft.category === c}" style="flex:none">${catIcon(c)} ${CAT_NAMES[c]}</button>`).join('')}</div>`}
    </div>

    <h2 class="h2">Paid by ${isSettle ? '' : `<button class="btn sm ghost" data-act="multiPay">${draft.multiPay ? 'One person' : 'Multiple people'}</button>`}</h2>
    ${draft.multiPay
      ? `<div class="card">${members.map((id) => `<div class="split-row">${davatar(id, 'sm')}<span class="name">${esc(dname(id))}</span><input class="input" data-pay="${id}" inputmode="decimal" placeholder="0" value="${draft.paid[id] ? draft.paid[id] / 100 : ''}" aria-label="${esc(dname(id))} paid"></div>`).join('')}
         <div class="note ${sumVals(paid) === total ? 'ok' : 'warn'}" style="margin-top:8px">${sumVals(paid) === total ? 'Adds up' : `${money(Math.abs(total - sumVals(paid)))} ${sumVals(paid) < total ? 'left' : 'over'}`}</div></div>`
      : `<div class="chips">${members.map((id) => `<button class="chip" data-payer="${id}" aria-pressed="${id === payer}">${davatar(id)}${esc(dname(id).split(' ')[0])}</button>`).join('')}<button class="chip new" data-act="addPersonDraft">${icon('plus', 'sm')} Person</button></div>`}

    ${isSettle ? `<h2 class="h2">Paid to</h2><div class="chips">${members.map((id) => `<button class="chip" data-settleto="${id}" aria-pressed="${id in draft.split.parts}">${davatar(id)}${esc(dname(id).split(' ')[0])}</button>`).join('')}</div>` : `
    <h2 class="h2">Split</h2>
    <div class="seg" role="tablist">${modes.map(([k, l]) => `<button role="tab" data-mode="${k}" aria-selected="${sm === k}">${l}</button>`).join('')}</div>
    <div class="card" style="margin-top:10px">
      ${sm === 'items' ? itemsHTML(members) : members.map((id) => {
        const v = draft.split.parts[id];
        const share = owed[id] || 0;
        if (sm === 'equal') return `<div class="split-row"><button class="check" role="checkbox" data-eq="${id}" aria-checked="${!!v}" aria-label="${esc(dname(id))}">${icon('check')}</button>${davatar(id, 'sm')}<span class="name">${esc(dname(id))}</span><span class="calc">${v ? money(share) : ''}</span></div>`;
        const shown = sm === 'exact' ? (v ? v / 100 : '') : v ?? '';
        return `<div class="split-row">${davatar(id, 'sm')}<span class="name">${esc(dname(id))}</span>${sm !== 'exact' ? `<span class="calc">${share ? money(share) : ''}</span>` : ''}<input class="input" data-part="${id}" inputmode="decimal" placeholder="0" value="${shown}" aria-label="${esc(dname(id))} ${sm}"></div>`;
      }).join('')}
      ${sm === 'equal' ? `<div class="btns" style="margin-top:6px"><button class="btn sm ghost" data-act="eqAll">Everyone</button><button class="btn sm ghost" data-act="eqNone">Nobody</button><button class="btn sm ghost" data-act="addPersonDraft">${icon('plus', 'sm')} Person</button></div>` : ''}
      ${sm === 'exact' && total ? (() => { const left = total - sumVals(owed); return `<div class="note ${left === 0 ? 'ok' : 'warn'}" style="margin-top:8px">${left === 0 ? 'Adds up' : left > 0 ? `${money(left)} left <button class="btn sm" data-act="fillRest" style="margin-left:auto">Split rest equally</button>` : `${money(-left)} over`}</div>`; })() : ''}
      ${sm === 'percent' ? (() => { const s = Object.values(draft.split.parts).reduce((a, b) => a + (+b || 0), 0); return `<div class="note ${Math.abs(s - 100) < 0.01 ? 'ok' : 'warn'}" style="margin-top:8px">${+s.toFixed(2)}% of 100%</div>`; })() : ''}
    </div>
    <label class="field" style="margin-top:14px"><span>Note (optional)</span><input class="input" id="note" maxlength="200" value="${esc(draft.note)}" placeholder="Anything to remember"></label>`}`;
  bindForm(f);
  renderSave();
}

function itemsHTML(members) {
  const extras = draftAmount() - draft.items.reduce((s, i) => s + i.amount, 0);
  return `<input class="input" id="whohad" placeholder="Who had what? “pizza Deepak, beer me and Rahul, rest everyone”" style="margin-bottom:8px" autocomplete="off">
    ${draft.items.map((it, i) => `<div class="item-row"><div class="top2"><input class="input" data-iname="${i}" value="${esc(it.name)}" aria-label="Item name"><input class="input amt" data-iamt="${i}" inputmode="decimal" value="${it.amount / 100}" aria-label="Item price"><button class="icon-btn" data-idel="${i}" aria-label="Remove item">${icon('x', 'sm')}</button></div>
      <div class="chips">${members.map((id) => `<button class="chip" data-iwho="${i}" data-id="${id}" aria-pressed="${it.who.includes(id)}">${davatar(id)}${esc(dname(id).split(' ')[0])}</button>`).join('')}</div></div>`).join('')}
    <button class="btn sm ghost" data-act="addItem" style="margin-top:8px">${icon('plus', 'sm')} Item</button>
    ${extras ? `<div class="note" style="margin-top:8px">${extras > 0 ? 'Tax, service & extras' : 'Discount'} ${money(Math.abs(extras))} is shared in proportion to what each person had.</div>` : ''}
    <div style="margin-top:10px">${Object.entries(draftOwed()).map(([id, a]) => `<div class="split-row" style="padding:4px 0">${davatar(id, 'sm')}<span class="name">${esc(dname(id))}</span><b class="num">${money(a)}</b></div>`).join('')}</div>`;
}

function bindForm(f) {
  const rerender = () => { renderPreview(); renderForm(); };
  const amt = $('#amt', f);
  amt.oninput = () => { draft.amount = amt.value.replace(/[^\d.]/g, ''); draft.touched.amount = 1; softUpdate(); };
  amt.onblur = () => renderForm();
  const desc = $('#desc', f);
  if (desc) desc.oninput = () => { draft.desc = desc.value; draft.touched.desc = 1; renderSave(); };
  $('#note', f)?.addEventListener('input', (e) => (draft.note = e.target.value));
  $('#dt', f).onchange = (e) => { if (e.target.value) { draft.date = new Date(e.target.value + 'T12:00:00').getTime(); draft.touched.date = 1; renderPreview(); } };
  $('#grp', f).onchange = (e) => {
    if (e.target.value === '__new') { e.target.value = draft.gid || ''; newGroupSheet((gid) => { switchGroup(gid); }); return; }
    switchGroup(e.target.value);
  };
  $$('[data-cat]', f).forEach((b) => (b.onclick = () => { draft.category = b.dataset.cat; draft.touched.category = 1; $$('[data-cat]', f).forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
  $$('[data-payer]', f).forEach((b) => (b.onclick = () => { draft.paid = { [b.dataset.payer]: 0 }; draft.touched.paid = 1; buzz(); rerender(); }));
  $$('[data-pay]', f).forEach((i) => (i.oninput = () => { draft.paid[i.dataset.pay] = toPaise(parseFloat(i.value) || 0); draft.touched.paid = 1; softUpdate(); }));
  $$('[data-pay]', f).forEach((i) => (i.onblur = () => renderForm()));
  $$('[data-settleto]', f).forEach((b) => (b.onclick = () => { draft.split = { mode: 'exact', parts: { [b.dataset.settleto]: draftAmount() } }; rerender(); }));
  $$('[data-mode]', f).forEach((b) => (b.onclick = () => {
    const m = b.dataset.mode;
    if (m === draft.split.mode) return;
    const owedNow = draftOwed();
    const ids = Object.keys(owedNow).length ? Object.keys(owedNow) : draftMembers();
    const total = draftAmount();
    if (m === 'equal') draft.split = { mode: 'equal', parts: Object.fromEntries(ids.map((id) => [id, 1])) };
    else if (m === 'exact') draft.split = { mode: 'exact', parts: { ...owedNow } };
    else if (m === 'percent') draft.split = { mode: 'percent', parts: Object.fromEntries(ids.map((id) => [id, total ? +((owedNow[id] / total) * 100).toFixed(2) : +(100 / ids.length).toFixed(2)])) };
    else if (m === 'shares') draft.split = { mode: 'shares', parts: Object.fromEntries(ids.map((id) => [id, 1])) };
    else if (m === 'items') draft.split = { mode: 'items', parts: {} };
    draft.touched.split = 1;
    rerender();
  }));
  $$('[data-eq]', f).forEach((b) => (b.onclick = () => { const id = b.dataset.eq; draft.split.parts[id] = draft.split.parts[id] ? 0 : 1; draft.touched.split = 1; buzz(); rerender(); }));
  $$('[data-part]', f).forEach((i) => {
    i.oninput = () => { const v = parseFloat(i.value) || 0; draft.split.parts[i.dataset.part] = draft.split.mode === 'exact' ? toPaise(v) : v; draft.touched.split = 1; softUpdate(); };
    i.onblur = () => renderForm();
  });
  // items
  const wh = $('#whohad', f);
  if (wh) wh.onchange = () => { draft.items = assignItems(wh.value, draft.items, { people: peopleArr(), me: st().me, members: draftMembers().filter((x) => !x.startsWith('new:')) }); rerender(); };
  $$('[data-iname]', f).forEach((i) => (i.oninput = () => (draft.items[+i.dataset.iname].name = i.value)));
  $$('[data-iamt]', f).forEach((i) => { i.oninput = () => { draft.items[+i.dataset.iamt].amount = toPaise(parseFloat(i.value) || 0); renderSave(); }; i.onblur = () => renderForm(); });
  $$('[data-idel]', f).forEach((b) => (b.onclick = () => { draft.items.splice(+b.dataset.idel, 1); rerender(); }));
  $$('[data-iwho]', f).forEach((b) => (b.onclick = () => { const it = draft.items[+b.dataset.iwho]; const id = b.dataset.id; it.who = it.who.includes(id) ? it.who.filter((x) => x !== id) : [...it.who, id]; buzz(); rerender(); }));
}
function softUpdate() {
  // update computed bits without stealing focus from the input being typed in
  const owed = draftOwed();
  $$('.split-row').forEach((r) => {
    const id = r.querySelector('[data-eq],[data-part]')?.dataset.eq || r.querySelector('[data-part]')?.dataset.part;
    const c = r.querySelector('.calc');
    if (id && c) c.textContent = owed[id] ? money(owed[id]) : '';
  });
  renderPreview();
  renderSave();
}
function switchGroup(gid) {
  draft.gid = gid;
  st().lastGroup = gid;
  const ms = memberList(gid);
  if (!draft.touched.split) draft.split = { mode: 'equal', parts: Object.fromEntries(ms.map((m) => [m, 1])) };
  if (draft.text.trim()) applyParse();
  if (draft.items) draft.items.forEach((it) => (it.who = it.who.length ? it.who : ms));
  renderPreview(); renderForm();
}
function renderSave() {
  const b = $('#save');
  if (!b) return;
  const p = draftProblems();
  const total = draftAmount();
  b.innerHTML = `${icon('check', 'sm')} ${draft.id ? 'Save changes' : 'Add'} ${total ? money(total) : ''}`;
  b.disabled = p.length > 0;
  $('#probs').textContent = p[0] || '';
}

function renderScan() {
  const box = $('#scanbox');
  if (!box || !draft.scan) { if (box) box.innerHTML = ''; return; }
  const s = draft.scan;
  box.innerHTML = `<div class="card" style="margin-top:12px">
    ${s.url ? `<img class="receipt-img" src="${s.url}" alt="Bill photo">` : ''}
    ${s.stage === 'reading' ? `<div style="margin-top:12px"><div class="small muted" style="display:flex;justify-content:space-between"><span>${s.p < 0.05 ? 'Loading scanner (first time takes a few seconds)…' : 'Reading the bill…'}</span><span class="num">${Math.round(s.p * 100)}%</span></div><div class="progress" style="margin-top:6px"><i style="width:${Math.max(4, s.p * 100)}%"></i></div><div class="sk" style="height:14px;margin-top:12px;width:70%"></div><div class="sk" style="height:14px;margin-top:8px;width:50%"></div></div>` : ''}
    ${s.stage === 'done' ? `<div class="note ok" style="margin-top:10px">${icon('check', 'sm')} Found ${s.count} item${s.count === 1 ? '' : 's'}${s.total ? ', total ' + money(s.total) : ''}. Check the numbers, then tap who had what below.</div>` : ''}
    ${s.stage === 'error' ? `<div class="note warn" style="margin-top:10px">${esc(s.err)}</div>` : ''}
  </div>`;
}
async function scanFile(file) {
  if (!/^image\//.test(file.type)) { toast('Pick a photo of the bill'); return; }
  const { shrink, ocr, parseReceipt } = await import('./receipt.js');
  let blob;
  try { blob = await shrink(file); } catch { blob = file; }
  draft.receiptBlob = blob;
  $('#samplehint')?.remove();
  draft.scan = { url: URL.createObjectURL(blob), stage: 'reading', p: 0 };
  renderScan();
  let last = 0;
  try {
    const text = await ocr(blob, (p) => { draft.scan.p = p; if (Date.now() - last > 150) { last = Date.now(); renderScan(); } });
    const r = parseReceipt(text);
    const ms = draftMembers();
    draft.items = r.items.map((it) => ({ ...it, who: [...ms] }));
    if (r.total && !draft.touched.amount) { draft.amount = String(r.total / 100); }
    if (!draft.desc || !draft.touched.desc) { const first = text.split('\n').map((l) => l.trim()).find((l) => /[a-z]{3}/i.test(l)); draft.desc = draft.desc || (first ? first.replace(/[^\w &'-]/g, '').trim().slice(0, 40) : 'Bill'); }
    draft.split = r.items.length ? { mode: 'items', parts: {} } : draft.split;
    draft.scan = { ...draft.scan, stage: 'done', count: r.items.length, total: r.total };
    if (!r.items.length) draft.scan = { ...draft.scan, stage: 'error', err: 'Could not read items. Enter the total above and split normally.' };
  } catch (e) {
    draft.scan = { ...draft.scan, stage: 'error', err: e.message || 'Scan failed. Enter the amount by hand.' };
  }
  renderScan(); renderPreview(); renderForm();
}

async function saveDraft(btn) {
  if (draftProblems().length || btn.classList.contains('busy')) return;
  await busy(btn, async () => {
    const total = draftAmount();
    // create new people the parser found, and add everyone involved to the group
    const map = {};
    for (const n of draft.newPeople) map[n.id] = S.addPerson(n.name);
    const fix = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [map[k] || k, v]));
    const paid = fix(draftPaid());
    const owed = fix(draftOwed());
    const g = st().groups[draft.gid];
    for (const id of [...Object.keys(paid), ...Object.keys(owed)]) if (!g.members.includes(id)) g.members.push(id);
    let receiptId = draft.receiptId;
    if (draft.receiptBlob) { receiptId = S.uid(); try { await S.putReceipt(receiptId, draft.receiptBlob); } catch { receiptId = null; toast('Could not store the bill photo'); } }
    const split = draft.split.mode === 'items' ? { mode: 'items', parts: {} } : { mode: draft.split.mode, parts: fix(draft.split.parts) };
    const items = draft.split.mode === 'items' && draft.items ? draft.items.map((it) => ({ ...it, who: it.who.map((w) => map[w] || w) })) : null;
    const id = S.upsertExpense({ id: draft.id, gid: draft.gid, kind: draft.kind || 'expense', text: draft.text.trim() || undefined, desc: (draft.desc || CAT_NAMES[draft.category] || 'Expense').trim().slice(0, 80), amount: total, date: draft.date, category: draft.kind === 'settle' ? 'settle' : draft.category, paid, owed, split, items, note: draft.note.trim(), receiptId });
    S.flush();
    buzz();
    const wasEdit = !!draft.id;
    const gid = draft.gid;
    draft = null;
    go(wasEdit ? '/e/' + id : '/g/' + gid);
    toast(wasEdit ? 'Saved' : 'Added', { action: wasEdit ? null : 'Undo', onAction: () => { S.softDelete(id); render(); } });
  });
}

// ---------- report (PDF via print) ----------
function viewReport(gid) {
  const g = st().groups[gid];
  if (!g) return null;
  const exps = S.groupExpenses(gid).slice().reverse();
  const real = exps.filter((e) => e.kind !== 'settle');
  const total = real.reduce((s, e) => s + e.amount, 0);
  const b = S.groupBalances(gid);
  const tr = transfersFor(gid);
  const ids = memberList(gid);
  const range = exps.length ? `${fmtDate(exps[0].date)} to ${fmtDate(exps[exps.length - 1].date)}` : '';
  const th = 'style="text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted)"';
  const td = 'style="padding:8px 6px;border-bottom:1px solid var(--line);font-size:14px;vertical-align:top"';
  return {
    title: g.name + ' report', back: '/g/' + gid, nav: false,
    actions: `<button class="icon-btn" data-act="print" aria-label="Save as PDF">${icon('download')}</button>`,
    html: `<div class="no-print btns" style="margin:4px 0 14px"><button class="btn primary" data-act="print">${icon('download', 'sm')} Save as PDF</button><button class="btn" data-act="shareGroup" data-g="${gid}">${icon('whatsapp', 'sm')} WhatsApp</button></div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><div style="font:800 26px var(--display)">${esc(g.name)}</div><div class="muted small">${esc(range)} · ${real.length} expenses · ${ids.length} people</div></div><div style="text-align:right"><div class="muted small">Total spent</div><div style="font:800 22px var(--display)">${money(total)}</div></div></div>
        <h2 class="h2">Who pays whom</h2>
        ${tr.length ? tr.map((t) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--line)"><span><b>${esc(S.pname(t.from, false))}</b> → <b>${esc(S.pname(t.to, false))}</b>${S.person(t.to).upi ? ` <span class="faint small">(UPI ${esc(S.person(t.to).upi)})</span>` : ''}</span><b class="num">${money(t.amount)}</b></div>`).join('') : '<p class="muted">All settled up.</p>'}
        <h2 class="h2">Per person</h2>
        <table style="width:100%;border-collapse:collapse"><tr><th ${th}>Name</th><th ${th}>Paid</th><th ${th}>Share</th><th ${th}>Balance</th></tr>
        ${ids.map((id) => { const s = S.spendOf(real, id); return `<tr><td ${td}>${esc(S.pname(id, false))}</td><td ${td} class="num">${money(s.paid)}</td><td ${td} class="num">${money(s.share)}</td><td ${td} class="num ${b[id] > 0 ? 'pos' : b[id] < 0 ? 'neg' : ''}">${b[id] ? (b[id] > 0 ? '+' : '') + money(b[id]) : '0'}</td></tr>`; }).join('')}</table>
        <h2 class="h2">All expenses</h2>
        <table style="width:100%;border-collapse:collapse"><tr><th ${th}>Date</th><th ${th}>What</th><th ${th}>Paid by</th><th ${th}>Amount</th></tr>
        ${exps.map((e) => `<tr><td ${td}>${fmtDate(e.date)}</td><td ${td}>${esc(e.desc)}<div class="faint small">${e.kind === 'settle' ? 'payment' : Object.keys(e.owed).map((w) => esc(S.firstName(w))).join(', ')}</div></td><td ${td}>${Object.keys(e.paid).map((p) => esc(S.pname(p, false))).join(', ')}</td><td ${td} class="num">${money(e.amount)}</td></tr>`).join('')}</table>
        <p class="faint small" style="margin-top:16px">Made with Hisaab · ${new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' })}</p>
      </div>`,
  };
}

// ---------- import shared link ----------
async function viewImport(code) {
  let d;
  try { d = await unpackGroup(code); } catch { return { title: 'Shared group', back: '/', html: `<div class="empty"><div class="art">${icon('link', 'lg')}</div><h3>This link is broken</h3><p>Ask for the link again. WhatsApp sometimes cuts long links.</p></div>` }; }
  const total = d.e.filter((x) => !x[6]).reduce((s, x) => s + x[1], 0);
  let pick = st().me ? null : d.by;
  if (st().me) { const myName = S.person(st().me).name.toLowerCase(); const i = d.p.findIndex(([n]) => n.toLowerCase() === myName); pick = i >= 0 ? i : d.by; }
  return {
    title: 'Shared group', back: '/', nav: false,
    html: `<section class="hero" style="margin-top:8px"><div class="muted small" style="font-weight:600">Someone shared a group with you</div><div style="font:800 28px var(--display);margin-top:4px">${esc(d.n)}</div><div class="muted small">${d.e.length} entries · ${d.p.length} people · ${money(total)} spent</div></section>
      <h2 class="h2">Which one is you?</h2>
      <div class="chips" id="who">${d.p.map(([n], i) => `<button class="chip" data-i="${i}" aria-pressed="${i === pick}">${avName(n)}${esc(n)}</button>`).join('')}</div>
      ${st().me ? '' : `<label class="field" style="margin-top:14px"><span>Not in the list? Your name</span><input class="input" id="myname" maxlength="40" placeholder="Your name"></label>`}
      <button class="btn primary block" style="margin-top:18px" id="imp">${icon('download', 'sm')} Add to my Hisaab</button>
      <p class="faint small" style="margin:10px 4px">This saves a copy on your phone. Changes you make later stay on your phone; share a new link to sync.</p>`,
    mount(v) {
      $$('#who .chip', v).forEach((c) => (c.onclick = () => { pick = +c.dataset.i; $$('#who .chip', v).forEach((x) => x.setAttribute('aria-pressed', x === c)); }));
      $('#imp', v).onclick = (e) => busy(e.currentTarget, async () => {
        const typed = $('#myname', v)?.value.trim();
        if (!st().me) {
          const name = typed || (pick != null ? d.p[pick][0] : '');
          if (!name) { toast('Pick yourself or type your name'); return; }
          const id = S.uid();
          st().people[id] = { id, name, phone: '', upi: pick != null && !typed ? d.p[pick][1] || '' : '', createdAt: Date.now() };
          st().me = id;
          if (typed) pick = null;
        }
        const map = d.p.map(([n, upi], i) => (i === pick ? st().me : S.addPerson(n, upi ? { upi } : {})));
        const gid = S.addGroup(d.n, d.m.map((i) => map[i]));
        for (const [desc, amount, date, category, paid, owed, settle] of d.e) {
          S.upsertExpense({ gid, desc: String(desc).slice(0, 80), amount: +amount, date: +date, category: CAT_NAMES[category] ? category : 'general', paid: Object.fromEntries(paid.map(([i, v]) => [map[i], +v])), owed: Object.fromEntries(owed.map(([i, v]) => [map[i], +v])), kind: settle ? 'settle' : 'expense', split: { mode: 'exact', parts: Object.fromEntries(owed.map(([i, v]) => [map[i], +v])) }, imported: 1 });
        }
        S.flush();
        go('/g/' + gid);
        toast(`Imported ${d.n}`);
      });
    },
  };
}

// ---------- settings ----------
let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
function viewSettings() {
  const me = S.person(st().me);
  const s = st().settings;
  const bytes = (localStorage.getItem('hisaab:v1') || '').length;
  return {
    title: 'Settings', back: '/', tab: '',
    html: `<a class="row card" href="#/p/${st().me}" style="margin-top:8px">${av(st().me)}<div class="main"><div class="t">${esc(me.name)}</div><div class="s">${me.upi ? 'UPI ' + esc(me.upi) : 'Add your UPI ID so friends can pay you in one tap'}</div></div>${icon('right', 'sm')}</a>
      <h2 class="h2">Look</h2>
      <nav class="seg">${[['system', 'System'], ['dark', 'Dark'], ['light', 'Light']].map(([k, l]) => `<button data-theme-set="${k}" aria-selected="${s.theme === k}">${l}</button>`).join('')}</nav>
      <label class="field" style="margin-top:12px"><span>Currency symbol</span><select class="input" id="cur">${['₹', '$', '€', '£', 'AED ', 'S$'].map((c) => `<option ${c === s.cur ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      ${installEvt ? `<button class="btn primary block" data-act="install">${icon('download', 'sm')} Install app on this phone</button>` : `<div class="note">${icon('download', 'sm')} Install: browser menu → “Add to Home screen”.</div>`}
      <h2 class="h2">Your data</h2>
      <div class="note" style="margin-bottom:10px">Everything stays on this device (${(bytes / 1024).toFixed(0)} KB). Export a backup now and then, or before changing phones.</div>
      <div class="btns"><button class="btn" data-act="export">${icon('download', 'sm')} Export backup</button><label class="btn">${icon('upload', 'sm')} Restore<input type="file" accept="application/json,.json" id="restore" hidden></label></div>
      <label class="btn block" style="margin-top:10px">${icon('upload', 'sm')} Import from Splitwise (CSV)<input type="file" accept=".csv,text/csv" id="swcsv" hidden></label>
      <p class="faint small" style="margin:6px 4px">In Splitwise: open a group → settings → Export as spreadsheet.</p>
      <h2 class="h2">Danger zone</h2>
      <button class="btn danger block" data-act="wipe">${icon('trash', 'sm')} Erase everything on this phone</button>
      <p class="faint small" style="text-align:center;margin-top:24px">Hisaab · free, open source, no tracking · <a class="link" href="https://github.com/nmtjn1997/hisaab" target="_blank" rel="noopener">GitHub</a></p>`,
    mount(v) {
      $$('[data-theme-set]', v).forEach((b) => (b.onclick = () => { s.theme = b.dataset.themeSet; S.save(); applyTheme(); render(); }));
      $('#cur', v).onchange = (e) => { s.cur = e.target.value; S.save(); };
      $('#restore', v).onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          if (data.v !== 1 || !data.people || !data.expenses) throw new Error();
          confirmSheet('Restore backup?', `This replaces everything on this phone with the backup from ${new Date(data.exportedAt || Date.now()).toLocaleDateString('en-IN')}.`, 'Restore', () => { delete data.exportedAt; S.replaceState(data); applyTheme(); go('/'); toast('Restored'); });
        } catch { toast('That is not a Hisaab backup file'); }
      };
      $('#swcsv', v).onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importSplitwise(await f.text(), f.name); };
    },
  };
}
function importSplitwise(text, fname) {
  let r;
  try { r = splitwiseRows(text); } catch (e) { toast(e.message); return; }
  const myName = S.person(st().me).name.toLowerCase();
  let meCol = r.names.findIndex((n) => n.toLowerCase() === myName || n.toLowerCase().split(' ')[0] === myName.split(' ')[0]);
  sheet(`<h3>Import from Splitwise</h3><p class="muted small">${r.rows.length} entries, ${r.names.length} people.</p>
    <label class="field"><span>Group name</span><input class="input" id="gn" value="${esc(fname.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ').replace(/\s*\d{4}.*$/, '') || 'Imported')}"></label>
    <div class="field"><span>Which one is you?</span><div class="chips" id="mc">${r.names.map((n, i) => `<button class="chip" data-i="${i}" aria-pressed="${i === meCol}">${avName(n)}${esc(n)}</button>`).join('')}</div></div>
    <button class="btn primary block" id="go">Import</button>`, (el, close) => {
    $$('#mc .chip', el).forEach((c) => (c.onclick = () => { meCol = +c.dataset.i; $$('#mc .chip', el).forEach((x) => x.setAttribute('aria-pressed', x === c)); }));
    $('#go', el).onclick = () => {
      const map = r.names.map((n, i) => (i === meCol ? st().me : S.addPerson(n)));
      const gid = S.addGroup($('#gn', el).value || 'Imported', map);
      const catMap = (c) => (/food|dining|restaurant|liquor/.test(c) ? 'food' : /grocer/.test(c) ? 'groceries' : /taxi|bus|train|plane|car|parking|hotel|travel/.test(c) ? 'travel' : /gas|fuel/.test(c) ? 'fuel' : /rent|electric|water|utilities|household|tv|internet|mortgage|maintenance|cleaning/.test(c) ? 'home' : /movie|game|music|sports|entertain/.test(c) ? 'fun' : /cloth|gift|electronics|shopping/.test(c) ? 'shopping' : /medical|health/.test(c) ? 'health' : 'general');
      for (const row of r.rows) {
        const paid = {}, owed = {};
        for (const [n, v] of row.nets) { const id = map[r.names.indexOf(n)]; if (v > 0) paid[id] = v; else owed[id] = -v; }
        if (!Object.keys(paid).length) continue;
        S.upsertExpense({ gid, desc: row.desc.slice(0, 80), amount: row.settle ? sumVals(paid) : row.amount, date: row.date, category: row.settle ? 'settle' : catMap(row.category), paid, owed, kind: row.settle ? 'settle' : 'expense', split: { mode: 'exact', parts: { ...owed } }, imported: 1, note: row.settle ? '' : 'Imported from Splitwise. Shows net amounts per person.' });
      }
      S.flush();
      close();
      go('/g/' + gid);
      toast(`Imported ${r.rows.length} entries`);
    };
  });
}
function applyTheme() {
  let t = st().settings.theme;
  if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]').content = t === 'light' ? '#f5f5f0' : '#0a0b0f';
}
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);

// ---------- actions ----------
async function shareText(text, url) {
  if (navigator.share) { try { await navigator.share({ text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  open(waLink(url ? text + '\n' + url : text), '_blank', 'noopener');
}
async function groupLink(gid) {
  const code = await packGroup(st(), gid);
  return `${location.origin}${location.pathname}#/import/${code}`;
}
function recordSettle(gid, from, to, amount, desc = 'Settlement') {
  return S.upsertExpense({ gid, kind: 'settle', desc, amount, date: Date.now(), category: 'settle', paid: { [from]: amount }, owed: { [to]: amount }, split: { mode: 'exact', parts: { [to]: amount } } });
}

const ACT = {
  newGroup: () => newGroupSheet(),
  newPerson: () => personSheet(null, (id) => go('/p/' + id)),
  editPerson: (b) => personSheet(b.dataset.id),
  toggleSimplify: (b) => { const g = st().groups[b.dataset.g]; g.simplify = g.simplify === false; S.save(); render(); },
  addMember: (b) => { const g = st().groups[b.dataset.g]; if (!g.members.includes(b.dataset.id)) g.members.push(b.dataset.id); S.save(); render(); },
  speak: () => listen((t) => { draft.text = draft.text.trim() ? draft.text.trim() + ', ' + t : t; const ta = $('#smart'); if (ta) ta.value = draft.text; applyParse(); render(); }),
  scan: () => $('#file')?.click(),
  sampleBill: async () => { const r = await fetch('assets/sample-bill.jpg'); const b = await r.blob(); scanFile(new File([b], 'sample-bill.jpg', { type: 'image/jpeg' })); },
  clearSmart: () => { const g = draft.gid; draft = { ...newDraft(g), key: draft.key }; render(); },
  multiPay: () => { draft.multiPay = !draft.multiPay; draft.touched.paid = 1; if (draft.multiPay) { const t = draftAmount(); const id = Object.keys(draft.paid)[0] || st().me; draft.paid = { [id]: t }; } else { draft.paid = { [Object.keys(draft.paid).find((k) => draft.paid[k] > 0) || st().me]: 0 }; } renderForm(); renderPreview(); },
  eqAll: () => { draftMembers().forEach((id) => (draft.split.parts[id] = 1)); draft.touched.split = 1; renderForm(); renderPreview(); },
  eqNone: () => { draft.split.parts = {}; draft.touched.split = 1; renderForm(); renderPreview(); },
  fillRest: () => {
    const total = draftAmount();
    const ids = draftMembers().filter((id) => !(draft.split.parts[id] > 0));
    if (!ids.length) return;
    Object.assign(draft.split.parts, allocate(total - sumVals(draftOwed()), Object.fromEntries(ids.map((i) => [i, 1]))));
    renderForm();
  },
  addItem: () => { draft.items.push({ name: 'Item', amount: 0, who: draftMembers() }); renderForm(); },
  addPersonDraft: () => {
    sheet(`<h3>Add person</h3><form id="ap"><input class="input" name="n" required maxlength="40" placeholder="Name" autofocus><button class="btn primary block" style="margin-top:12px">Add</button></form>`, (el, close) => {
      $('#ap', el).onsubmit = (e) => {
        e.preventDefault();
        const id = S.addPerson(e.target.n.value);
        const g = st().groups[draft.gid];
        if (g && !g.members.includes(id)) { g.members.push(id); S.save(); }
        if (draft.split.mode === 'equal') draft.split.parts[id] = 1;
        close(); renderForm(); renderPreview();
      };
    });
  },
  settle: (b) => {
    const { from, to, g } = b.dataset;
    const amt = +b.dataset.amt;
    sheet(`<h3>Record a payment</h3>
      <div style="display:flex;align-items:center;gap:10px;justify-content:center;margin:6px 0 16px">${av(from, 'lg')}<span class="muted">${icon('right')}</span>${av(to, 'lg')}</div>
      <p class="muted" style="text-align:center;margin-top:0"><b>${esc(S.pname(from))}</b> paid <b>${esc(S.pname(to))}</b></p>
      <div class="amount-in card"><span class="faint">${esc(cur())}</span><input id="sa" inputmode="decimal" value="${amt / 100}" aria-label="Amount"></div>
      <button class="btn primary block" style="margin-top:14px" id="ok">${icon('check', 'sm')} Mark as paid</button>`, (el, close) => {
      $('#ok', el).onclick = () => {
        const a = toPaise(parseFloat($('#sa', el).value) || 0);
        if (a <= 0) return toast('Enter an amount');
        const id = recordSettle(g, from, to, a);
        close(); buzz(); render();
        toast('Payment recorded', { action: 'Undo', onAction: () => { S.softDelete(id); render(); } });
      };
    });
  },
  settleAll: (b) => {
    const id = b.dataset.id, me = st().me;
    const rows = S.groupList().filter((g) => g.members.includes(id) && g.members.includes(me)).map((g) => ({ g, n: pairwiseInGroup(g.id, id) })).filter((x) => x.n);
    if (!rows.length) return;
    const tot = rows.reduce((s, r) => s + r.n, 0);
    confirmSheet(`Settle up with ${S.person(id).name}?`, `${tot > 0 ? `${S.person(id).name} paid you` : `You paid ${S.person(id).name}`} ${money(Math.abs(tot))}${rows.length > 1 ? ` across ${rows.length} groups` : ''}.`, 'Mark settled', () => {
      const made = rows.map(({ g, n }) => (n > 0 ? recordSettle(g.id, id, me, n) : recordSettle(g.id, me, id, -n)));
      render();
      toast('Settled', { action: 'Undo', onAction: () => { made.forEach((x) => S.softDelete(x)); render(); } });
    }, false);
  },
  remind: (b) => {
    const { from, to, g } = b.dataset;
    const amt = +b.dataset.amt;
    const p = S.person(from), r = S.person(to);
    const upi = r.upi ? `\nPay by UPI: ${r.upi}` : '';
    const text = `Hi ${p.name.split(' ')[0]}, quick reminder from Hisaab: you owe ${to === st().me ? 'me' : r.name} ${money(amt)} for ${st().groups[g]?.name || 'our expenses'}.${upi}`;
    if (p.phone) open(waLink(text, p.phone), '_blank', 'noopener'); else shareText(text);
  },
  remindPerson: (b) => {
    const p = S.person(b.dataset.id);
    const n = personNets()[p.id] || 0;
    const me = S.person(st().me);
    const text = `Hi ${p.name.split(' ')[0]}, quick reminder from Hisaab: you owe me ${money(n)}.${me.upi ? `\nPay by UPI: ${me.upi}` : ''}`;
    if (p.phone) open(waLink(text, p.phone), '_blank', 'noopener'); else shareText(text);
  },
  notifyBill: (b) => {
    const e = st().expenses[b.dataset.id];
    const payer = Object.keys(e.paid).map((k) => S.pname(k, false)).join(' & ');
    const lines = Object.entries(e.owed).map(([k, v]) => `• ${S.pname(k, false)}: ${money(v)}`);
    const me = S.person(st().me);
    const text = `*${e.desc}* · ${money(e.amount)} · ${fmtDate(e.date)}\nPaid by ${payer}\n${lines.join('\n')}${e.paid[st().me] && me.upi ? `\n\nPay me by UPI: ${me.upi}` : ''}`;
    shareText(text);
  },
  delExpense: (b) => {
    const id = b.dataset.id;
    const gid = st().expenses[id].gid;
    S.softDelete(id);
    go('/g/' + gid);
    toast('Deleted', { action: 'Undo', onAction: () => { S.softDelete(id, false); render(); } });
  },
  restore: (b) => { S.softDelete(b.dataset.id, false); render(); },
  shareGroup: (b) => {
    const gid = b.dataset.g;
    sheet(`<h3>Share ${esc(st().groups[gid].name)}</h3>
      <div class="list">
        <button class="row" data-s="wa">${icon('whatsapp')}<div class="main"><div class="t">WhatsApp summary</div><div class="s">Who pays whom, as a message</div></div></button>
        <button class="row" data-s="link">${icon('link')}<div class="main"><div class="t">Share a copy of this group</div><div class="s">Others open the link and get every expense</div></div></button>
        <button class="row" data-s="pdf">${icon('file')}<div class="main"><div class="t">PDF report</div><div class="s">Balances, per person totals, all expenses</div></div></button>
      </div>`, (el, close) => {
      el.querySelector('[data-s=wa]').onclick = () => { close(); const real = S.groupExpenses(gid).filter((e) => e.kind !== 'settle'); shareText(groupSummaryText({ group: st().groups[gid], transfers: transfersFor(gid), totals: { total: real.reduce((s, e) => s + e.amount, 0) }, name: (id) => S.pname(id, false), cur: cur() })); };
      el.querySelector('[data-s=link]').onclick = (e) => busy(e.currentTarget, async () => {
        const url = await groupLink(gid);
        close();
        if (url.length > 7000) toast('Big group: the link is long, WhatsApp may cut it. Prefer PDF.');
        if (navigator.share) { try { await navigator.share({ title: st().groups[gid].name, text: `${st().groups[gid].name} on Hisaab`, url }); return; } catch (x) { if (x.name === 'AbortError') return; } }
        try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); }
      });
      el.querySelector('[data-s=pdf]').onclick = () => { close(); go(`/g/${gid}/report`); };
    });
  },
  inviteGroup: (b) => ACT.shareGroup(b),
  groupMenu: (b) => {
    const g = st().groups[b.dataset.g];
    sheet(`<h3>${esc(g.name)}</h3>
      <form id="rn"><label class="field"><span>Name</span><input class="input" name="n" value="${esc(g.name)}" maxlength="50"></label><button class="btn block">Rename</button></form>
      <div class="btns" style="margin-top:12px"><button class="btn" data-x="arch">${g.archived ? 'Unarchive' : 'Archive'}</button><button class="btn danger" data-x="del">${icon('trash', 'sm')} Delete</button></div>`, (el, close) => {
      $('#rn', el).onsubmit = (e) => { e.preventDefault(); g.name = e.target.n.value.trim().slice(0, 50) || g.name; S.save(); close(); render(); };
      el.querySelector('[data-x=arch]').onclick = () => { g.archived = !g.archived; S.save(); close(); go('/groups'); };
      el.querySelector('[data-x=del]').onclick = () => { close(); confirmSheet(`Delete ${g.name}?`, 'The group and its expenses disappear from your lists. You can undo right after.', 'Delete', () => { g.deleted = true; S.save(); go('/groups'); toast('Group deleted', { action: 'Undo', onAction: () => { g.deleted = false; S.save(); render(); } }); }); };
    });
  },
  print: () => print(),
  install: async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); },
  export: () => {
    const blob = new Blob([JSON.stringify({ ...st(), exportedAt: Date.now() }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hisaab-backup-${isoDate(Date.now())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  wipe: () => confirmSheet('Erase everything?', 'All groups, people and expenses on this phone will be deleted. Export a backup first if unsure.', 'Erase', () => { localStorage.removeItem('hisaab:v1'); indexedDB.deleteDatabase('hisaab'); location.hash = '#/welcome'; location.reload(); }),
};

let lastClick = 0;
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const now = Date.now();
  if (now - lastClick < 250 && b.dataset.act !== 'eqAll') return; // swallow double taps
  lastClick = now;
  e.preventDefault();
  ACT[b.dataset.act]?.(b, e);
});

// ---------- boot ----------
applyTheme();
render();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('New version ready', { action: 'Reload', onAction: () => location.reload(), ms: 15000 }); });
    });
  }).catch(() => {});
}
