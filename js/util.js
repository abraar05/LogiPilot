/**
 * util.js — formatting, DOM helpers and small functional utilities.
 */
window.SP = window.SP || {};

/* ═══════════════════════════════════════════════════════════════ FORMAT */

const _fmt = new Map();

/** Cached Intl.NumberFormat instances keyed by options. */
function nf(key, opts) {
  let f = _fmt.get(key);
  if (!f) { f = new Intl.NumberFormat('en-US', opts); _fmt.set(key, f); }
  return f;
}

SP.fmt = {
  /** 4433 → "4,433" */
  n(v, dp = 0) {
    const x = Number(v) || 0;
    return nf(`n${dp}`, { maximumFractionDigits: dp, minimumFractionDigits: dp }).format(x);
  },

  /** 1580 → "1.6k"; 1580000 → "1.58M" */
  compact(v) {
    const x = Number(v) || 0;
    const a = Math.abs(x);
    if (a >= 1e9) return `${(x / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
    if (a >= 1e6) return `${(x / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
    if (a >= 10000) return `${(x / 1000).toFixed(a >= 1e5 ? 0 : 1)}k`;
    return nf('n0', { maximumFractionDigits: 0 }).format(x);
  },

  /** 4433 → "৳ 4,433" style currency using the locale currency. */
  money(v, currency = 'BDT') {
    const x = Number(v) || 0;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency, maximumFractionDigits: 0,
      }).format(x);
    } catch {
      return `${currency} ${this.n(x)}`;
    }
  },

  /** Money abbreviated: 1.2M */
  moneyCompact(v, currency = 'BDT') {
    const x = Number(v) || 0;
    const sym = (() => {
      try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency })
          .format(0).replace(/[\d.,\s]/g, '');
      } catch { return currency; }
    })();
    return `${sym}${this.compact(x)}`;
  },

  pct(v, dp = 0) {
    return `${(Number(v) || 0).toFixed(dp)}%`;
  },

  /** 3 → "3 days" */
  days(v) {
    const x = Math.round(Number(v) || 0);
    if (x <= 0) return 'today';
    if (x === 1) return '1 day';
    if (x < 30) return `${x} days`;
    const m = Math.round(x / 30);
    return `${m} month${m === 1 ? '' : 's'}`;
  },

  bytes(v) {
    const x = Number(v) || 0;
    if (x < 1024) return `${x} B`;
    if (x < 1048576) return `${(x / 1024).toFixed(1)} KB`;
    return `${(x / 1048576).toFixed(2)} MB`;
  },

  /** "3 days ago", "just now" */
  ago(ts) {
    const then = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!Number.isFinite(then)) return '—';
    const s = Math.max(0, (Date.now() - then) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    if (s < 604800) return `${Math.round(s / 86400)}d ago`;
    return new Date(then).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  },

  date(ts, opts) {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', opts || { day: '2-digit', month: 'short', year: 'numeric' });
  },

  dateTime(ts) {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  },

  /** "12 | 256GB" → { ram: 12, storage: 256 } */
  parseSpec(spec) {
    const m = /(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*(TB|GB|MB)/i.exec(spec || '');
    if (!m) return { ram: null, storage: null, unit: null, raw: spec || '' };
    return { ram: Number(m[1]), storage: Number(m[2]), unit: m[3].toUpperCase(), raw: spec };
  },

  initials(name) {
    return String(name || '?')
      .split(/[\s._-]+/).filter(Boolean).slice(0, 2)
      .map((w) => w[0]).join('') || '?';
  },

  /** "REDMI Note 15 Pro+ _ 5G" → "RN15P…5G" style short id for tight columns. */
  shortSku(sku, specs, max = 26) {
    const base = `${sku} ${specs || ''}`.trim();
    return base.length > max ? `${base.slice(0, max - 1)}…` : base;
  },

  titleCase(s) {
    return String(s || '').replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
  },

  pluralise(n, one, many) {
    return `${SP.fmt.n(n)} ${n === 1 ? one : (many || `${one}s`)}`;
  },
};

/* ══════════════════════════════════════════════════════════════════ DOM */

/**
 * Terse hyperscript. `el('div.card', {onclick}, child, child)`.
 * Tag string supports `tag#id.class.class`.
 */
SP.el = function el(spec, props, ...children) {
  const [head, ...classes] = String(spec).split('.');
  const [tag, id] = head.split('#');
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');

  if (props && (typeof props !== 'object' || props.nodeType || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = node.className ? `${node.className} ${v}` : v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  appendAll(node, children);
  return node;
};

function appendAll(node, kids) {
  for (const c of kids.flat(4)) {
    if (c === null || c === undefined || c === false || c === true || c === '') continue;
    node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

/** Escape for safe innerHTML interpolation. */
SP.esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Build an SVG sprite reference. */
SP.icon = (name, cls) => SP.el('svg', {
  class: cls || '', 'aria-hidden': 'true',
  html: `<use href="#${name}" />`,
});

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
SP.$ = $; SP.$$ = $$;

SP.on = (target, type, handler, opts) => {
  const t = typeof target === 'string' ? $(target) : target;
  if (t) t.addEventListener(type, handler, opts);
  return () => t && t.removeEventListener(type, handler, opts);
};

/** Delegated listener: SP.on(root, 'click', '.btn', fn) */
SP.onDelegated = (root, type, selector, fn) =>
  root.addEventListener(type, (e) => {
    const hit = e.target.closest(selector);
    if (hit && root.contains(hit)) fn(e, hit);
  });

SP.clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

/* ══════════════════════════════════════════════════════════════ FUNCTIONAL */

SP.groupBy = (arr, fn) => arr.reduce((acc, item) => {
  const k = typeof fn === 'function' ? fn(item) : item[fn];
  (acc[k] || (acc[k] = [])).push(item);
  return acc;
}, {});

SP.sum = (arr, fn = (x) => x) => arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0);

SP.unique = (arr) => [...new Set(arr)];

SP.sortBy = (arr, fn, dir = 'asc') => {
  const s = dir === 'desc' ? -1 : 1;
  return [...arr].sort((a, b) => {
    const x = fn(a); const y = fn(b);
    if (typeof x === 'string' || typeof y === 'string') {
      return String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }) * s;
    }
    return ((x ?? 0) - (y ?? 0)) * s;
  });
};

SP.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

SP.deepClone = (v) => (typeof structuredClone === 'function'
  ? structuredClone(v)
  : JSON.parse(JSON.stringify(v)));

SP.debounce = (fn, ms = 220) => {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
};

SP.throttle = (fn, ms = 100) => {
  let last = 0; let timer;
  return (...a) => {
    const now = Date.now();
    const wait = ms - (now - last);
    if (wait <= 0) { last = now; fn(...a); }
    else { clearTimeout(timer); timer = setTimeout(() => { last = Date.now(); fn(...a); }, wait); }
  };
};

SP.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

SP.uid = (prefix = 'id') => {
  const rnd = (crypto.getRandomValues
    ? crypto.getRandomValues(new Uint32Array(1))[0]
    : Math.floor(Math.random() * 0xffffffff)).toString(36);
  return `${prefix}_${Date.now().toString(36)}${rnd.slice(0, 5)}`;
};

/** Sequential human-friendly reference: PR-0042 */
SP.ref = (prefix, n) => `${prefix}-${String(n).padStart(4, '0')}`;

/* ═════════════════════════════════════════════════════════════════ MISC */

/** Trigger a client-side file download from a Blob or string. */
SP.download = (content, filename, mime = 'application/json') => {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = SP.el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};

/** CSV serializer with proper escaping. */
SP.toCSV = (rows, headers) => {
  const escCell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out = [];
  if (headers) out.push(headers.map(escCell).join(','));
  for (const r of rows) out.push((Array.isArray(r) ? r : headers.map((h) => r[h])).map(escCell).join(','));
  return `\uFEFF${out.join('\r\n')}`;
};

/** Lightweight fuzzy scorer: higher is better, 0 = no match. */
SP.score = (needle, haystack) => {
  if (!needle) return 1;
  const n = needle.toLowerCase();
  const h = String(haystack || '').toLowerCase();
  if (!h) return 0;
  const i = h.indexOf(n);
  if (i === 0) return 100;
  if (i > 0) return 70 - i;
  // subsequence match
  let j = 0; let hits = 0;
  for (const ch of h) { if (ch === n[j]) { j += 1; hits += 1; } if (j === n.length) break; }
  return hits === n.length ? 30 : 0;
};

/** Emits a short mechanical haptic where supported. */
SP.buzz = (pattern = 12) => { try { navigator.vibrate?.(pattern); } catch { /* noop */ } };

/** Screen-reader announcement without stealing focus. */
SP.announce = (msg) => {
  let live = document.getElementById('srLive');
  if (!live) {
    live = SP.el('div#srLive.sr-only', { 'aria-live': 'polite', 'aria-atomic': 'true' });
    document.body.appendChild(live);
  }
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 30);
};