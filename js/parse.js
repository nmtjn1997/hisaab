// Rule-based parser for "Dinner 800 paid by Deepak split with me and Rahul".
// No AI: a tokenizer plus a small state machine. Every guess is shown back to the
// user as an editable preview, so the parser only has to be right most of the time.
import { allocate } from './money.js';

const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const MULT = { hundred: 100, thousand: 1000, k: 1000, lakh: 100000, lac: 100000, lakhs: 100000 };

export function wordsToNumbers(s) {
  return s.replace(/\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakhs?|lac|and|a)\b[\s-]*)+/g, (m) => {
    const words = m.trim().split(/[\s-]+/).filter((w) => w !== 'and');
    if (!words.some((w) => w in ONES || w in TENS)) return m; // lone "a"/"hundred"
    // "a hundred" -> 100, but keep a leading article that is not followed by a multiplier.
    let lead = '';
    if (words[0] === 'a' && !(words[1] in MULT)) { words.shift(); lead = 'a '; }
    let total = 0, cur = 0;
    for (const w of words) {
      if (w === 'a') cur = 1;
      else if (w in ONES) cur += ONES[w];
      else if (w in TENS) cur += TENS[w];
      else if (w === 'hundred') cur = (cur || 1) * 100;
      else if (w in MULT) { total += (cur || 1) * MULT[w]; cur = 0; }
    }
    return lead + (total + cur) + ' ';
  });
}

const ME = new Set(['i', 'me', 'my', 'myself', 'mine', 'main', 'mai', 'maine', 'mera', 'mere', 'meri', 'mujhe', 'mujh', 'self']);
const ALL = new Set(['everyone', 'everybody', 'all', 'us', 'we', 'group', 'sab', 'sabka', 'sabhi', 'everyones', 'sabme', 'sabmein', 'sabke', 'sabko', 'sabne', 'hum', 'humne', 'humsab', 'saare', 'sare']);
const PAY = new Set(['paid', 'pay', 'pays', 'payed', 'gave', 'spent', 'covered', 'bought', 'diya', 'diye', 'kiya', 'kiye', 'chukaya', 'chukaye', 'bhara', 'bhare', 'bhari', 'bharaa', 'bharya', 'kharcha', 'kharche']);
const SPLIT = new Set(['split', 'splitted', 'between', 'among', 'amongst', 'divide', 'divided', 'share', 'shared', 'sharing', 'owns', 'own', 'owned', 'bata', 'baant', 'baanto', 'baato', 'beech', 'bich', 'bichme']);
const WITH = new Set(['with', 'saath', 'along']);
const FOR = new Set(['for', 'on', 'behalf']);
const EXCEPT = new Set(['except', 'excluding', 'exclude', 'without', 'minus', 'not', 'but', 'chhodke', 'chodke']);
const ONLY = new Set(['only', 'just', 'alone', 'solo', 'sirf', 'akela']);
const EQUAL = new Set(['equally', 'evenly', 'equal', 'even', 'barabar']);
const WAYS = new Set(['ways', 'way', 'people', 'persons', 'person', 'log', 'logo', 'members', 'heads', 'pax']);
const STOP = new Set(['a', 'an', 'the', 'of', 'at', 'in', 'to', 'and', 'or', 'is', 'was', 'it', 'this', 'that', 'by', 'rs', 'inr', 'rupees', 'rupee', 'bucks', 'total', 'amount', 'bill', 'cost', 'costs', 'costing', 'worth', 'today', 'yesterday', 'tomorrow', 'day', 'before', 'last', 'on', 'so', 'then', 'also', 'each', 'per', 'please', 'add', 'expense', 'ka', 'ki', 'ke', 'ko', 'ne', 'se', 'hai', 'tha', 'aur', 'friends', 'friend', 'family', 'them', 'they', 'he', 'she', 'his', 'her', 'their', 'our', 'you', 'your', 'got', 'had', 'have', 'has', 'from', 'did', 'do', 'will', 'should', 'would', 'owe', 'owes', 'lent', 'borrowed', 'remaining', 'rest', 'other', 'others', 'half', 'full', 'whole', 'liye', 'do', 'rupaye', 'rupay', 'wala', 'wali', 'thi', 'tha', 'ka', 'mein']);
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const CATEGORIES = {
  food: ['dinner', 'lunch', 'breakfast', 'food', 'pizza', 'burger', 'biryani', 'swiggy', 'zomato', 'restaurant', 'cafe', 'coffee', 'chai', 'tea', 'snacks', 'drinks', 'beer', 'party', 'dominos', 'kfc', 'mcdonalds', 'momos', 'maggi', 'dessert', 'icecream', 'cake', 'meal', 'brunch', 'thali', 'dhaba'],
  groceries: ['grocery', 'groceries', 'vegetables', 'sabzi', 'fruits', 'milk', 'blinkit', 'zepto', 'instamart', 'bigbasket', 'dmart', 'ration', 'eggs', 'bread', 'atta', 'rice'],
  travel: ['uber', 'ola', 'cab', 'taxi', 'auto', 'rapido', 'metro', 'bus', 'train', 'flight', 'flights', 'ticket', 'tickets', 'irctc', 'toll', 'parking', 'trip', 'travel', 'hotel', 'stay', 'airbnb', 'hostel', 'oyo'],
  fuel: ['petrol', 'diesel', 'fuel', 'gas', 'cng', 'ev', 'charging'],
  home: ['rent', 'maid', 'cook', 'electricity', 'water', 'wifi', 'internet', 'broadband', 'maintenance', 'society', 'cylinder', 'lpg', 'repair', 'plumber', 'furniture', 'cleaning'],
  fun: ['movie', 'movies', 'netflix', 'prime', 'hotstar', 'spotify', 'concert', 'game', 'games', 'bowling', 'club', 'pub', 'show', 'pvr', 'inox', 'subscription', 'ott'],
  shopping: ['shopping', 'clothes', 'shoes', 'amazon', 'flipkart', 'myntra', 'gift', 'gifts', 'decor', 'electronics', 'meesho', 'ajio'],
  health: ['medicine', 'medicines', 'doctor', 'hospital', 'pharmacy', 'gym', 'chemist', 'test', 'lab'],
};
const CAT_OF = Object.fromEntries(Object.entries(CATEGORIES).flatMap(([c, ws]) => ws.map((w) => [w, c])));

function lev1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}

function normalize(text) {
  let s = ' ' + text.toLowerCase().replace(/[₹]/g, ' ').replace(/\b(rs|inr)\.?(?=\s*\d)/g, ' ') + ' ';
  s = s.replace(/\bfifty[\s-]fifty\b|\bhalf[\s-](and[\s-])?half\b/g, ' 50-50 ');
  s = wordsToNumbers(s);
  s = s.replace(/(\d),(\d{2,3})/g, '$1$2').replace(/(\d),(\d{3})/g, '$1$2');
  s = s.replace(/(\d+(?:\.\d+)?)\s*(k|thousand)\b/g, (_, n) => String(Math.round(parseFloat(n) * 1000)));
  s = s.replace(/(\d+(?:\.\d+)?)\s*(lakhs?|lac)\b/g, (_, n) => String(Math.round(parseFloat(n) * 100000)));
  s = s.replace(/(\d)\s*percent\b/g, '$1%');
  s = s.replace(/\bday before yesterday\b/g, ' __dby ');
  return s;
}

function tokenize(norm, orig) {
  const re = /(\d+(?:\.\d+)?(?:\s*[-:/]\s*\d+(?:\.\d+)?)+)|(\d+(?:\.\d+)?)(\s*%)?|(__dby)|([a-zऀ-ॿ][a-zऀ-ॿ']*)|([,;&+.]|\bthen\b)/g;
  const out = [];
  let m;
  while ((m = re.exec(norm))) {
    if (m[1]) {
      const parts = m[1].split(/\s*[-:/]\s*/).map(Number);
      if (parts.every((p) => p > 0 && p <= 100)) out.push({ t: 'ratio', v: parts });
      else parts.forEach((p) => out.push({ t: 'num', v: p }));
    } else if (m[2]) out.push({ t: m[3] ? 'pct' : 'num', v: parseFloat(m[2]) });
    else if (m[4]) out.push({ t: 'date', v: 2 });
    else if (m[5]) {
      const w = m[5].replace(/'s$/, '').replace(/'/g, '');
      const cap = new RegExp('\\b' + w[0].toUpperCase() + w.slice(1) + '\\b').test(orig);
      out.push({ t: 'w', v: w, cap });
    } else out.push({ t: 'sep', v: m[6] });
  }
  return out;
}

function makeResolver(people, meId) {
  const idx = [];
  for (const p of people) {
    const full = p.name.toLowerCase().trim();
    const parts = full.split(/\s+/);
    idx.push({ key: parts, id: p.id });
    if (parts.length > 1) idx.push({ key: [parts[0]], id: p.id });
    for (const a of p.aliases || []) idx.push({ key: a.toLowerCase().split(/\s+/), id: p.id });
  }
  idx.sort((a, b) => b.key.length - a.key.length);
  // returns [id, tokensConsumed] or null
  return (toks, i) => {
    const w = toks[i];
    if (!w || w.t !== 'w') return null;
    if (ME.has(w.v)) return [meId, 1];
    if (ALL.has(w.v)) return ['*', 1];
    for (const { key, id } of idx) {
      if (key.every((k, j) => toks[i + j]?.t === 'w' && toks[i + j].v === k)) return [id, key.length];
    }
    if (w.v.length >= 4 && !STOP.has(w.v) && !CAT_OF[w.v]) {
      for (const { key, id } of idx) if (key.length === 1 && key[0].length >= 4 && key[0][0] === w.v[0] && lev1(w.v, key[0])) return [id, 1];
    }
    return null;
  };
}

function parseDate(toks, now) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'date') { d.setDate(d.getDate() - 2); return d; }
    if (t.t !== 'w') continue;
    if (t.v === 'yesterday' || t.v === 'kal') { d.setDate(d.getDate() - 1); return d; }
    const di = DAYS.indexOf(t.v);
    if (di >= 0) {
      let back = (d.getDay() - di + 7) % 7;
      if (back === 0 && toks[i - 1]?.v === 'last') back = 7;
      d.setDate(d.getDate() - back);
      return d;
    }
  }
  return d;
}

const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const nameCase = (s) => s.split(/\s+/).map(cap1).join(' ');

/**
 * @param {string} text
 * @param {{people:{id:string,name:string}[], members:string[], me:string, now?:number}} ctx
 * @returns parsed draft: {desc, amount(paise)|null, paid:{pid:paise}, split:{mode,parts}, newNames, warnings, category, date, kind}
 */
export function parseExpense(text, ctx) {
  const { people, me } = ctx;
  const members = ctx.members?.length ? ctx.members : [me];
  const norm = normalize(text || '');
  const toks = tokenize(norm, text || '');
  const resolve = makeResolver(people, me);
  const newNames = new Map(); // lower -> display
  const warnings = [];

  // Pass 1: collapse person spans into single tokens.
  const T = [];
  for (let i = 0; i < toks.length; ) {
    const r = resolve(toks, i);
    if (r) { T.push({ t: 'p', v: r[0], cap: toks[i].cap }); i += r[1]; }
    else T.push(toks[i++]);
  }

  // Unknown words become new people only in name slots, so "for pizza" stays a description.
  const isNameSlotWord = (i) => {
    const w = T[i];
    if (w?.t !== 'w' || STOP.has(w.v) || CAT_OF[w.v] || PAY.has(w.v) || SPLIT.has(w.v) || WITH.has(w.v) || FOR.has(w.v) || EXCEPT.has(w.v) || ONLY.has(w.v) || EQUAL.has(w.v) || WAYS.has(w.v) || w.v.length < 2 || DAYS.includes(w.v)) return false;
    const prev = T[i - 1], next = T[i + 1];
    const prevV = prev?.v;
    if (prev?.t === 'w' && (prevV === 'by' || prevV === 'between' || prevV === 'among' || prevV === 'amongst' || WITH.has(prevV) || EXCEPT.has(prevV) || ONLY.has(prevV))) return true;
    if ((prevV === 'and' || prevV === 'aur' || prevV === ',' || prevV === '&') && T[i - 2]?.t === 'p') return true;
    if (next?.t === 'w' && (next.v === 'ne' || next.v === 'ko') && !CAT_OF[w.v]) return true;
    if (next?.t === 'w' && (PAY.has(next.v) || next.v === 'owes' || next.v === 'owe') && T[i + 2]?.v !== 'by') return w.cap || !CAT_OF[w.v];
    if (next?.t === 'num' && prev?.t === 'p') return true; // "namit 90 deepak 10"
    if (next?.t === 'num' && (prevV === 'and' || prevV === ',') && T[i - 2]?.t === 'num' && T[i - 3]?.t === 'p') return true;
    if (next?.t === 'pct') return true;
    if (w.cap && prev && prev.t === 'num' && T[i - 2]?.t === 'p') return true;
    return false;
  };
  for (let i = 0; i < T.length; i++) {
    if (isNameSlotWord(i)) {
      const disp = nameCase(T[i].v);
      newNames.set(T[i].v, disp);
      T[i] = { t: 'p', v: 'new:' + T[i].v, cap: true };
    }
  }

  // Debt phrasing: "Rahul owes me 500", "I owe Rahul 200", "lent Rahul 300", "borrowed 300 from Rahul".
  const owIdx = T.findIndex((t) => t.t === 'w' && (t.v === 'owes' || t.v === 'owe'));
  if (owIdx > 0 && T[owIdx - 1].t === 'p' && T[owIdx + 1]?.t === 'p') {
    const debtor = T[owIdx - 1].v, creditor = T[owIdx + 1].v;
    const n = T.slice(owIdx + 2).find((t) => t.t === 'num') || T.slice(0, owIdx).find((t) => t.t === 'num');
    if (n && debtor !== creditor) {
      const amt = Math.round(n.v * 100);
      const desc = descFrom(T.filter((t, i) => i > owIdx + 1));
      return finish({ desc: desc || 'Owed', amount: amt, paid: { [creditor]: amt }, split: { mode: 'exact', parts: { [debtor]: amt } } });
    }
  }
  const lentIdx = T.findIndex((t) => t.t === 'w' && (t.v === 'lent' || t.v === 'borrowed' || t.v === 'udhaar'));
  if (lentIdx >= 0) {
    const ps = T.filter((t) => t.t === 'p' && t.v !== me);
    const n = T.find((t) => t.t === 'num');
    const subj = T[lentIdx - 1]?.t === 'p' ? T[lentIdx - 1].v : me;
    if (ps.length && n) {
      const amt = Math.round(n.v * 100);
      const other = ps.find((p) => p.v !== subj)?.v || ps[0].v;
      const lender = T[lentIdx].v === 'lent' ? subj : other;
      const borrower = lender === subj ? other : subj;
      return finish({ desc: descFrom(T.slice(lentIdx + 1)) || 'Loan', amount: amt, paid: { [lender]: amt }, split: { mode: 'exact', parts: { [borrower]: amt } } });
    }
  }

  // Pass 2: state machine.
  let total = null, ways = null, ratio = null, only = false, equal = false, withFlag = false, payNext = null;
  let mode = 'n';
  const payers = []; // {id, amt|null}
  const owed = [];   // {id, amt|null, pct|null}
  const pending = [];
  const excluded = new Set();
  const descToks = [];
  let lastP = null; // {id, role}
  const findPayer = (id) => payers.find((x) => x.id === id);
  const findOwed = (id) => owed.find((x) => x.id === id);
  const addPayer = (id) => { if (!findPayer(id)) payers.push({ id, amt: null }); return findPayer(id); };
  const addOwed = (id) => { if (!findOwed(id)) owed.push({ id, amt: null, pct: null }); return findOwed(id); };

  for (let i = 0; i < T.length; i++) {
    const t = T[i], prev = T[i - 1], next = T[i + 1];
    if (t.t === 'p') {
      const n1 = next?.t === 'w' ? next.v : '', n2 = T[i + 2]?.t === 'w' ? T[i + 2].v : '';
      if (n1 === 'ko' || n1 === 'liye' || (n1 === 'ke' && n2 === 'liye')) {
        addOwed(t.v); only = true; lastP = null; i += n1 === 'ke' ? 2 : 1; continue;
      }
      if (mode === 'pay') { const p = addPayer(t.v); if (payNext != null) { p.amt = payNext; payNext = null; } lastP = { id: t.v, role: 'pay' }; }
      else if (mode === 'ex') { excluded.add(t.v); lastP = null; }
      else if (mode === 'owe') { addOwed(t.v); lastP = { id: t.v, role: 'owe' }; }
      else { pending.push(t.v); lastP = { id: t.v, role: 'n' }; }
      continue;
    }
    if (t.t === 'num') {
      const n = Math.round(t.v * 100);
      if (next?.t === 'w' && WAYS.has(next.v)) { ways = t.v; i++; continue; }
      if (prev?.t === 'p' && lastP && lastP.role === 'n' && next?.t === 'w' && PAY.has(next.v)) {
        // "maine 500 diye", "Rahul 300 paid": the amount is what they paid
        const k = pending.indexOf(lastP.id); if (k >= 0) pending.splice(k, 1);
        addPayer(lastP.id).amt = n; lastP = { id: lastP.id, role: 'pay' }; i++; continue;
      }
      if (prev?.t === 'p' && lastP) {
        if (lastP.role === 'pay') { findPayer(lastP.id).amt = n; mode = 'n'; }
        else { const o = addOwed(lastP.id); o.amt = n; const k = pending.indexOf(lastP.id); if (k >= 0) pending.splice(k, 1); }
        continue;
      }
      if (next?.t === 'w' && PAY.has(next.v) && total != null) { payNext = n; continue; }
      if (next?.t === 'p' && total != null) {
        // "90 namit 10 deepak": number belongs to the following person.
        const id = next.v;
        if (mode === 'pay') { addPayer(id).amt = n; } else { addOwed(id).amt = n; }
        lastP = null; i++; continue;
      }
      if (total == null) { total = n; continue; }
      if (payNext == null && mode === 'pay') { payNext = n; continue; }
      warnings.push('Ignored extra number ' + t.v);
      continue;
    }
    if (t.t === 'pct') {
      let id = prev?.t === 'p' ? prev.v : next?.t === 'p' ? next.v : null;
      if (id) { const o = addOwed(id); o.pct = t.v; const k = pending.indexOf(id); if (k >= 0) pending.splice(k, 1); if (next?.t === 'p' && prev?.t !== 'p') i++; }
      continue;
    }
    if (t.t === 'ratio') { ratio = t.v; continue; }
    if (t.t === 'date' || t.t === 'sep') { if (t.t === 'sep' && (mode === 'pay' || (t.v !== ',' && t.v !== '&' && t.v !== '+'))) mode = 'n'; continue; }
    const w = t.v;
    if (PAY.has(w)) {
      if (next?.t === 'w' && next.v === 'by') { mode = 'pay'; i++; continue; }
      if (pending.length) { pending.splice(0).forEach((id) => { addPayer(id); lastP = { id, role: 'pay' }; }); }
      else if (prev?.t === 'p' && lastP) { addPayer(lastP.id); }
      else addPayer(me);
      // "X paid 300" -> amount follows
      if (next?.t === 'num' && lastP) { lastP = { id: lastP.id, role: 'pay' }; findPayer(lastP.id).amt = Math.round(next.v * 100); i++; if (total == null && payers.length === 1) {/* total derived later */} }
      mode = 'n';
      continue;
    }
    if (w === 'by' && next?.t === 'p') { mode = 'pay'; continue; }
    if (SPLIT.has(w)) { mode = 'owe'; if (pending.length) { /* "me and rahul split", "mere aur Deepak ke beech" */ pending.splice(0).forEach(addOwed); } continue; }
    if (WITH.has(w)) { mode = 'owe'; withFlag = true; continue; }
    if (FOR.has(w)) { if (next?.t === 'p') mode = 'owe'; else descToks.push(t); continue; }
    if (EXCEPT.has(w)) { mode = 'ex'; continue; }
    if (ONLY.has(w)) {
      only = true;
      if (prev?.t === 'p') { const k = pending.indexOf(prev.v); if (k >= 0) pending.splice(k, 1); addOwed(prev.v); }
      else mode = 'owe';
      continue;
    }
    if (EQUAL.has(w)) { equal = true; continue; }
    if (w === 'and' || w === 'aur') continue;
    descToks.push(t);
  }

  // Payers
  if (!payers.length) {
    // "Deepak 500 dinner": a lone pending person before a number reads naturally as the payer only
    // when they said "paid"; otherwise default payer is me.
    addPayer(ctx.defaultPayer || me);
  }
  const knownPaid = payers.reduce((s, p) => s + (p.amt || 0), 0);
  if (total == null) {
    total = knownPaid || owed.reduce((s, o) => s + (o.amt || 0), 0) || null;
  }
  if (total != null) {
    const noAmt = payers.filter((p) => p.amt == null);
    if (noAmt.length) {
      const rest = Math.max(0, total - knownPaid);
      const al = allocate(rest, Object.fromEntries(noAmt.map((p) => [p.id, 1])));
      noAmt.forEach((p) => (p.amt = al[p.id] || 0));
    }
  }
  const paid = {};
  payers.forEach((p) => { if (p.amt) paid[p.id] = (paid[p.id] || 0) + p.amt; });
  if (total != null) {
    const ps = Object.values(paid).reduce((s, v) => s + v, 0);
    if (ps !== total) warnings.push(`Paid adds up to ${ps / 100}, total is ${total / 100}`);
  }

  // Participants
  pending.forEach(addOwed);
  const expand = (ids) => ids.flatMap((id) => (id === '*' ? members : [id]));
  if (owed.some((o) => o.id === '*')) {
    const star = owed.findIndex((o) => o.id === '*');
    owed.splice(star, 1, ...members.filter((m) => !findOwed(m)).map((id) => ({ id, amt: null, pct: null })));
  }
  for (const id of expand([...excluded])) excluded.add(id);
  const hasOwedInfo = owed.length > 0;
  if ((withFlag || (pending.length && !only)) && !only) payers.forEach((p) => { if (!findOwed(p.id)) owed.push({ id: p.id, amt: null, pct: null }); });
  let partIds = owed.map((o) => o.id).filter((id) => !excluded.has(id));

  if (!hasOwedInfo) {
    if (ways) {
      if (members.length === ways) partIds = members.slice();
      else if (ratio && payers.length === ratio.length) partIds = payers.map((p) => p.id);
      else {
        partIds = members.slice(0, ways);
        warnings.push(`Split ${ways} ways but group has ${members.length}: pick who`);
      }
    } else if (ratio && payers.length === ratio.length && payers.length > 1) partIds = payers.map((p) => p.id);
    else partIds = members.filter((m) => !excluded.has(m));
  }
  if (!partIds.length) partIds = [me];

  let split;
  const exacts = owed.filter((o) => o.amt != null && partIds.includes(o.id));
  const pcts = owed.filter((o) => o.pct != null && partIds.includes(o.id));
  if (ratio && ratio.length === partIds.length) {
    split = { mode: ratio.reduce((a, b) => a + b, 0) === 100 ? 'percent' : 'shares', parts: Object.fromEntries(partIds.map((id, k) => [id, ratio[k]])) };
  } else if (pcts.length) {
    const used = pcts.reduce((s, o) => s + o.pct, 0);
    const others = partIds.filter((id) => !pcts.find((o) => o.id === id));
    const parts = Object.fromEntries(pcts.map((o) => [o.id, o.pct]));
    others.forEach((id) => (parts[id] = Math.max(0, 100 - used) / others.length));
    split = { mode: 'percent', parts };
    if (Math.abs(Object.values(parts).reduce((a, b) => a + b, 0) - 100) > 0.01) warnings.push('Percentages do not add up to 100');
  } else if (exacts.length && !equal && exacts.length === partIds.length && total != null && total !== 10000 && exacts.reduce((s, o) => s + o.amt, 0) === 10000) {
    // "90 namit 10 deepak" on a ₹1000 bill: the numbers add to 100, so they are percentages.
    split = { mode: 'percent', parts: Object.fromEntries(exacts.map((o) => [o.id, o.amt / 100])) };
  } else if (exacts.length && !equal) {
    const used = exacts.reduce((s, o) => s + o.amt, 0);
    const others = partIds.filter((id) => !exacts.find((o) => o.id === id));
    const parts = Object.fromEntries(exacts.map((o) => [o.id, o.amt]));
    if (total != null && others.length) Object.assign(parts, allocate(Math.max(0, total - used), Object.fromEntries(others.map((id) => [id, 1]))));
    split = { mode: 'exact', parts };
    if (total != null && Object.values(parts).reduce((a, b) => a + b, 0) !== total) warnings.push('Split shares do not add up to the total');
  } else {
    split = { mode: 'equal', parts: Object.fromEntries(partIds.map((id) => [id, 1])) };
  }
  if (ratio && split.mode !== 'percent' && split.mode !== 'shares') warnings.push(`Ratio ${ratio.join(':')} needs ${ratio.length} people`);

  return finish({ desc: descFrom(descToks), amount: total, paid, split });

  function descFrom(ts) {
    const words = ts.filter((t) => t.t === 'w' && !STOP.has(t.v) && !PAY.has(t.v) && !SPLIT.has(t.v) && !WITH.has(t.v) && !FOR.has(t.v) && !EQUAL.has(t.v) && !DAYS.includes(t.v) && t.v !== 'kal').map((t) => t.v);
    return words.length ? cap1(words.join(' ')) : '';
  }
  function finish(d) {
    const descWords = (d.desc || '').toLowerCase().split(/\s+/);
    const category = descWords.map((w) => CAT_OF[w] || CAT_OF[w.replace(/s$/, '')]).find(Boolean) || 'general';
    if (d.amount == null) warnings.push('How much? Add an amount');
    // Only surface new names that ended up used.
    const used = new Set([...Object.keys(d.paid), ...Object.keys(d.split.parts)]);
    const nn = [...newNames.entries()].filter(([k]) => used.has('new:' + k)).map(([k, v]) => ({ id: 'new:' + k, name: v }));
    return { ...d, desc: d.desc || (category !== 'general' ? cap1(category) : 'Expense'), category, date: parseDate(toks, ctx.now || Date.now()).getTime(), newNames: nn, warnings };
  }
}

/** People mentioned anywhere in text (ids; "everyone" expands to members). */
export function findPeople(text, people, me, members = []) {
  const toks = tokenize(normalize(text || ''), text || '');
  const resolve = makeResolver(people, me);
  const out = [];
  for (let i = 0; i < toks.length; ) {
    const r = resolve(toks, i);
    if (r) { r[0] === '*' ? out.push(...members) : out.push(r[0]); i += r[1]; } else i++;
  }
  return [...new Set(out)];
}

/**
 * "pizza deepak, beer me and rahul, rest everyone" -> who-had-what for receipt items.
 * Returns a new items array; items no clause mentions keep their current `who`.
 */
export function assignItems(text, items, ctx) {
  const out = items.map((it) => ({ ...it, who: [...it.who] }));
  const assigned = new Set();
  const nameWords = new Set(ctx.people.flatMap((p) => p.name.toLowerCase().split(/\s+/)));
  for (const clause of String(text).split(/[,;\n]+/)) {
    const ids = findPeople(clause, ctx.people, ctx.me, ctx.members);
    if (!ids.length) continue;
    const words = clause.toLowerCase().match(/[a-z]{3,}/g) || [];
    const keys = words.filter((w) => !nameWords.has(w) && !ME.has(w) && !ALL.has(w) && !STOP.has(w) && !['had', 'ate', 'took', 'got', 'drank', 'ordered', 'item', 'items'].includes(w));
    if (/\b(rest|remaining|baaki|baki|else|others|everything)\b/i.test(clause)) {
      out.forEach((it, i) => { if (!assigned.has(i)) { it.who = ids; assigned.add(i); } });
      continue;
    }
    out.forEach((it, i) => {
      const n = it.name.toLowerCase();
      if (keys.some((k) => n.includes(k) || (k.length >= 4 && n.split(/\s+/).some((w) => w.length >= 4 && (w.startsWith(k.slice(0, 4)) || k.startsWith(w.slice(0, 4))))))) { it.who = ids; assigned.add(i); }
    });
  }
  return out;
}
