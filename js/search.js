// Search everything on this phone: expenses, groups and people. Pure, no DOM.
// Words must all match (AND). A number also matches amounts ("500" finds ₹500 and ₹500.50).

const CAT_WORDS = { food: 'food drinks dinner lunch', groceries: 'groceries', travel: 'travel cab trip', fuel: 'fuel petrol diesel', home: 'home bills rent', fun: 'fun movies', shopping: 'shopping', health: 'health medicine', settle: 'settlement payment settled' };
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export function searchAll(state, query, { limit = 50 } = {}) {
  const q = norm(query).trim();
  if (!q) return { people: [], groups: [], expenses: [] };
  const words = q.split(/\s+/).filter(Boolean);
  const nums = words.map((w) => (/^₹?\d+(\.\d+)?k?$/.test(w) ? Math.round(parseFloat(w.replace('₹', '')) * (w.endsWith('k') ? 1000 : 1) * 100) : null));
  const name = (id) => norm(state.people[id]?.name);
  const live = (g) => g && !g.deleted;

  const people = Object.values(state.people).filter((p) => !p.deleted && words.every((w) => norm(p.name).includes(w) || norm(p.phone).includes(w)));
  const groups = Object.values(state.groups).filter((g) => live(g) && words.every((w) => norm(g.name).includes(w)));

  const scored = [];
  for (const e of Object.values(state.expenses)) {
    if (e.deleted || !live(state.groups[e.gid])) continue;
    const who = [...new Set([...Object.keys(e.paid || {}), ...Object.keys(e.owed || {})])].map(name).join(' ');
    const hay = [norm(e.desc), norm(e.note), norm(e.text), CAT_WORDS[e.category] || '', who, norm(state.groups[e.gid]?.name), (e.items || []).map((i) => norm(i.name)).join(' ')].join(' | ');
    let score = 0, ok = true;
    words.forEach((w, i) => {
      if (nums[i] != null) {
        if (Math.floor(e.amount / 100) === Math.floor(nums[i] / 100)) score += 5;
        else if (hay.includes(w)) score += 1;
        else ok = false;
      } else if (norm(e.desc).startsWith(w)) score += 4;
      else if (norm(e.desc).includes(w)) score += 3;
      else if (hay.includes(w)) score += 1;
      else ok = false;
    });
    if (ok) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || b.e.date - a.e.date);
  return { people, groups, expenses: scored.slice(0, limit).map((x) => x.e), total: scored.length };
}

/** Escaped text with the matched words wrapped in <mark>. */
export function highlight(text, query, esc) {
  const words = norm(query).split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const safe = esc(text);
  if (!words.length) return safe;
  // Never split an HTML entity that esc() produced ("&lt;" must stay whole).
  return safe.replace(new RegExp(`(&[#a-z0-9]+;)|(${words.join('|')})`, 'gi'), (m, ent, hit) => (ent ? ent : `<mark>${hit}</mark>`));
}
