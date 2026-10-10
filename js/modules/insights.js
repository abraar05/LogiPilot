/**
 * modules/insights.js — operational analytics derived from order history:
 * throughput, stage cycle times, per-person performance, failure rate,
 * late orders and COD outstanding. All computed from real records.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.insights = (() => {
  const MOD = { title: 'Insights', subtitle: () => 'Performance measured from the chain', mount, perm: 'orders:view' };

  function mount() {
    const s = SP.store.state;
    const orders = s.orders;
    const H = 3600e3;
    const root = SP.el('div.stack.gap-4');

    root.appendChild(SP.ui2.pageHead({
      title: 'Insights',
      sub: 'How fast work moves, who does what, and where it fails.',
      actions: [SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: exportCsv }, SP.icon('download'), SP.t('act.export'))],
    }));

    /* ── time helpers on one order ─────────────────────────────── */
    const firstAt = (o, action) => o.history.find((h) => h.action === action)?.at ?? null;
    const lastAt = (o, action) => [...o.history].reverse().find((h) => h.action === action)?.at ?? null;

    const packMin = orders.map((o) => (firstAt(o, 'packed') !== null && o.createdAt ? (firstAt(o, 'packed') - o.createdAt) / H : null)).filter((x) => x !== null && x >= 0);
    const qcMin = orders.map((o) => (firstAt(o, 'packed') !== null && firstAt(o, 'qc_approved') !== null ? (firstAt(o, 'qc_approved') - firstAt(o, 'packed')) / H : null)).filter((x) => x !== null && x >= 0);
    const delMin = orders.map((o) => (firstAt(o, 'out_for_delivery') !== null && firstAt(o, 'delivered') !== null ? (firstAt(o, 'delivered') - firstAt(o, 'out_for_delivery')) / H : null)).filter((x) => x !== null && x >= 0);
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const fmtH = (v) => (v === null ? '—' : v < 1 ? `${Math.round(v * 60)}m` : `${v.toFixed(1)}h`);

    const delivered = orders.filter((o) => o.status === 'delivered');
    const failed = orders.filter((o) => o.status === 'failed');
    const rejected = orders.filter((o) => o.history.some((h) => h.action === 'qc_rejected'));
    const late = orders.filter((o) => o.dueAt && o.dueAt < Date.now() && o.status !== 'delivered');

    /* ── headline KPIs ─────────────────────────────────────────── */
    root.appendChild(SP.el('div.kpi-grid',
      SP.ui2.kpi({ label: 'Delivered', value: SP.fmt.n(delivered.length), icon: 'check', tone: 'ok' }),
      SP.ui2.kpi({ label: 'Avg pack → QC', value: fmtH(avg(packMin)), icon: 'box' }),
      SP.ui2.kpi({ label: 'Avg QC time', value: fmtH(avg(qcMin)), icon: 'checkCircle' }),
      SP.ui2.kpi({ label: 'Avg delivery', value: fmtH(avg(delMin)), icon: 'truck' }),
      SP.ui2.kpi({ label: 'QC rejection rate', value: orders.length ? SP.fmt.pct(rejected.length / orders.length * 100) : '—', icon: 'alert', tone: rejected.length ? 'warn' : null }),
      SP.ui2.kpi({ label: 'Delivery failures', value: SP.fmt.n(failed.length), icon: 'alert', tone: failed.length ? 'danger' : null }),
      SP.ui2.kpi({ label: 'Late orders', value: SP.fmt.n(late.length), icon: 'clock', tone: late.length ? 'danger' : null }),
      SP.ui2.kpi({ label: 'COD outstanding', value: SP.i18n.money(SP.orders.codDue()), icon: 'database' }),
    ));

    /* ── throughput by day ─────────────────────────────────────── */
    const days = 7;
    const labels = []; const packed = []; const deliveredCount = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const next = d.getTime() + 864e5;
      labels.push(d.toLocaleDateString('en-GB', { weekday: 'short' }));
      packed.push(orders.filter((o) => { const a = firstAt(o, 'packed'); return a && a >= d.getTime() && a < next; }).length);
      deliveredCount.push(orders.filter((o) => { const a = lastAt(o, 'delivered'); return a && a >= d.getTime() && a < next; }).length);
    }
    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Throughput'), SP.el('p', 'Last 7 days'))),
      SP.el('div.card.card--pad', SP.charts.lines({
        labels, height: 160,
        series: [
          { label: 'Packed', values: packed, colour: '#5b8cff' },
          { label: 'Delivered', values: deliveredCount, colour: '#34d399' },
        ],
      }))));

    /* ── per-person performance ────────────────────────────────── */
    const people = [];
    for (const u of s.users.filter((x) => x.active)) {
      const packedBy = orders.filter((o) => o.history.some((h) => h.action === 'packed' && h.by === u.name));
      const qcBy = orders.filter((o) => o.history.some((h) => ['qc_approved', 'qc_rejected'].includes(h.action) && h.by === u.name));
      const delBy = orders.filter((o) => o.history.some((h) => h.action === 'delivered' && h.by === u.name));
      if (packedBy.length || qcBy.length || delBy.length) {
        people.push({ u, packed: packedBy.length, qc: qcBy.length, delivered: delBy.length });
      }
    }
    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Team performance'), SP.el('p', 'Stage actions recorded per person'))),
      SP.el('div.card.card--pad',
        people.length
          ? SP.el('div.stack.gap-1', ...people.map((p) => SP.el('div.lrow',
            SP.avatar(p.u),
            SP.el('div.lrow__main', SP.el('strong', p.u.name), SP.el('small', SP.auth.roleDef(p.u.role).label)),
            SP.el('div.lrow__end.tiny', `${p.packed} packed · ${p.qc} QC · ${p.delivered} delivered`))))
          : SP.el('p.tiny.mute', 'No recorded activity yet.'))));

    /* ── bottleneck: where orders sit right now ────────────────── */
    const stages = [
      { label: SP.t('status.new'), count: orders.filter((o) => o.status === 'new').length, color: '#94a3b8' },
      { label: SP.t('status.assigned'), count: orders.filter((o) => o.status === 'assigned').length, color: '#38bdf8' },
      { label: SP.t('status.packing'), count: orders.filter((o) => o.status === 'packing').length, color: '#5b8cff' },
      { label: SP.t('status.packed'), count: orders.filter((o) => o.status === 'packed').length, color: '#fbbf24' },
      { label: SP.t('status.qc_approved'), count: orders.filter((o) => o.status === 'qc_approved').length, color: '#a78bfa' },
      { label: SP.t('status.out_for_delivery'), count: orders.filter((o) => o.status === 'out_for_delivery').length, color: '#fb923c' },
    ];
    root.appendChild(SP.el('section.section',
      SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Where work is sitting'), SP.el('p', 'Current bottleneck detection'))),
      SP.el('div.card.card--pad',
        SP.charts.hbars({ data: stages.map((x) => ({ label: x.label, value: x.count, colour: x.color })) }),
        SP.el('div.legend', ...stages.map((x) => SP.el('span.legend__item', SP.el('i', { style: { background: x.color } }), `${x.label} ${x.count}`))))));

    /* ── COD list ──────────────────────────────────────────────── */
    const codOrders = orders.filter((o) => o.cod?.amount);
    if (codOrders.length) {
      root.appendChild(SP.el('section.section',
        SP.el('div.section__head', SP.el('div.grow', SP.el('h2', 'Cash on delivery'), SP.el('p', 'Expected vs collected'))),
        SP.el('div.stack.gap-1', ...codOrders.map((o) => SP.el('div.lrow',
          SP.el('span.lrow__ico', SP.icon('database')),
          SP.el('div.lrow__main', SP.el('strong', `${o.ref} · ${o.customer.name}`), SP.el('small', SP.statusOf(o.status).label)),
          SP.el('div.lrow__end', SP.ui2.tag(o.codCollected ? `Collected ${SP.i18n.money(o.cod.amount)}` : `Due ${SP.i18n.money(o.cod.amount)}`, o.codCollected ? 'ok' : 'warn')))))));
    }
    return root;
  }

  function exportCsv() {
    const s = SP.store.state;
    const rows = s.orders.map((o) => ({
      ref: o.ref, created: new Date(o.createdAt).toISOString(),
      status: o.status, customer: o.customer.name,
      packer: o.packerId ? (s.users.find((u) => u.id === o.packerId)?.name || '') : '',
      qc: o.qcId ? (s.users.find((u) => u.id === o.qcId)?.name || '') : '',
      delivery: o.deliveryId ? (s.users.find((u) => u.id === o.deliveryId)?.name || '') : '',
      delivered_at: [...o.history].reverse().find((h) => h.action === 'delivered')?.at ? new Date([...o.history].reverse().find((h) => h.action === 'delivered').at).toISOString() : '',
      cod: o.cod?.amount || '', cod_collected: o.codCollected ? 'yes' : 'no',
      due: o.dueAt ? new Date(o.dueAt).toISOString() : '',
    }));
    SP.download(SP.toCSV(rows, ['ref', 'created', 'status', 'customer', 'packer', 'qc', 'delivery', 'delivered_at', 'cod', 'cod_collected', 'due']),
      `logipilot-insights-${Date.now()}.csv`, 'text/csv');
    SP.store.audit('insights.export', `${rows.length} rows`, '');
  }

  return MOD;
})();