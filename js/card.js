// A 1080x1350 balance card drawn on canvas, shared as a PNG (WhatsApp shows images far
// better than long text). No libraries: plain 2D canvas with the app's own fonts.

const W = 1080, PAD = 72;
const C = { bg: '#0a0b0f', card: '#13151c', line: '#262a36', text: '#f4f5f7', muted: '#9aa1b0', lime: '#c8f560', ink: '#0b0d06', pos: '#3ddc97', neg: '#ff6b6b' };

function fit(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

/**
 * @param {{title:string, subtitle:string, total:string, rows:{from:string,to:string,amount:string,upi?:string}[], people:{name:string,net:string,sign:number}[], footer:string}} d
 * @returns {Promise<Blob>}
 */
export async function balanceCard(d) {
  await Promise.all(['800 64px "Bricolage Grotesque"', '600 32px Inter'].map((f) => document.fonts?.load(f).catch(() => {})));
  const rows = d.rows.slice(0, 7), ppl = d.people.slice(0, 6);
  const H = Math.max(1350, 520 + (rows.length || 1) * 118 + (ppl.length ? 120 + Math.ceil(ppl.length / 2) * 96 : 0) + 140);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const D = '"Bricolage Grotesque", Inter, system-ui, sans-serif', T = 'Inter, system-ui, sans-serif';

  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W, 0, 0, W, 0, 760);
  glow.addColorStop(0, 'rgba(200,245,96,.28)'); glow.addColorStop(1, 'rgba(200,245,96,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);

  // brand
  g.fillStyle = C.lime; rr(g, PAD, PAD, 72, 72, 20); g.fill();
  g.fillStyle = C.ink; g.font = `800 46px ${D}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('h', PAD + 36, PAD + 38);
  g.textAlign = 'left'; g.fillStyle = C.text; g.font = `700 36px ${D}`; g.fillText('Hisaab', PAD + 92, PAD + 38);

  // title + total
  g.textBaseline = 'alphabetic';
  g.font = `800 78px ${D}`; g.fillStyle = C.text; g.fillText(fit(g, d.title, W - PAD * 2), PAD, 270);
  g.font = `500 32px ${T}`; g.fillStyle = C.muted; g.fillText(fit(g, d.subtitle, W - PAD * 2), PAD, 322);
  g.font = `600 30px ${T}`; g.fillStyle = C.muted; g.fillText('Total spent', PAD, 404);
  g.font = `800 64px ${D}`; g.fillStyle = C.lime; g.fillText(d.total, PAD, 468);

  // who pays whom
  let y = 540;
  g.font = `700 34px ${D}`; g.fillStyle = C.text; g.fillText(rows.length ? 'Who pays whom' : 'All settled up', PAD, y); y += 30;
  for (const r of rows) {
    g.fillStyle = C.card; rr(g, PAD, y, W - PAD * 2, 96, 26); g.fill();
    g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();
    g.font = `600 34px ${T}`; g.fillStyle = C.text;
    const amt = r.amount;
    g.font = `800 40px ${D}`; const aw = g.measureText(amt).width;
    g.textAlign = 'right'; g.fillText(amt, W - PAD - 32, y + 62); g.textAlign = 'left';
    g.font = `600 34px ${T}`;
    g.fillText(fit(g, `${r.from}  →  ${r.to}`, W - PAD * 2 - aw - 96), PAD + 32, y + (r.upi ? 48 : 60));
    if (r.upi) { g.font = `500 24px ${T}`; g.fillStyle = C.muted; g.fillText(fit(g, `UPI ${r.upi}`, W - PAD * 2 - aw - 96), PAD + 32, y + 80); }
    y += 118;
  }
  if (d.rows.length > rows.length) { g.font = `500 26px ${T}`; g.fillStyle = C.muted; g.fillText(`+ ${d.rows.length - rows.length} more in the app`, PAD, y + 10); y += 40; }

  // per person
  if (ppl.length) {
    y += 40;
    g.font = `700 34px ${D}`; g.fillStyle = C.text; g.fillText('Balances', PAD, y); y += 30;
    const cw = (W - PAD * 2 - 24) / 2;
    ppl.forEach((p, i) => {
      const x = PAD + (i % 2) * (cw + 24), yy = y + Math.floor(i / 2) * 96;
      g.fillStyle = C.card; rr(g, x, yy, cw, 80, 22); g.fill();
      g.font = `600 30px ${T}`; g.fillStyle = C.text; g.fillText(fit(g, p.name, cw - 200), x + 24, yy + 51);
      g.textAlign = 'right'; g.font = `800 32px ${D}`; g.fillStyle = p.sign > 0 ? C.pos : p.sign < 0 ? C.neg : C.muted; g.fillText(p.net, x + cw - 24, yy + 52); g.textAlign = 'left';
    });
  }

  g.font = `500 26px ${T}`; g.fillStyle = C.muted; g.fillText(d.footer, PAD, H - PAD);
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}
