/**
 * ui.js — overlays, toasts, menus and shared view widgets.
 */
window.SP = window.SP || {};

/* ═════════════════════════════════════════════════════════════════ OVERLAYS */

const openLayers = [];

function pushLayer(scrim, panel, onClose) {
  document.body.appendChild(scrim);
  document.body.appendChild(panel);
  requestAnimationFrame(() => {
    scrim.classList.add('is-open');
    panel.classList.add('is-open');
  });
  document.body.style.overflow = 'hidden';

  const close = (result) => {
    const i = openLayers.indexOf(ctl);
    if (i >= 0) openLayers.splice(i, 1);
    scrim.classList.remove('is-open');
    panel.classList.remove('is-open');
    document.body.style.overflow = openLayers.length ? 'hidden' : '';
    setTimeout(() => { scrim.remove(); panel.remove(); }, 320);
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose(result);
  };

  const onKey = (e) => {
    if (e.key === 'Escape' && openLayers[openLayers.length - 1] === ctl) {
      e.stopPropagation();
      close(null);
    }
  };

  scrim.addEventListener('click', () => close(null));
  document.addEventListener('keydown', onKey, true);

  const ctl = { close, panel, scrim };
  openLayers.push(ctl);

  // focus trap
  setTimeout(() => {
    const focusable = panel.querySelector(
      '[autofocus], input:not([type=hidden]), select, textarea, button:not(.sheet__close)',
    );
    if (focusable) focusable.focus();
  }, 120);

  return ctl;
}

/**
 * Bottom sheet (mobile) that becomes a centred dialog on desktop.
 * @returns {{close:(result)=>void, el:HTMLElement, body:HTMLElement}}
 */
SP.sheet = function sheet(o) {
  const scrim = SP.el('div.scrim-fade');
  const body = SP.el('div.sheet__body');
  const foot = o.actions ? SP.el('div.sheet__foot', ...o.actions) : null;

  const panel = SP.el('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Panel' },
    SP.el('div.sheet__grab'),
    SP.el('div.sheet__head',
      SP.el('h2', o.title || ''),
      o.subtitle ? SP.el('span.tiny.mute', o.subtitle) : null,
      o.onClose ? null : SP.el('button.sheet__close.btn.btn--icon.btn--quiet.btn--sm', {
        type: 'button', 'aria-label': 'Close', onclick: () => ctl.close(null),
      }, SP.icon('x')),
    ),
    body,
    foot,
  );

  if (o.subtitle) {
    panel.querySelector('.sheet__head h2').nextSibling;
    SP.el('p.tiny.mute', { style: { marginTop: '-6px', paddingBottom: '4px' } }, o.subtitle);
    panel.querySelector('.sheet__head h2').after(
      SP.el('p.tiny.mute', { style: { marginTop: '-4px', flexBasis: '100%' } }, o.subtitle),
    );
    panel.querySelector('.sheet__head span')?.remove();
  }

  if (typeof o.content === 'string') body.innerHTML = o.content;
  else if (o.content) body.appendChild(o.content);

  const ctl = pushLayer(scrim, panel, o.onClose);
  ctl.el = panel;
  ctl.body = body;
  if (o.actions) {
    ctl.foot = foot;
    SP.$$('.btn', foot).forEach((b) => {
      b.addEventListener('click', () => {
        const r = b.dataset.keepOpen ? undefined : ctl.close(b.dataset.result ?? null);
        if (b.dataset.keepOpen !== undefined && typeof b.onClick === 'function') {
          b.addEventListener('click', b.onClick);
        }
        void r;
      });
    });
  }
  return ctl;
};

/**
 * Confirmation / form dialog.
 * @returns {Promise<boolean|object>} false on cancel, else the payload.
 */
SP.modal = function modal(o) {
  return new Promise((resolve) => {
    const scrim = SP.el('div.scrim-fade');
    const body = SP.el('div.modal__body');
    const fieldNodes = [];

    if (o.body) {
      if (typeof o.body === 'string') body.innerHTML = o.body;
      else body.appendChild(o.body);
    }

    (o.fields || []).forEach((f) => {
      const node = buildField(f);
      if (node) { body.appendChild(node.wrap); fieldNodes.push(node); }
    });

    /* Draft auto-save: restore previous values, persist on input, and
       clear once the form completes. Protects long forms from refreshes. */
    if (o.draftId && SP.drafts) {
      const saved = SP.drafts.load(o.draftId);
      if (saved) {
        for (const fn of fieldNodes) {
          const v = saved[fn.key ?? fn.control?.name];
          const name = fn.key ?? fn.control?.name;
          if (v === undefined || !fn.control) continue;
          if (fn.control.type === 'checkbox') fn.control.checked = !!v;
          else fn.control.value = v;
          void name;
        }
        const note = SP.el('p.field__hint', 'Draft restored from your last session.');
        body.prepend(note);
      }
      body.addEventListener('input', SP.debounce(() => {
        const values = {};
        for (const fn of fieldNodes) {
          if (!fn.control) continue;
          values[fn.key] = fn.control.type === 'checkbox' ? fn.control.checked : fn.control.value;
        }
        SP.drafts.save(o.draftId, values);
      }, 450));
    }

    const ctaOk = o.okLabel || 'Confirm';
    const ctl = { resolve };

    const okBtn = SP.el('button.btn', {
      type: 'button',
      class: `btn ${o.tone === 'danger' ? 'btn--danger' : o.tone === 'ok' ? 'btn--ok' : 'btn--primary'}`,
    }, o.busy ? null : null, SP.el('span.btn__label', ctaOk));

    const cancelBtn = SP.el('button.btn.btn--ghost', { type: 'button' }, o.cancelLabel || 'Cancel');

    okBtn.addEventListener('click', async () => {
      const values = {};
      let ok = true;
      for (const fn of fieldNodes) {
        const r = fn.read();
        if (r.error) { fn.showError(r.error); ok = false; }
        else if (r.value !== undefined) values[r.key] = r.value;
      }
      if (!ok) return;
      if (typeof o.onOk === 'function') {
        okBtn.setAttribute('aria-busy', 'true');
        try {
          const res = await o.onOk(values, okBtn);
          if (res === false) { okBtn.removeAttribute('aria-busy'); return; }
        } catch (err) {
          okBtn.removeAttribute('aria-busy');
          SP.ui.toast({ tone: 'danger', title: 'Action failed', body: err.message });
          return;
        }
        okBtn.removeAttribute('aria-busy');
      }
      if (o.draftId && SP.drafts) SP.drafts.clear(o.draftId);
      ctl.close(values);
    });

    cancelBtn.addEventListener('click', () => ctl.close(false));

    const panel = SP.el('div.modal', {
      role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Dialog',
      dataset: { tone: o.tone || 'brand' },
    },
      SP.el('div.modal__head',
        o.icon ? SP.el('div.modal__ico', SP.icon(o.icon)) : null,
        SP.el('div.grow',
          SP.el('h2', o.title || ''),
          o.subtitle ? SP.el('p', o.subtitle) : null,
        ),
        o.dismissable === false ? null : SP.el('button.btn.btn--icon.btn--quiet.btn--sm', {
          type: 'button', 'aria-label': 'Close', onclick: () => ctl.close(false),
        }, SP.icon('x')),
      ),
      body,
      SP.el('div.modal__foot', cancelBtn, okBtn),
    );

    const layer = pushLayer(scrim, panel, (result) => resolve(result === null ? false : result));
    ctl.close = layer.close;
    ctl.el = panel;
  });
};

/** Build one labelled form control; returns { wrap, read, showError }. */
function buildField(f) {
  const id = SP.uid('f');
  const wrap = SP.el('div.field');
  if (f.label) wrap.appendChild(SP.el('label.field__label', { for: id }, f.label));
  const err = SP.el('p.field__error');
  let control;
  let appended = false;   // checkbox renders its own label, so skip the shared append

  switch (f.type) {
    case 'select':
      control = SP.el('select.select', { id },
        ...(f.options || []).map((op) => SP.el('option', {
          value: op.value, selected: String(op.value) === String(f.value ?? ''),
        }, op.label)),
      );
      break;
    case 'textarea':
      control = SP.el('textarea.textarea', { id, placeholder: f.placeholder || '' });
      control.value = f.value ?? '';
      break;
    case 'checkbox':
      wrap.appendChild(SP.el('label.check',
        SP.el('input', { type: 'checkbox', id, checked: !!f.value }),
        SP.el('span.check__box'),
        SP.el('span.check__text', f.checkboxLabel || ''),
      ));
      appended = true;
      break;
    case 'number': {
      control = SP.el('input.input.input--num', {
        id, type: 'number', inputmode: 'numeric',
        min: f.min, max: f.max, step: f.step || 1,
        placeholder: f.placeholder || '',
      });
      control.value = f.value ?? '';
      if (f.suffix) {
        wrap.appendChild(SP.el('div.input-affix', control, SP.el('span.field__suffix', f.suffix)));
      } else wrap.appendChild(control);
      appended = true;
      break;
    }
    default:
      control = SP.el('input.input', {
        id, type: f.type || 'text', placeholder: f.placeholder || '',
        autocomplete: f.autocomplete || 'off', inputmode: f.inputmode || null,
      });
      control.value = f.value ?? '';
      wrap.appendChild(control);
      appended = true;
  }

  if (!appended) wrap.appendChild(control);
  if (f.type !== 'checkbox') {
    if (f.hint) wrap.appendChild(SP.el('p.field__hint', f.hint));
    wrap.appendChild(err);
  }

  const validate = f.validate;
  return {
    wrap,
    control,
    key: f.key,
    read() {
      if (f.type === 'checkbox') return { key: f.key, value: control.checked };
      const raw = control.value;
      let value = raw;
      if (f.type === 'number') {
        if (raw === '') return { key: f.key, value: f.required ? NaN : null, error: f.required ? 'Required' : undefined };
        value = Number(raw);
        if (!Number.isFinite(value)) return { key: f.key, error: 'Enter a number' };
        if (f.min !== undefined && value < f.min) return { key: f.key, error: `Minimum ${f.min}` };
        if (f.max !== undefined && value > f.max) return { key: f.key, error: `Maximum ${f.max}` };
      }
      if (f.required && (raw === null || String(raw).trim() === '')) {
        return { key: f.key, error: 'Required' };
      }
      if (validate) {
        const msg = validate(raw, value);
        if (msg) return { key: f.key, error: msg };
      }
      return { key: f.key, value };
    },
    showError(msg) {
      err.textContent = msg || '';
      if (control.classList) control.classList.toggle('is-invalid', !!msg);
    },
  };
}

/* ══════════════════════════════════════════════════════════════════ TOASTS */

SP.ui = SP.ui || {};

SP.ui.toast = function toast(o) {
  const root = document.getElementById('toastRoot');
  if (!root) return () => {};
  const icons = { ok: 'check', danger: 'alert', warn: 'alert', info: 'info', brand: 'sparkles' };
  const tone = o.tone || 'info';

  const node = SP.el('div.toast', { dataset: { tone } },
    SP.el('div.toast__ico', SP.icon(icons[tone] || 'info')),
    SP.el('div.toast__text',
      SP.el('strong', o.title || ''),
      o.body ? SP.el('span', o.body) : null,
    ),
    o.action ? SP.el('button.btn.btn--sm.btn--ghost.toast__act', {
      type: 'button',
      onclick: () => { o.action.onClick?.(); dismiss(); },
    }, o.action.label) : SP.el('button.btn.btn--icon.btn--sm.btn--quiet.toast__act', {
      type: 'button', 'aria-label': 'Dismiss', onclick: () => dismiss(),
    }, SP.icon('x')),
  );

  let timer;
  function dismiss() {
    clearTimeout(timer);
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 240);
  }

  root.appendChild(node);
  const life = o.duration ?? (tone === 'danger' ? 6500 : 3600);
  timer = setTimeout(dismiss, life);

  // keep the stack shallow
  while (root.children.length > 4) root.firstChild.remove();

  SP.announce(`${o.title || ''} ${o.body || ''}`);
  return dismiss;
};

/* ═══════════════════════════════════════════════════════════════════ MENUS */

/** Anchored popover menu. `items` accept { label, icon, onClick, danger, meta }. */
SP.menu = function menu(anchor, items, o = {}) {
  const existing = SP.$('.menu');
  if (existing) existing.remove();

  const panel = SP.el('div.menu', { role: 'menu' });
  for (const it of items) {
    if (it === '-') { panel.appendChild(SP.el('div.menu__sep')); continue; }
    if (it.group) { panel.appendChild(SP.el('div.menu__group', it.group)); continue; }
    if (!it) continue;
    panel.appendChild(SP.el('button.menu__item', {
      type: 'button', role: 'menuitem',
      class: it.danger ? 'is-danger' : '',
      disabled: it.disabled || false,
      onclick: () => { panel.remove(); it.onClick?.(); },
    },
      it.icon ? SP.icon(it.icon) : null,
      SP.el('span', it.label),
      it.meta ? SP.el('span.menu__meta', it.meta) : null,
      it.badge ? SP.el('span.badge' + (it.badgeTone ? `.badge--${it.badgeTone}` : ''), it.badge) : null,
    ));
  }

  document.body.appendChild(panel);
  const r = anchor.getBoundingClientRect();
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  let left = o.align === 'right' ? r.right - pw : r.left;
  let top = o.placement === 'above' ? r.top - ph - 6 : r.bottom + 6;
  left = SP.clamp(left, 8, innerWidth - pw - 8);
  if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;

  const off = (e) => {
    if (!panel.contains(e.target) && !anchor.contains(e.target)) {
      panel.remove();
      document.removeEventListener('pointerdown', off, true);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  const esc = (e) => {
    if (e.key === 'Escape') { panel.remove(); document.removeEventListener('keydown', esc, true); }
  };
  document.addEventListener('keydown', esc, true);

  return panel;
};

/* ═════════════════════════════════════════════════════ SHARED WIDGETS */

/** Section wrapper with a heading and optional trailing link. */
SP.section = function section(title, subtitle, ...children) {
  return SP.el('section.section',
    (title || subtitle) ? SP.el('div.section__head',
      SP.el('div.grow',
        title ? SP.el('h2', title) : null,
        subtitle ? SP.el('p', subtitle) : null,
      ),
    ) : null,
    ...children,
  );
};

/** Empty-state block. */
SP.empty = function empty(o) {
  return SP.el('div.empty',
    SP.el('div.empty__ico', SP.icon(o.icon || 'box')),
    SP.el('h3', o.title || 'Nothing here yet'),
    SP.el('p', o.body || ''),
    o.action ? SP.el('button.btn.btn--primary', {
      type: 'button', onclick: o.action.onClick,
    }, o.action.label) : null,
  );
};

/** Skeleton placeholder. */
SP.skeleton = function skeleton(kind = 'block', count = 1) {
  return SP.el('div', { class: kind === 'block' ? 'stack gap-2' : 'stack gap-1' },
    ...Array.from({ length: count }, () => SP.el('div.skel', {
      class: kind === 'text' ? 'skel--text' : kind === 'title' ? 'skel--title' : 'skel--block',
      style: kind === 'block' ? { height: `${44 + Math.floor(Math.random() * 40)}px` } : null,
    })),
  );
};

/** Urgency tag. */
SP.urgencyTag = function urgencyTag(u, opts = {}) {
  return SP.el('span.tag', { class: `tag--u-${u.tone === 'danger' ? 'red' : u.tone === 'warn' ? 'amber' : 'green'}` },
    SP.el('i.tag__dot'),
    opts.short ? u.short : u.label,
  );
};

/** A single inventory row used by several modules. */
SP.skuRow = function skuRow(rec, o = {}) {
  const { sku, qty, urgency } = rec;
  return SP.el('button.lrow', {
    type: 'button',
    onclick: () => o.onClick?.(rec),
  },
    SP.el('span.lrow__ico', {
      style: {
        background: `color-mix(in srgb, ${urgency.colour} 16%, transparent)`,
        color: urgency.colour,
      },
    }, SP.icon(o.icon || 'box')),
    SP.el('div.lrow__main',
      SP.el('strong', sku.sku),
      SP.el('small', `${sku.specs} · ${sku.brand}`),
    ),
    SP.el('div.lrow__end',
      SP.el('span.lrow__val', { style: { color: qty === 0 ? 'var(--danger)' : undefined } }, SP.fmt.n(qty)),
      o.showUrgency === false ? null : SP.urgencyTag(urgency, { short: true }),
    ),
    SP.icon('chevron', 'lrow__chev'),
  );
};

/** Sticky segmented control bound to local state. */
SP.segmented = function segmented(options, value, onChange, o = {}) {
  const wrap = SP.el('div.seg', { class: o.small ? 'seg--sm' : '', role: 'tablist' });
  const render = (val) => {
    SP.clear(wrap);
    for (const opt of options) {
      const btn = SP.el('button.seg__btn', {
        type: 'button', role: 'tab',
        class: String(opt.value) === String(val) ? 'is-active' : '',
        'aria-selected': String(opt.value) === String(val),
        onclick: () => { render(opt.value); onChange(opt.value); },
      }, opt.label, opt.count !== undefined ? ` ${opt.count}` : '');
      wrap.appendChild(btn);
    }
  };
  render(value);
  return wrap;
};

/** Horizontal filter chips. */
SP.chipRow = function chipRow(options, value, onChange) {
  const row = SP.el('div.chips', { role: 'group' });
  const render = (val) => {
    SP.clear(row);
    for (const opt of options) {
      row.appendChild(SP.el('button.chip', {
        type: 'button',
        class: String(opt.value) === String(val) ? 'is-active' : '',
        onclick: () => { render(opt.value); onChange(opt.value); },
      },
        opt.swatch ? SP.el('i.chip__swatch', { style: { background: opt.swatch } }) : null,
        opt.label,
        opt.count !== undefined ? SP.el('span.chip__count', SP.fmt.n(opt.count)) : null,
      ));
    }
  };
  render(value);
  return row;
};

/** Copy-to-clipboard with a confirmation toast. */
SP.copy = async function copy(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    SP.ui.toast({ tone: 'ok', title: label, body: 'Ready to paste.' });
    return true;
  } catch {
    // fallback for insecure contexts
    const ta = SP.el('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    SP.ui.toast(ok
      ? { tone: 'ok', title: label }
      : { tone: 'warn', title: 'Copy blocked', body: 'Select the text and copy manually.' });
    return ok;
  }
};

/** First-run / contextual tip banner with dismissal persisted per user. */
SP.tip = function tip(tipObj) {
  const s = SP.store.state;
  if (s.prefs.seenTips.includes(tipObj.id)) return null;
  return SP.el('div.callout', { dataset: { tone: 'brand' } },
    SP.el('span.callout__ico', SP.icon('sparkles')),
    SP.el('div.callout__body',
      SP.el('strong', 'Tip'),
      SP.el('p', tipObj.text),
    ),
    SP.el('button.btn.btn--icon.btn--sm.btn--quiet', {
      type: 'button', 'aria-label': 'Dismiss tip',
      onclick: (e) => {
        SP.store.update(['prefs'], (st) => { st.prefs.seenTips.push(tipObj.id); });
        e.target.closest('.callout')?.remove();
      },
    }, SP.icon('x')),
  );
};

SP.TIPS_BY_ID = (id) => SP.TIPS.find((t) => t.id === id);

/** Monogram avatar. */
SP.avatar = function avatar(user, size) {
  return SP.el('span.avatar', {
    class: size ? `avatar--${size}` : '',
    dataset: { role: user?.role || 'viewer' },
    title: user?.name || 'Unknown',
  }, SP.fmt.initials(user?.name || '?'));
};