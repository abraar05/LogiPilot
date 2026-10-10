/**
 * modules/delivery.js — delivery workspace: dispatch queue (awaiting
 * assignment), active runs, handover with proof of delivery, failures.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.delivery = (() => {
  const MOD = { title: 'Delivery', subtitle: () => `${SP.fmt.pluralise(SP.store.state.orders.filter((o) => o.status === 'out_for_delivery').length, 'parcel')} on the road`, mount, perm: 'orders:view' };

  function mount(params) {
    const root = SP.el('div.stack.gap-3');
    const uid = SP.auth.current()?.id;
    const canAssign = SP.auth.can('assign:delivery');
    const canDeliver = SP.auth.can('deliver:perform');
    const s = SP.store.state;

    root.appendChild(SP.ui2.pageHead({
      title: 'Delivery',
      sub: 'Driver carries, delivery staff hands over — both recorded.',
      actions: [SP.ui2.scanButton({ onOrder: (o) => runSheet(o.id), label: 'Scan parcel' })],
    }));

    if (params?.id) runSheet(params.id);

    /* awaiting dispatch (QC approved, needs driver + delivery assignment) */
    const toDispatch = s.orders.filter((o) => o.status === 'qc_approved');
    if (toDispatch.length) {
      root.appendChild(SP.el('section.section',
        SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Awaiting dispatch'), SP.el('p', 'QC passed — assign driver and delivery staff'))),
        SP.el('div.stack.gap-2', ...toDispatch.map((o) => SP.ui2.orderCard(o, {
          onClick: () => SP.modules.orders.openOrder(o.id),
          actions: canAssign ? [SP.el('button.btn.btn--sm.btn--primary', {
            type: 'button', onclick: (e) => { e.stopPropagation(); assignDelivery(o); },
          }, 'Assign & dispatch')] : [],
        })))));
    }

    /* on the road */
    const onRoad = s.orders.filter((o) => o.status === 'out_for_delivery');
    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'On the road'), SP.el('p', `${onRoad.length} active run${onRoad.length === 1 ? '' : 's'}`))),
      onRoad.length
        ? SP.el('div.stack.gap-2', ...onRoad.map((o) => {
          const mine = o.deliveryId === uid || o.driverId === uid;
          return SP.ui2.orderCard(o, {
            onClick: () => runSheet(o.id),
            actions: canDeliver && (mine || ['admin', 'supervisor'].includes(SP.auth.roleOf(SP.auth.current())))
              ? [SP.el('button.btn.btn--sm.btn--primary', { type: 'button', onclick: (e) => { e.stopPropagation(); runSheet(o.id); } }, mine ? 'My run' : 'Open')]
              : [SP.ui2.tag(mine ? 'Your run' : `${SP.ui2.userName(o.deliveryId) || '—'}`, mine ? 'brand' : 'mute')],
          });
        }))
        : SP.el('div.card.card--pad', SP.el('p.tiny.mute', 'No parcels on the road.'))));

    /* failed — needs a decision */
    const failed = s.orders.filter((o) => o.status === 'failed');
    if (failed.length) {
      root.appendChild(SP.el('section.section',
        SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Failed deliveries'), SP.el('p', 'Retry, return or cancel'))),
        SP.el('div.stack.gap-2', ...failed.map((o) => SP.ui2.orderCard(o, {
          onClick: () => runSheet(o.id),
          actions: canDeliver ? [SP.el('button.btn.btn--sm.btn--primary', { type: 'button', onclick: (e) => { e.stopPropagation(); runSheet(o.id); } }, SP.icon('refresh'), SP.t('act.resolve'))] : [],
        })))));
    }
    return root;
  }

  /* ────────────────────────────────────────── assignment shortcut */

  async function assignDelivery(o) {
    const driver = SP.ui2.staffPicker('driver', { value: o.driverId });
    const del = SP.ui2.staffPicker('delivery', { value: o.deliveryId });
    const r = await SP.modal({
      title: `Dispatch ${o.ref}`, icon: 'truck', okLabel: 'Dispatch',
      body: SP.el('div.stack.gap-2',
        SP.el('label.field', SP.el('span.field__label', 'Driver'), driver),
        SP.el('label.field', SP.el('span.field__label', 'Delivery staff'), del)),
      onOk: async () => {
        if (!driver.value || !del.value) throw new Error('Choose both driver and delivery staff.');
        SP.orders.assign(o.id, 'driverId', driver.value);
        SP.orders.assign(o.id, 'deliveryId', del.value);
        SP.orders.transition(o.id, 'out_for_delivery');
        SP.ui.toast({ tone: 'ok', title: `${o.ref} dispatched` });
      },
    });
    if (r) SP.router.refresh();
  }

  /* ──────────────────────────────────────────────── run sheet */

  function runSheet(orderId) {
    const o = SP.orders.byId(orderId);
    if (!o) return;
    const canDeliver = SP.auth.can('deliver:perform');

    const actions = [];
    if (canDeliver && ['out_for_delivery', 'failed'].includes(o.status)) {
      actions.push(SP.el('button.btn.btn--ok.btn--lg', {
        type: 'button', onclick: () => deliver(o),
      }, SP.icon('camera'), SP.t('act.delivered')));
      actions.push(SP.el('button.btn.btn--danger', {
        type: 'button', onclick: () => fail(o),
      }, SP.icon('alert'), SP.t('act.failed')));
      if (o.status === 'failed') {
        actions.push(SP.el('button.btn.btn--ghost', {
          type: 'button', onclick: async () => {
            SP.orders.transition(o.id, 'out_for_delivery', { note: 'Re-attempting delivery' });
            SP.ui.toast({ tone: 'ok', title: 'Back on the road' });
          },
        }, SP.icon('refresh'), SP.t('act.retry')));
        actions.push(SP.el('button.btn.btn--ghost', {
          type: 'button',
          onclick: async () => {
            const r = await SP.modal({ title: `Return ${o.ref} to the warehouse?`, tone: 'danger', okLabel: 'Mark returned', fields: [{ key: 'note', label: 'Reason', required: true }] });
            if (r) { SP.orders.transition(o.id, 'returned', { note: r.note }); SP.ui.toast({ tone: 'ok', title: 'Marked returned' }); }
          },
        }, SP.icon('logout'), SP.t('act.return')));
      }
    }
    if (o.cod?.amount && !o.codCollected && canDeliver) {
      actions.push(SP.el('button.btn.btn--ghost', {
        type: 'button',
        onclick: async () => {
          const r = await SP.modal({
            title: `Collect ${SP.i18n.money(o.cod.amount)} — ${o.ref}`, icon: 'key', okLabel: SP.t('act.collect_cod'),
            fields: [{ key: 'amount', label: 'Amount received', type: 'number', min: 0, value: o.cod.amount }],
            onOk: async (v) => {
              SP.orders.collectCOD(o.id, v.amount);
              SP.store.update(['orders'], (s) => { const t = s.orders.find((x) => x.id === o.id); t.codCollected = true; });
              SP.store.notify({ tone: 'ok', title: 'COD recorded', body: `${o.ref} · ${SP.i18n.money(v.amount)}` });
              SP.router.refresh();
            },
          });
          return r;
        },
      }, SP.icon('key'), SP.t('act.collect_cod')));
    }
    actions.push(SP.el('button.btn.btn--ghost', {
      type: 'button', onclick: () => printReceipt(o),
    }, SP.icon('print'), SP.t('act.receipt')));
    actions.push(SP.el('button.btn.btn--ghost', {
      type: 'button',
      onclick: () => {
        const addr = o.customer.address || '';
        const q = encodeURIComponent(addr || o.customer.name);
        window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank', 'noopener');
      },
    }, SP.icon('pin'), SP.t('act.map')));

    SP.sheet({
      title: `Run ${o.ref}`,
      subtitle: `${o.customer.name} · ${o.customer.phone || 'no phone'}`,
      content: SP.el('div.stack.gap-3',
        SP.el('div.row.gap-2', { style: { alignItems: 'center', flexWrap: 'wrap' } },
          SP.ui2.badge(o.status),
          SP.ui2.tag(`Driver: ${SP.ui2.userName(o.driverId) || '—'}`, 'mute'),
          SP.ui2.tag(`Delivery: ${SP.ui2.userName(o.deliveryId) || '—'}`, 'mute')),
        SP.el('div.card.card--pad',
          SP.el('strong', { style: { display: 'block', marginBottom: '6px' } }, 'Deliver to'),
          SP.el('p', o.customer.name),
          o.customer.phone ? SP.el('p', SP.el('a.btn.btn--sm.btn--ghost', { href: `tel:${o.customer.phone}` }, SP.icon('truck'), `Call ${o.customer.phone}`)) : null,
          o.customer.address ? SP.el('p.tiny', o.customer.address) : null),
        SP.el('div',
          SP.el('strong', { style: { display: 'block', marginBottom: '6px' } }, `Parcels (${o.items.length})`),
          SP.el('div.stack.gap-1', ...o.items.map((i) => SP.el('div.lrow',
            SP.el('span.lrow__ico', SP.icon('box')),
            SP.el('div.lrow__main', SP.el('strong', i.name), SP.el('small', i.sku || '')),
            SP.el('span.lrow__val', `×${i.qty}`))))),
        SP.el('div',
          SP.el('strong', { style: { display: 'block', marginBottom: '6px' } }, 'Proofs'),
          SP.ui2.proofStrip(o.id)),
      ),
      actions,
    });
  }

  async function deliver(o) {
    try {
      const proof = SP.store.state.settings.deliveryRequiresPhoto
        ? await SP.photo.captureProof({ order: o, stage: 'delivered' })
        : null;
      if (SP.store.state.settings.deliveryRequiresPhoto && !proof) return;
      SP.orders.transition(o.id, 'delivered', { proofId: proof?.id, note: 'Handed over with photo proof' });
      SP.ui.toast({ tone: 'ok', title: `${o.ref} delivered`, body: 'Chain complete. Well done.' });
      SP.router.refresh();
    } catch (e) { SP.ui.toast({ tone: 'danger', title: e.message }); }
  }

  async function fail(o) {
    const r = await SP.modal({
      title: `Delivery failed — ${o.ref}`, icon: 'alert', tone: 'danger', okLabel: 'Record failure',
      fields: [
        { key: 'note', label: 'Reason', type: 'select', required: true, options: [
          { value: 'Customer unreachable', label: 'Customer unreachable' },
          { value: 'Address not found', label: 'Address not found' },
          { value: 'Customer refused', label: 'Customer refused the parcel' },
          { value: 'Vehicle breakdown', label: 'Vehicle breakdown' },
          { value: 'Other', label: 'Other' },
        ] },
        { key: 'detail', label: 'Detail', type: 'textarea' },
        { key: 'photo', label: 'Evidence', type: 'checkbox', checkboxLabel: 'Capture photo evidence', value: false },
      ],
      onOk: async (v) => {
        let proof = null;
        if (v.photo) proof = await SP.photo.captureProof({ order: o, stage: 'failed', note: v.note });
        SP.orders.transition(o.id, 'failed', { proofId: proof?.id, note: `${v.note}${v.detail ? ` — ${v.detail}` : ''}` });
      },
    });
    if (r) { SP.ui.toast({ tone: 'warn', title: `${o.ref} marked failed` }); SP.router.refresh(); }
  }

  /** Printable delivery receipt with the customer's signature line. */
  function printReceipt(o) {
    const s = SP.store.state;
    const rowsHtml = o.items.map((i) => `<tr><td>${SP.esc(i.name)}</td><td>${SP.esc(i.sku || '—')}</td><td style="text-align:right">${i.qty}</td></tr>`).join('');
    printDoc(`Delivery Receipt ${o.ref}`, `${o.customer.name} · ${SP.fmt.dateTime(Date.now())}`, `
      <p><strong>Delivered to:</strong> ${SP.esc(o.customer.name)} ${SP.esc(o.customer.phone ? `· ${o.customer.phone}` : '')}<br>
      ${SP.esc(o.customer.address || '')}</p>
      <table class="printdoc__table"><thead><tr><th>Item</th><th>SKU</th><th style="text-align:right">Qty</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      ${o.cod?.amount ? `<p><strong>Cash on delivery:</strong> ${SP.esc(SP.i18n.money(o.cod.amount))}${o.codCollected ? ' — collected' : ' — DUE'}</p>` : ''}
      <p style="margin-top:26px">Delivered by: ${SP.esc(SP.ui2.userName(o.deliveryId) || '')} · Driver: ${SP.esc(SP.ui2.userName(o.driverId) || '')}</p>
      <div style="display:flex;gap:60px;margin-top:40px"><span>Received by: ______________</span><span>Date: ______________</span></div>`);
  }

  function printDoc(title, sub, bodyHtml) {
    const doc = SP.el('div.printdoc', { html: `
      <div class="printdoc__head"><div><strong>${SP.esc(title)}</strong><div class="printdoc__sub">${SP.esc(sub)}</div></div>
      <div class="printdoc__meta">${SP.esc(sName())}<br>${SP.fmt.dateTime(Date.now())}</div></div>
      <div class="printdoc__body">${bodyHtml}</div>` });
    document.body.appendChild(doc);
    document.body.classList.add('is-printing');
    const cleanup = () => { document.body.classList.remove('is-printing'); doc.remove(); removeEventListener('afterprint', cleanup); };
    addEventListener('afterprint', cleanup);
    setTimeout(() => { window.print(); setTimeout(cleanup, 1500); }, 60);
  }
  const sName = () => SP.store.state.settings.company.name || 'LogiPilot';

  return MOD;
})();
