# Xentra Core — REST API Specification

**Base Path:** `/api/v1`  
**Authentication:** Bearer JWT / API Key / Session Token

---

## 1. Customer & Ordering Endpoints

### `GET /api/v1/brand/info`
Resolves brand identity, theme, and logo based on the request domain/host header.
- **Headers:** `Host: app.mybangjo.com`
- **Response 200:**
```json
{
  "success": true,
  "brand": {
    "id": "brand_bangjo",
    "name": "Bangjo Resto",
    "primary_color": "#b6ff00",
    "logo_url": "/assets/brand/logo.png"
  }
}
```

### `POST /api/v1/delivery/match-branch`
Evaluates customer coordinates against candidate branches, calculates actual road distance via OSRM, and returns the nearest eligible branch with delivery fee.
- **Request Body:**
```json
{
  "latitude": -7.289166,
  "longitude": 112.734398
}
```
- **Response 200:**
```json
{
  "success": true,
  "eligible": true,
  "branch": {
    "id": "branch_sby_barat",
    "name": "Bangjo Surabaya Barat",
    "address": "Jl. Raya Darmo Permai No. 12"
  },
  "delivery": {
    "distance_meters": 3200,
    "distance_km": 3.2,
    "free_km": 2.0,
    "price_per_km": 2500,
    "delivery_fee": 3000,
    "estimated_duration_minutes": 18
  }
}
```

### `GET /api/v1/catalog/menu`
Returns categories and active menu items for the selected branch.
- **Query:** `?branch_id=branch_sby_barat`
- **Response 200:**
```json
{
  "success": true,
  "categories": [
    {
      "id": "cat_1",
      "name": "Menu Utama",
      "products": [
        {
          "id": "prod_1",
          "name": "Nasi Goreng Spesial",
          "description": "Nasi goreng dengan telur dan ayam suwir",
          "price": 25000,
          "image": "/images/nasgor.jpg"
        }
      ]
    }
  ]
}
```

### `POST /api/v1/checkout/create-order`
Validates cart items, computes final delivery fee, creates immutable order snapshot, and returns Midtrans Snap token.
- **Request Body:**
```json
{
  "branch_id": "branch_sby_barat",
  "customer": {
    "name": "Ikhwan",
    "phone": "08123456789"
  },
  "order_type": "delivery",
  "schedule_type": "asap",
  "delivery": {
    "address": "Jl. Kertajaya Indah No. 45",
    "latitude": -7.289166,
    "longitude": 112.734398
  },
  "items": [
    { "id": "prod_1", "quantity": 2, "note": "Pedas sedang" }
  ],
  "payment_method": "midtrans_snap"
}
```
- **Response 201:**
```json
{
  "success": true,
  "order_id": "ord_998811",
  "order_number": "XN-20260827-0001",
  "grand_total": 53000,
  "snap_token": "79b3c41a-8e2b-47de-a89c-5a956d3b9e4a",
  "redirect_url": "https://app.sandbox.midtrans.com/snap/v2/vtweb/79b3c41a..."
}
```

---

## 2. Kitchen & Operator Workspace Endpoints

### `GET /api/v1/kitchen/queue`
Retrieves live active orders for the branch kitchen display.
- **Query:** `?branch_id=branch_sby_barat`
- **Response 200:** List of `confirmed` & `preparing` orders with countdown timers.

### `PATCH /api/v1/kitchen/orders/:id/status`
Updates order status with atomic state machine transition and pushes real-time event.
- **Request Body:**
```json
{
  "status": "preparing",
  "actor": "kitchen_staff_1"
}
```

---

## 3. Webhook Endpoints

### `POST /api/v1/webhooks/midtrans`
Handles incoming asynchronous payment status notifications from Midtrans with transaction row-locking and idempotency key checks.


---

## Master Menu Composition APIs — 2026-09-29

These Owner-authoritative endpoints provide the structured Master Menu foundation.
They are not a replacement for the legacy Branch Override endpoint yet; that endpoint
is quarantined and will be contracted only after the new consumer paths are migrated.

### Master component vocabulary

- `GET /api/v1/admin/menu/components/:type`
  - `:type` = `flavor` | `complement` | `level`
  - optional query `active_only=true`
- `POST /api/v1/admin/menu/components/level/ensure-defaults`
  - idempotently creates the standard Level master only when the brand has no Level rows
  - defaults: `1 — Tidak Pedas`, `2 — Pedas Sedang`, `3 — Pedas Banget`, `4 — Super Pedas`
- `POST /api/v1/admin/menu/components/:type`
  - body: `{ name, slug?, sort_order? }`
- `PUT /api/v1/admin/menu/components/:type/:id`
  - body: `{ name?, slug?, sort_order?, is_active? }`
- `PATCH /api/v1/admin/menu/components/:type/:id/toggle`

All component records are Brand-scoped. Authorization is Owner/Brand-level and is
enforced by Core.

### Master Product composition

- `GET /api/v1/admin/products/:id/composition`
- `PUT /api/v1/admin/products/:id/composition`

PUT body:

```json
{
  "category_id": "…",
  "flavor_id": "…",
  "complement_ids": ["…", "…"],
  "level_id": "…"
}
```

Composition semantics:

- Kategori: required, one;
- Rasa: optional, one;
- Kelengkapan: optional, many, ordered by array position;
- Level: optional, one.

The API stores structured relations; it does not concatenate the composition into a
free-text Menu field.

**Important:** these APIs are the foundation for the new architecture. Customer PWA,
Merchant adoption, and Checkout must consume the canonical composition resolver when
those migration stages are activated.


### Canonical Branch Menu Read Model — 2026-09-29

- `GET /api/v1/admin/branches/:id/menu`

Returns the forward Merchant/Owner Branch Menu read model:

- Branch-scoped adopted Master Products;
- structured `menu_composition`;
- Branch Category memberships;
- Branch availability/stock state;
- Master Products available for adoption.

The response does not require Merchant clients to read legacy Branch Override fields.
Legacy `/admin/branches/:id/catalog` remains compatibility infrastructure during migration.
