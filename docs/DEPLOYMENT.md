# Deployment — app.mybangjo.com (single runtime)

Xentra Core runs as a Node/Express app served by **CloudLinux Passenger** on the
cPanel host. `app.mybangjo.com` is the only runtime; legacy `dev.mybangjo.com` and
WordPress deploy paths were retired in `26ae28b` and must not be resurrected.

Code delivery is handled automatically: **push to `main` → GitHub Actions
(`.github/workflows/deploy-app.yml`) → SSH unzip to `/home/mybangjo/xentra-core` →
`npm install` → `tmp/restart.txt`** (Passenger restart).

The remaining piece is server-side: making the domain's vhost actually serve the
Express app through Passenger.

## Preflight (SSH)

```bash
ssh USER@HOST            # credentials in GitHub secrets: XENTRA_SSH_USER/HOST/PORT
# 1. Deployed code present & restart marker fresh
ls -la /home/mybangjo/xentra-core/app.js
ls -la /home/mybangjo/xentra-core/tmp/restart.txt
# 2. Node runtime works (match the venv used by the workflow: nodevenv/xentra-core/20)
/home/mybangjo/nodevenv/xentra-core/20/bin/node --version
# 3. Dependencies installed (workflow runs npm install; verify)
ls /home/mybangjo/xentra-core/node_modules/express/package.json
# 4. .env sanity (PORT, secrets; DEPLOY_TOKEN is no longer used by the app)
cat /home/mybangjo/xentra-core/.env   # never print secrets into chat
```

> Node version note: deploy-app.yml uses `nodevenv/xentra-core/20`
> (`package.json` requires `>=20.20.2`). Keep PassengerNodejs pointing at the
> same venv; the old template referenced `/22` — do not mix.

## 1. Find the vhost document root for app.mybangjo.com

cPanel → Domains shows the document root (commonly `/home/mybangjo/app.mybangjo.com`
for an addon domain, or `/home/mybangjo/public_html`). Confirm over SSH, e.g.:

```bash
grep -r "app.mybangjo.com" /home/mybangjo/.htaccess 2>/dev/null || true
# or ask cPanel: Domains > app.mybangjo.com > Document Root
```

## 2. Put the Passenger block in that docroot's .htaccess

`app.mybangjo.com/.htaccess` (docroot) must contain the CloudLinux Passenger
directives pointing at the app root:

```apache
# DO NOT REMOVE. CLOUDLINUX PASSENGER CONFIGURATION BEGIN
PassengerAppRoot "/home/mybangjo/xentra-core"
PassengerBaseURI "/"
PassengerNodejs "/home/mybangjo/nodevenv/xentra-core/20/bin/node"
PassengerAppType node
PassengerStartupFile app.js
PassengerAppLogFile "/home/mybangjo/xentra-core/passenger.log"
# DO NOT REMOVE. CLOUDLINUX PASSENGER CONFIGURATION END

# SPA fallback for customer PWA (keep /api and /health hitting Node)
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteCond %{REQUEST_FILENAME} -f [OR]
    RewriteCond %{REQUEST_FILENAME} -d
    RewriteRule ^ - [L]
    RewriteCond %{REQUEST_URI} !^/(api|health|assets|pwa|dashboard)/
    RewriteRule ^ index.html [L]
</IfModule>
```

The Express app itself serves `/api/v1`, `/assets`, `/pwa`, `/dashboard`, `/health`,
`/checkout`, `/order-received`, and falls back to the PWA `index.html` — no extra
routes needed inside Passenger.

## 3. Restart & confirm Passenger is serving

```bash
touch /home/mybangjo/xentra-core/tmp/restart.txt
tail -50 /home/mybangjo/xentra-core/passenger.log   # app boot / errors
# cPanel alternative: "Passenger" / "Restart App" for the domain
```

If the app crashes on boot, the domain falls back to 404s — read `passenger.log`.

## 4. Cloudflare

`app.mybangjo.com` is fronted by Cloudflare. After enabling Passenger:

1. **Purge cache** for the host (zone → Caching → Purge Everything) so stale
   origin responses are not served.
2. Confirm DNS/proxy points at the same origin the SSH deploy targets (compare
   `dig +short app.mybangjo.com` origin vs the server's IP).
3. Disable any page rule/worker that rewrites `/api/*` or `/health`.

## 5. Runtime verification (after every deploy)

```bash
# Health (expect JSON {"status":"ok","persistence":"ready",...})
curl -sS https://app.mybangjo.com/health

# Promo discovery — guest browser (expect discovery with should_show_banner=true)
curl -sS 'https://app.mybangjo.com/api/v1/promotions/active?is_pwa=0&phone='

# Promo entitlement — install requirement satisfied (is_pwa=1): running
# standalone OR accepted-install state in the same tab (pwa-runtime install_state).
# Seed reward targets product 401 (Es Teh); swap via promotion_rewards config — no source change.
curl -sS 'https://app.mybangjo.com/api/v1/promotions/active?is_pwa=1&phone='
```

Expected shapes (per `domains/promotion`, install-incentive):
- `is_pwa=0` → `promotions[].should_show_banner === true` → checkout renders the
  **Install** promo card.
- `is_pwa=1` → `applied[].should_grant_reward === true` with authoritative
  reward fields enriched from the catalog: `product_id`, `reward_price`, and
  `product_name`/`regular_price`/`image_url` → checkout renders **Claim**.

Pay (`POST /checkout/verify`) is NOT standalone-only: it evaluates the same
promotion contract from `pwa_runtime` (`display_mode === 'standalone'` OR
`install_state === 'accepted'`) while authority stays in the server DB checks
(promo active, first order, redemption ledger, branch/brand catalog, price).

Full UI flow (install banner → claim → remove → re-claim, single `checkout.items[]`,
no duplicates on reload) must be exercised in a real browser against the live host;
that remains a manual runtime check until an E2E harness exists.

## Failure modes to distinguish

| Symptom | Meaning |
|---|---|
| `/health` 200 JSON | Passenger serving the Express app ✅ |
| `/health` & `/api/*` → LiteSpeed/WordPress 404 page | Domain still on the old origin; Passenger `.htaccess` missing/inactive, or Cloudflare serving stale origin |
| `/health` 503 `{"status":"degraded"}` | App up, DB not ready (check `*.db` seeding/permissions) |
| `/health` 200 but `/api/v1/*` 404 JSON `TENANT_NOT_FOUND` | Host header not resolving to the `bangjo` brand (check `server/middleware/tenantResolver.js` — only `app.mybangjo.com` maps) |
