# Run doc — Freebuff preview (customer PWA)

Environment: **Node.js is available** (v24.20.0, `node_modules` present). The full
Express server (`server/app.js`) runs the customer PWA **and** the live `/api/v1`
backend locally (native `node:sqlite` persistence; no `.env` required). Prefer
this over the static fallback for a real end-to-end preview.

## Reproduce uncommitted artifacts

None required to run. `node_modules` is installed (needed for Express/CORS/sql.js).
No `.env` is needed — the server boots standalone with `node:sqlite` (WAL mode).
The static `serve-static.ps1` path below exists only as a fallback if `npm`/Node
is ever unavailable.

NOTE (schema self-migration): a persistent `server/database/xentra.db` created
before the C2 schema used to crash boot on the `inventory_movements.mutation_id`
partial index. `db.js` now migrates that column (and
`branch_operation_logs.product_id`) with guarded `ALTER TABLE` statements
outside the CREATE TABLE batch, so stale file databases boot and migrate in
place — no manual DB reset required.

## Run the server

```powershell
# from the repo root
npm run start
```

- Server prints `[Xentra Core] Standalone SaaS Engine running on http://localhost:PORT`
  and serves the PWA at the domain root with the API under `/api/v1`.
- Default port **3000** (see `server/app.js`).
- **IMPORTANT:** this shell may export `PORT=0` (system env) — if the log shows
  `localhost:0`, the process bound an ephemeral port. Override explicitly:

```powershell
cmd /c "set PORT=3000 && npm run start"
```

- Verify: `curl http://127.0.0.1:3000/health` → `{"status":"ok",...}`.

### Static fallback (no Node)

```powershell
powershell -NoProfile -File .freebuff\serve-static.ps1 -Port 3000 -Root apps\customer-pwa
```

Serves only the static PWA (falls back to embedded `DEFAULT_CATALOG`; no live API).