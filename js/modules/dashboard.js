/**
 * modules/dashboard.js — the operations overview: queues, workload,
 * today's throughput and alerts.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.dashboard = (() => {
  const MOD = { title: 'Dashboard', subtitle: () => `${SP.fmt.pluralise(SP.orders.queues().active.length, 'active order')} in the pipeline`, mount };

  function mount() {
    const root = SP.el('div.stack.gap-4');
    const s = SP.store.state;
    const uid = SP.auth.current()?.id;
    const q = SP.orders.queues();

    /* ── KPIs ─────────────────────────────────────────────────────── */
    const dayStart = new Date().setHours(0, 0, 0, 0);
    const packedToday = s.audit.filter((a) => a.action === 'order.packed' && a.at >= dayStart).length;
    const qcToday = s.audit.filter((a) => ['order.qc_approved', 'order.qc_rejected'].includes(a.action) && a.at >= dayStart).length;
    const failed = s.orders.filter((o) => o.status === 'failed').length;
    const late = s.orders.filter((o) => o.dueAt && o.dueAt < Date.now() && !['delivered', 'cancelled', 'returned'].includes(o.status)).length;

    if (s.settings.demo) {
      root.appendChild(SP.el('div.callout', { dataset: { tone: 'warn' } },
        SP.el('span.callout__ico', SP.icon('info')),
        SP.el('div.callout__body',
          SP.el('strong', 'DEMO DATA'),
          SP.el('p', 'You are exploring a generated workspace. Photo proofs are labelled placeholders, not real photos. Wipe it in Settings → Backup & data when you are ready to go live.'))));
    }

    root.appendChild(SP.el('div.kpi-grid',
      SP.ui2.kpi({ label: 'To pack', value: SP.fmt.n(q.toPack.length), icon: 'box', tone: q.toPack.length ? 'warn' : null, onClick: () => SP.router.go('packing') }),
      SP.ui2.kpi({ label: 'QC queue', value: SP.fmt.n(q.qcQueue.length), icon: 'checkCircle', tone: q.qcQueue.length ? 'warn' : null, onClick: () => SP.router.go('qc') }),
      SP.ui2.kpi({ label: 'Out for delivery', value: SP.fmt.n(s.orders.filter((o) => o.status === 'out_for_delivery').length), icon: 'truck', onClick: () => SP.router.go('delivery') }),
      SP.ui2.kpi({ label: 'Delivered today', value: SP.fmt.n(q.doneToday.length), icon: 'check', tone: q.doneToday.length ? 'ok' : null, onClick: () => SP.router.go('orders', { status: 'delivered' }) }),
      SP.ui2.kpi({ label: 'Packed today', value: SP.fmt.n(packedToday), icon: 'box' }),
      SP.ui2.kpi({ label: 'QC decisions today', value: SP.fmt.n(qcToday), icon: 'checkCircle' }),
      SP.ui2.kpi({ label: 'Failed deliveries', value: SP.fmt.n(failed), icon: 'alert', tone: failed ? 'danger' : null, onClick: () => SP.router.go('orders', { status: 'failed' }) }),
      SP.ui2.kpi({ label: 'Late orders', value: SP.fmt.n(late), icon: 'clock', tone: late ? 'danger' : null }),
    ));

    /* ── my work ──────────────────────────────────────────────────── */
    const myPacking = q.toPack.filter((o) => o.packerId === uid);
    const myQc = q.qcQueue.filter((o) => o.qcId === uid);
    const myDel = q.myDeliveries;
    if (myPacking.length || myQc.length || myDel.length) {
      root.appendChild(SP.el('section.section',
        SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'My work'), SP.el('p', 'Assigned to you right now'))),
        SP.el('div.stack.gap-2',
          ...myPacking.slice(0, 3).map((o) => SP.ui2.orderCard(o, { onClick: () => SP.router.go('packing', { id: o.id }) })),
          ...myQc.slice(0, 3).map((o) => SP.ui2.orderCard(o, { onClick: () => SP.router.go('qc', { id: o.id }) })),
          ...myDel.slice(0, 3).map((o) => SP.ui2.orderCard(o, { onClick: () => SP.router.go('delivery', { id: o.id }) })))));
    }

    /* ── pipeline snapshot ────────────────────────────────────────── */
    const stages = [
      { label: 'New', count: s.orders.filter((o) => o.status === 'new').length, color: '#94a3b8' },
      { label: 'Packing', count: s.orders.filter((o) => ['assigned', 'packing', 'qc_rejected'].includes(o.status)).length, color: '#5b8cff' },
      { label: 'QC', count: q.qcQueue.length, color: '#fbbf24' },
      { label: 'Delivery', count: s.orders.filter((o) => ['qc_approved', 'out_for_delivery'].includes(o.status)).length, color: '#fb923c' },
      { label: 'Delivered', count: s.orders.filter((o) => o.status === 'delivered').length, color: '#34d399' },
    ];
    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Pipeline'), SP.el('p', 'Orders by stage'))),
      SP.el('div.card.card--pad',
        SP.charts ? SP.charts.hbars({ data: stages.map((x) => ({ label: x.label, value: x.count, colour: x.color })) }) : null,
        SP.el('div.legend',
          ...stages.map((x) => SP.el('span.legend__item', SP.el('i', { style: { background: x.color } }), `${x.label} ${x.count}`))))));

    /* ── staff workload ───────────────────────────────────────────── */
    const workload = s.users.filter((u) => u.active).map((u) => ({
      u,
      packing: s.orders.filter((o) => o.packerId === u.id && ['assigned', 'packing', 'qc_rejected'].includes(o.status)).length,
      qc: s.orders.filter((o) => o.qcId === u.id && o.status === 'packed').length,
      delivering: s.orders.filter((o) => (o.deliveryId === u.id || o.driverId === u.id) && o.status === 'out_for_delivery').length,
    })).filter((w) => w.packing || w.qc || w.delivering);
    if (workload.length) {
      root.appendChild(SP.el('section.section',
        SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Staff workload'), SP.el('p', 'Open assignments per person'))),
        SP.el('div.stack.gap-1', ...workload.map((w) => SP.el('div.lrow',
          SP.avatar(w.u),
          SP.el('div.lrow__main', SP.el('strong', w.u.name), SP.el('small', SP.auth.roleDef(w.u.role).label)),
          SP.el('div.lrow__end.tiny',
            [w.packing && `${w.packing} packing`, w.qc && `${w.qc} QC`, w.delivering && `${w.delivering} delivering`].filter(Boolean).join(' · ')))))));
    }

    /* ── recent activity ──────────────────────────────────────────── */
    const recent = s.audit.filter((a) => a.action.startsWith('order.') || a.action.startsWith('proof.')).slice(0, 10);
    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Recent activity')),
        SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => SP.router.go('audit') }, 'Audit log')),
      SP.el('div.card.card--pad', SP.ui2.timeline(recent.map((a) => ({
        at: a.at, title: a.detail ? `${a.target} — ${a.detail}` : a.target, meta: `${a.action} · ${a.by}`,
        tone: a.action.includes('rejected') || a.action.includes('failed') ? 'danger' : a.action.includes('delivered') || a.action.includes('approved') ? 'ok' : 'info',
      }))))));

    return root;
  }

  return MOD;
})();
