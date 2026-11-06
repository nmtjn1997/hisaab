// Recurring expenses. The original expense is the template; each run is a copy with a
// deterministic id (template id + date), so two phones in a live group never double-add.

export function nextDate(ts, every) {
  const d = new Date(ts);
  if (every === 'week') { d.setDate(d.getDate() + 7); return d.getTime(); }
  // Same day next month, clamped: 31 Jan -> 28/29 Feb -> 31 Mar keeps the original day.
  const day = new Date(ts).getDate();
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1, d.getHours(), d.getMinutes());
  n.setDate(Math.min(day, new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()));
  return n.getTime();
}

const ymd = (ts) => { const d = new Date(ts); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };

/**
 * Copies that should exist by `now` and do not yet.
 * @returns {{id:string, src:string, date:number}[]}
 */
export function dueRepeats(expenses, now = Date.now()) {
  const out = [];
  for (const e of Object.values(expenses)) {
    if (!e.repeat?.every || e.deleted || e.repeatOf) continue;
    let anchorDay = new Date(e.date).getDate();
    let t = e.date;
    for (let guard = 0; guard < 120; guard++) {
      t = nextDate(t, e.repeat.every);
      if (e.repeat.every === 'month') { const d = new Date(t); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(anchorDay, last)); t = d.getTime(); }
      if (t > now) break;
      if (e.repeat.until && t > e.repeat.until) break;
      const id = `${e.id}-${ymd(t)}`;
      if (!expenses[id]) out.push({ id, src: e.id, date: t });
    }
  }
  return out;
}
