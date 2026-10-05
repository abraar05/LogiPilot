/**
 * table.js — reusable data table: sort, paginate, select, column toggle.
 *
 * const t = SP.table.create({
 *   columns: [{ key, label, width?, align?, render?(row), value?(row), hidden? }],
 *   rows: () => array,                 // live row source
 *   rowId: (row) => row.id,
 *   selectable: true,
 *   pageSize: 25,
 *   empty: { icon, title, body },
 *   onRowClick?(row),
 *   bulkActions?: [{ id, label, icon?, danger?, run(rows) }],
 * });
 * host.appendChild(t.el); t.refresh();
 */
window.SP = window.SP || {};

SP.table = (() => {
  function create(opts) {
    const state = {
      sort: opts.defaultSort || null,
      dir: opts.defaultDir || 'asc',
      page: 0,
      pageSize: opts.pageSize || 25,
      selected: new Set(),
      hiddenCols: new Set((opts.columns || []).filter((c) => c.hidden).map((c) => c.key)),
    };

    const el = SP.el('div.dtable');
    const headRow = SP.el('div.dtable__row.dtable__row--head', { role: 'row' });
    const body = SP.el('div.dtable__body', { role: 'rowgroup' });
    const foot = SP.el('div.dtable__foot');
    const bulkBar = SP.el('div.dtable__bulk', { hidden: true });

    function visibleCols() { return opts.columns.filter((c) => !state.hiddenCols.has(c.key)); }

    function sortedRows() {
      const rows = [...(opts.rows() || [])];
      if (state.sort) {
        const col = opts.columns.find((c) => c.key === state.sort);
        if (col) {
          const val = col.value || ((r) => r[col.key]);
          rows.sort((a, b) => {
            const x = val(a); const y = val(b);
            const dir = state.dir === 'asc' ? 1 : -1;
            if (typeof x === 'string' || typeof y === 'string') {
              return String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }) * dir;
            }
            return ((x ?? 0) - (y ?? 0)) * dir;
          });
        }
      }
      return rows;
    }

    function pageRows() {
      const rows = sortedRows();
      const start = state.page * state.pageSize;
      return { rows: rows.slice(start, start + state.pageSize), total: rows.length, start };
    }

    function renderHead() {
      SP.clear(headRow);
      if (opts.selectable) {
        const all = SP.el('input', { type: 'checkbox', 'aria-label': 'Select all rows' });
        all.addEventListener('change', () => {
          const { rows } = pageRows();
          if (all.checked) rows.forEach((r) => state.selected.add(opts.rowId(r)));
          else rows.forEach((r) => state.selected.delete(opts.rowId(r)));
          renderBody(); renderBulk();
        });
        headRow.appendChild(SP.el('div.dtable__cell.dtable__cell--check', all));
      }
      for (const c of visibleCols()) {
        const cell = SP.el('button.dtable__cell.dtable__th', {
          type: 'button',
          class: [c.align === 'right' ? 'is-right' : '', state.sort === c.key ? `is-sorted is-${state.dir}` : ''].join(' '),
          style: c.width ? { flex: `0 0 ${c.width}` } : null,
          onclick: () => {
            if (state.sort === c.key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
            else { state.sort = c.key; state.dir = 'asc'; }
            renderHead(); renderBody();
          },
        }, SP.el('span', c.label), SP.icon('chevronDown', 'dtable__sort-ico'));
        headRow.appendChild(cell);
      }
      headRow.appendChild(SP.el('div.dtable__cell.dtable__cell--menu',
        SP.el('button.btn.btn--icon.btn--sm.btn--quiet', {
          type: 'button', 'aria-label': 'Choose columns',
          onclick: (e) => {
            SP.menu(e.currentTarget, opts.columns.map((c) => ({
              label: `${state.hiddenCols.has(c.key) ? '○' : '●'} ${c.label}`,
              onClick: () => { state.hiddenCols.has(c.key) ? state.hiddenCols.delete(c.key) : state.hiddenCols.add(c.key); renderHead(); renderBody(); },
            })), { align: 'right' });
          },
        }, SP.icon('sliders'))));
    }

    function renderBody() {
      SP.clear(body);
      const { rows, total, start } = pageRows();
      if (!rows.length) {
        body.appendChild(SP.empty(opts.empty || { icon: 'box', title: 'No rows', body: 'Nothing matches the current filters.' }));
      }
      for (const r of rows) {
        const id = opts.rowId(r);
        const row = SP.el('div.dtable__row', {
          role: 'row', tabindex: '0',
          class: state.selected.has(id) ? 'is-selected' : '',
          onclick: (e) => {
            if (e.target.closest('input,button,a')) return;
            opts.onRowClick?.(r);
          },
          onkeydown: (e) => { if (e.key === 'Enter' && !e.target.closest('input,button,a')) opts.onRowClick?.(r); },
        });
        if (opts.selectable) {
          const cb = SP.el('input', { type: 'checkbox', 'aria-label': 'Select row' });
          cb.checked = state.selected.has(id);
          cb.addEventListener('change', () => {
            cb.checked ? state.selected.add(id) : state.selected.delete(id);
            row.classList.toggle('is-selected', cb.checked);
            renderBulk();
          });
          row.appendChild(SP.el('div.dtable__cell.dtable__cell--check', cb));
        }
        for (const c of visibleCols()) {
          const val = c.render ? c.render(r) : (c.value ? c.value(r) : r[c.key]);
          row.appendChild(SP.el('div.dtable__cell', {
            class: c.align === 'right' ? 'is-right' : '',
            style: c.width ? { flex: `0 0 ${c.width}` } : null,
            dataset: { col: c.key },
          }, val === null || val === undefined ? '—' : val));
        }
        row.appendChild(SP.el('div.dtable__cell.dtable__cell--menu'));
        body.appendChild(row);
      }

      // footer / pagination
      SP.clear(foot);
      const pages = Math.max(1, Math.ceil(total / state.pageSize));
      state.page = Math.min(state.page, pages - 1);
      foot.appendChild(SP.el('span.tiny.mute',
        total ? `${SP.fmt.n(start + 1)}–${SP.fmt.n(Math.min(start + state.pageSize, total))} of ${SP.fmt.n(total)}` : '0 rows'));
      const pager = SP.el('div.dtable__pager');
      const mkPageBtn = (label, page, dis, aria) => SP.el('button.btn.btn--icon.btn--sm.btn--ghost', {
        type: 'button', disabled: dis, 'aria-label': aria,
        onclick: () => { state.page = page; renderBody(); },
      }, SP.icon(label));
      pager.appendChild(mkPageBtn('chevronsLeft', 0, state.page === 0, 'First page'));
      pager.appendChild(mkPageBtn('chevron', state.page - 1, state.page === 0, 'Previous page'));
      pager.querySelectorAll('[aria-label="Previous page"] svg').forEach((s) => { s.style.transform = 'rotate(180deg)'; });
      foot.appendChild(SP.el('div.row.gap-2', { style: { alignItems: 'center' } },
        SP.el('span.tiny.mute', `${state.page + 1} / ${pages}`), pager,
        (() => { const b = mkPageBtn('chevron', state.page + 1, state.page >= pages - 1, 'Next page'); return b; })(),
      ));
      renderBulk();
    }

    function renderBulk() {
      if (!opts.selectable) return;
      const n = state.selected.size;
      bulkBar.hidden = n === 0;
      if (!n) return;
      SP.clear(bulkBar);
      bulkBar.appendChild(SP.el('strong', `${SP.fmt.n(n)} selected`));
      for (const a of opts.bulkActions || []) {
        bulkBar.appendChild(SP.el('button.btn.btn--sm', {
          type: 'button',
          class: a.danger ? 'btn--danger' : 'btn--ghost',
          onclick: () => {
            const rows = opts.rows().filter((r) => state.selected.has(opts.rowId(r)));
            const done = () => { state.selected.clear(); renderBody(); };
            if (a.confirm) {
              SP.modal({
                title: a.confirmTitle || a.label,
                body: a.confirm.replace('{n}', n),
                tone: a.danger ? 'danger' : 'brand',
                okLabel: a.label,
                onOk: async () => { await a.run(rows); done(); },
              });
            } else Promise.resolve(a.run(rows)).then(done);
          },
        }, a.icon ? SP.icon(a.icon) : null, a.label));
      }
      bulkBar.appendChild(SP.el('button.btn.btn--sm.btn--quiet', {
        type: 'button', onclick: () => { state.selected.clear(); renderBody(); },
      }, 'Clear'));
    }

    renderHead();
    renderBody();
    el.append(bulkBar, SP.el('div.dtable__scroll', SP.el('div.dtable__table', { role: 'table' }, headRow, body)), foot);

    return {
      el,
      refresh() { renderHead(); renderBody(); },
      resetPage() { state.page = 0; },
      get selected() { return [...state.selected]; },
      setPageSize(n) { state.pageSize = n; state.page = 0; renderBody(); },
    };
  }

  return { create };
})();

/* ══════════════════════════════════════════════════════════════ DRAFTS */

/**
 * drafts.js behaviour (kept here to avoid another file): form auto-save.
 *
 * const d = SP.drafts.bind('sale-new', formEl);
 *   d.restore();  // returns saved values and fills the form
 *   d.clear();    // call after a successful submit
 * A beforeunload + route-change warning is installed while a draft is dirty.
 */
SP.drafts = (() => {
  const KEY = 'stockpilot.drafts.v1';
  const active = new Map();

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* full */ } };

  function save(id, values) {
    const all = read();
    all[id] = { at: Date.now(), values };
    write(all);
  }
  function load(id) { return read()[id]?.values || null; }
  function clear(id) { const all = read(); delete all[id]; write(all); active.delete(id); }

  function bind(id, root) {
    const api = {
      restore() {
        const v = load(id);
        if (!v) return null;
        for (const [k, val] of Object.entries(v)) {
          const field = root.querySelector(`[name="${k}"]`);
          if (!field) continue;
          if (field.type === 'checkbox') field.checked = !!val;
          else field.value = val;
        }
        return v;
      },
      snapshot() {
        const out = {};
        root.querySelectorAll('[name]').forEach((f) => { out[f.name] = f.type === 'checkbox' ? f.checked : f.value; });
        save(id, out);
        return out;
      },
      clear: () => clear(id),
    };
    root.addEventListener('input', SP.debounce(() => api.snapshot(), 400));
    active.set(id, api);
    return api;
  }

  /** True when any draft exists (used for the unsaved-changes warning). */
  function anyDirty() { return Object.keys(read()).length > 0; }

  addEventListener('beforeunload', (e) => {
    if (anyDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  return { bind, load, save, clear, anyDirty };
})();
