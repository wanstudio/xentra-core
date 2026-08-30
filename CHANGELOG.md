# Changelog — Xentra Core

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
