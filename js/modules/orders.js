/**
 * modules/orders.js — sales order list, creation, and the order detail
 * page with the complete pack → QC → deliver chain, assignments and proofs.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.orders = (() => {
  const state = { q: '', status: 'all' };

  const MOD = { title: 'Orders', subtitle: () => `${SP.fmt.pluralise(SP.store.state.orders.length, 'sales order')}`, mount, openOrder, createForm, printSlip };

  function rows() {
    let list = [...SP.store.state.orders].sort((a, b) => b.createdAt - a.createdAt);
    if (state.status !== 'all') list = list.filter((o) => o.status === state.status);
    if (state.q) list = list.filter((o) => `${o.ref} ${o.customer.name} ${o.customer.phone} ${o.items.map((i) => i.name).join(' ')}`.toLowerCase().includes(state.q));
    return list;
  }

  function mount(params) {
    if (params?.status) state.status = params.status;
    if (params?.id) setTimeout(() => openOrder(params.id), 80);
    const root = SP.el('div.stack.gap-3');

    const table = SP.table.create({
      columns: [
        { key: 'ref', label: 'Order', width: '110px', value: (o) => o.ref, render: (o) => SP.el('div.stack', SP.el('strong', o.ref), SP.el('small.mute', SP.fmt.date(o.createdAt))) },
        { key: 'customer', label: 'Customer', value: (o) => o.customer.name, render: (o) => SP.el('div.stack', SP.el('span', o.customer.name), SP.el('small.mute', o.customer.phone || '')) },
        { key: 'units', label: 'Units', width: '70px', align: 'right', value: (o) => SP.sum(o.items, (i) => i.qty), render: (o) => SP.fmt.n(SP.sum(o.items, (i) => i.qty)) },
        { key: 'packer', label: 'Packer', width: '110px', value: (o) => SP.ui2.userName(o.packerId) || '', render: (o) => SP.ui2.userName(o.packerId) || SP.el('span.mute', '—') },
        { key: 'delivery', label: 'Delivery', width: '110px', value: (o) => SP.ui2.userName(o.deliveryId) || '', render: (o) => SP.ui2.userName(o.deliveryId) || SP.el('span.mute', '—') },
        { key: 'status', label: 'Status', width: '170px', value: (o) => o.status, render: (o) => SP.ui2.badge(o.status, { sm: true }) },
      ],
      rows,
      rowId: (o) => o.id,
      defaultSort: 'ref', defaultDir: 'desc',
      empty: { icon: 'file', title: 'No orders', body: 'Create a sales order to start the chain.' },
      onRowClick: (o) => openOrder(o.id),
    });

    const search = SP.el('div.searchbar', SP.icon('search'),
      SP.el('input.input', { type: 'search', placeholder: 'Search ref, customer, item…', oninput: SP.debounce((e) => { state.q = e.target.value.trim().toLowerCase(); table.refresh(); }, 160) }));

    const chips = SP.chipRow(
      [{ value: 'all', label: 'All' }, ...SP.ORDER_STATUS.map((s) => ({ value: s.id, label: s.label }))],
      state.status, (v) => { state.status = v; table.refresh(); });

    const actions = [];
    if (SP.auth.can('orders:create')) actions.push(SP.el('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => createForm() }, SP.icon('plus'), 'New S/O'));
    actions.push(SP.ui2.scanButton({ onOrder: (o) => openOrder(o.id) }));
    if (SP.auth.can('orders:export')) actions.push(SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => exportCsv(rows()) }, SP.icon('download'), 'Export'));

    root.append(
      SP.ui2.pageHead({ title: 'Orders', sub: 'Every sales order, from intake to proven delivery.', actions }),
      search, chips, table.el,
    );
    return root;
  }

  /* ══════════════════════════════════════════════════════════ CREATE */

  function createForm() {
    const items = [{ name: '', sku: '', qty: 1, barcode: '' }];
    const itemsHost = SP.el('div.stack.gap-1');
    const draw = () => {
      SP.clear(itemsHost);
      items.forEach((it, idx) => {
        itemsHost.appendChild(SP.el('div.sale-line',
          SP.el('div.grow',
            SP.el('input.input', { placeholder: 'Item name *', value: it.name, oninput: (e) => { it.name = e.target.value; } }),
            SP.el('div.row.gap-2', { style: { marginTop: '4px' } },
              SP.el('input.input', { placeholder: 'SKU / barcode', value: it.sku, style: { flex: 2 }, oninput: (e) => { it.sku = e.target.value; it.barcode = e.target.value; } }),
              SP.el('input.input.input--num', { type: 'number', min: 1, value: it.qty, style: { flex: 1 }, onchange: (e) => { it.qty = Math.max(1, Number(e.target.value) || 1); } }))),
          SP.el('button.btn.btn--icon.btn--sm.btn--quiet', { type: 'button', 'aria-label': 'Remove', onclick: () => { items.splice(idx, 1); draw(); } }, SP.icon('x'))));
      });
      itemsHost.appendChild(SP.el('div.row.gap-2',
        SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => { items.push({ name: '', sku: '', qty: 1, barcode: '' }); draw(); } }, SP.icon('plus'), 'Add item'),
        SP.el('button.btn.btn--quiet.btn--sm', {
          type: 'button',
          onclick: async () => {
            const code = await SP.scan.open({ title: 'Scan item barcode' });
            if (code) { items.push({ name: code, sku: code, qty: 1, barcode: code }); draw(); }
          },
        }, SP.icon('target'), 'Scan item')));
    };
    draw();

    return SP.modal({
      title: 'New sales order', icon: 'file', okLabel: 'Create order', draftId: 'so-new',
      body: SP.el('div.stack.gap-2', SP.el('strong', { class: 'tiny mute' }, 'ITEMS'), itemsHost),
      fields: [
        { key: 'customer', label: 'Customer name', required: true },
        { key: 'phone', label: 'Phone', inputmode: 'tel' },
        { key: 'address', label: 'Delivery address', type: 'textarea' },
        { key: 'priority', label: 'Priority', type: 'select', value: 'normal', options: [{ value: 'normal', label: 'Normal' }, { value: 'urgent', label: 'Urgent' }] },
        { key: 'dueAt', label: 'Due date', type: 'date' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onOk: async (v) => {
        const order = SP.orders.createOrder({
          customer: { name: v.customer, phone: v.phone, address: v.address },
          items: items.filter((i) => i.name.trim()),
          priority: v.priority,
          dueAt: v.dueAt ? Date.parse(v.dueAt) : null,
          notes: v.notes || '',
        });
        SP.ui.toast({ tone: 'ok', title: `Order ${order.ref} created`, body: 'Assign a packer to begin.' });
        SP.router.refresh();
        openOrder(order.id);
      },
    });
  }

  /* ══════════════════════════════════════════════════════════ DETAIL */

  function openOrder(id) {
    const o = SP.orders.byId(id);
    if (!o) { SP.ui.toast({ tone: 'warn', title: 'Order not found' }); return; }

    const actions = [];
    const btn = (label, icon, perm, run, danger) => {
      if (perm && !SP.auth.can(perm)) return;
      actions.push(SP.el('button.btn', { type: 'button', class: danger ? 'btn--danger' : 'btn--primary', onclick: () => run(o) }, icon ? SP.icon(icon) : null, label));
    };

    // stage-relevant actions
    if (['new'].includes(o.status)) {
      btn('Assign packer', 'users', 'assign:packer', (x) => assignDialog(x, 'packerId', 'packer'));
    }
    if (['assigned', 'packing', 'qc_rejected'].includes(o.status) && !o.packerId) {
      btn('Assign packer', 'users', 'assign:packer', (x) => assignDialog(x, 'packerId', 'packer'));
    }
    if (o.status === 'packed' && !o.qcId) {
      btn('Assign QC', 'checkCircle', 'assign:qc', (x) => assignDialog(x, 'qcId', 'approver'));
    }
    if (o.status === 'qc_approved') {
      btn('Assign delivery', 'truck', 'assign:delivery', (x) => assignDeliveryDialog(x));
    }
    btn('Print packing slip', 'print', null, (x) => printSlip(x));
    if (!['delivered', 'cancelled', 'returned'].includes(o.status)) {
      btn('Cancel order', 'x', 'orders:cancel', async (x) => {
        const r = await SP.modal({ title: `Cancel ${x.ref}?`, tone: 'danger', okLabel: 'Cancel order', fields: [{ key: 'note', label: 'Reason', required: true }] });
        if (r) { SP.orders.transition(x.id, 'cancelled', { note: r.note }); SP.ui.toast({ tone: 'ok', title: 'Order cancelled' }); }
      }, true);
    }

    const units = SP.sum(o.items, (i) => i.qty);
    const packedUnits = SP.sum(o.items, (i) => i.packedQty);

    SP.sheet({
      title: `Order ${o.ref}`,
      subtitle: `${o.customer.name} · created ${SP.fmt.dateTime(o.createdAt)}`,
      content: SP.el('div.stack.gap-3',
        SP.el('div.row.gap-2', { style: { alignItems: 'center', flexWrap: 'wrap' } },
          SP.ui2.badge(o.status),
          o.priority === 'urgent' ? SP.ui2.tag('URGENT', 'danger') : null,
          o.dueAt ? SP.ui2.tag(`Due ${SP.fmt.date(o.dueAt)}`, o.dueAt < Date.now() && o.status !== 'delivered' ? 'danger' : 'mute') : null),
        SP.el('dl.kv',
          SP.el('dt', 'Customer'), SP.el('dd', o.customer.name),
          o.customer.phone ? [SP.el('dt', 'Phone'), SP.el('dd', SP.el('a', { href: `tel:${o.customer.phone}` }, o.customer.phone))] : null,
          o.customer.address ? [SP.el('dt', 'Address'), SP.el('dd', o.customer.address)] : null,
          SP.el('dt', 'Packer'), SP.el('dd', SP.ui2.userName(o.packerId) || '—'),
          SP.el('dt', 'QC approver'), SP.el('dd', SP.ui2.userName(o.qcId) || '—'),
          SP.el('dt', 'Driver'), SP.el('dd', SP.ui2.userName(o.driverId) || '—'),
          SP.el('dt', 'Delivery staff'), SP.el('dd', SP.ui2.userName(o.deliveryId) || '—'),
          SP.el('dt', 'Order barcode'), SP.el('dd', SP.el('code.tiny', o.barcode || o.ref)),
          o.notes ? [SP.el('dt', 'Notes'), SP.el('dd', o.notes)] : null),
        SP.el('div',
          SP.el('div.row', { style: { justifyContent: 'space-between', alignItems: 'center' } },
            SP.el('strong', 'Items'),
            SP.el('span.tiny.mute', `${packedUnits}/${units} packed`)),
          SP.el('div.stack.gap-1', { style: { marginTop: '6px' } }, ...o.items.map((i) => SP.el('div.lrow',
            SP.el('span.lrow__ico', SP.icon(i.packedQty >= i.qty ? 'check' : 'box')),
            SP.el('div.lrow__main', SP.el('strong', i.name), SP.el('small', i.sku || '—')),
            SP.el('span.lrow__val', `${i.packedQty}/${i.qty}`))))),
        SP.el('div',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Photo proofs'),
          SP.ui2.proofStrip(o.id)),
        SP.el('div',
          SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Chain of custody'),
          SP.ui2.timeline(o.history.map((h) => ({
            at: h.at,
            title: SP.fmt.titleCase(h.action.replace(/_/g, ' ')),
            body: h.note || '',
            meta: `${h.by}${h.proofId ? ' · proof attached' : ''}`,
            tone: h.action.includes('reject') || h.action === 'failed' ? 'danger' : ['delivered', 'qc_approved'].includes(h.action) ? 'ok' : 'info',
          })))),
      ),
      actions,
    });
  }

  /* assignment dialogs */
  async function assignDialog(o, field, role) {
    const picker = SP.ui2.staffPicker(role, { value: o[field] });
    const r = await SP.modal({
      title: `Assign ${role === 'approver' ? 'QC approver' : role} — ${o.ref}`,
      icon: 'users', okLabel: 'Assign',
      body: picker,
      onOk: async () => {
        if (!picker.value) throw new Error('Choose a person.');
        SP.orders.assign(o.id, field, picker.value);
        SP.ui.toast({ tone: 'ok', title: 'Assigned' });
      },
    });
    if (r) SP.router.refresh();
  }

  async function assignDeliveryDialog(o) {
    const driver = SP.ui2.staffPicker('driver', { value: o.driverId });
    const del = SP.ui2.staffPicker('delivery', { value: o.deliveryId });
    const r = await SP.modal({
      title: `Assign delivery — ${o.ref}`, icon: 'truck', okLabel: 'Dispatch',
      body: SP.el('div.stack.gap-2',
        SP.el('label.field', SP.el('span.field__label', 'Driver'), driver),
        SP.el('label.field', SP.el('span.field__label', 'Delivery staff'), del)),
      onOk: async () => {
        if (!driver.value || !del.value) throw new Error('Choose both driver and delivery staff.');
        SP.orders.assign(o.id, 'driverId', driver.value);
        SP.orders.assign(o.id, 'deliveryId', del.value);
        SP.orders.transition(o.id, 'out_for_delivery', { skipPerm: !SP.auth.can('assign:delivery') });
        SP.ui.toast({ tone: 'ok', title: `${o.ref} out for delivery` });
      },
    });
    if (r) SP.router.refresh();
  }

  /* packing slip with scannable order code */
  function printSlip(o) {
    const rows = o.items.map((i) => [i.name, i.sku || '—', i.qty, '']);
    const html = `
      <table class="printdoc__table">
        <thead><tr><th>Item</th><th>SKU / Barcode</th><th>Qty</th><th>Packed ✓</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${SP.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <p style="font-size:18px;letter-spacing:3px;font-family:monospace;margin:12px 0">▌▍${SP.esc(o.barcode || o.ref)} ▍▌</p>
      <p>Customer: ${SP.esc(o.customer.name)} · ${SP.esc(o.customer.phone || '')}<br>${SP.esc(o.customer.address || '')}</p>
      <div style="display:flex;gap:60px;margin-top:40px"><span>Packed by: ____________</span><span>QC by: ____________</span><span>Received by: ____________</span></div>`;
    printDoc(`Packing Slip ${o.ref}`, `${SP.statusOf(o.status).label} · ${SP.fmt.dateTime(o.createdAt)}`, html);
  }

  function printDoc(title, sub, bodyHtml) {
    const doc = SP.el('div.printdoc', { html: `
      <div class="printdoc__head"><div><strong>${SP.esc(title)}</strong><div class="printdoc__sub">${SP.esc(sub)}</div></div>
      <div class="printdoc__meta">${SP.esc(SP.store.state.settings.company.name)}<br>${SP.fmt.dateTime(Date.now())}</div></div>
      <div class="printdoc__body">${bodyHtml}</div>` });
    document.body.appendChild(doc);
    document.body.classList.add('is-printing');
    const cleanup = () => { document.body.classList.remove('is-printing'); doc.remove(); removeEventListener('afterprint', cleanup); };
    addEventListener('afterprint', cleanup);
    setTimeout(() => { window.print(); setTimeout(cleanup, 1500); }, 60);
  }

  function exportCsv(list) {
    const rows = list.map((o) => ({
      ref: o.ref, date: new Date(o.createdAt).toISOString(), customer: o.customer.name, phone: o.customer.phone,
      units: SP.sum(o.items, (i) => i.qty), status: o.status,
      packer: SP.ui2.userName(o.packerId) || '', qc: SP.ui2.userName(o.qcId) || '',
      driver: SP.ui2.userName(o.driverId) || '', delivery: SP.ui2.userName(o.deliveryId) || '',
    }));
    SP.download(SP.toCSV(rows, ['ref', 'date', 'customer', 'phone', 'units', 'status', 'packer', 'qc', 'driver', 'delivery']),
      `logipilot-orders-${Date.now()}.csv`, 'text/csv');
    SP.store.audit('orders.export', `${list.length} rows`, '');
  }

  return MOD;
})();
