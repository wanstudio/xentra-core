# Xentra Core — Technical Architecture Specification

**Version:** 2.0.0 (Standalone Multi-Tenant & Multi-Branch Restaurant SaaS)  
**Status:** Canonical Engineering Specification

---

## 1. System Overview & Hierarchy

Xentra is an enterprise-grade, multi-tenant digital ordering and restaurant operations platform. It powers customer-facing digital ordering (PWA), branch selection, routing calculations, direct-to-merchant payment processing, real-time kitchen queues (KDS), and aggregate business reporting.

### Core Domain Hierarchy:
```
Organization (Holding / SaaS Account)
  └── Brand (e.g., Bangjo, CoffeeBrand, BurgerCo)
        ├── Branch (Physical / Cloud Kitchen Location)
        │     ├── Fulfillment Schedules (Delivery, Pickup, Dine-in)
        │     ├── Delivery Settings (Radius, Rates, Free Distance)
        │     ├── Workspaces (Kitchen Display, Cashier, Courier)
        │     └── Live Stock & Menu Availability
        └── Menus & Categories (Master Products, Prices, Modifiers)
```

---

## 2. Core Architectural Principles (Non-Negotiable)

1. **Single Source of Truth Delivery Calculator:**  
   - Frontend never calculates or dictates delivery fees.
   - Distance is computed via road routing providers (OSRM / OpenStreetMap Nominatim).
   - Delivery fee formula: `(actual_road_distance_km - free_km) * price_per_km`.
   - Maximum radius validation is enforced strictly on the backend.
2. **Customer-First Branch Matching:**  
   - Customer enters delivery location.
   - Spatial pre-filtering identifies candidate branches within straight-line bounding radius.
   - Eligibility check: branch active, fulfillment open, road distance <= `max_radius_km`.
   - The nearest eligible branch is assigned automatically.
3. **Transaction Snapshotting (Immutable Historical Data):**  
   - An order permanently freezes: product names, prices, modifiers, delivery address, coordinates, road distance, delivery fee formula, and payment gateway account IDs.
   - Future menu price adjustments or address edits NEVER distort past financial reports.
4. **Direct-to-Merchant Payment Flow (Zero Escrow):**  
   - Orders resolve payment gateway credentials hierarchically (`Branch` ➡️ `Brand` ➡️ `Organization`).
   - Customer payments flow directly into the merchant's bank account via Midtrans.
   - Refunds call the Midtrans Refund API against the captured transaction ID directly.
5. **Real-Time Event Driven State Machine:**  
   - Order States: `Pending` ➡️ `Confirmed` ➡️ `Preparing` ➡️ `Ready` ➡️ `Out for Delivery` ➡️ `Completed` (or `Cancelled`, `Rejected`, `Refunded`).
   - State changes trigger Server-Sent Events (SSE) / WebSockets to update the customer PWA and kitchen display simultaneously.
6. **Two-Phase Cash vs. Financial Status Lifecycle (Industry F&B Standard):**  
   - **Kitchen / Order Fulfillment Status (`orders.status`)**: Decoupled from physical cash collection. For cash orders (COD / Table Dine-in), `orders.status` is set to `confirmed` upon submission so the kitchen can immediately prepare the food and stock is reserved.
   - **Financial Settlement Status (`order_payments.payment_status`)**: Remains `pending` (outstanding receivable) until physical banknotes are received and settled by the cashier at the POS or confirmed by the delivery courier.
   - **Shift Cash Report**: Cashier shift reports only account for cash payments transitioned to `settlement`, ensuring 100% accurate drawer balancing without premature uncollected cash inflation.

---

## 3. Module Boundaries & Clean Architecture

```
┌──────────────────────────────────────────────────────────┐
│             PRESENTATION / WORKSPACES                    │
│   (Customer PWA, Kitchen Display KDS, Admin Dashboard)   │
└────────────────────────────┬─────────────────────────────┘
                             │ (HTTPS REST API / WebSockets)
┌────────────────────────────▼─────────────────────────────┐
│                   API GATEWAY LAYER                      │
│   (Tenant Domain Resolver, Rate Limiter, Auth Guard)     │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│                 APPLICATION SERVICES                     │
│  - BranchMatchingService       - OrderOrchestrator       │
│  - DeliveryCalculatorService   - PaymentOrchestrator     │
│  - KitchenQueueService         - NotificationService     │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│             DOMAIN ENGINES & REPOSITORIES                │
│  - Routing Engine (OSRM)       - State Machine Engine    │
│  - Payment Gateway (Midtrans)  - Audit Logger Engine     │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│                    DATABASE LAYER                        │
│             (PostgreSQL / MySQL / SQLite)                │
└──────────────────────────────────────────────────────────┘
```
