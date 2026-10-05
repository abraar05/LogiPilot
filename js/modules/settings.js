/**
 * modules/settings.js — workspace settings, proof policy, backup & data.
 */
window.SP = window.SP || {};
SP.modules = SP.modules || {};

SP.modules.settings = (() => {
  const MOD = { title: 'Settings', subtitle: 'Workspace configuration', mount };

  function mount() {
    const u = SP.auth.current();
    const s = SP.store.state;
    const root = SP.el('div.stack.gap-4');
    root.appendChild(SP.ui2.pageHead({ title: 'Settings', sub: `LogiPilot v${SP.VERSION} · build ${SP.BUILD}` }));

    /* profile */
    root.appendChild(SP.el('div.card.card--pad',
      SP.el('div.row.gap-3', { style: { alignItems: 'center' } },
        SP.avatar(u, 'xl'),
        SP.el('div.grow', SP.el('strong', { style: { fontSize: 'var(--fs-lg)' } }, u.name), SP.el('p.tiny.mute', u.email)),
        SP.ui2.tag(SP.auth.roleDef(u.role).label, 'brand')),
      SP.el('div.row.gap-2', { style: { marginTop: 'var(--sp-3)', flexWrap: 'wrap' } },
        SP.el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onclick: async () => {
            const r = await SP.modal({
              title: 'Change password', icon: 'lock', okLabel: 'Change',
              fields: [
                { key: 'old', label: 'Current password', type: 'password', required: true },
                { key: 'next', label: 'New password', type: 'password', required: true },
              ],
              onOk: async (v) => { await SP.auth.changeOwnPassword(v.old, v.next); },
            });
            if (r) SP.ui.toast({ tone: 'ok', title: 'Password changed' });
          },
        }, SP.icon('key'), 'Change password'),
        SP.el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onclick: async () => {
            const r = await SP.modal({
              title: u.pin ? 'Change PIN' : 'Set quick PIN', icon: 'pin', okLabel: 'Save',
              fields: [{ key: 'pin', label: '4-digit PIN', inputmode: 'numeric', required: true, validate: (raw) => /^\d{4}$/.test(raw) ? null : 'Exactly 4 digits' }],
              onOk: async (v) => { await SP.auth.setPin(u.id, v.pin); },
            });
            if (r) SP.ui.toast({ tone: 'ok', title: 'PIN saved' });
          },
        }, SP.icon('pin'), u.pin ? 'Change PIN' : 'Set PIN'),
        SP.el('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => SP.app.setThemeMode(SP.app.currentTheme() === 'dark' ? 'light' : 'dark') },
          SP.icon(SP.app.currentTheme() === 'dark' ? 'sun' : 'moon'), 'Toggle theme'),
        SP.el('button.btn.btn--danger.btn--sm', { type: 'button', onclick: () => SP.app.signOut() }, SP.icon('logout'), 'Sign out'))));

    /* ── language, currency & appearance ───────────────────────── */
    root.appendChild(appearanceCard(u));

    /* proof policy */
    const st = s.settings;
    const toggle = (key, label, sub) => SP.el('label.switch', { style: { marginBottom: 'var(--sp-2)' } },
      SP.el('input', {
        type: 'checkbox', checked: st[key],
        onchange: (e) => {
          SP.store.update(['settings'], (x) => { x.settings[key] = e.target.checked; });
          SP.store.audit('settings.change', key, String(e.target.checked));
        },
      }),
      SP.el('span.switch__track'),
      SP.el('span.switch__text', SP.el('strong', label), SP.el('small', sub)));

    root.appendChild(SP.el('div.card.card--pad',
      SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Proof & workflow policy'),
      toggle('qcRequiresPhoto', 'QC approvals require a photo', 'Approvers must submit a stamped photo to pass an order'),
      toggle('deliveryRequiresPhoto', 'Deliveries require a photo', 'Proof of delivery photo is mandatory'),
      toggle('requireGps', 'GPS required on all proofs', 'Proofs without coordinates are rejected (needs device permission)'),
      toggle('allowSelfAssign', 'Staff may claim orders', 'Packers and QC can claim from the open queue without a supervisor')));

    /* company */
    root.appendChild(SP.el('div.card.card--pad',
      SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Company'),
      SP.el('div.stack.gap-2',
        field('Company name', st.company.name, (v) => setCompany('name', v)),
        field('Address', st.company.address, (v) => setCompany('address', v)),
        field('Phone', st.company.phone, (v) => setCompany('phone', v)))));

    /* backup & data */
    const size = (() => { try { return JSON.stringify(s).length; } catch { return 0; } })();
    root.appendChild(SP.el('div.card.card--pad',
      SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'Backup & data'),
      SP.el('dl.kv',
        SP.el('dt', 'Data size'), SP.el('dd', SP.fmt.bytes(size)),
        SP.el('dt', 'Orders'), SP.el('dd', SP.fmt.n(s.orders.length)),
        SP.el('dt', 'Proofs'), SP.el('dd', `${SP.fmt.n(s.proofs.length)} (${SP.fmt.bytes(SP.sum(s.proofs, (p) => (p.dataUrl || '').length))} uncompressed)`)),
      SP.el('div.row.gap-2', { style: { marginTop: 'var(--sp-3)', flexWrap: 'wrap' } },
        SP.el('button.btn.btn--primary.btn--sm', {
          type: 'button',
          onclick: () => {
            SP.download(JSON.stringify(SP.store.exportBackup(), null, 2), `logipilot-backup-${new Date().toISOString().slice(0, 10)}.json`);
            SP.store.audit('backup.export', 'manual', '');
            SP.ui.toast({ tone: 'ok', title: 'Backup downloaded' });
          },
        }, SP.icon('save'), 'Download backup'),
        SP.el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onclick: async () => {
            const ok = await SP.modal({ title: 'Restore from backup?', body: 'Replaces ALL current data on this device.', tone: 'danger', okLabel: 'Choose file' });
            if (!ok) return;
            const input = SP.el('input', { type: 'file', accept: '.json,application/json' });
            input.addEventListener('change', async () => {
              try {
                SP.store.importBackup(JSON.parse(await input.files[0].text()));
                SP.store.audit('backup.restore', '', '');
                SP.ui.toast({ tone: 'ok', title: 'Backup restored' });
                SP.router.refresh();
              } catch (e) { SP.ui.toast({ tone: 'danger', title: 'Restore failed', body: e.message }); }
            });
            input.click();
          },
        }, SP.icon('upload'), 'Restore'),
        SP.auth.can('data:manage') ? SP.el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          onclick: async () => {
            const r = await SP.modal({
              title: 'Purge old proofs', icon: 'trash', okLabel: 'Purge',
              fields: [{ key: 'days', label: 'Delete proofs older than (days)', type: 'number', min: 7, value: 90, required: true }],
              onOk: async (v) => {
                const n = SP.photo.purgeOlderThan(v.days);
                SP.ui.toast({ tone: 'ok', title: `${n} proofs purged` });
                SP.router.refresh();
              },
            });
          },
        }, SP.icon('trash'), 'Purge old proofs') : null,
        SP.auth.can('data:manage') ? SP.el('button.btn.btn--danger.btn--sm', {
          type: 'button',
          onclick: async () => {
            const ok = await SP.modal({
              title: 'Wipe workspace data?', tone: 'danger', okLabel: 'Wipe',
              body: 'Deletes orders, proofs and settings. User accounts are kept.',
              fields: [{ key: 'confirm', label: 'Type WIPE to confirm', required: true, validate: (raw) => raw === 'WIPE' ? null : 'Type WIPE exactly' }],
            });
            if (!ok) return;
            SP.store.reset({ keepUsers: true });
            SP.store.audit('data.wipe', 'workspace', 'All data wiped');
            SP.router.go('dashboard');
          },
        }, SP.icon('trash'), 'Wipe data') : null)));

    /* about */
    root.appendChild(SP.el('div.card.card--pad',
      SP.el('strong', { style: { display: 'block', marginBottom: 'var(--sp-2)' } }, 'About'),
      SP.el('dl.kv',
        SP.el('dt', 'Version'), SP.el('dd', `v${SP.VERSION} (${SP.BUILD})`),
        SP.el('dt', 'Environment'), SP.el('dd', `${location.protocol === 'https:' ? 'HTTPS' : location.protocol} · ${navigator.onLine ? 'online' : 'offline'}`),
        SP.el('dt', 'Camera scanning'), SP.el('dd', SP.scan.cameraSupported ? 'Supported' : 'Unsupported in this browser — typed codes and gun scanners still work'),
        SP.el('dt', 'Data'), SP.el('dd', 'Stored on this device — export backups regularly'))));
    return root;
  }

  /* ─────────────────────────────────────────── appearance card */

  const STYLES = [
    { id: 'default', label: 'Default', swatch: '#5b8cff' },
    { id: 'emerald', label: 'Emerald', swatch: '#34d399' },
    { id: 'ocean', label: 'Ocean', swatch: '#38bdf8' },
    { id: 'sunset', label: 'Sunset', swatch: '#fb923c' },
    { id: 'violet', label: 'Violet', swatch: '#a78bfa' },
  ];
  const CURRENCIES = ['BDT', 'USD', 'CNY', 'EUR', 'INR'];

  function appearanceCard(u) {
    const p = SP.store.state.prefs;
    const st = SP.store.state.settings;

    /* language */
    const langRow = SP.el('div.row.gap-2', { style: { flexWrap: 'wrap' } },
      ...SP.i18n.LOCALES.map((l) => SP.el('button.chip', {
        type: 'button',
        class: SP.i18n.locale() === l.id ? 'is-active' : '',
        onclick: () => { SP.i18n.setLocale(l.id); SP.ui.toast({ tone: 'ok', title: l.label }); SP.router.refresh(); },
      }, l.label)));

    /* currency */
    const curSel = SP.el('select.select', { onchange: (e) => { SP.i18n.setCurrency(e.target.value); SP.ui.toast({ tone: 'ok', title: e.target.value }); } },
      ...CURRENCIES.map((c) => SP.el('option', { value: c, selected: SP.i18n.currency() === c }, `${c} ${SP.i18n.currencySymbol() === c ? '' : `(${{ BDT: '৳', USD: '$', CNY: '¥', EUR: '€', INR: '₹' }[c]})`}`)));

    /* theme mode */
    const themeSeg = SP.segmented(
      [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'auto', label: 'Auto' }],
      localStorage.getItem('logipilot.themeMode') || p.theme || 'dark',
      (v) => { SP.app.setThemeMode(v); });

    /* style preset */
    const styleRow = SP.el('div.row.gap-2', { style: { flexWrap: 'wrap' } },
      ...STYLES.map((s) => SP.el('button.stylechip', {
        type: 'button',
        class: (p.style || 'default') === s.id ? 'is-active' : '',
        onclick: () => {
          SP.store.update(['prefs'], (x) => { x.prefs.style = s.id; });
          SP.app.applyTheme();
          SP.router.refresh();
        },
      },
        SP.el('i.stylechip__dot', { style: { background: s.swatch } }),
        s.label)));

    return SP.el('div.card.card--pad.stack.gap-3',
      SP.el('div',
        SP.el('div.row.gap-2', { style: { alignItems: 'center' } }, SP.icon('users'), SP.el('strong', SP.t('misc.language'))),
        SP.el('div', { style: { marginTop: '8px' } }, langRow)),
      SP.el('div',
        SP.el('div.row.gap-2', { style: { alignItems: 'center' } }, SP.icon('database'), SP.el('strong', SP.t('misc.currency'))),
        SP.el('div', { style: { marginTop: '8px', maxWidth: '220px' } }, curSel),
        SP.el('p.tiny.mute', { style: { marginTop: '4px' } }, 'Changing the language suggests its currency — you can override it here any time.')),
      SP.el('div',
        SP.el('div.row.gap-2', { style: { alignItems: 'center' } }, SP.icon('moon'), SP.el('strong', SP.t('misc.theme'))),
        SP.el('div', { style: { marginTop: '8px' } }, themeSeg)),
      SP.el('div',
        SP.el('div.row.gap-2', { style: { alignItems: 'center' } }, SP.icon('palette'), SP.el('strong', SP.t('misc.style'))),
        SP.el('div', { style: { marginTop: '8px' } }, styleRow)));
  }

  function field(label, value, onCommit) {
    const input = SP.el('input.input', { value: value || '' });
    input.addEventListener('change', () => { onCommit(input.value); SP.ui.toast({ tone: 'ok', title: 'Saved' }); });
    return SP.el('label.field', SP.el('span.field__label', label), input);
  }
  const setCompany = (k, v) => SP.store.update(['settings'], (st) => { st.settings.company[k] = v; });

  return MOD;
})();
