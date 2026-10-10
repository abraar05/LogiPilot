# LogiPilot — Product Roadmap & Completion Lock

**Last updated:** 2026-10-10 · **Locked baseline:** `v1.1.0`

---

# 🔒 PART 1 — WHAT IS DONE AND LOCKED (v1.1.0)

Everything below is shipped, committed, tagged and verified. Treat it as the
**frozen baseline**: do not regress it while building the full stack.

## 1.1 Verified baseline

| Check | Result |
|---|---|
| Acceptance suite (`npm test`) | **40 / 40 passing** |
| Module mount smoke test | **10 / 10 modules** |
| Syntax check (`npm run check`) | clean |
| Live site | https://abraar05.github.io/LogiPilot/ (HTTP 200) |
| Android APK | signed (v1+v2), release `v1.1.0` |
| Git history | tagged `v1.1.0`, `stable` branch mirrors it |

## 1.2 Locked features (v1 — static PWA)

**Order chain (complete & enforced)**
- State machine: `NEW → ASSIGNED → PACKING → PACKED → QC_APPROVED → OUT_FOR_DELIVERY → DELIVERED`
- Branches: `QC_REJECTED` (rework loop), `FAILED` (retry / return), `CANCELLED`, `RETURNED`
- Illegal jumps, wrong roles, unassigned actors and missing prerequisites are **rejected by the engine**, not by convention
- Chain-of-custody timeline per order + immutable global audit log

**Photo proofs (immutable)**
- Camera capture, downscaled, stamped **in the pixels**: user, role, order ref, stage, timestamp, GPS (or honest "GPS unavailable")
- Cannot be edited or deleted through the app; purge is audited
- Proof gallery, per-order strip, full stamp detail, download

**Scanner**
- Camera scanning (BarcodeDetector: QR, Code-128/39, EAN-8/13, UPC-A/E, ITF, DataMatrix)
- Keyboard-wedge (USB/Bluetooth gun) support
- Resolution against order refs, order barcodes and item SKUs; unknown codes report honestly

**Roles & permissions (6 roles)**
- admin, supervisor, packer, QC approver, driver, delivery staff
- module×action permissions, warehouse-independent but role-scoped
- assignment enforcement, workload view, bulk assignment, enable/disable, session revocation

**Operations**
- Supervisor order editing before packing; cash-on-delivery amounts, collection at handover, outstanding tracking
- Delivery receipt + packing slip printing (print-to-PDF)
- Insights: throughput, stage cycle times, per-person performance, bottleneck detection, CSV export
- Demo workspace seed (labelled DEMO DATA, one-tap wipe)

**Platform**
- PWA (offline shell), localStorage persistence, backup/restore, drafts, dark/light/auto + 5 style presets
- i18n: English / বাংলা / 中文 with linked currency (BDT ৳ / CNY ¥ / USD $), app-wide
- Full icon system (0 unresolved icons), responsive down to 360px, keyboard + palette (Ctrl+K)

---

# 🧱 PART 2 — FULL-STACK BUILD LIST

Everything below is **not yet built**. It is the work required to take LogiPilot
from a client-side operations app to a production full-stack platform. Phases are
ordered by dependency; each phase ends with a shippable release.

## Phase A — Backend foundation (the platform)

- [ ] **Service architecture** — Node.js (Fastify/NestJS) API + Postgres + Redis
- [ ] **Repository layout** — `apps/api`, `apps/web`, `packages/shared`
- [ ] **Shared validation** — Zod schemas shared by client and server (one contract)
- [ ] **Migrations** — Prisma/TypeORM, versioned, reversible, seed strategy
- [ ] **Auth service** — server sessions (httpOnly cookies), refresh rotation, revocation, brute-force lockout server-side
- [ ] **MFA / OTP** — TOTP app + SMS OTP (real provider), recovery codes
- [ ] **Password reset** — real email delivery (Resend/SES), hashed reset tokens
- [ ] **RBAC enforcement server-side** — same permission matrix as v1, evaluated in the API, warehouse-scoped
- [ ] **Multi-tenant organisation model** — org → warehouses → locations; tenant isolation at query level
- [ ] **Idempotency keys** on every mutating endpoint (safe retries)
- [ ] **Error contract** — RFC-7807 style errors with trace ids
- [ ] **API versioning** — `/api/v1/*`, documented OpenAPI
- [ ] **Health checks** — liveness/readiness, dependency probes

## Phase B — Data & integrity

- [ ] **Server-side ledger of order events** (append-only event table)
- [ ] **Hash-chained audit records** (each entry commits the previous hash → tamper-evident)
- [ ] **Proof object storage** — S3-compatible, signed upload URLs, server-side thumbnail generation
- [ ] **EXIF stripping + GPS normalisation** on upload
- [ ] **Retention policies** — proof purge jobs, legal hold, user data deletion
- [ ] **Backups** — scheduled Postgres backups, point-in-time recovery, restore drills
- [ ] **Barcode catalogue** — server-side item master with GS1 parsing and assignment

## Phase C — Realtime & sync

- [ ] **WebSocket/SSE gateway** — queue updates, assignment pushes, live status
- [ ] **Offline outbox** — queue writes offline, replay in order on reconnect
- [ ] **Conflict detection & resolution** — field-level merge rules, user-visible conflicts
- [ ] **Sync status UI** — ONLINE / OFFLINE / SYNCING / SYNC ERROR / N pending
- [ ] **Push notifications** — Web Push + service worker, subscription management per user

## Phase D — Domain completeness

- [ ] **Returns / RMA flow** — return authorisation, inspection, restock or scrap, with proofs
- [ ] **Partial / split delivery** — deliver some items now, rest later, per-line receipts
- [ ] **Multi-stop runs** — one driver run, many orders, route order
- [ ] **Route & ETA** — real map routing provider, driver location trail, ETA to customer
- [ ] **Delivery windows & SLA** — promised windows, breach alerts, escalation rules
- [ ] **Re-packing / kit rules** — multi-item kits packed as one parcel
- [ ] **Inventory reservation** — reserve stock at order creation, release on cancel
- [ ] **Inbound purchasing** — PO creation, supplier, expected arrival, receive into stock (link to StockPilot ledger)
- [ ] **E-signature** — customer signature captured on the receipt canvas
- [ ] **Barcode label printing** — ZPL/TSPL label generation per parcel or item
- [ ] **Customer portal** — read-only tracking page per order (link + OTP)
- [ ] **Driver app view** — dedicated driver screen: run list, navigation, quick status change
- [ ] **Handover exceptions** — wrong address, refused, damaged in transit, partial acceptance

## Phase E — Reporting & intelligence

- [ ] **Report engine (server)** — same 20+ reports, async generation, PDF + CSV
- [ ] **Scheduled reports** — daily/weekly email digest to supervisors
- [ ] **Dashboards** — per-role dashboards, date range filters, saved views
- [ ] **Anomaly detection** — packing/QC time outliers, repeat rejections, suspicious GPS gaps
- [ ] **Predictive ETA** — model delivery duration from historical data

## Phase F — Integrations

- [ ] **WhatsApp Cloud API** — real order status messages, opt-in, templates
- [ ] **SMS provider** (Twilio/MSG) for OTP + delivery alerts
- [ ] **Email service** — order confirmations, receipts, password reset
- [ ] **Google Sheets / Drive export** — real sync of orders + proofs index
- [ ] **E-commerce sync** — pull orders from WooCommerce/Shopify
- [ ] **Accounting** — export COD/payments to a ledger (CSV/API)

## Phase G — Hardening, QA & operations

- [ ] **Automated tests** — unit (Vitest), integration (Supertest), e2e (Playwright)
- [ ] **Load testing** — k6 for concurrent packers/drivers (target: 500 users)
- [ ] **Security headers** — CSP, HSTS, X-Frame-Options, Referrer-Policy
- [ ] **Rate limiting** on auth, scan, upload endpoints
- [ ] **Secret management** — no secrets in code/CI logs; rotation plan
- [ ] **Dependency & SAST scanning** in CI (Dependabot, CodeQL)
- [ ] **CI/CD** — preview env per PR, migrations on deploy, blue/green, rollback
- [ ] **Observability** — Sentry errors, structured logs, uptime checks, alerts
- [ ] **Docker/compose** for local dev + single-node prod
- [ ] **Play Store release** — signed AAB, listing, staged rollout
- [ ] **Runbooks** — incident, restore, key rotation

## Phase H — Product polish (after backend)

- [ ] Complete i18n coverage (settings, modals, emails) + Crowdin workflow
- [ ] Offline PWA: install prompts, background sync, camera + file upload offline queue
- [ ] Accessibility audit (screen readers, contrast, focus)
- [ ] Bangla numerals/locale formatting, timezone handling per warehouse

---

## Version plan

| Release | Scope |
|---|---|
| `v1.1.0` | **locked baseline** (this document) |
| `v2.0.0-alpha` | Phase A: backend foundation + real auth |
| `v2.0.0-beta` | Phases B–C: data integrity, realtime, sync |
| `v2.0.0` | Phases D–E: full domain + reporting |
| `v2.1.0` | Phases F–G: integrations, hardening, ops |
| `v2.2.0` | Phase H: polish, a11y, store release |

## Non-negotiable rules for all future work

1. Never fake functionality — if a service is not connected, say so in the UI.
2. Every state change is server-validated; the client is never the authority.
3. Proofs are immutable and tamper-evident.
4. Offline is a first-class state, not an error.
5. Ship behind a flag; never regress the locked v1 chain semantics.