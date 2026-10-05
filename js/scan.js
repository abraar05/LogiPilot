/**
 * scan.js — barcode / QR scanner.
 *
 * Two input paths, both honest about capability:
 *  1. Camera scanning via BarcodeDetector where the platform supports it
 *     (Android Chrome, most modern browsers). Where unsupported, the UI
 *     says so instead of faking it.
 *  2. Keyboard-wedge scanners (Bluetooth/USB guns) that type the code and
 *     end with Enter — captured globally and routed to the active handler.
 *
 * Scanned values resolve against order refs, order barcodes and item SKUs.
 */
window.SP = window.SP || {};

SP.scan = (() => {
  const cameraSupported = 'BarcodeDetector' in window && !!(navigator.mediaDevices?.getUserMedia);

  /* ─────────────────────────────────────────────── camera session */

  /**
   * Open the camera scanner sheet. Resolves with the first decoded value.
   * @returns {Promise<string|null>}
   */
  function open({ title = 'Scan code', hint = 'Point the camera at a barcode or QR code…' } = {}) {
    return new Promise(async (resolve) => {
      if (!cameraSupported) {
        SP.ui.toast({
          tone: 'info', title: 'Camera scanning unsupported here',
          body: 'Type the code, or use a keyboard-wedge scanner (ends with Enter).',
        });
        resolve(null);
        return;
      }
      let stream = null;
      let done = false;
      const video = SP.el('video', { autoplay: true, playsinline: true, muted: true, class: 'scan__video' });
      const status = SP.el('p.tiny.mute', hint);
      const frame = SP.el('div.scan__frame', video, SP.el('div.scan__reticle'));
      const shell = SP.sheet({
        title,
        content: SP.el('div.stack.gap-2', frame, status),
        onClose: () => { cleanup(); if (!done) resolve(null); },
      });
      const cleanup = () => { try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ } };

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        video.srcObject = stream;
        const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'datamatrix'] });
        const tick = async () => {
          if (done || !shell.el.isConnected) return;
          if (video.readyState >= 2) {
            try {
              const codes = await detector.detect(video);
              if (codes.length) {
                done = true;
                SP.buzz([10, 50, 10]);
                const value = codes[0].rawValue;
                shell.close();
                resolve(value);
                return;
              }
            } catch { /* keep scanning */ }
          }
          requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        status.textContent = `Camera unavailable: ${e.message}. Type the code instead.`;
        status.style.color = 'var(--warn)';
        setTimeout(() => { if (!done) { shell.close(); resolve(null); } }, 2500);
      }
    });
  }

  /* ─────────────────────────────────────────── keyboard-wedge hook */

  let wedgeHandler = null;
  let buffer = '';
  let lastKeyAt = 0;

  document.addEventListener('keydown', (e) => {
    if (!wedgeHandler) return;
    const now = Date.now();
    if (now - lastKeyAt > 60) buffer = ''; // human typing is slower than a gun
    lastKeyAt = now;
    if (e.key === 'Enter') {
      if (buffer.length >= 4) {
        const code = buffer;
        buffer = '';
        e.preventDefault();
        wedgeHandler(code);
      }
      return;
    }
    if (e.key.length === 1) buffer += e.key;
  }, true);

  /** Register a handler for gun input; returns an unregister function. */
  function onWedgeScan(fn) {
    wedgeHandler = fn;
    return () => { if (wedgeHandler === fn) wedgeHandler = null; };
  }

  /* ─────────────────────────────────────────────── resolution */

  /**
   * Find what a scanned code refers to.
   * @returns {{kind:'order'|'item'|'unknown', order?, item?}}
   */
  function resolve(code) {
    const c = String(code || '').trim();
    if (!c) return { kind: 'unknown' };
    const s = SP.store.state;
    const cl = c.toLowerCase();
    const order = s.orders.find((o) => o.ref.toLowerCase() === cl || o.id === c || o.barcode === c);
    if (order) return { kind: 'order', order };
    for (const o of s.orders) {
      const item = o.items.find((i) => i.sku?.toLowerCase() === cl || i.barcode === c);
      if (item) return { kind: 'item', order: o, item };
    }
    return { kind: 'unknown' };
  }

  return { open, resolve, onWedgeScan, get cameraSupported() { return cameraSupported; } };
})();
