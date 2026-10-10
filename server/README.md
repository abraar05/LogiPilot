# LogiPilot API

The server for LogiPilot: orders, the chain state machine, photo proofs, users
and roles, sessions with TOTP, a hash-chained audit trail, reports and an SSE
realtime stream.

## Run it

```bash
cd server
npm install          # optional; only 'pg' is used, and only for Postgres
node src/bootstrap.js   # creates the first admin + a starter crew (once)
LP_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  npm start            # http://0.0.0.0:8787
```

With Docker:

```bash
cp .env.example .env   # fill LP_SECRET
docker compose up -d --build
docker compose exec api node src/bootstrap.js
```

## Storage

- **File adapter (default)** — atomic JSON snapshots in `$LP_DATA_DIR`
- **Postgres** — set `DATABASE_URL`; the `pg` driver is optional and loaded lazily

## API surface

| Area | Endpoints |
|---|---|
| Health/meta | `GET /api/v1/health`, `GET /api/v1/meta` |
| Auth | `POST /auth/signin` · `/signout` · `/password` · `/password/forgot` · `/password/reset` · `/totp/enable` · `/totp/confirm` |
| Users | `GET/POST /users` · `PATCH /users/:id` · `POST /users/:id/revoke` |
| Orders | `GET/POST /orders` · `GET/PATCH /orders/:id` · `POST /orders/:id/{assign,packed-qty,transition,cod}` |
| Proofs | `GET /proofs` · `POST /orders/:id/proofs` · `GET /proofs/:id/image` |
| Audit | `GET /audit` (includes chain verification) |
| Reports | `GET /reports/:kind` — summary · throughput · cycle_times · performance · proofs · orders · audit · cod (`?format=csv`) |
| Realtime | `GET /stream` (SSE) |

Authenticate with `Authorization: Bearer <token>`.
Mutations accept `Idempotency-Key`; order transitions accept `expectedVersion`
for optimistic concurrency (409 `VERSION_CONFLICT`).

## Tests

```bash
npm test    # 17 tests: lifecycle, RBAC, proofs, audit chain, SSE, parity
```

`test/parity.test.js` asserts the server state machine matches `js/config.js`
in the web app, so the two can never disagree about a legal transition.
