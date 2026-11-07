// Sharing without a server: WhatsApp text, UPI deep links, and whole groups packed into a URL.
import { fmt } from './money.js';

export const waLink = (text, phone = '') => `https://wa.me/${String(phone).replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}?text=${encodeURIComponent(text)}`;

export function upiLink({ upi, name, amount, note }) {
  const p = new URLSearchParams({ pa: upi, pn: name || '', am: (amount / 100).toFixed(2), cu: 'INR', tn: (note || 'Hisaab settle up').slice(0, 50) });
  return 'upi://pay?' + p.toString();
}

async function deflate(str) {
  const cs = new Blob([str]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function inflate(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(ds).text();
}

// Compact pack: people by index, expenses as arrays. Receipts are never included.
export async function packGroup(state, gid) {
  const g = state.groups[gid];
  const ids = [...new Set([...g.members, ...Object.values(state.expenses).filter((e) => e.gid === gid && !e.deleted).flatMap((e) => [...Object.keys(e.paid), ...Object.keys(e.owed)])])];
  const ix = Object.fromEntries(ids.map((id, i) => [id, i]));
  const mapObj = (o) => Object.entries(o).map(([k, v]) => [ix[k], v]);
  const ex = Object.values(state.expenses).filter((e) => e.gid === gid && !e.deleted).map((e) => [e.desc, e.amount, e.date, e.category, mapObj(e.paid), mapObj(e.owed), e.kind === 'settle' ? 1 : 0]);
  const data = { n: g.name, p: ids.map((id) => [state.people[id]?.name || '?', state.people[id]?.upi || '']), m: g.members.map((id) => ix[id]), e: ex, by: ix[state.me] };
  return deflate(JSON.stringify(data));
}
export async function unpackGroup(code) {
  const d = JSON.parse(await inflate(code));
  if (!d || !Array.isArray(d.p) || !Array.isArray(d.e)) throw new Error('Bad link');
  return d;
}

export function groupSummaryText({ group, transfers, totals, name, cur, url }) {
  const lines = [`*${group.name}* on Hisaab`, `Total spent: ${fmt(totals.total, cur)}`, ''];
  if (!transfers.length) lines.push('All settled up.');
  else {
    lines.push('*Who pays whom*');
    for (const t of transfers) lines.push(`• ${name(t.from)} → ${name(t.to)}: ${fmt(t.amount, cur)}`);
  }
  if (url) lines.push('', url);
  return lines.join('\n');
}

// Splitwise "Export as spreadsheet" CSV: Date,Description,Category,Cost,Currency,<person>...
// Person columns are net per expense (+ owed to them, - they owe), which is all we need for balances.
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
export function splitwiseRows(text) {
  const rows = parseCSV(text);
  const h = rows[0]?.map((s) => s.trim());
  if (!h || h[0] !== 'Date' || h[3] !== 'Cost') throw new Error('Not a Splitwise export (expected Date, Description, Category, Cost, Currency, …)');
  const names = h.slice(5);
  const out = [];
  for (const r of rows.slice(1)) {
    if (!r[0] || /total balance/i.test(r[1] || '') || isNaN(Date.parse(r[0]))) continue;
    const nets = names.map((n, i) => [n, Math.round(parseFloat(r[5 + i] || '0') * 100)]).filter(([, v]) => v);
    const cost = Math.round(parseFloat(r[3]) * 100);
    out.push({ date: Date.parse(r[0]), desc: r[1] || 'Expense', category: (r[2] || '').toLowerCase(), amount: cost, nets, settle: /^payment$/i.test(r[2] || '') });
  }
  return { names, rows: out };
}

// Export a group in Splitwise's spreadsheet layout, so it opens in Excel or Google Sheets and
// imports back into Splitwise or Hisaab: Date, Description, Category, Cost, Currency, one column
// per person with their net for that row (+ is owed to them), and a closing "Total balance" row.
// Text that starts like a formula (=, +, -, @) gets a leading quote so spreadsheets show it as text.
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s) && isNaN(+s)) s = "'" + s;
  return /[",\n\r]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
};
export function groupToCSV({ expenses, members, name, cur = 'INR', category = (c) => c }) {
  const ids = members.map((m) => m.id);
  const head = ['Date', 'Description', 'Category', 'Cost', 'Currency', ...members.map((m) => m.name)];
  const rows = [head];
  const total = Object.fromEntries(ids.map((id) => [id, 0]));
  const iso = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  for (const e of [...expenses].sort((a, b) => a.date - b.date)) {
    const nets = ids.map((id) => (e.paid[id] || 0) - (e.owed[id] || 0));
    nets.forEach((n, i) => (total[ids[i]] += n));
    rows.push([iso(e.date), e.desc, e.kind === 'settle' ? 'Payment' : category(e.category), (e.amount / 100).toFixed(2), cur, ...nets.map((n) => (n / 100).toFixed(2))]);
  }
  rows.push([iso(Date.now()), 'Total balance', '', '', cur, ...ids.map((id) => (total[id] / 100).toFixed(2))]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
