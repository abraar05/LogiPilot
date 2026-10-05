/**
 * seed.js — DEMO DATA for first-run exploration.
 *
 * Creates a realistic workspace: orders in every stage of the chain with
 * consistent assignments and history, plus canvas-generated DEMO proofs
 * (clearly watermarked — they are placeholders, not real photos).
 *
 * Wipe it any time from Settings → Backup & data → Wipe data.
 */
window.SP = window.SP || {};

SP.seedDemo = (() => {

  /** Generate a labelled placeholder "photo" as a data URL. */
  function demoImage(title, sub, hue) {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const ctx = c.getContext && c.getContext('2d');
    if (!ctx) {
      // No canvas (very old WebView): labelled SVG placeholder instead.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="hsl(${hue} 45% 20%)"/><text x="320" y="60" fill="#ffc83c" font-family="sans-serif" font-size="22" font-weight="700" text-anchor="middle">— DEMO PROOF —</text><text x="320" y="360" fill="#f2f4f7" font-family="sans-serif" font-size="28" font-weight="700" text-anchor="middle">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }
    const g = ctx.createLinearGradient(0, 0, 640, 480);
    g.addColorStop(0, `hsl(${hue} 45% 22%)`);
    g.addColorStop(1, `hsl(${hue + 30} 50% 12%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 640, 480);
    // parcel sketch
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 5;
    ctx.strokeRect(200, 130, 240, 170);
    ctx.beginPath(); ctx.moveTo(200, 170); ctx.lineTo(440, 170); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(320, 130); ctx.lineTo(320, 300); ctx.stroke();
    ctx.fillStyle = '#f2f4f7';
    ctx.font = '700 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, 320, 360);
    ctx.font = '400 20px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(242,244,247,.75)';
    ctx.fillText(sub, 320, 392);
    ctx.fillStyle = 'rgba(255,200,60,.9)';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText('— DEMO PROOF —', 320, 60);
    return c.toDataURL('image/jpeg', 0.8);
  }

  function run() {
    const s = SP.store.state;
    if (s.orders.length) return false;

    const u = (email) => s.users.find((x) => x.email === email);
    const admin = u('admin@logipilot.app');
    const packer = u('packer@logipilot.app');
    const qc = u('qc@logipilot.app');
    const driver = u('driver@logipilot.app');
    const delivery = u('delivery@logipilot.app');
    if (!admin || !packer || !qc || !driver || !delivery) return false;

    const H = 3600e3; const D = 86400e3;
    const now = Date.now();
    let proofSeq = 0;

    const mkProof = (order, stage, byUser, at, hue) => {
      proofSeq += 1;
      return {
        id: SP.uid('prf'),
        ref: `PRF-${String(proofSeq).padStart(4, '0')}`,
        orderId: order.id, orderRef: order.ref,
        stage,
        byId: byUser.id, byName: byUser.name, role: byUser.role,
        at,
        dataUrl: demoImage(`${order.ref} · ${SP.statusOf(stage).label}`, `${byUser.name} · ${SP.fmt.dateTime(at)}`, hue),
        stamp: { text: ['demo', 'demo'], gps: { lat: 23.7808, lng: 90.4070, acc: 25 }, device: 'Demo seed' },
        note: 'Demo proof (generated placeholder)',
        demo: true,
        immutable: true,
      };
    };

    const mkOrder = (n, customer, items, status, assignees, t0, extra = {}) => {
      const order = {
        id: SP.uid('ord'),
        ref: `SO-${String(n).padStart(4, '0')}`,
        barcode: `SO${String(n).padStart(6, '0')}`,
        customer,
        items: items.map((i, idx) => ({ id: `it${idx + 1}`, packedQty: 0, barcode: i.sku || '', ...i })),
        status, priority: extra.priority || 'normal',
        packerId: assignees.packer || null, qcId: assignees.qc || null,
        driverId: assignees.driver || null, deliveryId: assignees.delivery || null,
        notes: extra.notes || '',
        history: [], proofs: undefined,
        createdAt: t0, updatedAt: t0,
        dueAt: extra.dueAt || null,
      };
      return order;
    };

    const orders = [];
    const proofs = [];
    const hist = (order, at, by, action, note = '', proofId = null) => {
      order.history.push({ at, by, action, note, proofId });
      order.updatedAt = at;
    };

    /* 1–2 · DELIVERED (full chain with proofs) */
    [['Rahim Electronics', '01711000001', 'Dhanmondi 27, Dhaka', [
      { name: 'Xiaomi 14 Ultra 12|256', sku: 'XIA14U-BLK', qty: 2 },
      { name: 'Redmi Buds 5', sku: 'BUDS5', qty: 3 },
    ]], ['Karim Traders', '01711000002', 'Uttara Sector 7, Dhaka', [
      { name: 'Redmi Pad 8|256', sku: 'PAD8-GRY', qty: 1 },
    ]]].forEach(([name, phone, address, items], i) => {
      const n = i + 1;
      const t0 = now - (3 - i) * D;
      const o = mkOrder(n, { name, phone, address }, items, 'delivered', { packer: packer.id, qc: qc.id, driver: driver.id, delivery: delivery.id }, t0);
      o.items.forEach((it) => { it.packedQty = it.qty; });
      hist(o, t0, admin.name, 'created', 'Demo order');
      hist(o, t0 + H, admin.name, 'assigned', `Packer → ${packer.name}`);
      hist(o, t0 + 2 * H, packer.name, 'packing', 'Started packing');
      const p1 = mkProof(o, 'packed', packer, t0 + 3 * H, 210);
      hist(o, t0 + 3 * H, packer.name, 'packed', 'Packed with photo proof', p1.id);
      const p2 = mkProof(o, 'qc_approved', qc, t0 + 5 * H, 150);
      hist(o, t0 + 5 * H, qc.name, 'qc_approved', 'QC passed', p2.id);
      hist(o, t0 + 6 * H, admin.name, 'out_for_delivery', `Driver ${driver.name} · ${delivery.name}`);
      const p3 = mkProof(o, 'delivered', delivery, t0 + 9 * H, 100);
      hist(o, t0 + 9 * H, delivery.name, 'delivered', 'Handed over with photo proof', p3.id);
      proofs.push(p1, p2, p3);
      orders.push(o);
    });

    /* 3 · OUT FOR DELIVERY */
    {
      const t0 = now - 5 * H;
      const o = mkOrder(3, { name: 'Nusrat Mobile Point', phone: '01711000003', address: 'Mirpur 10, Dhaka' }, [
        { name: 'Realme Note 50 6|128', sku: 'RN50-BLU', qty: 4 },
        { name: 'Realme Buds T300', sku: 'T300', qty: 4 },
      ], 'out_for_delivery', { packer: packer.id, qc: qc.id, driver: driver.id, delivery: delivery.id }, t0, { priority: 'urgent', dueAt: now + D });
      o.items.forEach((it) => { it.packedQty = it.qty; });
      hist(o, t0, admin.name, 'created', 'Urgent — deliver today');
      hist(o, t0 + H / 2, admin.name, 'assigned', `Packer → ${packer.name}`);
      hist(o, t0 + H, packer.name, 'packing', '');
      const p1 = mkProof(o, 'packed', packer, t0 + 2 * H, 210);
      hist(o, t0 + 2 * H, packer.name, 'packed', '', p1.id);
      const p2 = mkProof(o, 'qc_approved', qc, t0 + 3 * H, 150);
      hist(o, t0 + 3 * H, qc.name, 'qc_approved', 'All matched', p2.id);
      hist(o, t0 + 4 * H, admin.name, 'out_for_delivery', 'Dispatched');
      proofs.push(p1, p2);
      orders.push(o);
    }

    /* 4–5 · PACKED (waiting in the QC queue) */
    [['Sakib Gadgets', '01711000004', 'Banani, Dhaka', [
      { name: 'Samsung Galaxy A55 8|128', sku: 'A55-NAVY', qty: 3 },
    ]], ['Mitu Telecom', '01711000005', 'Farmgate, Dhaka', [
      { name: 'Redmi 15C 4|128', sku: 'R15C-GRN', qty: 6 },
      { name: 'Mi Powerbank 10000', sku: 'PB10K', qty: 2 },
    ]]].forEach(([name, phone, address, items], i) => {
      const n = 4 + i;
      const t0 = now - (3 - i) * H;
      const o = mkOrder(n, { name, phone, address }, items, 'packed', { packer: packer.id, qc: i === 0 ? qc.id : null }, t0);
      o.items.forEach((it) => { it.packedQty = it.qty; });
      hist(o, t0, admin.name, 'created', '');
      hist(o, t0 + H / 4, admin.name, 'assigned', `Packer → ${packer.name}`);
      hist(o, t0 + H / 2, packer.name, 'packing', '');
      const p1 = mkProof(o, 'packed', packer, t0 + H, 210);
      hist(o, t0 + H, packer.name, 'packed', 'Packed with photo proof', p1.id);
      proofs.push(p1);
      orders.push(o);
    });

    /* 6 · QC_REJECTED (back with the packer for rework) */
    {
      const t0 = now - 7 * H;
      const o = mkOrder(6, { name: 'Dhaka Wholesale Hub', phone: '01711000006', address: 'New Market, Dhaka' }, [
        { name: 'Vivo Y28 8|128', sku: 'VY28-ORG', qty: 5 },
      ], 'qc_rejected', { packer: packer.id, qc: qc.id }, t0, { notes: 'Customer wants morning delivery' });
      o.items[0].packedQty = 4;
      hist(o, t0, admin.name, 'created', '');
      hist(o, t0 + H / 2, admin.name, 'assigned', `Packer → ${packer.name}`);
      hist(o, t0 + H, packer.name, 'packing', '');
      const p1 = mkProof(o, 'packed', packer, t0 + 2 * H, 210);
      hist(o, t0 + 2 * H, packer.name, 'packed', '', p1.id);
      hist(o, t0 + 3 * H, qc.name, 'qc_rejected', '5 ordered, only 4 in the box — recount');
      proofs.push(p1);
      orders.push(o);
    }

    /* 7 · PACKING (half done) */
    {
      const t0 = now - 2 * H;
      const o = mkOrder(7, { name: 'Anwar Mobile Store', phone: '01711000007', address: 'Chawkbazar, Chattogram' }, [
        { name: 'Infinix Hot 40 8|256', sku: 'H40-BLK', qty: 8 },
        { name: 'Infinix XE27 Earbuds', sku: 'XE27', qty: 4 },
      ], 'packing', { packer: packer.id }, t0);
      o.items[0].packedQty = 5;
      hist(o, t0, admin.name, 'created', '');
      hist(o, t0 + H / 4, admin.name, 'assigned', `Packer → ${packer.name}`);
      hist(o, t0 + H / 2, packer.name, 'packing', 'Started packing');
      orders.push(o);
    }

    /* 8 · ASSIGNED (waiting for the packer to start) */
    {
      const t0 = now - H;
      const o = mkOrder(8, { name: 'Rafi Electronics', phone: '01711000008', address: 'Sylhet Sadar' }, [
        { name: 'Tecno Spark 20 8|128', sku: 'TS20-GLD', qty: 2 },
      ], 'assigned', { packer: packer.id }, t0, { dueAt: now + 2 * D });
      hist(o, t0, admin.name, 'created', '');
      hist(o, t0 + H / 6, admin.name, 'assigned', `Packer → ${packer.name}`);
      orders.push(o);
    }

    /* 9 · NEW (nobody assigned yet) */
    {
      const t0 = now - H / 2;
      const o = mkOrder(9, { name: 'City Mobile Zone', phone: '01711000009', address: 'Motijheel, Dhaka' }, [
        { name: 'Redmi 15 5G 6|128', sku: 'R15-5G', qty: 10 },
      ], 'new', {}, t0, { priority: 'urgent', notes: 'Call customer before packing' });
      hist(o, t0, admin.name, 'created', 'Call customer before packing');
      orders.push(o);
    }

    /* 10 · FAILED delivery (needs resolution) */
    {
      const t0 = now - 2 * D;
      const o = mkOrder(10, { name: 'Gulshan Gadgets', phone: '01711000010', address: 'Gulshan 2, Dhaka' }, [
        { name: 'Oppo A3x 4|64', sku: 'OA3X-SIL', qty: 2 },
      ], 'failed', { packer: packer.id, qc: qc.id, driver: driver.id, delivery: delivery.id }, t0);
      o.items.forEach((it) => { it.packedQty = it.qty; });
      hist(o, t0, admin.name, 'created', '');
      hist(o, t0 + H / 2, admin.name, 'assigned', `Packer → ${packer.name}`);
      hist(o, t0 + H, packer.name, 'packing', '');
      const p1 = mkProof(o, 'packed', packer, t0 + 2 * H, 210);
      hist(o, t0 + 2 * H, packer.name, 'packed', '', p1.id);
      const p2 = mkProof(o, 'qc_approved', qc, t0 + 3 * H, 150);
      hist(o, t0 + 3 * H, qc.name, 'qc_approved', '', p2.id);
      hist(o, t0 + 4 * H, admin.name, 'out_for_delivery', '');
      hist(o, t0 + 8 * H, delivery.name, 'failed', 'Customer unreachable — phone off');
      proofs.push(p1, p2);
      orders.push(o);
    }

    SP.store.update(['orders', 'proofs', 'settings', 'counters'], (st) => {
      st.orders = orders;
      st.proofs = proofs;
      st.counters.order = 10;
      st.counters.proof = proofs.length;
      st.settings.demo = true;
    });
    SP.store.audit('system.seed', 'demo', `${orders.length} demo orders · ${proofs.length} demo proofs`, 'system');
    return true;
  }

  return { run };
})();
