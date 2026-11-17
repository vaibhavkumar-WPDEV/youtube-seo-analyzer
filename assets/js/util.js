// Small DOM + formatting helpers. No dependencies.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Build an HTML element. Text from the API always goes in as text nodes, never as HTML.
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  append(node, children);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  return node;
}

function setAttrs(node, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') throw new Error('Use text, not html');
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, String(val));
        else node.style[prop] = val;
      }
    }
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'value' && 'value' in node) node.value = v;
    else if (k === 'checked' && 'checked' in node) node.checked = !!v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// ---------- numbers & dates ----------
const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fullFmt = new Intl.NumberFormat('en-IN');
export const compact = (n) => (n == null || Number.isNaN(n) ? '—' : compactFmt.format(n));
export const full = (n) => (n == null || Number.isNaN(n) ? '—' : fullFmt.format(n));
export const pct = (n, digits = 1) => (n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(digits)}%`);

export function parseISODuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso || '');
  if (!m) return 0;
  const [, d = 0, hh = 0, mm = 0, ss = 0] = m;
  return Number(d) * 86400 + Number(hh) * 3600 + Number(mm) * 60 + Math.round(Number(ss));
}

export function fmtDuration(sec) {
  if (!Number.isFinite(sec)) return '—';
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = Math.floor(sec % 60);
  const two = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${two(mm)}:${two(ss)}` : `${mm}:${two(ss)}`;
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const fmtDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : '—');
export const daysSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);
export const todayKey = () => new Date().toISOString().slice(0, 10);

// Count what a person sees as characters (emoji = 1).
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
export function graphemes(str) {
  if (!str) return [];
  return seg ? [...seg.segment(str)].map((x) => x.segment) : [...str];
}
export const glen = (str) => graphemes(str).length;
export function gslice(str, n) {
  const g = graphemes(str);
  return g.length <= n ? str : g.slice(0, n).join('');
}

// Lowercase, strip accents (keeps Devanagari intact) for keyword matching.
export function normalize(str) {
  return (str || '').toLowerCase().normalize('NFKC');
}

export function camelTag(phrase) {
  return (phrase || '')
    .replace(/[#@]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

// ---------- storage (always guarded: storage can be blocked) ----------
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  keys(prefix) {
    try {
      return Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    } catch {
      return [];
    }
  },
};

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function csvCell(v) {
  const t = v == null ? '' : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((x) => x.src === src)) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(el);
  });
}

// Run async jobs with a concurrency limit.
export async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

// Status icons (inline SVG) — status never relies on colour alone.
export function statusIcon(status, size = 16) {
  const common = { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true', class: `st-icon st-${status}` };
  if (status === 'pass')
    return s('svg', common, s('circle', { cx: 8, cy: 8, r: 7.25, class: 'st-fill' }), s('path', { d: 'M4.6 8.3l2.2 2.2 4.6-4.8', class: 'st-mark' }));
  if (status === 'warn')
    return s('svg', common, s('path', { d: 'M8 1.2l7 12.6H1z', class: 'st-fill' }), s('path', { d: 'M8 5.6v3.9M8 11.6v.2', class: 'st-mark' }));
  if (status === 'fail')
    return s('svg', common, s('rect', { x: 1, y: 1, width: 14, height: 14, rx: 3.5, class: 'st-fill' }), s('path', { d: 'M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2', class: 'st-mark' }));
  return s('svg', common, s('circle', { cx: 8, cy: 8, r: 6.5, class: 'st-ring' }), s('path', { d: 'M8 7.2v4M8 4.8v.2', class: 'st-mark-muted' }));
}

export const STATUS_WORD = { pass: 'Passed', warn: 'Improve', fail: 'Fix', unknown: 'Not checked', info: 'Info', na: 'Not needed' };
