# Xentra Driver PWA — UX / IA Contract v1

**Status: LOCKED — MVP UX / IA BASELINE**  
**Date:** 2026-10-06  
**Depends on:** `docs/decisions/driver-cod-happy-path-validation-v1.md`

## Purpose

This document locks the UX and information architecture baseline for the Xentra Driver PWA.

The Driver PWA is an **execution tool for delivery drivers**, not a reduced Merchant Dashboard. Its interface is task-driven and state-driven: the Driver should always understand **what state the delivery is in, where the destination is, and what the next action is**.

This contract intentionally covers the MVP happy path only. Exception flows remain a separate layer.

---

## 1. Core mental model

The Driver PWA follows:

**State → Context → Next Action**

At any point, the Driver should be able to answer within a few seconds:

1. **Saya sedang di tahap apa?**
2. **Saya harus berada di mana?**
3. **Apa tindakan saya berikutnya?**

The UI must translate authoritative backend state into a clear next action. The Driver should not need to understand internal state-machine terminology.

---

## 2. Primary information architecture

### Bottom navigation

The MVP has only three primary navigation destinations:

1. **Tugas**
2. **Riwayat**
3. **Profil**

There is intentionally **no dedicated Kas / Settlement menu** for Driver.

### Tugas

The Driver's operational home.

- Tugas Baru
- Tugas Aktif
- COD custody status when applicable

### Riwayat

Completed delivery history.

- Delivery list
- Delivery detail
- COD handover status where applicable

This is operational history, not a financial reporting dashboard.

### Profil

Driver identity and operational settings.

- Driver identity
- Availability
- Vehicle
- Preferred navigation app
- Help
- About
- Sign out

---

## 3. Locked UI vocabulary

| Domain concept | Driver UI vocabulary |
|---|---|
| Driver | Driver |
| Availability | **Tersedia / Tidak tersedia** |
| Delivery Job | **Pengantaran** |
| Assignment | **Tugas** / **Penugasan** |
| Order | **Pesanan** |
| Customer | **Pelanggan** |
| Destination | **Tujuan** |
| Assigned | **Ditugaskan** |
| Assignment accepted | **Tugas diterima** |
| Pickup | **Ambil Pesanan** |
| Picked up | **Pesanan Diambil** |
| On delivery | **Sedang Diantar** |
| Delivered | **Terkirim / Pengantaran Selesai** |
| COD | **COD / Bayar di Tempat** |
| COD collected | **Uang COD Diterima** |
| Driver cash custody | **Uang di Tangan Anda** |
| Cash handover | **Serah Terima ke Kasir** |
| Payment settlement | **Penyelesaian Pembayaran** |

### Vocabulary rule

Do not expose technical state-machine vocabulary such as `picked_up`, `on_delivery`, `cod_collection_status`, or `cash_custody` directly to the Driver.

The UI translates system state into operational language.

Availability should use **Tersedia / Tidak tersedia**, not merely **Online / Offline**, because internet connectivity and willingness to receive new assignments are different concepts.

---

## 4. State-to-screen / CTA framework

The primary interaction model is **One Dominant Action**.

| Authoritative state | Driver-facing state | Primary CTA |
|---|---|---|
| assigned + assignment pending | Tugas Baru | **Terima Tugas** |
| assigned + accepted | Siap Ambil | **Ambil Pesanan** |
| picked_up | Pesanan Sudah Diambil | **Mulai Antar** |
| on_delivery | Sedang Mengantar | **Selesaikan Pengantaran** |
| delivered + COD collected | Pengantaran Selesai | **Lihat Ringkasan** |

The UI must never invent an action that is not permitted by the current authoritative state.

The primary CTA must remain visually dominant. Secondary actions must not compete with it.

---

## 5. Page framework

### 5.1 Tugas

Framework:

**Availability → Active Task → Incoming Tasks → Empty State**

The page should prioritize:

- availability
- current active delivery
- newly assigned tasks
- clear empty state

Do not put merchant KPIs, revenue charts, inventory, or unrelated operational metrics here.

---

### 5.2 Tugas Baru

Framework:

**What → Where → Amount → Decision**

Show only information needed to decide whether to accept the assignment:

- delivery/order identifier
- customer
- destination
- COD amount when applicable
- basic distance/context when available

Primary actions:

- **Terima Tugas**
- **Tolak**

This is a decision screen, not a full order-detail workspace.

---

### 5.3 Detail Pengantaran

Framework:

**Status → Destination → Order → Payment → Action**

Typical structure:

- current delivery status
- customer and destination
- navigation entry point
- order summary
- COD summary when applicable
- one dominant next action

---

### 5.4 Ambil Pesanan

The Driver must clearly understand:

- which branch/counter to collect from
- which order is being collected
- order summary
- COD amount if applicable

Primary CTA:

**Ambil Pesanan**

After successful pickup, the next state becomes explicit:

**Pesanan Diambil → Mulai Antar**

---

### 5.5 Sedang Mengantar

This is the map-first screen.

Framework:

**Map → Destination → ETA → Contact → One Action**

The screen prioritizes:

- current location
- destination
- route
- distance
- ETA
- customer contact
- completion action

Xentra should not attempt to replace a full turn-by-turn navigation application in MVP.

Use Mapbox for spatial context, route visualization, distance, and ETA. Provide an explicit **Navigasi** action to launch the Driver's preferred navigation app when appropriate.

---

### 5.6 Konfirmasi COD

This is a financial-safety interaction.

Show:

- amount expected
- amount tendered
- change
- explicit confirmation that cash was received

Example mental model:

**Harus dibayar → Uang diterima → Kembalian → Konfirmasi**

The Driver confirms physical cash collection; the Driver does not settle the payment.

Short/over cash handling is intentionally outside this MVP UX contract until the exception contract is locked.

---

### 5.7 Pengantaran Selesai

The completion screen must distinguish three separate concepts:

- delivery completed
- COD collected
- payment settlement

For COD:

**Pengantaran Selesai**  
**Uang COD Diterima**  
**Uang di Tangan Anda**  
**Menunggu Serah Terima ke Kasir**

Do **not** show “Pembayaran Berhasil” merely because the Driver collected cash.

There must be no Driver-facing **Settlement / Bayar / Lunas** action.

---

### 5.8 Riwayat

Framework:

**Date → Delivery → Outcome**

Show completed delivery history.

This is not a financial accounting/reporting page.

---

### 5.9 Profil

Framework:

**Identity → Availability → Vehicle → Navigation → Help**

The Driver may manage operational preferences, but not merchant/payment authority.

---

## 6. Map UX boundary

The Driver PWA should use mapping according to context:

### Before pickup
Map is secondary.

### During delivery
Map is primary.

### After delivery
Map is no longer necessary as the primary UI.

The existing Xentra delivery destination snapshot is the source for Point B:

- `destination_address`
- `destination_latitude`
- `destination_longitude`

The Driver's current GPS position is Point A.

The PWA may use the existing Xentra mapping stack:

- Mapbox GL JS for map UI
- OSRM for road route/distance/ETA
- existing geocoding/search infrastructure where needed

No Google Maps dependency is required for this lifecycle.

---

## 7. Role boundary

The Driver PWA must not expose authority belonging to other actors.

### Driver owns

- accept assigned delivery task
- pickup execution
- start delivery
- delivery completion
- COD physical collection
- custody of collected COD cash until handover

### Branch Manager owns

- order acceptance/rejection
- delivery assignment
- delivery monitoring

### Cashier/POS owns

- physical COD handover confirmation
- final payment settlement

The Driver must never be presented with Cashier/POS settlement controls.

---

## 8. Core UX principles

### 8.1 State-driven

The backend state machine is authoritative. UI derives available actions from it.

### 8.2 One dominant action

Every operational screen has one clear next action.

### 8.3 Progressive disclosure

Show only the information needed for the current decision. Details can be expanded when necessary.

### 8.4 Map only when spatial context matters

Do not make the entire application a map.

### 8.5 Financial states are explicit

Differentiate:

**COD expected → COD collected → cash held by Driver → cash handed to Cashier → payment settled**

These are not interchangeable statuses.

### 8.6 Driver executes; Driver does not administer

The Driver PWA is an execution surface, not a merchant administration console.

---

## 9. MVP page hierarchy

```
XENTRA DRIVER
│
├── TUGAS
│   ├── Tugas Baru
│   ├── Tugas Aktif
│   ├── Detail Pengantaran
│   ├── Ambil Pesanan
│   ├── Sedang Mengantar
│   ├── Konfirmasi COD
│   └── Pengantaran Selesai
│
├── RIWAYAT
│   └── Detail Pengantaran
│
└── PROFIL
    ├── Identitas Driver
    ├── Availability
    ├── Kendaraan
    ├── Navigasi
    ├── Bantuan
    └── Keluar
```

The happy-path navigation is:

```
Tugas Baru
  ↓
Terima Tugas
  ↓
Detail Pengantaran
  ↓
Ambil Pesanan
  ↓
Pesanan Diambil
  ↓
Mulai Antar
  ↓
Sedang Mengantar
  ↓
Selesaikan Pengantaran
  ↓
Konfirmasi COD
  ↓
Pengantaran Selesai
  ↓
Uang COD di Tangan Driver
  ↓
Serah Terima ke Kasir
```

---

## 10. Explicit non-goals for this UX contract

Do not expand the MVP Driver IA to cover these until a separate exception/operations contract is locked:

- customer unavailable
- COD refusal
- failed delivery / return
- driver cancellation
- reassignment
- short/over cash variance
- lost cash
- delivery transition failure after collection
- complex proof-of-delivery requirements
- fleet management
- multi-stop route optimization
- Driver financial settlement

These may later add states or screens, but must not redefine the canonical happy path without an explicit contract change.

---

## 11. Canonical design rule

The Driver PWA should always make the next valid action obvious.

**The Driver should never have to interpret the state machine.**

The system knows the state.  
The UI explains the state.  
The Driver performs the next action.

This UX/IA contract is subordinate to and consistent with:

`docs/decisions/driver-cod-happy-path-validation-v1.md`

Any future Driver PWA implementation should treat both documents as the baseline source of truth for MVP happy-path behavior.
