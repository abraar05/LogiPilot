/**
 * charts.js — dependency-free SVG charts tuned for small screens.
 *
 * Every chart returns a DOM node, sizes itself to its container via viewBox,
 * and animates in with CSS. Colour is passed in so charts follow the theme.
 */
window.SP = window.SP || {};

SP.charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      n.setAttribute(k, String(v));
    }
    return n;
  };

  const shell = (w, h, label) => {
    const s = svgEl('svg', {
      viewBox: `0 0 ${w} ${h}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': label || 'chart',
      style: 'height:auto',
    });
    return s;
  };

  const cssVar = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  };

  /* ───────────────────────────────────────────────────── vertical bars */

  /**
   * @param {object} o
   * @param {{label:string,value:number,colour?:string}[]} o.data
   */
  function bars(o) {
    const data = o.data || [];
    const W = 320;
    const H = o.height || 130;
    const pad = { t: 8, r: 6, b: 20, l: 6 };
    const svg = shell(W, H, o.label);
    if (!data.length) return wrapEmpty(svg);

    const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    const slot = innerW / data.length;
    const bw = Math.min(34, slot * 0.62);

    // baseline
    svg.appendChild(svgEl('line', {
      x1: pad.l, y1: pad.t + innerH, x2: W - pad.r, y2: pad.t + innerH,
      class: 'chart__grid',
    }));

    data.forEach((d, i) => {
      const h = Math.max(2, (Math.abs(d.value) / max) * innerH);
      const x = pad.l + slot * i + (slot - bw) / 2;
      const y = pad.t + innerH - h;
      const colour = d.colour || cssVar('--brand', '#5b8cff');

      const g = svgEl('g', {});
      const rect = svgEl('rect', {
        x, y, width: bw, height: h, rx: Math.min(4, bw / 3),
        fill: colour, class: 'chart__bar',
        style: 'transform-origin: center bottom; animation: barGrow .5s cubic-bezier(.22,1,.36,1) both',
      });
      // Animate via inline custom property fallback
      rect.style.transform = 'scaleY(0)';
      rect.style.transition = 'transform .55s cubic-bezier(.22,1,.36,1)';
      g.appendChild(rect);
      requestAnimationFrame(() => { rect.style.transform = 'scaleY(1)'; });

      const title = svgEl('title');
      title.textContent = `${d.label}: ${SP.fmt.n(d.value)}`;
      g.appendChild(title);

      // value label above the bar when space allows
      if (o.showValues && slot > 30) {
        const t = svgEl('text', {
          x: x + bw / 2, y: y - 4, class: 'chart__axis',
          'text-anchor': 'middle', 'font-size': 9,
        });
        t.textContent = SP.fmt.compact(d.value);
        g.appendChild(t);
      }
      svg.appendChild(g);

      // x label
      if (d.label !== undefined) {
        const xl = svgEl('text', {
          x: x + bw / 2, y: H - 6, class: 'chart__axis', 'text-anchor': 'middle',
        });
        xl.textContent = d.label;
        svg.appendChild(xl);
      }
    });

    return SP.el('div.chart', svg);
  }

  /* ──────────────────────────────────────────────────────── sparkline */

  function sparkline(values, o = {}) {
    const W = o.width || 120;
    const H = o.height || 34;
    const svg = shell(W, H, o.label || 'trend');
    const vals = (values || []).map((v) => Number(v) || 0);
    if (vals.length < 2) return SP.el('div.chart', svg);

    const max = Math.max(...vals);
    const min = Math.min(...vals, 0);
    const span = max - min || 1;
    const stepX = W / (vals.length - 1);
    const pts = vals.map((v, i) => [
      i * stepX,
      H - 3 - ((v - min) / span) * (H - 6),
    ]);

    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const colour = o.colour || cssVar('--brand', '#5b8cff');

    if (o.fill !== false) {
      const area = `${d} L${W},${H} L0,${H} Z`;
      const gid = SP.uid('grad');
      const defs = svgEl('defs');
      const lg = svgEl('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
      lg.appendChild(svgEl('stop', { offset: '0%', 'stop-color': colour, 'stop-opacity': 0.35 }));
      lg.appendChild(svgEl('stop', { offset: '100%', 'stop-color': colour, 'stop-opacity': 0 }));
      defs.appendChild(lg);
      svg.appendChild(defs);
      svg.appendChild(svgEl('path', { d: area, fill: `url(#${gid})` }));
    }

    const path = svgEl('path', {
      d, fill: 'none', stroke: colour, 'stroke-width': o.weight || 1.8,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    svg.appendChild(path);

    if (o.dot !== false) {
      const last = pts[pts.length - 1];
      svg.appendChild(svgEl('circle', {
        cx: last[0], cy: last[1], r: 2.4, fill: colour,
      }));
    }
    return SP.el('div.chart', svg);
  }

  /* ────────────────────────────────────────────────────────────── donut */

  /**
   * @param {{label:string,value:number,colour:string}[]} o.data
   */
  function donut(o) {
    const data = (o.data || []).filter((d) => d.value > 0);
    const size = o.size || 132;
    const stroke = o.stroke || 17;
    const R = (size - stroke) / 2;
    const C = size / 2;
    const circumference = 2 * Math.PI * R;

    const svg = shell(size, size, o.label);
    svg.setAttribute('style', `width:${size}px;height:${size}px`);

    svg.appendChild(svgEl('circle', {
      cx: C, cy: C, r: R, fill: 'none',
      stroke: cssVar('--surface-3', '#1e2536'), 'stroke-width': stroke,
    }));

    const total = data.reduce((a, d) => a + d.value, 0) || 1;
    let offset = 0;

    data.forEach((d, i) => {
      const frac = d.value / total;
      const arc = svgEl('circle', {
        cx: C, cy: C, r: R, fill: 'none',
        stroke: d.colour || cssVar('--brand', '#5b8cff'),
        'stroke-width': stroke,
        'stroke-dasharray': `${(frac * circumference).toFixed(2)} ${circumference}`,
        'stroke-dashoffset': `${(-offset * circumference).toFixed(2)}`,
        transform: `rotate(-90 ${C} ${C})`,
        style: 'transition: stroke-dasharray .6s cubic-bezier(.22,1,.36,1), stroke-dashoffset .6s cubic-bezier(.22,1,.36,1)',
      });
      arc.appendChild(Object.assign(document.createElementNS(NS, 'title'), {
        textContent: `${d.label}: ${SP.fmt.n(d.value)} (${((d.value / total) * 100).toFixed(1)}%)`,
      }));
      svg.appendChild(arc);
      offset += frac;
      void i;
    });

    const chart = SP.el('div.donut__chart', { style: `width:${size}px;height:${size}px` }, svg);
    const center = SP.el('div.donut__center',
      SP.el('b', o.centerValue ?? SP.fmt.compact(total)),
      SP.el('span', o.centerLabel || 'total'),
    );
    chart.appendChild(center);

    const list = data.map((d) => SP.el('div.donut__row',
      SP.el('span.dot', { style: { background: d.colour } }),
      SP.el('span', d.label),
      SP.el('b', { style: { color: d.colour } }, SP.fmt.compact(d.value)),
    ));

    return SP.el('div.donut', chart, SP.el('div.donut__list', ...list));
  }

  /* ──────────────────────────────────────────────────── horizontal bars */

  /** CSS-driven bar list — far crisper than SVG for labelled rows. */
  function hbars(o) {
    const data = o.data || [];
    const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
    const rows = data.map((d) => SP.el('div.hbar__row',
      SP.el('div.hbar__label', { title: d.label }, d.label),
      SP.el('div.hbar__track',
        SP.el('i.hbar__fill', {
          style: {
            width: `${(Math.abs(d.value) / max) * 100}%`,
            background: d.colour || cssVar('--brand', '#5b8cff'),
          },
        }),
      ),
      SP.el('div.hbar__val', o.format ? o.format(d.value) : SP.fmt.compact(d.value)),
    ));
    return SP.el('div.hbar', ...rows);
  }

  /* ──────────────────────────────────────────────────── stacked columns */

  /**
   * @param {object} o
   * @param {{label:string, parts:{label:string,value:number,colour:string}[]}[]} o.rows
   */
  function stacked(o) {
    const rows = o.rows || [];
    const W = 320;
    const rowH = o.rowH || 30;
    const H = Math.max(40, rows.length * rowH + 16);
    const pad = { t: 8, r: 4, b: 8, l: o.labelWidth ?? 76 };
    const svg = shell(W, H, o.label);

    const totals = rows.map((r) => r.parts.reduce((a, p) => a + p.value, 0));
    const max = Math.max(1, ...totals);
    const innerW = W - pad.l - pad.r;
    const barH = Math.min(15, rowH - 13);

    rows.forEach((r, i) => {
      const y = pad.t + i * rowH;
      const total = totals[i];

      if (r.label) {
        const t = svgEl('text', {
          x: 0, y: y + barH / 2 + 3.5, class: 'chart__axis', 'text-anchor': 'start',
        });
        t.textContent = r.label.length > 11 ? `${r.label.slice(0, 10)}…` : r.label;
        svg.appendChild(t);
      }

      let x = pad.l;
      const scale = total / max;
      for (const p of r.parts) {
        if (p.value <= 0) continue;
        const w = (p.value * scale / (total || 1)) * innerW * (total / max === 0 ? 0 : 1);
        const seg = svgEl('rect', {
          x, y, width: Math.max(1.5, (p.value / max) * innerW), height: barH,
          fill: p.colour, class: 'chart__bar',
        });
        seg.appendChild(Object.assign(document.createElementNS(NS, 'title'), {
          textContent: `${p.label}: ${SP.fmt.n(p.value)}`,
        }));
        svg.appendChild(seg);
        x += (p.value / max) * innerW;
        void w;
      }

      const val = svgEl('text', {
        x: W - pad.r, y: y + barH / 2 + 3.5, class: 'chart__axis',
        'text-anchor': 'end', 'font-size': 10,
      });
      val.textContent = o.format ? o.format(total) : SP.fmt.compact(total);
      svg.appendChild(val);
    });

    return SP.el('div.chart', svg);
  }

  /* ─────────────────────────────────────────────────────────────── gauge */

  /** Semicircular gauge for a 0–100 score. */
  function gauge(o) {
    const pctVal = SP.clamp(o.value ?? 0, 0, 100);
    const size = 128;
    const H = 76;
    const R = 54;
    const C = size / 2;
    const svg = shell(size, H, o.label);
    const arc = (from, to) => {
      const a0 = Math.PI * (1 - from / 100);
      const a1 = Math.PI * (1 - to / 100);
      const x0 = C + R * Math.cos(a0); const y0 = H - 4 + R * Math.sin(a0) * -1;
      const x1 = C + R * Math.cos(a1); const y1 = H - 4 + R * Math.sin(a1) * -1;
      return `M${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${to - from > 50 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
    };

    svg.appendChild(svgEl('path', {
      d: arc(0, 100), fill: 'none',
      stroke: cssVar('--surface-3', '#1e2536'), 'stroke-width': 11, 'stroke-linecap': 'round',
    }));
    const fill = svgEl('path', {
      d: arc(0, Math.max(0.6, pctVal)), fill: 'none',
      stroke: o.colour || cssVar('--brand', '#5b8cff'), 'stroke-width': 11, 'stroke-linecap': 'round',
      style: 'transition: d .7s cubic-bezier(.22,1,.36,1)',
    });
    svg.appendChild(fill);

    return SP.el('div.gauge',
      SP.el('div.gauge__arc', svg,
        SP.el('div', {
          style: {
            position: 'absolute', inset: '0', display: 'grid', placeContent: 'center',
            textAlign: 'center', paddingTop: '14px',
          },
          html: `<b class="gauge__val">${o.display ?? SP.fmt.pct(pctVal)}</b>`,
        }),
      ),
      o.label ? SP.el('span.tiny.mute', o.label) : null,
    );
  }

  /* ────────────────────────────────────────────────────── line / area */

  /** Multi-series line chart with a shared y-axis. */
  function lines(o) {
    const series = o.series || [];
    const labels = o.labels || [];
    const W = 320;
    const H = o.height || 150;
    const pad = { t: 10, r: 8, b: 22, l: 30 };
    const svg = shell(W, H, o.label);

    if (!series.length || labels.length < 2) return wrapEmpty(svg);

    const allVals = series.flatMap((s) => s.values);
    const max = Math.max(1, ...allVals);
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    const stepX = innerW / (labels.length - 1);

    // horizontal guides + y labels
    for (let g = 0; g <= 3; g += 1) {
      const y = pad.t + (innerH / 3) * g;
      svg.appendChild(svgEl('line', {
        x1: pad.l, y1: y, x2: W - pad.r, y2: y, class: 'chart__grid',
      }));
      const t = svgEl('text', {
        x: pad.l - 5, y: y + 3.5, class: 'chart__axis', 'text-anchor': 'end', 'font-size': 9,
      });
      t.textContent = SP.fmt.compact(max - (max / 3) * g);
      svg.appendChild(t);
    }

    series.forEach((s) => {
      const pts = s.values.map((v, i) => [
        pad.l + stepX * i,
        pad.t + innerH - ((Number(v) || 0) / max) * innerH,
      ]);
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      const colour = s.colour || cssVar('--brand', '#5b8cff');

      if (s.area !== false) {
        const gid = SP.uid('g');
        const defs = svgEl('defs');
        const lg = svgEl('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
        lg.appendChild(svgEl('stop', { offset: '0%', 'stop-color': colour, 'stop-opacity': 0.28 }));
        lg.appendChild(svgEl('stop', { offset: '100%', 'stop-color': colour, 'stop-opacity': 0 }));
        defs.appendChild(lg);
        svg.appendChild(defs);
        svg.appendChild(svgEl('path', { d: `${d} L${pts[pts.length - 1][0]},${pad.t + innerH} L${pad.l},${pad.t + innerH} Z`, fill: `url(#${gid})` }));
      }
      svg.appendChild(svgEl('path', {
        d, fill: 'none', stroke: colour, 'stroke-width': 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-dasharray': s.dashed ? '4 3' : null,
      }));
      pts.forEach((p, i) => {
        const c = svgEl('circle', { cx: p[0], cy: p[1], r: labels.length > 20 ? 0 : 2.6, fill: colour });
        c.appendChild(Object.assign(document.createElementNS(NS, 'title'), {
          textContent: `${s.label} · ${labels[i]}: ${SP.fmt.n(s.values[i])}`,
        }));
        svg.appendChild(c);
      });
    });

    // x labels — thin them out so they never collide
    const every = Math.ceil(labels.length / 6);
    labels.forEach((l, i) => {
      if (i % every !== 0 && i !== labels.length - 1) return;
      const t = svgEl('text', {
        x: pad.l + stepX * i, y: H - 6, class: 'chart__axis', 'text-anchor': 'middle', 'font-size': 9,
      });
      t.textContent = l;
      svg.appendChild(t);
    });

    const wrap = SP.el('div.chart', svg);
    if (series.length > 1) {
      wrap.appendChild(SP.el('div.chart__legend', ...series.map((s) => SP.el('div.chart__legend-item',
        SP.el('i.chart__legend-swatch', { style: { background: s.colour } }),
        s.label,
      ))));
    }
    return wrap;
  }

  /* ─────────────────────────────────────────────────── heatmap (grid) */

  /**
   * Warehouse × colour matrix. Rendered as CSS grid rather than SVG so cells
   * stay crisp and tappable.
   */
  function heatmap(o) {
    const cols = o.columns || [];
    const rows = o.rows || [];
    if (!cols.length || !rows.length) return SP.el('div.empty', 'No data');

    const max = Math.max(1, ...rows.flatMap((r) => r.cells.map((c) => c.value)));
    const grid = SP.el('div.heat');

    grid.appendChild(SP.el('div.heat__row',
      SP.el('div.heat__label', ''),
      ...cols.map((c) => SP.el('div.heat__head', c.label || c)),
    ));

    for (const r of rows) {
      grid.appendChild(SP.el('div.heat__row',
        SP.el('div.heat__label', { title: r.label }, r.label),
        ...r.cells.map((c) => {
          const frac = c.value / max;
          const zero = c.value === 0;
          const bg = zero
            ? 'var(--surface-3)'
            : SP.charts.fade(c.colour, 0.16 + frac * 0.72);
          return SP.el('div', {
            class: `heat__cell${zero ? ' is-zero' : ''}`,
            style: { background: bg },
            title: `${r.label} · ${c.label}: ${SP.fmt.n(c.value)}`,
            onclick: c.onClick,
          }, zero ? '' : SP.fmt.compact(c.value));
        }),
      ));
    }
    return grid;
  }

  /* ─────────────────────────────────────────────────── colour blending */

  /** Blend `hex` toward the page background; alpha 0–1. */
  function fade(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
    if (!m) return `rgba(148,163,184,${alpha})`;
    const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
  }

  function wrapEmpty(svg) {
    return SP.el('div.chart', svg);
  }

  return { bars, sparkline, donut, hbars, stacked, gauge, lines, heatmap, fade };
})();