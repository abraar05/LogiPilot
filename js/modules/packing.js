/**
 * modules/packing.js — the packer's workspace. Claim/assigned orders,
 * per-item checklist (scan to verify), then a stamped photo proof to
 * mark the order PACKED.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.packing = (() => {
  const MOD = { title: 'Packing', subtitle: () => `${SP.fmt.pluralise(SP.orders.queues().toPack.length, 'order')} to pack`, mount, perm: 'pack:perform' };

  function mount(params) {
    const root = SP.el('div.stack.gap-3');
    const uid = SP.auth.current()?.id;
    const queue = SP.orders.queues().toPack;

    root.appendChild(SP.ui2.pageHead({
      title: 'Packing',
      sub: 'Prepare goods exactly as per the sales order, then prove it with a photo.',
      actions: [SP.ui2.scanButton({ onOrder: (o) => workspace(o.id), label: 'Scan order' })],
    }));

    if (params?.id) { workspace(params.id); }

    if (!queue.length) {
      root.appendChild(SP.empty({ icon: 'box', title: 'Nothing to pack', body: 'New orders assigned to you will appear here.' }));
      return root;
    }

    root.appendChild(SP.el('div.stack.gap-2', ...queue.map((o) => {
      const mine = o.packerId === uid;
      const rework = o.status === 'qc_rejected';
      return SP.ui2.orderCard(o, {
        onClick: () => workspace(o.id),
        actions: [
          mine || !o.packerId ? SP.el('button.btn.btn--sm', {
            type: 'button',
            class: rework ? 'btn--danger' : 'btn--primary',
            onclick: (e) => { e.stopPropagation(); workspace(o.id); },
          }, rework ? 'Rework' : mine ? 'Continue' : 'Claim') : SP.ui2.tag(`with ${SP.ui2.userName(o.packerId)}`, 'mute'),
        ],
      });
    })));
    return root;
  }

  /* ─────────────────────────────────────────────────── workspace */

  function workspace(orderId) {
    const o = SP.orders.byId(orderId);
    if (!o) return;
    const uid = SP.auth.current()?.id;

    const body = SP.el('div.stack.gap-3');

    // claim bar
    if (!o.packerId) {
      body.appendChild(SP.el('div.callout', { dataset: { tone: 'brand' } },
        SP.el('span.callout__ico', SP.icon('info')),
        SP.el('div.callout__body', SP.el('strong', 'Unassigned order'), SP.el('p', 'Claim it to start packing.')),
        SP.el('button.btn.btn--sm.btn--primary', {
          type: 'button',
          onclick: async () => {
            try {
              SP.orders.assign(o.id, 'packerId', uid);
              shell.close(); workspace(orderId);
            } catch (e) { SP.ui.toast({ tone: 'danger', title: e.message }); }
          },
        }, 'Claim this order')));
    }

    // items checklist with scan-to-verify
    const listHost = SP.el('div.stack.gap-1');
    const drawItems = () => {
      SP.clear(listHost);
      for (const i of o.items) {
        const done = i.packedQty >= i.qty;
        listHost.appendChild(SP.el('div.packline', { class: done ? 'is-done' : '' },
          SP.el('button.packline__check', {
            type: 'button', 'aria-label': `Mark ${i.name} packed`,
            onclick: () => {
              SP.orders.setPackedQty(o.id, i.id, done ? 0 : i.qty);
              if (o.status === 'assigned' || o.status === 'qc_rejected') {
                try { SP.orders.transition(o.id, 'packing', { note: 'Started packing' }); } catch { /* already packing */ }
              }
              drawItems(); drawFoot();
            },
          }, SP.icon(done ? 'check' : 'plus')),
          SP.el('div.grow',
            SP.el('strong', i.name),
            SP.el('small.mute', i.sku || 'no SKU')),
          SP.el('div.row.gap-1', { style: { alignItems: 'center' } },
            SP.el('button.btn.btn--icon.btn--sm.btn--quiet', { type: 'button', 'aria-label': 'Minus one', onclick: () => { SP.orders.setPackedQty(o.id, i.id, i.packedQty - 1); drawItems(); drawFoot(); } }, SP.icon('minus')),
            SP.el('b', { style: { minWidth: '44px', textAlign: 'center' } }, `${i.packedQty}/${i.qty}`),
            SP.el('button.btn.btn--icon.btn--sm.btn--quiet', { type: 'button', 'aria-label': 'Plus one', onclick: () => { SP.orders.setPackedQty(o.id, i.id, i.packedQty + 1); drawItems(); drawFoot(); } }, SP.icon('plus')))));
      }
    };

    const scanNote = SP.el('p.tiny.mute');
    body.append(
      SP.el('div.row.gap-2', { style: { alignItems: 'center', flexWrap: 'wrap' } },
        SP.ui2.badge(o.status),
        SP.el('strong', `${o.customer.name}`),
        SP.el('span.tiny.mute', o.customer.address || '')),
      SP.el('div.row.gap-2',
        SP.el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onclick: async () => {
            const code = await SP.scan.open({ title: 'Scan item to verify' });
            if (!code) return;
            const item = o.items.find((i) => i.sku === code || i.barcode === code);
            if (item) {
              SP.orders.setPackedQty(o.id, item.id, item.packedQty + 1);
              scanNote.textContent = `✓ ${item.name} counted (${item.packedQty}/${item.qty})`;
              scanNote.style.color = 'var(--ok)';
              drawItems(); drawFoot();
            } else {
              scanNote.textContent = `✗ "${code}" is not on this order`;
              scanNote.style.color = 'var(--danger)';
            }
          },
        }, SP.icon('target'), 'Scan item'),
      ),
      scanNote,
      listHost,
    );

    // footer: submit with proof
    const foot = SP.el('div.stack.gap-2');
    const drawFoot = () => {
      SP.clear(foot);
      const full = SP.orders.fullyPacked(o);
      const hint = SP.el('p.tiny', { style: { color: full ? 'var(--ok)' : 'var(--text-mute)' } },
        full ? 'All items packed. Take a photo of the packaged goods to finish.' : 'Pack every item before submitting.');
      const submit = SP.el('button.btn.btn--primary.btn--block.btn--lg', {
        type: 'button', disabled: !full || !o.packerId,
        onclick: () => submitPacked(o),
      }, SP.icon('check'), 'Mark packed & submit photo proof');
      foot.append(hint, submit);
    };
    body.appendChild(foot);

    drawItems(); drawFoot();
    const shell = SP.sheet({ title: `Pack ${o.ref}`, subtitle: o.customer.name, content: body });
  }

  async function submitPacked(o) {
    try {
      if (o.status === 'assigned' || o.status === 'qc_rejected') {
        SP.orders.transition(o.id, 'packing', { skipPerm: true });
      }
      const proof = await SP.photo.captureProof({ order: o, stage: 'packed' });
      if (!proof) return; // aborted
      SP.orders.transition(o.id, 'packed', { proofId: proof.id, note: 'Packed with photo proof' });
      SP.ui.toast({ tone: 'ok', title: `${o.ref} marked packed`, body: 'QC has been notified.' });
      SP.router.refresh();
    } catch (e) {
      SP.ui.toast({ tone: 'danger', title: 'Could not complete', body: e.message });
    }
  }

  return MOD;
})();

/* ══════════════════════════════════════════════════════ QC APPROVAL */

SP.modules.qc = (() => {
  const MOD = { title: 'QC Approval', subtitle: () => `${SP.fmt.pluralise(SP.orders.queues().qcQueue.length, 'order')} awaiting check`, mount, perm: 'qc:perform' };

  function mount(params) {
    const root = SP.el('div.stack.gap-3');
    const uid = SP.auth.current()?.id;
    const queue = SP.orders.queues().qcQueue;

    root.appendChild(SP.ui2.pageHead({
      title: 'QC Approval',
      sub: 'Verify packaged items match the order. Approve with proof, or reject with a reason.',
      actions: [SP.ui2.scanButton({ onOrder: (o) => review(o.id), label: 'Scan order' })],
    }));

    if (params?.id) review(params.id);

    if (!queue.length) {
      root.appendChild(SP.empty({ icon: 'checkCircle', title: 'Queue clear', body: 'Packed orders will appear here for checking.' }));
      return root;
    }

    root.appendChild(SP.el('div.stack.gap-2', ...queue.map((o) => {
      const mine = o.qcId === uid;
      return SP.ui2.orderCard(o, {
        onClick: () => review(o.id),
        actions: [
          mine || !o.qcId ? SP.el('button.btn.btn--sm.btn--primary', {
            type: 'button', onclick: (e) => { e.stopPropagation(); review(o.id); },
          }, mine ? 'Review' : 'Claim & review') : SP.ui2.tag(`with ${SP.ui2.userName(o.qcId)}`, 'mute'),
        ],
      });
    })));
    return root;
  }

  /* ─────────────────────────────────────────────────────── review */

  function review(orderId) {
    const o = SP.orders.byId(orderId);
    if (!o) return;
    const uid = SP.auth.current()?.id;
    const checks = new Map(); // itemId → true when QC-verified

    const listHost = SP.el('div.stack.gap-1');
    const drawItems = () => {
      SP.clear(listHost);
      for (const i of o.items) {
        const on = checks.get(i.id) === true;
        listHost.appendChild(SP.el('div.packline', { class: on ? 'is-done' : '' },
          SP.el('button.packline__check', { type: 'button', 'aria-label': `Verify ${i.name}`, onclick: () => { checks.set(i.id, !on); drawItems(); drawFoot(); } }, SP.icon(on ? 'check' : 'plus')),
          SP.el('div.grow', SP.el('strong', i.name), SP.el('small.mute', i.sku || 'no SKU')),
          SP.el('b', `${i.packedQty}/${i.qty}`)));
      }
    };

    const foot = SP.el('div.stack.gap-2');
    const drawFoot = () => {
      SP.clear(foot);
      const allChecked = o.items.every((i) => checks.get(i.id));
      foot.append(
        SP.el('p.tiny', { style: { color: allChecked ? 'var(--ok)' : 'var(--text-mute)' } },
          allChecked ? 'Everything matches. Capture the QC proof photo to approve.' : 'Check each item against the order before deciding.'),
        SP.el('div.row.gap-2',
          SP.el('button.btn.btn--ok.grow', {
            type: 'button', disabled: !allChecked,
            onclick: () => approve(o),
          }, SP.icon('check'), 'Approve + photo'),
          SP.el('button.btn.btn--danger.grow', { type: 'button', onclick: () => reject(o) }, SP.icon('x'), 'Reject')),
      );
    };

    const body = SP.el('div.stack.gap-3',
      !o.qcId ? SP.el('div.callout', { dataset: { tone: 'brand' } },
        SP.el('span.callout__ico', SP.icon('info')),
        SP.el('div.callout__body', SP.el('strong', 'No QC approver assigned'), SP.el('p', 'Claim the review to proceed.')),
        SP.el('button.btn.btn--sm.btn--primary', {
          type: 'button',
          onclick: () => {
            try { SP.orders.assign(o.id, 'qcId', uid); shell.close(); review(orderId); }
            catch (e) { SP.ui.toast({ tone: 'danger', title: e.message }); }
          },
        }, 'Claim review')) : null,
      SP.el('div.row.gap-2', { style: { alignItems: 'center' } }, SP.ui2.badge(o.status), SP.el('strong', o.customer.name)),
      SP.el('div',
        SP.el('strong', { style: { display: 'block', marginBottom: '6px' } }, 'Packer\'s proof'),
        SP.ui2.proofStrip(o.id)),
      SP.el('div.row.gap-2',
        SP.el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onclick: async () => {
            const code = await SP.scan.open({ title: 'Scan item to verify' });
            if (!code) return;
            const item = o.items.find((i) => i.sku === code || i.barcode === code);
            if (item) { checks.set(item.id, true); SP.ui.toast({ tone: 'ok', title: `Verified: ${item.name}` }); drawItems(); drawFoot(); }
            else SP.ui.toast({ tone: 'danger', title: 'Not on this order', body: code });
          },
        }, SP.icon('target'), 'Scan item')),
      listHost,
      foot,
    );

    drawItems(); drawFoot();
    const shell = SP.sheet({ title: `QC review ${o.ref}`, subtitle: o.customer.name, content: body });
  }

  async function approve(o) {
    try {
      const proof = SP.store.state.settings.qcRequiresPhoto
        ? await SP.photo.captureProof({ order: o, stage: 'qc_approved' })
        : null;
      if (SP.store.state.settings.qcRequiresPhoto && !proof) return;
      SP.orders.transition(o.id, 'qc_approved', { proofId: proof?.id, note: 'QC passed' });
      SP.ui.toast({ tone: 'ok', title: `${o.ref} QC approved`, body: 'Ready for delivery assignment.' });
      SP.router.refresh();
    } catch (e) { SP.ui.toast({ tone: 'danger', title: e.message }); }
  }

  async function reject(o) {
    const r = await SP.modal({
      title: `Reject ${o.ref}`, icon: 'alert', tone: 'danger', okLabel: 'Reject & send back',
      fields: [
        { key: 'note', label: 'What does not match?', required: true, type: 'textarea', placeholder: 'e.g. 2× Xiaomi 14 ordered, only 1 packed' },
        { key: 'photo', label: 'Attach photo evidence', type: 'checkbox', checkboxLabel: 'Capture a photo of the mismatch', value: false },
      ],
      onOk: async (v) => {
        let proof = null;
        if (v.photo) proof = await SP.photo.captureProof({ order: o, stage: 'packed', note: `QC rejection: ${v.note}` });
        SP.orders.transition(o.id, 'qc_rejected', { proofId: proof?.id, note: v.note });
      },
    });
    if (r) { SP.ui.toast({ tone: 'warn', title: `${o.ref} sent back for rework` }); SP.router.refresh(); }
  }

  return MOD;
})();
