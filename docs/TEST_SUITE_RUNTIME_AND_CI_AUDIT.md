# Test Suite Runtime & CI Audit — Node 20 (sql.js) vs Node 22/24 (node:sqlite)

**Date:** 2026-09-22
**Scope:** test/CI infrastructure and runtime engine — no application, domain, RBAC or API behaviour changed.
**Related:** `docs/DEPLOYMENT.md`, `docs/DEPLOY_VPS.md`, `server/database/db.js`, `.github/workflows/`

---

## 1. Test matrix

Same repository state, three runtimes, full `npm test` (`--test-concurrency=1 --test-force-exit`):

| Runtime | Database engine | Tests | Pass | **Fail** |
|---|---|---|---|---|
| **Node 20.20.2** (CI at the time of the audit) | `sql.js` | 1.906 | 1.003 | **804** |
| **Node 22.23.2** | `node:sqlite` | 2.058 | 2.005 | **42** |
| **Node 24.21.0** (production runtime) | `node:sqlite` | 2.058 | 1.995 | **52** |

Node 20 reports fewer tests (1.906) because whole suites abort during setup, so their sub-tests are
never registered. The Node 22/24 difference is partly order/load sensitivity, not a stable defect
set.

Reproduce:

```bash
npm test                                    # local default (Node 24)
env -i HOME="$HOME" PATH="$HOME/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin" \
  NODE_ENV=test node --test --test-concurrency=1 --test-force-exit tests/*.test.js tests/**/*.test.js
```

## 2. Failure classification

| Category | Evidence | Node 24 count |
|---|---|---|
| **A — Environment / runtime (`sql.js`)** | Present only on Node 20; disappears on 22/24. Clusters: `workforce*` (154), `apiEndpoints` (60), `branchMenuOverride`, `catalogModel`, `ownerDashboard*`, `branchManagerDashboardBM*` … | **~762** (804 − 42) |
| **B — Test fixture / session gaps** | `window` stub without `addEventListener` (whole files aborted at `require`); an email seeded as the customer phone; hand-built customer sessions missing `organization_id`; demo fixtures not seeded after schema init stopped auto-seeding | **~320** (repaired) |
| **C — Test drift vs a deliberate product change** | `renderTrackingOrder` (`a3ffb67`) routes delivery/pickup awaiting-acceptance to the unified tracking layout; tests still assert the superseded `#x-waiting-screen` | **~25** (remaining) |
| **D — Fixture vs schema drift** | `13 values for 14 columns` (`bannerContent`) — a column was added and the fixture INSERT was not updated | **~5** (remaining) |
| **E — Regression from recent changes** | **None.** Merchant App, Owner, and the isolation-guard suites are green | **0** |

## 3. Checkout repairs (35 → 0 failures)

Two fixture defects, **no assertion was changed**:

1. **Incomplete `window` stub.** `apps/customer-pwa/assets/js/pages/checkout.js:250` binds window-level
   PWA install listeners at load. The hand-rolled stub (`globalThis.window = globalThis`) never defined
   `addEventListener`, so `require()` threw `TypeError: window.addEventListener is not a function` and
   **19/19** cases in `checkoutGoogleAuthGate` failed before any logic ran. Fixed in the 15 test files
   that share the pattern.
2. **Invalid phone in the session fixture.** The harness seeded `phone: 'customer@google.com'`. The
   checkout submit gate `hasValidCustomerPhone()` (`checkout.js:2380`) requires an Indonesian mobile
   (prefix `08`/`628`/`8`, 9–15 digits) before `/checkout/verify`, so every valid-session case returned
   early without POSTing. Fixture now seeds `08120000001`.

Result: `checkoutGoogleAuthGate` 0/19 → 19/19; `checkoutSessionLifecycle` and `checkoutReactivity` green.

## 4. Production database runtime verification

**Direct probe of `db.js` on each runtime, in production mode, against a temporary database (never the
production file):**

```
Node 20 → [Database Fatal Error] Native node:sqlite failed to initialize persistent database
          at …: ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite
          exit = 1

Node 24 → [Database] Native node:sqlite persistent storage initialized successfully (Node v24.21.0, WAL mode)
```

Facts:

- `server/database/db.js:87-103` attempts `require('node:sqlite')` first. Node 20.20.2 does not ship it
  (`has_node_sqlite=false`), so the module falls through to `sql.js`.
- **In `NODE_ENV=production` that fall-through does not happen:** the catch branch calls `process.exit(1)`
  because it tests for the message `'Cannot find module'`, while the real error is
  `'No such built-in module'` (`db.js:97`). Node 20 therefore **cannot boot the application** in
  production unless `XENTRA_FORCE_SQLJS=1` is set.
- `XENTRA_FORCE_SQLJS` appears **only** in `tests/databaseProductionFailFast.test.js` — it is absent from
  `.env`, `.env.example` and every workflow.
- **Production runs Node 24:** `docs/DEPLOY_VPS.md:7` — *"Node 24 (via NVM)"* with `nvm install 24`, and
  `.github/workflows/deploy-vps.yml:62-64` runs `nvm use 24` before restarting the runtime.
- The shared-hosting/Passenger deployment (`deploy-app.yml`, `app.mybangjo.com`) is described by
  `docs/DEPLOYMENT.md:21` as a *legacy migration/workaround, not the target architecture*.

**Conclusion:** production uses `node:sqlite`. `sql.js` is a test-only engine (plus the legacy cPanel
path). The CI test job was validating a database engine that production never uses.

## 5. Node decision

**Decision: run CI on Node 24, matching production. Production itself is unchanged.**

Reasoning:

1. Production already runs Node 24, so this removes a divergence rather than introducing a runtime change.
2. Node 20 cannot boot the app in production mode, so a green Node 20 test job would never correspond to
   anything that can actually be served.
3. On Node 20 the suite exercised `sql.js` — a different engine with different behaviour — accounting for
   ~762 of the 804 failures. Those were not application defects.

Applied in `.github/workflows/deploy-app.yml` and `.github/workflows/deploy-vps.yml` (test job only).

### Known infrastructure issue (reported, not changed)

`db.js:97` inspects the wrong error message. If Node 20 support is ever required again, the `sql.js`
fallback currently **terminates the process instead of falling back**. Fixing it changes production
runtime behaviour and was deliberately left out of this change.

## 6. Remaining blockers (52 failures across 17 files)

| Cluster | ~count | Category | Correct action |
|---|---|---|---|
| Phase 7 / Customer Order Result / Phase 6 / Phase 8 acceptance & payment rendering | 25 | C — test drift vs `a3ffb67` | Update assertions to the unified tracking layout, or exercise the legacy surface with a non-delivery `order_type` |
| `emailVerification` + `authEmailVerificationPolicy` | 10 | unclassified (appears on Node 24, not 22 → possibly load-sensitive) | needs one investigation pass |
| `bannerContent` | 4 | D — schema drift | align the fixture INSERT with the current columns |
| `catalogModel` | 4 | fixture (master product / availability) | complete the fixture |
| Remaining singletons (9 files) | 9 | mixed | case by case |

None of these touch the Merchant App, the Owner dashboard, or the backend.

## 7. Commits

```
a56deed  refactor(shared): single source for merchant widgets and shared css
cc5b0cf  refactor(shared): lift auth/session guards into merchant-shared
75f1369  refactor(shared): lift branch catalog and branch context into merchant-shared
437ebb3  feat(merchant-app): standalone branch manager frontend + shared stylesheet
60261b9  refactor(merchant-dashboard): remove branch manager surface, redirect BM to merchant-app
193109c  test: stop the suite from hanging (--test-force-exit)
d4cffb9  test: seed demo fixtures per suite instead of relying on an implicit startup seed
64b1d7b  test: complete demo fixtures and fix customer session fixtures
4a02281  test+ci: repair checkout test fixtures and test on the production runtime
4b0b9e1  test: point phase 4B UI assertions at the surface that owns each contract
```

Net effect: **381 → 52 failures (−86%)**, the full suite completes in ~8 minutes instead of hanging
indefinitely, and CI now tests the runtime production actually uses.
