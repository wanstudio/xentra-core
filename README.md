# Xentra Core — Standalone Multi-Tenant & Multi-Branch SaaS Engine (v2.0.0)

Xentra Core adalah *Core SaaS Platform Engine* independen generasi berikutnya untuk pemesanan makanan & minuman (*Food & Beverage Ordering System*) dengan arsitektur **Multi-Tenant (Many Brands)** dan **Multi-Branch (Many Outlets)**.

---

## 🌟 Arsitektur & Fitur Unggulan

1. **Multi-Tenant & Hierarchical Entities:**
   - **Organization** (Holding / Enterprise)
   - **Brand** (Brand percontohan: *Bangjo Resto*)
   - **Branch** (Cabang *Surabaya Barat*, *Surabaya Timur*, dll.)
2. **Customer-First Spatial Routing & Branch Matching:**
   - Deteksi rute jalan aktual via OSRM (*Open Source Routing Machine*) dan pencarian alamat via Nominatim.
   - Otomatis mencocokkan cabang terdekat yang aktif berdasarkan koordinat pelanggan.
3. **Single Source of Truth Delivery Calculator:**
   - Formula: `(jarak_km - free_km) * price_per_km`.
   - Potongan promo ongkir otomatis jika subtotal mencapai target belanja.
4. **Direct-to-Merchant Payment Ownership (Anti-Escrow):**
   - Tidak ada penahanan dana merchant (*No escrow*).
   - Kredensial Midtrans di-resolve secara bertingkat: `Branch` ➡️ `Brand` ➡️ `Organization`.
5. **Customer Mobile Ordering PWA (`apps/customer-pwa`):**
   - Single Page Application cepat bertema identitas visual `#b6ff00` dan Plus Jakarta Sans.
   - Interactive map location picker, floating bottom dock, dan alur checkout instan.
6. **Kitchen Display System (`apps/kitchen-display`):**
   - Layar antrean dapur resto realtime untuk manajemen status pesanan (`confirmed` ➡️ `preparing` ➡️ `ready` ➡️ `out_for_delivery` ➡️ `completed`).

---

## 📁 Struktur Direktori

```
xentra-core/
├── docs/                           # Dokumentasi & Spesifikasi
│   ├── ARCHITECTURE.md             # Blueprint Sistem & Domain Boundaries
│   ├── DATABASE_SCHEMA.md          # Skema Tabel & Relasi Multi-Tenant
│   └── API_SPECIFICATION.md        # Spesifikasi REST Endpoints & Webhooks
│
├── server/                         # Backend Core Engine (Node.js REST API)
│   ├── database/db.js              # SQLite Engine + Multi-Tenant Seeders
│   ├── middleware/tenantResolver.js# Multi-Tenant Domain & Header Resolver
│   ├── services/                   # Domain Logic Services
│   │   ├── DeliveryCalculator.js   # Single Source of Truth Formula Ongkir
│   │   ├── RouteService.js         # OSRM Road Distance & Nominatim Geocoding
│   │   ├── BranchMatcher.js        # Nearest Eligible Branch Spatial Matcher
│   │   ├── OrderStateMachine.js    # State Machine Siklus Pesanan & Audit Log
│   │   └── PaymentService.js       # Midtrans Snap & Webhook Idempotency
│   ├── routes/api.js               # REST API Endpoints
│   └── app.js                      # Express App Server Entry Point
│
├── apps/
│   ├── customer-pwa/               # Customer Mobile Ordering Web App
│   └── kitchen-display/            # Kitchen Display System (Layar Antrean Dapur)
│
├── tests/                          # Automated Test Suite (100% Pass)
│   ├── deliveryCalculator.test.js  # Uji Formula Ongkir & Promo Diskon
│   ├── orderStateMachine.test.js   # Uji Transisi Status & Audit Log
│   └── apiEndpoints.test.js        # Uji End-to-End REST API
│
├── app.js                          # Root Startup File (Passenger Compatible)
└── package.json                    # Scripts & Dependencies
```

---

## 🧪 Menjalankan Automated Test

```bash
npm test
```

Semua 9 test suite terverifikasi 100% lulus uji:
```
✔ API GET /api/v1/brand/info
✔ API GET /api/v1/catalog/menu
✔ API POST /api/v1/checkout/create-order
✔ DeliveryCalculator: within free distance should have 0 fee
✔ DeliveryCalculator: beyond free distance calculates exact formula
✔ DeliveryCalculator: beyond max radius should be ineligible
✔ DeliveryCalculator: applies promo discount if subtotal threshold met
✔ OrderStateMachine: enforces strict transition rules
✔ OrderStateMachine: transitions order and inserts audit log

ℹ tests 9 | pass 9 | fail 0
```

---

## 🚀 Menjalankan Server Lokal

```bash
node app.js
```
Akses di browser:
* 📱 **Customer PWA:** `http://localhost:3000/`
* 🍳 **Kitchen Display:** `http://localhost:3000/kitchen/`
* 🩺 **Health Check:** `http://localhost:3000/health`
