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

### Mobile Page Bottom Action Bar & Portal Lifecycle (Strict Contract)
1. **Single Active Page Root**: Never hide a React page container (`#modern-*-mount`) using only `style.display = 'none'` without calling `root.unmount()`. Portaled bottom action bars (`createPortal(..., document.body)`) stay mounted on `document.body` and overlap across pages unless the React root is actually unmounted.
2. **Enforce in `packages/menu-editor-ui/src/main.jsx`**: Track all mounted page containers in a `Map`, call `unmountOtherPageRoots(container)` inside every `mount*` function, and expose `window.unmountAllModernPages()`.
3. **Route Transition & Back Cleanup**:
   - `applyRoute(route)` in `dashboard.js` must call `window.XentraPresentation.closeAll()`, `window.XentraUI.Modal.closeAll()`, and `window.unmountAllModernPages()` on every route transition.
   - `XentraPresentation`, `XentraUI.Modal`, and React components with portaled sheets/modals must listen to `popstate` / `hashchange` so pressing Back destroys/closes open sheets without leaving orphaned DOM shells.
   - Guarded by `node --test tests/ownerBottomBarLifecycle.test.js`.

### Smooth Page Transition & Anti-Flicker Standard (Strict Contract)
1. **No Native WebView Top Progress Bar**: Native Android WebView wrappers (`native/owner-android`, `native/merchant-android`, `native/pos-android`) must keep `progressBar` permanently `View.GONE` (`0dp`, `alpha="0"`). Never toggle `progressBar.setVisibility(View.VISIBLE)` in `onPageStarted` or `onProgressChanged`, which causes a green bar flicker above the topbar on SPA route transitions.
2. **Use `window.navigateTo(route)` (`history.pushState`/`replaceState`)**: Never mutate `window.location.hash = ...` directly in React components or feature modules for SPA navigation.
3. **No Transform/Animation on `.x-tab-content`**: Outer `.x-tab-content` sections must keep `animation: none; transform: none;`. Apply directional animations (`xentraSlidePushIn`, `xentraSlidePopIn`, `xentraTabFadeIn` driven by `body[data-nav-dir="push|pop|tab"]`) only on inner page roots/shells, with synchronous `window.scrollTo({ top: 0, behavior: 'auto' })`.
4. **Hide Legacy Sibling Containers in CSS**: Legacy fallback markup replaced by modern React mounts must be hidden via CSS (`display: none !important`) to prevent 1-frame flashes during route switches.

### Mobile Layout System & Bottom Clearance Governance (Strict Contract)
1. **Screen Archetype A (With Primary Bottom Nav - Beranda, Pesanan, etc.)**:
   - Only `.x-tab-content.active::after` provides bottom clearance (`var(--m-bottom-spacer)`).
   - Inner screens (`.x-home-screen`, `.bm-orders-mobile-cards`) must have `padding-bottom: 0 !important;`.
   - Last element in scroll container (`:last-child`, `:last-of-type`) must have `margin-bottom: 0 !important;`.
2. **Screen Archetype B (With Floating Bottom Action Dock/CTA - e.g. Kategori & Menu)**:
   - Primary bottom nav is hidden.
   - Tab's `::after` spacer MUST be suppressed (`display: none !important; height: 0 !important;`) to prevent double clearance.
   - Floating action dock stays at `bottom: 0` with its internal padding (`14px 16px max(14px, env(...))`).
   - Scrollable card container (`.x-menu-category-list`) MUST have `padding-bottom: calc(88px + env(...)) !important;` so cards are NEVER covered by the bottom action dock.
   - Cards have `margin-bottom: 0 !important;` (inter-card spacing is handled strictly by `gap: 12px;`).
3. **Permanent Automated Guard**: Validated on every test run via `node --test tests/merchantLayoutContract.test.js`.

## State & UI-to-Backend Derivation Standpoint
Separate server state, UI state, and transient interaction state. Avoid multiple competing sources of truth for cart, checkout, authentication, or runtime capabilities.

When implementing or redesigning any user-facing UI screen, strictly follow the [UI-to-Backend Execution Standpoint](file:///home/ubuntu/xentra-core/docs/XENTRA_UI_TO_BACKEND_EXECUTION_STANDPOINT.md):
- Automatically derive the full 5-endpoint CRUD suite (`GET`, `GET /:id`, `POST`, `PUT /:id`, `PUT/PATCH /:id/status`).
- Enforce Service Worker network-only bypass in `sw.js` and `Cache-Control: no-store` on server responses.
- Implement dual-layer client synchronization: 0ms Optimistic UI updates + authoritative background invalidation on screen resume.

## Figma / Pure UI to Production Translation Protocol
When translating raw visual code exports (Figma, Tailwind JSX, static pixel mocks, AI canvas snippets) into application surfaces, strictly adhere to [FIGMA_TO_PRODUCTION_UI_TRANSLATION_RULES.md](file:///home/ubuntu/xentra-core/docs/decisions/FIGMA_TO_PRODUCTION_UI_TRANSLATION_RULES.md):
- Never copy literal absolute coordinates (`top-[16px] left-[14px] absolute`) or static viewport widths (`w-96`).
- Extract design tokens (radius, shadow, brand green `#16a34a`, inactive slate `#0f172a`, typography).
- Strip mock OS chrome artifacts (iOS home bar pills, fake status bars) and use native CSS safe-area-insets.
- Convert raw `<div>` hierarchies to semantic HTML5 (`<nav>`, `<button type="button">`, ARIA attributes).
- Use monochrome SVG icons with `fill="currentColor"` so active/inactive states toggle automatically.
- Dynamically bind indicators and routes to the host app's native router (`navigateTo(route)`).

## Responsive/mobile correctness
For layout, scrolling, touch, and viewport issues inspect the DOM hierarchy, containing blocks, sizing, overflow ownership, touch/pointer behavior, and runtime differences before changing CSS.

## Frontend completion check
For a changed feature verify: shared component reuse, data contract, page composition, runtime script/resource wiring, navigation/back behavior, stale-cache implications, and absence of client-side authoritative business logic.
