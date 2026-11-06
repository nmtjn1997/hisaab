// Motion layer. Everything here is decoration: it only moves transform/opacity, never blocks
// input, and does nothing when the user asked the OS for reduced motion.
export const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Material-style ripple from the exact point of the tap.
const RIPPLE = '.btn, .chip, .row, .icon-btn, .seg button, .seg a, .mic, .fab, .pl[role=button], .hint';
export function initRipple() {
  document.addEventListener('pointerdown', (e) => {
    if (calm() || e.button > 0) return;
    const el = e.target.closest(RIPPLE);
    if (!el || el.disabled) return;
    const r = el.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 2.2;
    const s = document.createElement('span');
    s.className = 'rip';
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.classList.add('has-rip');
    el.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  }, { passive: true });
}

// Numbers that count up to their value: <b data-count="123450" data-fmt="money">.
export function countUp(root, format) {
  for (const el of root.querySelectorAll('[data-count]')) {
    const to = +el.dataset.count;
    if (calm() || !to) { el.textContent = format(to); continue; }
    const t0 = performance.now(), dur = 700;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = format(Math.round((to * e) / 100) * 100 || (k === 1 ? to : 0));
      if (k < 1) requestAnimationFrame(step); else el.textContent = format(to);
    };
    requestAnimationFrame(step);
  }
}

// Rows cascade in, capped so long lists do not feel slow.
export function stagger(root) {
  if (calm()) return;
  let i = 0;
  for (const el of root.querySelectorAll('.list > .row, .stack > .card, .bars > .bar-row')) {
    if (i > 14) break;
    el.style.setProperty('--i', i++);
    el.classList.add('in');
  }
}

// Small lime confetti burst from a point, for "added" and "settled" moments.
export function burst(x, y, n = 18) {
  if (calm()) return;
  const colors = ['#c8f560', '#3ddc97', '#ffffff', '#ffb547', '#7aa7ff'];
  const wrap = document.createElement('div');
  wrap.className = 'burst';
  wrap.style.cssText = `left:${x}px;top:${y}px`;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const dist = 60 + Math.random() * 70;
    p.style.cssText = `--x:${Math.cos(a) * dist}px;--y:${Math.sin(a) * dist - 40}px;--r:${Math.random() * 540 - 270}deg;background:${colors[i % colors.length]};animation-delay:${Math.random() * 60}ms`;
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 1100);
}

// Native page transitions where the browser has them; plain swap elsewhere.
export function transition(update, dir = 'fwd') {
  if (calm() || !document.startViewTransition) return update();
  document.documentElement.dataset.dir = dir;
  return document.startViewTransition(update).finished.catch(() => {});
}
