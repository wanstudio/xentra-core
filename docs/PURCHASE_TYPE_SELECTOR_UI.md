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

## Delivery scheduling

Delivery supports **“Jadwalkan delivery”**.

- Toggle OFF → date/time selector is hidden.
- Toggle ON → date/time selector is shown.
- Selected date/time becomes part of the delivery draft state.
- A compact summary reflects the selected schedule.

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
