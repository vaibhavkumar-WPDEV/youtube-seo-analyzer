// Hand-built SVG/HTML charts. One series each, thin marks, hairline axes,
// hover + keyboard tooltips, and every chart has a table twin.

import { h, s, clear, compact, full, fmtDate } from './util.js';

const tip = () => document.getElementById('tooltip');

export function showTip(lines, clientX, clientY) {
  const t = tip();
  if (!t) return;
  clear(t);
  lines.forEach(([value, label], i) => {
    t.append(h('div', { class: i === 0 ? 'tip-row tip-head' : 'tip-row' }, h('strong', { text: value }), label ? h('span', { text: label }) : null));
  });
  t.hidden = false;
  const pad = 14;
  const r = t.getBoundingClientRect();
  let x = clientX + pad;
  let y = clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = clientY - r.height - pad;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}

export function hideTip() {
  const t = tip();
  if (t) t.hidden = true;
}

function tipAtElement(el, lines) {
  const r = el.getBoundingClientRect();
  showTip(lines, r.left + r.width / 2, r.top);
}

function niceMax(v) {
  if (v <= 5) return Math.max(1, Math.ceil(v));
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

function ticks(max, count = 4) {
  const step = niceMax(max / count);
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

const tickLabel = (v) => (v >= 10000 ? compact(v) : full(v));

// ---------------------------------------------------------------------------
// Ranked horizontal bars (HTML) — "What to fix first"
// rows: [{ key, label, value, detail }]
// ---------------------------------------------------------------------------
export function rankedBars(container, rows, { total, selected, onSelect, unit = 'videos' } = {}) {
  clear(container);
  if (!rows.length) {
    container.append(h('p', { class: 'empty-note', text: 'Nothing to fix in this view. Nice.' }));
    return;
  }
  const max = Math.max(total || 0, ...rows.map((r) => r.value));
  const list = h('ol', { class: 'rbars' });
  rows.forEach((r) => {
    const w = max ? (r.value / max) * 100 : 0;
    const btn = h(
      'button',
      {
        type: 'button',
        class: `rbar${selected === r.key ? ' is-selected' : ''}`,
        'aria-pressed': selected === r.key ? 'true' : 'false',
        'aria-label': `${r.label}: ${r.value} ${unit}. ${r.detail || ''} Show these videos.`,
        onclick: () => onSelect?.(r.key),
        onpointermove: (e) => showTip([[`${r.value} ${unit}`, r.label], ...(r.detail ? [[r.detail, '']] : [])], e.clientX, e.clientY),
        onpointerleave: hideTip,
        onfocus: (e) => tipAtElement(e.currentTarget, [[`${r.value} ${unit}`, r.label]]),
        onblur: hideTip,
      },
      h('span', { class: 'rbar-label', text: r.label }),
      h('span', { class: 'rbar-track' }, h('span', { class: 'rbar-fill', style: { width: `${w}%` } }), h('span', { class: 'rbar-value', text: full(r.value) }))
    );
    list.append(h('li', {}, btn));
  });
  container.append(list);
}

// ---------------------------------------------------------------------------
// Column histogram (SVG) — score distribution
// bins: [{ label, from, to, value }]
// ---------------------------------------------------------------------------
export function histogram(container, bins, { onSelect, selected } = {}) {
  clear(container);
  const W = Math.max(280, container.clientWidth || 480);
  const H = 190;
  const m = { t: 18, r: 8, b: 28, l: 34 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const maxV = niceMax(Math.max(1, ...bins.map((b) => b.value)));
  const yt = ticks(maxV, 3);
  const band = iw / bins.length;
  const bw = Math.min(24, band * 0.62);
  const y = (v) => m.t + ih - (v / maxV) * ih;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': `Score distribution: ${bins.map((b) => `${b.label}: ${b.value}`).join(', ')}` });
  yt.forEach((v) => {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis-base' : 'grid' }));
    svg.append(s('text', { x: m.l - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end', text: tickLabel(v) }));
  });
  const tallest = bins.reduce((a, b) => (b.value > a.value ? b : a), bins[0]);
  bins.forEach((b, i) => {
    const cx = m.l + band * i + band / 2;
    const x = cx - bw / 2;
    const top = y(b.value);
    const base = y(0);
    const g = s('g', {
      class: `col${selected === b.label ? ' is-selected' : ''}`,
      tabindex: 0,
      role: 'button',
      'aria-label': `Score ${b.label}: ${b.value} videos`,
      onpointermove: (e) => showTip([[`${b.value} video${b.value === 1 ? '' : 's'}`, `Score ${b.label}`]], e.clientX, e.clientY),
      onpointerleave: hideTip,
      onfocus: (e) => tipAtElement(e.currentTarget, [[`${b.value} videos`, `Score ${b.label}`]]),
      onblur: hideTip,
      onclick: () => onSelect?.(b.label),
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.(b.label);
        }
      },
    });
    g.append(s('rect', { x: m.l + band * i, y: m.t, width: band, height: ih + 4, class: 'hit' }));
    if (b.value > 0) {
      const r = Math.min(4, bw / 2, base - top);
      g.append(s('path', { class: 'bar', d: `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${base}Z` }));
    }
    if (b === tallest && b.value > 0) g.append(s('text', { x: cx, y: top - 6, class: 'cap-label', 'text-anchor': 'middle', text: full(b.value) }));
    if (i % 2 === 0 || bins.length <= 6) g.append(s('text', { x: cx, y: H - 8, class: 'tick', 'text-anchor': 'middle', text: b.from }));
    svg.append(g);
  });
  container.append(svg);
}

// ---------------------------------------------------------------------------
// Scatter (SVG) — SEO score vs views, one series, nearest-point hover
// points: [{ id, x, y, label }]
// ---------------------------------------------------------------------------
export function scatter(container, points, { onSelect } = {}) {
  clear(container);
  const W = Math.max(280, container.clientWidth || 480);
  const H = 210;
  const m = { t: 14, r: 12, b: 34, l: 46 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const maxY = niceMax(Math.max(10, ...points.map((p) => p.y)));
  const x = (v) => m.l + (v / 100) * iw;
  const y = (v) => m.t + ih - (v / maxY) * ih;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': `SEO score against views for ${points.length} public videos` });
  ticks(maxY, 3).forEach((v) => {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis-base' : 'grid' }));
    svg.append(s('text', { x: m.l - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end', text: tickLabel(v) }));
  });
  [0, 25, 50, 75, 100].forEach((v) => svg.append(s('text', { x: x(v), y: H - 16, class: 'tick', 'text-anchor': 'middle', text: v })));
  svg.append(s('text', { x: m.l + iw / 2, y: H - 2, class: 'axis-title', 'text-anchor': 'middle', text: 'SEO score' }));
  const dots = s('g');
  points.forEach((p) => dots.append(s('circle', { cx: x(p.x), cy: y(p.y), r: 4.5, class: 'dot', 'data-id': p.id })));
  svg.append(dots);
  const focusRing = s('circle', { r: 8, class: 'dot-focus', visibility: 'hidden' });
  svg.append(focusRing);
  const overlay = s('rect', { x: m.l, y: m.t, width: iw, height: ih, class: 'hit' });
  let current = null;
  const nearest = (e) => {
    const pt = svg.getBoundingClientRect();
    const sx = ((e.clientX - pt.left) / pt.width) * W;
    const sy = ((e.clientY - pt.top) / pt.height) * H;
    let best = null;
    let bd = Infinity;
    for (const p of points) {
      const d = (x(p.x) - sx) ** 2 + (y(p.y) - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return bd <= 30 ** 2 ? best : null;
  };
  overlay.addEventListener('pointermove', (e) => {
    current = nearest(e);
    if (!current) {
      focusRing.setAttribute('visibility', 'hidden');
      overlay.style.cursor = 'default';
      return hideTip();
    }
    overlay.style.cursor = 'pointer';
    focusRing.setAttribute('cx', x(current.x));
    focusRing.setAttribute('cy', y(current.y));
    focusRing.setAttribute('visibility', 'visible');
    showTip([[`${full(current.y)} views`, `Score ${current.x}`], [current.label, '']], e.clientX, e.clientY);
  });
  overlay.addEventListener('pointerleave', () => {
    focusRing.setAttribute('visibility', 'hidden');
    hideTip();
  });
  overlay.addEventListener('click', () => current && onSelect?.(current.id));
  svg.append(overlay);
  container.append(svg);
}

// ---------------------------------------------------------------------------
// Line (SVG) — channel score over time, crosshair snaps to the nearest day
// points: [{ date: 'YYYY-MM-DD', value }]
// ---------------------------------------------------------------------------
export function lineChart(container, points, { label = 'Score', max = 100 } = {}) {
  clear(container);
  const W = Math.max(280, container.clientWidth || 480);
  const H = 190;
  const m = { t: 16, r: 40, b: 28, l: 34 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const t0 = new Date(points[0].date).getTime();
  const t1 = new Date(points[points.length - 1].date).getTime();
  const span = Math.max(1, t1 - t0);
  const x = (d) => m.l + ((new Date(d).getTime() - t0) / span) * iw;
  const y = (v) => m.t + ih - (v / max) * ih;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': `${label} over time: ${points.map((p) => `${p.date} ${p.value}`).join(', ')}` });
  ticks(max, 4).forEach((v) => {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis-base' : 'grid' }));
    svg.append(s('text', { x: m.l - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end', text: v }));
  });
  const first = points[0];
  const last = points[points.length - 1];
  svg.append(s('text', { x: x(first.date), y: H - 8, class: 'tick', 'text-anchor': 'start', text: fmtDate(first.date) }));
  if (points.length > 1) svg.append(s('text', { x: x(last.date), y: H - 8, class: 'tick', 'text-anchor': 'end', text: fmtDate(last.date) }));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date)},${y(p.value)}`).join('');
  svg.append(s('path', { d, class: 'line' }));
  svg.append(s('circle', { cx: x(last.date), cy: y(last.value), r: 4.5, class: 'dot' }));
  svg.append(s('text', { x: x(last.date) + 8, y: y(last.value) + 4, class: 'end-label', text: last.value }));
  const cross = s('line', { y1: m.t, y2: m.t + ih, class: 'crosshair', visibility: 'hidden' });
  const mark = s('circle', { r: 4.5, class: 'dot', visibility: 'hidden' });
  svg.append(cross, mark);
  const overlay = s('rect', { x: m.l, y: m.t, width: iw + 8, height: ih, class: 'hit' });
  overlay.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    let best = points[0];
    for (const p of points) if (Math.abs(x(p.date) - sx) < Math.abs(x(best.date) - sx)) best = p;
    cross.setAttribute('x1', x(best.date));
    cross.setAttribute('x2', x(best.date));
    cross.setAttribute('visibility', 'visible');
    mark.setAttribute('cx', x(best.date));
    mark.setAttribute('cy', y(best.value));
    mark.setAttribute('visibility', 'visible');
    showTip([[String(best.value), `${label} · ${fmtDate(best.date)}`]], e.clientX, e.clientY);
  });
  overlay.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    mark.setAttribute('visibility', 'hidden');
    hideTip();
  });
  svg.append(overlay);
  container.append(svg);
}

// Table twin for any chart.
export function dataTable(headers, rows, caption) {
  return h(
    'table',
    { class: 'mini-table' },
    caption ? h('caption', { class: 'sr-only', text: caption }) : null,
    h('thead', {}, h('tr', {}, headers.map((x, i) => h('th', { scope: 'col', class: i ? 'num' : '', text: x })))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h(i ? 'td' : 'th', { class: i ? 'num' : '', scope: i ? null : 'row', text: c })))))
  );
}
