# Production Diagnosis: Customer Google Login Not Working

**Date:** 2026-09-20
**Diagnosed by:** CLI-only, no browser interaction

## TL;DR

The PM2 process on xentra.cloud is running **old code** that does not contain
the broker routes. A simple `pm2 restart xentra-core` fixes it. No code changes
needed -- the files on disk are already correct.

## Root Cause

PM2 loaded `server/routes/api.js` BEFORE commit `496151c` (the broker routes)
was pushed. Every GitHub Actions deploy since Sep 10 has been **cancelled** due
to `cancel-in-progress: true` with rapid commits.

| Fact | Value |
|------|-------|
| PM2 process start time | 2026-09-20 03:34:31 UTC |
| Broker commit push time | 2026-09-20 05:14:44 UTC |
| Time gap | 1h 40m AFTER process started |
| Last successful VPS deploy | Sep 10 (10 days ago) |
| All deploy-vps.yml results | Cancelled or failed |

## Evidence

1. `POST /api/v1/customer/auth/broker/init` -> **404** from localhost:3001
2. `POST /api/v1/customer/auth/google` -> **200** (old route works)
3. Error log shows `api.js:665` -- matches OLD code line numbers
4. Git repo on disk: HEAD = `d8591ae` (has broker routes)
5. Running Express process: does NOT have broker routes
6. All 50+ deploy workflow runs since Sep 10: cancelled

## What Works (source on disk)

- Customer PWA (`checkout.js:2315`): calls `/customer/auth/broker/init` ok
- Customer PWA (`index.html:428`): handles `?customer_code=xnt_chdf_*` exchange ok
- Broker page (`auth-broker.html:225`): `mode=customer` routes correctly ok
- Server routes (`api.js:708,734,783`): broker init/exchange/google defined ok
- Auth config (`api.js:4838`): `google_enabled: true`, client ID present ok
- Live HTML (`app.mybangjo.com`): `v_20260920_pwa-cache-fix` with no-cache headers ok

## What Is Broken (running process)

- PM2 process loaded api.js BEFORE broker routes were added
- `/customer/auth/broker/init` -> 404
- `/customer/auth/broker/exchange` -> 404
- `/customer/auth/broker/google` -> 404

## Architecture

```
Customer tenant (app.mybangjo.com)
  -> POST /customer/auth/broker/init  -> broker_url
  -> redirect to xentra.cloud/auth/broker?mode=customer&brand_id=...
  -> Google GSI runs ONLY on xentra.cloud origin (authorized)
  -> broker POST /customer/auth/broker/google (server-side credential verify)
  -> xnt_chdf_* one-time handoff code
  -> redirect back to app.mybangjo.com/?customer_code=xnt_chdf_*
  -> POST /customer/auth/broker/exchange  -> xnt_cust_* session
```

The entire flow is correctly implemented in source. The running process just
never loaded the broker routes.

## Fix

### Immediate (1 command)

```bash
pm2 restart xentra-core
```

### Systemic (CI/CD)

Both `deploy-vps.yml` and `deploy-app.yml` have `cancel-in-progress: true`.
The test suite takes ~26 minutes. Any commit pushed within 26 minutes of
another cancels the in-flight deploy. Solutions:

- Remove `cancel-in-progress: true`
- Increase concurrency group timeout
- Split test job from deploy job
- Add manual deploy trigger
