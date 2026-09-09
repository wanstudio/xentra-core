# LOCKED — Purchase Type / Fulfillment Selector UI & State Behavior

Date: 2026-09-07
Status: LOCKED

## Scope

Bottom Sheet **“Pilih tipe pembelian”** pada Checkout memiliki 4 tipe:

- Delivery
- Pick-up
- Dine-in
- Reservasi

Referensi screenshot user menjelaskan state dan behavior UI. Screenshot bukan source of truth untuk data/angka dan bukan instruksi untuk redesign domain Checkout.

## UI states

Each purchase type has dynamic availability and selection state:

- **Available:** selectable.
- **Selected:** currently selected type uses the existing active/selected visual.
- **Unavailable / Disabled:** unavailable for the current context; visually disabled/greyed and not selectable. Disabled must be behavioral, not cosmetic only.

Availability must come from existing Xentra data/configuration/business logic and must not be hardcoded merely to reproduce a screenshot.

## Delivery & Pick-up scheduling

Delivery and Pick-up both support the same scheduling UI.

- Delivery toggle label: **“Jadwalkan delivery”**.
- Pick-up toggle label: **“Jadwalkan pengambilan”**.
- Toggle OFF → date/time selector is hidden.
- Toggle ON → date/time selector is shown.
- Selected date/time becomes part of the delivery/pick-up draft state.
- A compact summary reflects the selected schedule.
- Switching between Delivery ↔ Pick-up keeps the schedule selection; switching
  to Dine-in / Reservasi clears it (non-schedulable types).
- Unscheduled pick-up stays ASAP and commits the same “Sekarang” slot as
  delivery.

## Reservation (customer app)

Reservation is a **future arrival booking** — locked rules from the Notion
roadmap: tomorrow onwards only, same-day strictly rejected, guest estimate.

- In the sheet, selecting **Reservasi** opens the reservation picker:
  - **Date wheel** starts at **Besok** (next device-local day) + the following
    5 days (6 booking days). “Hari ini” is never offered.
  - **Time wheel**: 30-minute steps in a 09:00–21:00 window (placeholder until
    an operating-hours data source exists — B1 gap, same as delivery scheduling).
  - **Jumlah Orang**: stepper 1–20 (default 2).
- Confirming commits `reservationDate` (device-local YYYY-MM-DD),
  `reservationTime` (HH:MM) and `guestCount` to the fulfillment state.
- **No toggle jadwal** — a reservation is always a dated booking.
- Server (OrderPlacementService) remains the authority for the same-day
  rejection (`reservation_date >= tomorrow`) and duplicate/booking-capacity
  guards.

### LOCKED — Schedule slot & timezone rule (2026-09-09)

**Current time source = device/customer local timezone.** The schedule picker
uses the customer's device `new Date()` and its local getters. It MUST NOT use
the WordPress/server timezone as the current-time source, and MUST NOT convert
the device time back to a server timezone for display or slot generation.

**Slot math (order is WAJIB):**

1. `current_time(device) + 1 hour`
2. Round UP to the next 30-minute boundary
3. That is the first available slot; all slots continue every 30 minutes.

Never round current time first and then add 1 hour.

**Day/date transition** follows the device-local calendar. Example: device
`23:40` → `+1h = 00:40` (next device-day) → round up → `01:00`. The first
available slot must render on **Besok** as `01:00–01:30`; it must never render
as “Hari ini 01:00–01:30”, and never use a server date that differs from the
device date.

**Labels** stay `Hari ini` / `Besok` / weekday, but “today” and the actual date
are derived from the device timezone.

**Operating hours** are not broken: fulfillment-type availability (e.g. a
branch with `is_delivery_active = 0`, or an off day) still disables the type.
Note: Xentra-Core currently has no operating-hours record (server B1 gap);
`core/delivery-schedule.js` carries an optional open/close window + off-day
hook so slot clamping can be enabled when operating-hours data exists.

**ASAP stays the default; scheduling is optional.** No schedule → order is
processed ASAP.

**Order storage** uses a canonical, timezone-aware ISO-8601 timestamp derived
from the device-local selection (with the device's UTC offset) in
`scheduled_slot_start` / `scheduled_slot_end`. The backend never assumes a
specific timezone for these fields.

The math lives in `apps/customer-pwa/assets/js/core/delivery-schedule.js`
(single source of truth; browser + Node-tested) and is consumed by
`checkout.js`.

## Bottom actions

- **Gak jadi:** dismiss/cancel without applying the draft selection.
- **Konfirmasi:** apply the selected purchase type and delivery schedule state.

The sheet must distinguish draft state from committed state so cancel does not accidentally persist a changed selection.

## Layout / visual hierarchy

- Four option cards remain a 2×2 grid.
- Keep the existing option-card design; only support the necessary selected/available/disabled states.
- Use clean, consistent separators and spacing.
- Hierarchy: sheet title > option label > supporting/schedule text > bottom actions.
- Use existing Xentra components and design tokens.
- Use the established Xentra typography system; if the project token is **Plus Jakarta Sans**, the entire sheet must use it consistently.

## Locked behavior

1. Customer can select only an available purchase type.
2. Disabled types cannot be selected.
3. Switching type updates the draft state and any type-dependent UI.
4. Delivery scheduling controls are conditional on the scheduling toggle.
5. Cancel discards draft changes.
6. Confirm commits the draft selection.
7. Availability is dynamic and must not be represented by hardcoded Branch/type checks.

## Boundaries

Do not change unrelated Checkout/Commerce architecture, Cart, BranchMatcher, Payment, Order lifecycle, or other domain logic unless strictly required to implement this selector behavior.

## Acceptance

Implementation must cover:

- selected state
- available state
- disabled/unavailable state
- Delivery scheduling OFF/ON
- date/time selection state
- cancel vs confirm behavior
- dynamic availability for all four purchase types
- existing Xentra typography/component conventions
