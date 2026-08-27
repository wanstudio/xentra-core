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
