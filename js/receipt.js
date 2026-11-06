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

export async function ocr(blob, onProgress) {
  const T = await loadTesseract();
  const { data } = await T.recognize(blob, 'eng', {
    logger: (m) => m.status === 'recognizing text' && onProgress?.(m.progress),
  });
  return data.text;
}

const TOTAL_RE = /\b(grand\s*total|net\s*(amount|payable|total)|total\s*(amount|payable|due)?|amount\s*(payable|due)|to\s*pay|bill\s*amount|balance\s*due)\b/i;
const EXTRA_RE = /\b(c?gst|sgst|igst|vat|tax|service\s*(charge|tax)?|s\.?c\.?|tip|packing|packaging|delivery|round(ing)?\s*off|discount|cess|convenience|platform\s*fee)\b/i;
const SKIP_RE = /\b(sub\s*total|subtotal|cash|change|card|upi|paid|tender|qty|rate|amount\s*$|invoice|bill\s*no|table|gstin|fssai|phone|tel|date|time|thank|visit|cashier|order\s*no|kot|token)\b/i;

const num = (s) => parseFloat(s.replace(/[,\s]/g, '').replace(/[oO]/g, '0'));

/** @returns {{items:{name,amount}[], extras:{name,amount}[], total:number|null}} amounts in paise */
export function parseReceipt(text) {
  const items = [], extras = [];
  let total = null, sub = null;
  for (let raw of text.split(/\n+/)) {
    const line = raw.replace(/[|_~*`"]/g, ' ').replace(/\s+/g, ' ').trim();
    if (line.length < 3) continue;
    // last money-looking number on the line
    const m = line.match(/(-?\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/-|rs|inr|₹)?\s*$/i);
    if (!m) continue;
    const amt = Math.round(num(m[1]) * 100);
    if (!isFinite(amt) || amt === 0 || Math.abs(amt) > 10000000) continue;
    let name = line.slice(0, m.index).replace(/(₹|rs\.?|inr)\s*$/i, '').replace(/\s+\d+(\.\d+)?\s*(x|@|nos?|pcs?)?\s*\d*(\.\d+)?\s*$/i, '').replace(/^[\d.)\s-]+/, '').trim();
    if (/sub\s*-?\s*total/i.test(line)) { sub = amt; continue; }
    if (TOTAL_RE.test(line)) { total = Math.max(total || 0, amt); continue; }
    if (EXTRA_RE.test(line)) { extras.push({ name: name || 'Tax', amount: /discount/i.test(line) ? -Math.abs(amt) : amt }); continue; }
    if (SKIP_RE.test(name) || name.length < 2 || !/[a-z]{2}/i.test(name)) continue;
    items.push({ name: name.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40), amount: amt });
  }
  if (total == null) total = (sub || items.reduce((s, i) => s + i.amount, 0)) + extras.reduce((s, e) => s + e.amount, 0) || null;
  return { items, extras, total };
}
