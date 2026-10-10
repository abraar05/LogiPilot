/**
 * photo.js — stamped photo proofs.
 *
 * Every proof is:
 *  - captured from the camera (or picked from gallery as a fallback),
 *  - downscaled for storage,
 *  - STAMPED in-image with user, role, order ref, stage, timestamp and
 *    GPS coordinates when the device provides them,
 *  - stored as an immutable record — no edit, no delete through the app.
 *
 * GPS honesty: coordinates come only from the Geolocation API with user
 * permission. When unavailable the stamp says "GPS unavailable" — never fake.
 */
window.SP = window.SP || {};

SP.photo = (() => {

  /* ──────────────────────────────────────────────────────── GPS */

  function getPosition(timeoutMs = 6000) {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve(null);
      const timer = setTimeout(() => resolve(null), timeoutMs);
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) }); },
        () => { clearTimeout(timer); resolve(null); },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
      );
    });
  }

  /* ─────────────────────────────────────────────────── capture */

  /** Pick an image from camera (mobile: opens camera) or gallery. */
  function pickImage() {
    return new Promise((resolve) => {
      const input = SP.el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
      input.addEventListener('change', () => resolve(input.files[0] || null));
      document.body.appendChild(input);
      input.click();
      setTimeout(() => input.remove(), 120000);
    });
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the image')); };
      img.src = url;
    });
  }

  /**
   * Draw the image + stamp banner onto canvas and export as JPEG data URL.
   * The stamp is part of the pixels — it cannot be edited in the app.
   */
  function stampImage(img, lines) {
    const MAX = 1280;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const bannerH = Math.max(64, Math.round(h * 0.085) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h + bannerH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    // banner
    ctx.fillStyle = 'rgba(8, 10, 14, 0.92)';
    ctx.fillRect(0, h, w, bannerH);
    ctx.fillStyle = '#f2f4f7';
    ctx.textBaseline = 'top';
    const pad = Math.round(w * 0.02);
    const fs1 = Math.max(15, Math.round(w * 0.024));
    const fs2 = Math.max(12, Math.round(w * 0.019));
    ctx.font = `700 ${fs1}px system-ui, sans-serif`;
    ctx.fillText(lines[0] || '', pad, h + Math.round(bannerH * 0.18));
    ctx.font = `400 ${fs2}px system-ui, sans-serif`;
    ctx.fillStyle = '#b6bdc9';
    ctx.fillText(lines[1] || '', pad, h + Math.round(bannerH * 0.58));

    // LogiPilot watermark
    ctx.font = `600 ${fs2}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(91,140,255,0.9)';
    ctx.textAlign = 'right';
    ctx.fillText('LogiPilot ✓', w - pad, h + Math.round(bannerH * 0.58));
    ctx.textAlign = 'left';

    return canvas.toDataURL('image/jpeg', 0.82);
  }

  /* ─────────────────────────────────────────────────── proofs */

  /**
   * Full proof capture flow: pick → stamp → store (immutable).
   * @param {object} o { order, stage, note? }
   * @returns {Promise<proof|null>}
   */
  async function captureProof({ order, stage, note = '' }) {
    const user = SP.auth.current();
    if (!user) throw new Error('Sign in to submit a proof.');

    const file = await pickImage();
    if (!file) return null;

    const gps = await getPosition();
    if (SP.store.state.settings.requireGps && !gps) {
      SP.ui.toast({ tone: 'danger', title: 'GPS required', body: 'This workspace requires location on proofs. Enable location and retry.' });
      return null;
    }

    const img = await loadImage(file);
    const when = new Date();
    const gpsText = gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} (±${gps.acc}m)` : 'GPS unavailable';
    const stampLines = [
      `${order.ref} · ${SP.statusOf(stage).label || stage} · ${user.name} (${SP.auth.roleDef(user.role).label})`,
      `${SP.fmt.dateTime(when.getTime())} · ${gpsText}`,
    ];
    const dataUrl = stampImage(img, stampLines);

    const proof = {
      id: SP.uid('prf'),
      ref: SP.store.nextRef('proof'),
      orderId: order.id,
      orderRef: order.ref,
      stage,
      byId: user.id,
      byName: user.name,
      role: user.role,
      at: when.getTime(),
      dataUrl,
      stamp: { text: stampLines, gps, device: SP.auth.deviceLabel() },
      note,
      immutable: true,
    };

    SP.store.update(['proofs'], (st) => { st.proofs.unshift(proof); });
    SP.store.audit('proof.submit', proof.ref, `${order.ref} · ${stage} · ${gps ? 'GPS' : 'no GPS'}`);
    SP.api?.enqueue?.({ kind: 'proof.submit', id: proof.id, payload: { orderId: order.id, stage, dataUrl, gps, note } });
    return proof;
  }

  const forOrder = (orderId) => SP.store.state.proofs.filter((p) => p.orderId === orderId);

  /** Purge proofs older than N days (storage hygiene; audited). */
  function purgeOlderThan(days) {
    const cutoff = Date.now() - days * 864e5;
    let removed = 0;
    SP.store.update(['proofs'], (st) => {
      const before = st.proofs.length;
      st.proofs = st.proofs.filter((p) => p.at >= cutoff);
      removed = before - st.proofs.length;
    });
    if (removed) SP.store.audit('proof.purge', `${removed} proofs`, `older than ${days} days`);
    return removed;
  }

  return { captureProof, forOrder, purgeOlderThan, getPosition };
})();
