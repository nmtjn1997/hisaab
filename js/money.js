// All amounts are integer paise. Rupees only exist at the UI edge.
export const toPaise = (r) => Math.round(Number(r) * 100);
export const toRupees = (p) => p / 100;

const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Whole rupees print without decimals; anything with paise always shows two digits.
export const fmt = (p, cur = '₹') => (p < 0 ? '-' : '') + cur + (Math.abs(p) % 100 ? nf2 : nf0).format(Math.abs(p) / 100);

/**
 * Trip budget pace. Amounts in paise, times in ms. start/end optional (whole days, inclusive).
 * @returns {{spent, budget, left, pct, over, daysLeft, perDayLeft, perDaySoFar, onTrack}}
 */
export function budgetStatus({ budget, spent, start, end, now = Date.now() }) {
  const day = 864e5, d0 = (t) => { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const left = budget - spent;
  const pct = budget ? Math.min(999, Math.round((spent / budget) * 100)) : 0;
  let daysLeft = null, perDayLeft = null, perDaySoFar = null, onTrack = null;
  if (start) {
    const elapsed = Math.max(1, Math.floor((d0(Math.min(now, end || now)) - d0(start)) / day) + 1);
    perDaySoFar = Math.round(spent / elapsed / 100) * 100; // whole rupees read better
    if (end) {
      const total = Math.max(1, Math.floor((d0(end) - d0(start)) / day) + 1);
      daysLeft = Math.max(0, total - elapsed + (now < start ? 0 : 0));
      if (now < start) daysLeft = total;
      perDayLeft = daysLeft ? Math.floor(Math.max(0, left) / daysLeft / 100) * 100 : 0;
      onTrack = spent <= Math.round((budget * Math.min(total, elapsed)) / total);
    }
  }
  return { spent, budget, left, pct, over: left < 0, daysLeft, perDayLeft, perDaySoFar, onTrack };
}

// Split `total` across keys by integer weights; remainder paise go to the
// largest fractional parts so the parts always sum exactly to total.
export function allocate(total, weights) {
  const keys = Object.keys(weights).filter((k) => weights[k] > 0);
  const sum = keys.reduce((s, k) => s + weights[k], 0);
  const out = {};
  if (!keys.length || !sum) return out;
  let used = 0;
  const fr = keys.map((k) => {
    const exact = (total * weights[k]) / sum;
    out[k] = Math.floor(exact);
    used += out[k];
    return [k, exact - out[k]];
  });
  fr.sort((a, b) => b[1] - a[1]);
  for (let i = 0; used < total; i++, used++) out[fr[i % fr.length][0]]++;
  return out;
}

// split = { mode: 'equal'|'exact'|'percent'|'shares', parts: {pid: number} }
// equal: parts value truthy = included. exact: paise. percent: 0-100. shares: weight.
export function computeOwed(total, split) {
  const p = split.parts || {};
  if (split.mode === 'exact') {
    const o = {};
    for (const k in p) if (p[k] > 0) o[k] = Math.round(p[k]);
    return o;
  }
  if (split.mode === 'percent' || split.mode === 'shares') {
    const w = {};
    for (const k in p) if (p[k] > 0) w[k] = Math.round(p[k] * 1000);
    return allocate(total, w);
  }
  const w = {};
  for (const k in p) if (p[k]) w[k] = 1;
  return allocate(total, w);
}

export const sumVals = (o) => Object.values(o || {}).reduce((s, v) => s + v, 0);

// Net per person: positive = should receive, negative = should pay.
export function balances(expenses) {
  const b = {};
  for (const e of expenses) {
    for (const k in e.paid) b[k] = (b[k] || 0) + e.paid[k];
    for (const k in e.owed) b[k] = (b[k] || 0) - e.owed[k];
  }
  for (const k in b) if (b[k] === 0) delete b[k];
  return b;
}

// Greedy min-transfers: biggest debtor pays biggest creditor. At most n-1 transfers.
export function simplify(bal) {
  const cr = [], dr = [];
  for (const k in bal) {
    if (bal[k] > 0) cr.push([k, bal[k]]);
    else if (bal[k] < 0) dr.push([k, -bal[k]]);
  }
  const out = [];
  while (cr.length && dr.length) {
    cr.sort((a, b) => b[1] - a[1]);
    dr.sort((a, b) => b[1] - a[1]);
    const amt = Math.min(cr[0][1], dr[0][1]);
    out.push({ from: dr[0][0], to: cr[0][0], amount: amt });
    cr[0][1] -= amt;
    dr[0][1] -= amt;
    if (!cr[0][1]) cr.shift();
    if (!dr[0][1]) dr.shift();
  }
  return out;
}

// Pairwise debts between `me` and everyone (not simplified), across expenses.
export function pairwise(expenses, me) {
  const r = {};
  for (const e of expenses) {
    const tot = sumVals(e.paid);
    if (!tot) continue;
    for (const debtor in e.owed) {
      for (const payer in e.paid) {
        if (debtor === payer) continue;
        const amt = Math.round((e.owed[debtor] * e.paid[payer]) / tot);
        if (payer === me) r[debtor] = (r[debtor] || 0) + amt;
        else if (debtor === me) r[payer] = (r[payer] || 0) - amt;
      }
    }
  }
  for (const k in r) if (!r[k]) delete r[k];
  return r;
}
