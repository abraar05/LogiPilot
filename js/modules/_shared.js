/**
 * modules/_shared.js — cross-module widgets for LogiPilot.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.ui2 = (() => {

  function badge(id, opts = {}) {
    const s = SP.statusOf(id);
    return SP.el('span.tag', { class: `tag--${s.tone}${opts.sm ? ' tag--sm' : ''}` }, s.label);
  }
  function tag(label, tone = 'mute') { return SP.el('span.tag', { class: `tag--${tone}` }, label); }

  function kpi({ label, value, sub, tone, icon, onClick }) {
    return SP.el(onClick ? 'button.kpi' : 'div.kpi', {
      type: onClick ? 'button' : null, onclick: onClick,
      class: tone ? `kpi--${tone}` : '',
    },
      SP.el('div.kpi__top', SP.el('span.kpi__label', label), icon ? SP.el('span.kpi__ico', SP.icon(icon)) : null),
      SP.el('div.kpi__value', value),
      sub ? SP.el('div.kpi__sub', sub) : null);
  }

  function pageHead({ title, sub, actions = [] }) {
    return SP.el('div.phead',
      SP.el('div.grow', SP.el('h1.phead__title', title), sub ? SP.el('p.phead__sub', sub) : null),
      SP.el('div.phead__actions', ...actions.filter(Boolean)));
  }

  const userName = (id) => SP.store.state.users.find((u) => u.id === id)?.name || null;

  /** Compact order card used across queues. */
  function orderCard(order, { onClick, actions = [] } = {}) {
    const units = SP.sum(order.items, (i) => i.qty);
    const proofs = SP.photo.forOrder(order.id).length;
    return SP.el('div.ocard', { class: order.priority === 'urgent' ? 'ocard--urgent' : '' },
      SP.el('button.ocard__main', { type: 'button', onclick: () => onClick?.(order) },
        SP.el('div.ocard__top',
          SP.el('strong', order.ref),
          badge(order.status, { sm: true })),
        SP.el('div.ocard__cust', order.customer.name),
        SP.el('div.ocard__meta',
          SP.el('span', `${SP.fmt.pluralise(units, 'unit')}`),
          order.customer.phone ? SP.el('span', order.customer.phone) : null,
          proofs ? SP.el('span', `${proofs} proof${proofs === 1 ? '' : 's'}`) : null,
          order.packerId ? SP.el('span', `P: ${userName(order.packerId) || '—'}`) : null,
          order.deliveryId ? SP.el('span', `D: ${userName(order.deliveryId) || '—'}`) : null),
        order.dueAt ? SP.el('div.ocard__due', { class: order.dueAt < Date.now() ? 'is-late' : '' },
          SP.icon('clock'), `Due ${SP.fmt.date(order.dueAt)}`) : null),
      actions.length ? SP.el('div.ocard__actions', ...actions) : null);
  }

  /** Timeline from order history. */
  function timeline(items) {
    const wrap = SP.el('div.tline');
    for (const it of items) {
      wrap.appendChild(SP.el('div.tline__item',
        SP.el('span.tline__dot', { class: it.tone ? `tline__dot--${it.tone}` : '' }),
        SP.el('div.tline__body',
          SP.el('div.tline__head', SP.el('strong', it.title), SP.el('span.tiny.mute', SP.fmt.dateTime(it.at))),
          it.body ? SP.el('p.tline__text', it.body) : null,
          it.meta ? SP.el('p.tiny.mute', it.meta) : null)));
    }
    if (!items.length) wrap.appendChild(SP.empty({ icon: 'history', title: 'No history yet' }));
    return wrap;
  }

  /** Staff picker filtered by role. */
  function staffPicker(role, { label, value } = {}) {
    const staff = SP.auth.byRole(role);
    return SP.el('select.select', { name: label || role },
      SP.el('option', { value: '', selected: !value }, '— choose —'),
      ...staff.map((u) => SP.el('option', { value: u.id, selected: value === u.id }, `${u.name}${u.phone ? ` · ${u.phone}` : ''}`)));
  }

  /** Scan button that resolves and navigates. */
  function scanButton({ onOrder, onItem, label = 'Scan' } = {}) {
    return SP.el('button.btn.btn--ghost.btn--sm', {
      type: 'button',
      onclick: async () => {
        const code = await SP.scan.open();
        if (!code) return;
        const hit = SP.scan.resolve(code);
        if (hit.kind === 'order') onOrder?.(hit.order);
        else if (hit.kind === 'item') onItem?.(hit.order, hit.item);
        else SP.ui.toast({ tone: 'warn', title: 'Unknown code', body: `"${code}" matches no order or item.` });
      },
    }, SP.icon('target'), label);
  }

  /** Proof gallery strip. */
  function proofStrip(orderId) {
    const proofs = SP.photo.forOrder(orderId);
    if (!proofs.length) return SP.el('p.tiny.mute', 'No photo proofs yet.');
    return SP.el('div.proofstrip', ...proofs.map((p) => SP.el('button.proofstrip__item', {
      type: 'button',
      onclick: () => viewProof(p),
    },
      SP.el('img', { src: p.dataUrl, alt: `Proof ${p.ref}`, loading: 'lazy' }),
      SP.el('span.proofstrip__cap', `${SP.statusOf(p.stage).label || p.stage}`))));
  }

  function viewProof(p) {
    SP.sheet({
      title: `Proof ${p.ref}`,
      subtitle: `${p.orderRef} · ${SP.statusOf(p.stage).label || p.stage}`,
      content: SP.el('div.stack.gap-2',
        SP.el('img.proofview', { src: p.dataUrl, alt: `Proof ${p.ref}` }),
        SP.el('dl.kv',
          SP.el('dt', 'Submitted by'), SP.el('dd', `${p.byName} (${SP.auth.roleDef(p.role).label})`),
          SP.el('dt', 'Captured'), SP.el('dd', SP.fmt.dateTime(p.at)),
          SP.el('dt', 'GPS'), SP.el('dd', p.stamp.gps ? `${p.stamp.gps.lat.toFixed(5)}, ${p.stamp.gps.lng.toFixed(5)} (±${p.stamp.gps.acc}m)` : 'Unavailable'),
          SP.el('dt', 'Device'), SP.el('dd', p.stamp.device || '—'),
          SP.el('dt', 'Integrity'), SP.el('dd', 'Immutable — proofs cannot be edited or deleted through the app'),
          p.note ? [SP.el('dt', 'Note'), SP.el('dd', p.note)] : null)),
      actions: [
        SP.el('button.btn.btn--ghost', { type: 'button', onclick: () => { const a = SP.el('a', { href: p.dataUrl, download: `${p.ref}.jpg` }); a.click(); } }, SP.icon('download'), 'Download'),
      ],
    });
  }

  return { badge, tag, kpi, pageHead, orderCard, timeline, staffPicker, scanButton, proofStrip, viewProof, userName };
})();
