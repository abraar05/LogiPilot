# LogiPilot

**Pack · Approve · Deliver — every step proven.**

A dedicated logistics-operations app for the team that turns sales orders into delivered parcels:

- **Packing staff** prepare goods exactly as per the S/O — per-item checklist, scan-to-verify, then a stamped photo proof to finish.
- **QC approvers** check packaged items against the order, approve with a photo, or reject with a reason that sends it straight back to the packer.
- **Driver + delivery staff** carry and hand over; proof of delivery is a stamped photo (name, time, order ref, GPS when the device allows).
- **Supervisors/admins** assign work through the assignment panel and watch every queue.
- **Everyone** is accountable: immutable proofs, chain-of-custody timeline and audit log on every order.

## Live

**Web app:** https://abraar05.github.io/LogiPilot/

**Android APK:** https://github.com/abraar05/LogiPilot/releases

Demo accounts (delete before going live):

| Email | Password | PIN | Role |
|---|---|---|---|
| admin@logipilot.app | Admin@1234 | — | Administrator |
| super@logipilot.app | Super@1234 | 2468 | Supervisor |
| packer@logipilot.app | Pack@1234 | 1357 | Packing Staff |
| qc@logipilot.app | Qc@12345 | 9753 | QC Approver |
| driver@logipilot.app | Drive@1234 | 1111 | Driver |
| delivery@logipilot.app | Deliver@123 | 2222 | Delivery Staff |

## The chain

```
NEW → ASSIGNED → PACKING → PACKED (photo) → QC_APPROVED (photo)
    → OUT_FOR_DELIVERY → DELIVERED (photo)
          ↘ QC_REJECTED → back to PACKING
          ↘ FAILED → retry / RETURNED
```

Rules enforced by the engine, not by convention:

- Only the **assigned** person (or supervisor/admin) can move an order through a stage.
- PACKED, QC approval and DELIVERED **require a stamped photo proof** (configurable).
- Proofs are **immutable** — no edit, no delete; storage hygiene purges are audited.
- Every transition records who/when/why plus optional proof linkage.
- Wrong-role assignment, impossible state jumps and missing prerequisites are rejected with clear messages.

## Scanner

- **Camera scanning** (QR, Code-128/39, EAN, UPC, ITF, DataMatrix) via BarcodeDetector where the browser supports it — order barcodes open the order, item barcodes tick items during packing and QC.
- **Keyboard-wedge scanners** (USB/Bluetooth guns) work everywhere: scan ends with Enter and routes automatically.
- Where camera scanning is unsupported the app says so — it never pretends.

## Honesty notes

- GPS coordinates on proofs come only from the device with permission; otherwise the stamp says "GPS unavailable".
- Data is per-device (localStorage). Export backups in Settings → Backup & data.
- Client-side permissions prevent accidents; a real backend is required for hard security.

## Test

```
npm test        # full chain: 32 checks
npm run check   # syntax-check all modules
```
