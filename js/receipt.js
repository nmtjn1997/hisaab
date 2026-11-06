// Receipt OCR (Tesseract.js, loaded on demand) and a plain-text bill parser.
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let loading;
function loadTesseract() {
  return (loading ||= new Promise((res, rej) => {
    if (window.Tesseract) return res(window.Tesseract);
    const s = document.createElement('script');
    s.src = TESS;
    s.crossOrigin = 'anonymous';
    s.onload = () => res(window.Tesseract);
    s.onerror = () => { loading = null; rej(new Error('Could not load the scanner. Check your connection.')); };
    document.head.appendChild(s);
  }));
}

// Downscale before OCR and storage: phone photos are 12MP, receipts need ~1600px.
export async function shrink(file, max = 1600, q = 0.75) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', q));
}

// Phone photos of bills are grey, shadowed and low contrast. Greyscale plus a percentile
// contrast stretch, and upscaling small text, lifts Tesseract accuracy a lot for free.
export async function cleanForOcr(blob) {
  const bmp = await createImageBitmap(blob);
  const k = bmp.width < 1100 ? 1400 / bmp.width : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = y; hist[y]++; }
  const n = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < n * 0.02) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < n * 0.02) hi--;
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span)); d[i] = d[i + 1] = d[i + 2] = v; }
  g.putImageData(img, 0, 0);
  return c;
}

export async function ocr(blob, onProgress) {
  const T = await loadTesseract();
  const img = await cleanForOcr(blob).catch(() => blob);
  const w = await T.createWorker('eng', 1, { logger: (m) => m.status === 'recognizing text' && onProgress?.(m.progress) });
  try {
    // PSM 4: one column of text of varying sizes, which is what a bill is.
    await w.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
    const { data } = await w.recognize(img);
    return data.text;
  } finally { w.terminate(); }
}

const TOTAL_RE = /\b(grand\s*total|net\s*(amount|payable|total)|total\s*(amount|payable|due)?|amount\s*(payable|due)|to\s*pay|bill\s*amount|balance\s*due)\b/i;
const EXTRA_RE = /\b(c?gst|sgst|igst|vat|tax|service\s*(charge|tax)?|s\.?c\.?|tip|packing|packaging|delivery|round(ing)?\s*off|discount|cess|convenience|platform\s*fee)\b/i;
const SKIP_RE = /\b(sub\s*total|subtotal|cash|change|card|upi|paid|tender|qty|rate|amount\s*$|invoice|bill\s*no|table|gstin|fssai|phone|tel|date|time|thank|visit|cashier|order\s*no|kot|token)\b/i;

// OCR confuses letters and digits inside prices: O/o->0, l/I/|->1, S->5, B->8. "420,00" is 420.00.
export const fixDigits = (t) => t.replace(/[oO]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
const num = (s) => parseFloat(fixDigits(s).replace(/,(\d{2})$/, '.$1').replace(/[,\s]/g, ''));
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
export function findDate(text, now = Date.now()) {
  let m = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
  let d = null;
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; d = new Date(y, +m[2] - 1, +m[1], 12); }
  else if ((m = text.match(/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,'-]*(\d{2,4})\b/i))) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; d = new Date(y, MON[m[2].toLowerCase()], +m[1], 12); }
  if (!d || isNaN(d) || d.getTime() > now + 864e5 || d.getTime() < now - 400 * 864e5) return null;
  return d.getTime();
}

/** @returns {{items:{name,amount}[], extras:{name,amount}[], total:number|null}} amounts in paise */
export function parseReceipt(text) {
  const items = [], extras = [];
  let total = null, sub = null, afterSub = false;
  for (let raw of text.split(/\n+/)) {
    const line = raw.replace(/[|_~*`"]/g, ' ').replace(/\s+/g, ' ').trim();
    if (line.length < 3) continue;
    // last money-looking number on the line
    const m = line.match(/(-?[\dOoSB][\dOoSBlI|,]*(?:[.,][\dOo]{2})?)\s*(?:\/-|rs|inr|₹)?\s*$/i);
    if (!m || !/\d/.test(m[1])) continue;
    const amt = Math.round(num(m[1]) * 100);
    if (!isFinite(amt) || amt === 0 || Math.abs(amt) > 10000000) continue;
    let name = line.slice(0, m.index).replace(/(₹|rs\.?|inr)\s*$/i, '').replace(/\s+\d+(\.\d+)?\s*(x|@|nos?|pcs?)?\s*\d*(\.\d+)?\s*$/i, '').replace(/^[\d.)\s-]+/, '').trim();
    if (/sub\s*-?\s*total/i.test(line)) { sub = amt; afterSub = true; continue; }
    if (TOTAL_RE.test(line)) { total = Math.max(total || 0, amt); afterSub = false; continue; }
    // Between "Sub Total" and "Grand Total" every priced line is a tax or charge, even when OCR mangles its label.
    if (afterSub && !EXTRA_RE.test(line)) { extras.push({ name: /[a-z]{3}/i.test(name) ? name : 'Tax / charges', amount: amt }); continue; }
    if (EXTRA_RE.test(line)) { extras.push({ name: name || 'Tax', amount: /discount/i.test(line) ? -Math.abs(amt) : amt }); continue; }
    if (SKIP_RE.test(name) || name.length < 2 || !/[a-z]{2}/i.test(name)) continue;
    items.push({ name: name.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40), amount: amt });
  }
  let itemSum = items.reduce((s, i) => s + i.amount, 0);
  // Printed Sub Total is the truth for items: a shortfall means OCR dropped a line. Keep the
  // split exact with a placeholder the user can rename, instead of silently losing money.
  let unread = 0;
  if (sub != null && sub - itemSum > 100 && sub - itemSum < sub) {
    unread = sub - itemSum;
    items.push({ name: 'Unreadable item (check bill)', amount: unread, unread: true });
    itemSum = sub;
  }
  // Tax lines are the most mangled part of a bill; when both totals are printed, trust them.
  let extraSum = extras.reduce((s, e) => s + e.amount, 0);
  if (sub != null && total != null && total >= sub) extraSum = total - sub;
  const totalRead = total != null;
  if (total == null) total = (sub || itemSum) + extraSum || null;
  const merchant = (text.split(/\n+/).map((l) => l.trim()).find((l) => /[a-z]{3}/i.test(l) && !SKIP_RE.test(l) && !/\d{3,}/.test(l)) || '').replace(/[^\w &'.-]/g, '').trim().slice(0, 40);
  // diff > 0: the bill says more than the items we read (a line was missed or misread)
  const diff = total != null ? total - itemSum - extraSum : 0;
  return { items, extras, total, totalRead, merchant, date: findDate(text), diff, itemSum, extraSum, unread };
}
