---
name: xentra-frontend-engineering
description: Build Xentra customer PWA, dashboard, and workspace UI with reusable components, explicit view-model contracts, runtime wiring, and correct navigation behavior.
---

# Xentra Frontend Engineering

## Architecture
Prefer:
`API/domain -> page/service state -> view model -> reusable component -> page composition`.

Presentation renders contracts; it does not decide tenant, branch, price, inventory, payment, authorization, or financial truth.

## Reuse
Before creating UI markup or logic, search for an existing shared component, utility, store, router, or contract. Reuse when responsibility is the same. Do not duplicate page-specific copies of business logic.

## Data flow
- Normalize API data into the shape expected by components.
- Keep server-authoritative values authoritative in the UI; client state is for interaction and presentation.
- Do not manufacture defaults that can change business meaning.
- Do not use mock/fallback business records in production paths.

## PWA/runtime
- Centralize browser runtime capability detection in the existing PWA runtime utility when one exists.
- Load required core scripts before page controllers that depend on them.
- Do not treat browser runtime hints (installed display mode, appinstalled, local storage, referrer) as server-side identity or entitlement proof.
- Service-worker/cache behavior must be considered when a change affects assets or startup wiring.

## Navigation and overlays
Xentra core UX rule: when a modal, bottom sheet, or overlay is open, browser/mobile back must close the topmost active layer first and keep the user on the current page. Only when no layer is open may back navigation leave the page.

Implement this consistently through shared navigation/state mechanisms rather than page-local event hacks.

## State
Separate server state, UI state, and transient interaction state. Avoid multiple competing sources of truth for cart, checkout, authentication, or runtime capabilities.

## Responsive/mobile correctness
For layout, scrolling, touch, and viewport issues inspect the DOM hierarchy, containing blocks, sizing, overflow ownership, touch/pointer behavior, and runtime differences before changing CSS.

## Frontend completion check
For a changed feature verify: shared component reuse, data contract, page composition, runtime script/resource wiring, navigation/back behavior, stale-cache implications, and absence of client-side authoritative business logic.
