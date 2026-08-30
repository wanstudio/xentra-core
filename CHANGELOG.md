## [2.2.2] — 2026-08-30

### Banner Promo + PWA Install (cache-bust)

- Cache-bust semua HTML: `PWA_VERSION` `v2_1_3/v2_1_4` → `v2_2_2`, `?v=...` → `?v=2.2.2`, `CACHE_NAME` `bangjo-core-v2xx` → `bangjo-core-v222` — perbaiki "tidak tampak perubahan" karena SW/HTML masih cached v2.1.3.
- Checkout banner abu-abu muda + `iced-tea.png` sudah ada (v2.2.1) — tidak diubah lagi.
- Tombol **Install** di banner checkout sekarang fungsional:
  - Android: pakai `beforeinstallprompt` (`deferredPrompt.prompt()`) → dialog install PWA native.
  - iOS: tampilkan sheet panduan 3 langkah Share → Tambah ke Layar Utama → Tambah.
  - Saat klik **Install**, otomatis tambah item **Es Teh Rp0** (`promo-es-teh-gratis`, `price:0`, `regular_price:5000`, `image_url:/assets/img/iced-tea.png`) ke cart via `Store.addItem`, render ulang list + `calculateTotals` — gratis tetap saat submit (backend validasi `price` dari produk jika ada, tapi untuk promo ini `price:0` ikut `validatedItems`).
  - Sudah terpasang / `appinstalled` juga dapat gratis.

---

## [2.2.1] — 2026-08-30

### Promo Banner — abu-abu muda + asset lokal iced-tea

- Banner checkout `x-alt-promo-banner` dari `background:#1f2428` (dark) → `#ececec` (abu-abu muda) sesuai Image 2 target — headline `color:#111`, sub `syarat & ketentuan berlaku` di bawah headline.
- Layout `display:grid` 3-kolom → `display:flex` (iced-tea kiri `56px`, copy tengah flex, tombol Install kanan) — `gap:12px`, `padding:10px 14px`, `border-radius:14px`, responsive `max-width:380px` `48px`.
- Asset `iced_tea.png` (72x65 PNG 7.5K) → `apps/customer-pwa/assets/img/iced-tea.png`, `checkout.js` `src` dari `https://images.unsplash.com/...` → `/assets/img/iced-tea.png` (`object-fit:contain`, `background:transparent`).
- Tidak ada rewrite/mock/preview HTML — hanya patch CSS/JS existing (`checkout.css`, `checkout.js`) + asset.

---

# Changelog — Xentra Core

## [2.2.0] — 2026-08-30

### 🔵 Checkout Alternative 2 — Wiring ke flow xentra-core existing (no mock)

Checkout `apps/customer-pwa` sekarang replica pixel **Checkout Bangjo** tapi 100%% lewat service existing:

| Aspek | Sebelum | Sesudah |
|-------|---------|---------|
| Ongkir/diskon | `state.deliveryFee/state.discount` hardcode 12000/7000 | `POST /delivery/match-branch` via `BranchMatcher` + `RouteService` (OSRM/Haversine) + `DeliveryCalculator.calculate()` — single source of truth |
| Upsell rail | `fallback-1/2/3 Es Jeruk` statis + try `/catalog/upsell` | `GET /catalog/menu` (reuse catalog service), filter cart, fallback `/catalog/upsell` |
| Submit | `POST /checkout/submit` mock `customer_name/customer_phone` + `product_id` + `price` | `POST /checkout/create-order` kontrak existing `{branch_id, customer:{name,phone}, order_type, fulfillment, delivery/address, items:[{id,quantity,note}], payment_method}` — immutable snapshot, `branch_delivery_settings` + `order_deliveries/order_payments` |
| State | `fulfillment.scheduled` hilang | `scheduled` + `scheduled_slot_start` |
| Empty cart | kosong | seed demo Mie Gurith x5 + Es Teh x1 untuk preview desainer |

Visual: `assets/css/checkout.css` append scoped `.x-checkout-alt2` 278 baris (banner dark Install/es teh, card Mie Gurith 17k→15k + Es Teh, rail Es Jeruk, card delivery/pickup, alamat Rumah Gw, ringkasan strike 42k→35k, COD/Online, trust midtrans, sticky Pesan sekarang).

### 🟢 Backend & Test Fixes

| Fix | File | Sebab |
|-----|------|-------|
| `order_items.item_note → note` | `server/routes/api.js` | schema kolom `note`, sebelumnya 500 |
| `products.slug` NOT NULL | `server/database/syncWoo.js` | live sync Woo tanpa slug |
| `DeliveryCalculator` ineligible return `free_km/price_per_km/discount_label` | `server/services/DeliveryCalculator.js` | `order_deliveries.rate_per_km_applied` jadi null → SQLite param 9 error |
| branch seed balik `Surabaya Barat -7.2912,112.7154` | `server/database/db.js` | test payload dekat branch, Pringsewu bikin out-of-radius |
| `orders.customer_name` fixture | `tests/orderStateMachine.test.js` | NOT NULL constraint |
| `NODE_ENV=test` isolasi DB per pid + skip `syncWoo` + guard `app.listen` | `server/database/db.js`, `server/app.js` | WAL `database is locked` saat `node --test` parallel |

Tests: `13/13 pass` (`deliveryCalculator 4 + orderStateMachine 2 + apiEndpoints 7`). Midtrans sandbox error `Access denied` expected (dummy key) → fallback `sim_snap_*`, order tetap 201.

### Ops

- `package.json` `2.0.0 → 2.2.0`, `server/app.js` `/health` version `2.2.0`
- `.gitignore` tambah `*.db` (xentra.db runtime tidak ikut deploy)
- Deploy: `deploy-core.sh` `target=core` ke `/home/mybangjo/xentra-core` via `app.mybangjo.com/wp-json/xentra/v1/deploy`

---

## [2.1.0] — 2026-08-30

### 🔴 Database Schema Fixes (BREAKING — DB direset)

File SQLite `xentra.db` sudah dihapus dan akan di-recreate otomatis saat
server di-start ulang. Semua data lama (orders, products, dll) akan di-seed
ulang dari `seedData()`.

| Sebelum (schema lama)      | Sesudah (match kode)        | File yang diperbaiki |
|----------------------------|-----------------------------|----------------------|
| `delivery_orders`          | `order_deliveries`          | `db.js` schema       |
| `payments`                 | `order_payments`            | `db.js` schema       |
| `order_status_audit`       | `order_status_logs`         | `db.js` schema       |
| `branch_settings` (di kode)| `branch_delivery_settings`  | `api.js`, `BranchMatcher.js` |

**Kolom yang juga diseragamkan:**
- `order_deliveries`: tambah `destination_address`, `destination_latitude`,
  `actual_road_distance_meters`, `chargeable_distance_km`, dll
- `order_payments`: tambah `merchant_id`, `snap_token`, `payment_status`,
  `raw_webhook_response`, `settled_at`
- `order_status_logs`: `from_status`→`previous_status`, `to_status`→`new_status`,
  `changed_by`→`actor_type`+`actor_id`
- `branch_delivery_settings`: `max_delivery_radius_km`→`max_radius_km`,
  `delivery_enabled`→`is_delivery_active`, `promo_config`→`promo_delivery_discount`+`promo_min_order`

**Tabel baru ditambahkan ke schema:**
- `product_categories` (junction table untuk relasi produk-kategori multi)

### 🟠 Brand ID Consistency

| Komponen          | Lama                   | Baru            |
|-------------------|------------------------|-----------------|
| `tenantResolver`  | `brand_bangjo_master`  | `brand_bangjo`  |
| `memoryStore`     | `brand_bangjo_master`  | `brand_bangjo`  |
| `seedData()`      | `brand_bangjo` (sudah) | `brand_bangjo`  |

### 🟡 Redundant Files Cleanup

File berikut dipindahkan ke `assets/js/_deprecated/` (tidak dihapus, bisa
di-recover):

| File Lama                    | Alasan                                    |
|------------------------------|-------------------------------------------|
| `assets/js/app.js` (568 ln)  | Duplikat `pages/home.js` versi lama       |
| `assets/js/checkout.js` (173KB)| Copy paste dari WP production plugin    |
| `assets/js/home.js` (1317 ln) | Campuran XentraNav + WP production logic |
| `assets/js/store.js` (168 ln) | Duplikat `core/store.js`, localStorage key beda |
| `sw.js`                       | Identik dengan `service-worker.js`       |

### File Canonical (yang dipakai)

```
assets/js/
├── core/
│   ├── api.js       ← API wrapper
│   ├── nav.js       ← XentraNav back-button handler
│   ├── router.js    ← SPA hash-based router
│   ├── store.js     ← CANONICAL store (localStorage key: xentra_v2_*)
│   └── ui.js        ← Utility helpers (money, escape)
├── pages/
│   ├── home.js      ← CANONICAL home controller
│   ├── checkout.js  ← CANONICAL checkout controller
│   └── order-received.js
├── dashboard.js     ← Merchant dashboard
├── location.js      ← Location helper
└── _deprecated/     ← File lama (safe to delete after verification)
```

---

## Cara Revert

Jika terjadi masalah, gunakan salah satu cara berikut:

### Revert commit saja (buat commit baru yang membatalkan):
```bash
cd xentra-core
git revert HEAD
```

### Hard reset ke save point (buang commit v2.1.0 sepenuhnya):
```bash
cd xentra-core
git reset --hard aafe903
```

### Git log untuk referensi:
```
12f724e (HEAD) v2.1.0: Audit cleanup
aafe903          SAVE POINT: sebelum audit cleanup
efc6f23          Initialize Xentra Core v2.0.0
```

---

## Known Issues (belum diperbaiki di v2.1.0)

1. **Upsell endpoint hardcoded** — `/catalog/upsell` masih return array statis,
   belum query DB
2. **Addresses hanya di memory** — belum ada tabel `addresses` di schema,
   data hilang saat server restart
3. **Auth login password** — masih pakai plaintext comparison + backdoor
   `bangjo123`
4. **`syncWoo.js` price normalization** — logika `price >= 100000 ? price/100`
   bisa salah untuk produk yang memang harganya di atas Rp 100.000
