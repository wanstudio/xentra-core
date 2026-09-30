# Xentra Merchant Home UI Contract v1

**Status:** LOCKED  
**Decision date:** 29 September 2026  
**Surface:** `apps/merchant-app`  
**Scope:** Merchant App / Branch Manager — Home / Beranda

## 1. Decision

Xentra Merchant Home / Beranda is locked as a **mobile-native operational home**, not a desktop dashboard compressed into a phone.

The design benchmark is the interaction quality of modern merchant applications such as GoFood Merchant / GoBiz and GrabMerchant. These products are **visual and ergonomic references only**. Xentra does not copy their marketplace model, business rules, IA, terminology, or exact UI.

The approved Xentra Merchant Home mockup and the existing locked Merchant App UX/IA contract remain the higher-level visual/product source of truth. This document locks the **Home composition and implementation planning detail** below.

## 2. Source-of-truth hierarchy

1. Locked Xentra business/domain contracts.
2. Locked Branch Manager responsibility, role, scope, and KDS boundaries.
3. Locked Xentra Merchant App UX/IA + visual design source of truth.
4. This Home UI Contract v1.
5. Existing implementation only where it does not conflict with the above.
6. GoFood Merchant / GrabMerchant references for ergonomics only.

Legacy UI is not authoritative merely because it already exists.

## 3. Primary Home mental model

Home must follow:

**Glance → Understand → Act**

The screen answers, in order:

1. What is happening?
2. Does anything need attention?
3. What can I do now?

Home is not a KPI wall, database browser, feature directory, or generic CRUD surface.

## 4. Locked mobile composition

The primary mobile Home order is:

**A. Merchant context**
- compact branch/outlet identity;
- notification action;
- account/profile action.

**B. Operational controls**
- Branch open/closed state;
- Online-order availability;
- these states remain visibly independent.

**C. Greeting / date**
- short human greeting;
- current local business date.

**D. Primary Sales Card**
- Penjualan Hari Ini as the first major content block;
- primary total sales value;
- concise comparison signal where available;
- compact transaction/order summary;
- no excessive KPI subcards.

**E. Attention — Pesanan Baru**
- pending/new orders appear before secondary information;
- mobile card feed, never a desktop table;
- show only a small preview (normally 2–3 cards);
- each card prioritizes order context, current human-readable state, amount/quantity, and one primary next action;
- include a clear path to the full Order Center.

**F. Quick Actions**
Quick actions must **not duplicate primary bottom navigation**.
They are reserved for high-value jobs such as:
- Meja;
- Jam Operasional;
- Staff;
- Penjualan / reporting entry;
- other action-oriented branch tasks only when operationally justified.

**G. Operational Snapshot**
Compact status grid for the branch's current order pulse:
- Menunggu;
- Diproses;
- Siap;
- Selesai.

This is a pulse summary, not an analytics dashboard.

**H. Perlu Perhatian — Menu & Stock**
- Menu availability exceptions;
- Stock attention / low-stock exceptions;
- each row/card links to the responsible Merchant surface;
- Menu availability and physical Stock remain distinct facts and authorities.

**I. Promo Aktif**
- concise active promotion preview;
- no campaign-builder UI on Home.

**J. Aktivitas Terakhir**
- short human-readable operational narrative;
- normally 3–4 recent items;
- technical IDs, raw JSON, internal state names, audit field names, and provider metadata remain in deeper detail surfaces.

**K. Persistent bottom navigation**
- **Beranda | Pesanan | Menu | Stock | Promo**

## 5. Mobile visual language

Home inherits the approved Merchant visual grammar:

- soft white cards on a light neutral background;
- restrained status colors;
- Xentra green for primary/active/success states;
- amber/orange for attention;
- red only for genuinely critical/destructive/error states;
- compact status pills;
- strong typographic hierarchy;
- purposeful spacing;
- minimal chrome;
- direct Indonesian human language;
- comfortable touch targets;
- no unnecessary horizontal scrolling.

Recommended spacing rhythm:
**8 / 12 / 16 / 20 / 24 px**

Primary interactive controls should target approximately **44–48 px** touch height.

## 6. Top bar contract

The existing Merchant mobile top bar is retained and refined, not rebuilt from scratch.

Target shape:

`[Branch identity] [Notification] [Profile]`
`[Buka] [Order online]`

Rules:
- branch identity is immediately visible;
- Branch open/closed and Online ordering are independent;
- notification/profile remain compact;
- top bar must consume minimal vertical space;
- safe-area handling remains intact;
- no desktop sidebar as the primary mobile navigation.

## 7. Bottom navigation contract

Primary mobile navigation is fixed to:

**Beranda | Pesanan | Menu | Stock | Promo**

Rules:
- persistent and reachable during normal scrolling;
- active icon + label use Xentra active treatment;
- inactive items remain visually quiet;
- Pesanan may display an attention badge;
- do not add arbitrary badges to every navigation item.

## 8. Home card contract

Operational cards should generally communicate:

**Context → State → Relevant amount/quantity → Primary next action → Detail**

Use progressive disclosure:
- primary action on the card;
- secondary actions in detail/overflow;
- full history only in deeper surfaces.

Do not expose every possible mutation directly on Home.

## 9. Data / presentation boundary

Home consumes authoritative data and renders a presentation view model.

Target conceptual composition:

`Xentra Core / API`
→ `hari-ini.js / existing data loaders`
→ `Home View Model`
→ `Home UI renderer`

The Home UI must not become a business authority.

Home must not:
- create a second order state machine;
- determine Branch fulfillment;
- authorize access;
- mutate payment semantics;
- fabricate inventory state;
- change pricing policy;
- create branch scope;
- introduce new backend authority.

## 10. Existing source reuse

Reuse existing Merchant App infrastructure where it is suitable:

- `apps/merchant-app/assets/js/hari-ini.js` for current Home data loading/operational facts;
- `apps/merchant-app/assets/js/merchant-app.js` for routing and shell coordination;
- `apps/merchant-shared/js/shared.js` for auth/session/DOM/formatter helpers;
- existing merchant-shared shell, toast, modal, sheet, toggle, and navigation primitives.

Home-specific composition and presentation should remain surface-owned by Merchant App.

Do not expand `merchant-shared` with large Home-specific business markup merely for convenience.

## 11. Legacy quarantine boundary

The new Home work must not revive or extend quarantined legacy Menu/Branch Override assumptions.

Legacy implementation may remain in the repository for compatibility/migration, but the new Home, Menu, Stock, and future Merchant surfaces must follow their current locked forward contracts.

Do not use legacy UI as the design basis for the new Home.

## 12. Desktop rule

Desktop is a responsive adaptation of the Merchant App mobile shell.

Desktop may:
- expand cards into wider panes;
- show more information side-by-side;
- use denser layouts where they improve the same merchant task.

Desktop may not:
- replace the mobile task hierarchy with an Owner-style admin dashboard;
- introduce a sidebar as the primary Merchant mental model merely because the viewport is wide;
- expose extra technical complexity merely because there is screen space.

## 13. Performance / loading

Home is a high-frequency surface.

Implementation must prioritize:
- fast first meaningful render;
- immediate shell rendering;
- progressive data hydration;
- loading skeletons or compact loading states instead of large blocking empty areas;
- no unnecessary network waterfalls;
- no full application reload for ordinary Home refresh/revalidation.

Normal freshness follows the locked Merchant refresh/re-fetch contract. Manual recovery belongs in **Pengaturan → Segarkan data aplikasi**, not as a persistent Home refresh button.

## 14. Required states

Every Home section must have explicit:
- loading;
- populated;
- empty;
- error/recoverable;
- stale/revalidating states where relevant.

Empty states must be useful and calm. They should explain the operational condition rather than exposing raw implementation language.

## 15. Responsive target

Visual QA target widths:

- 360 × 800
- 375 × 812
- 390 × 844
- 412 × 915

Test in:
- mobile browser;
- installed PWA standalone mode;
- safe-area devices;
- slow/unstable network conditions.

## 16. Implementation sequence

**H0 — Contract freeze**
- treat this document as the Home UI source of truth.

**H1 — Shell refinement**
- top bar;
- status row;
- page background;
- scroll container;
- bottom navigation;
- spacing and typography.

**H2 — Home composition**
- replace dashboard-like Home hierarchy with the locked composition in Section 4.

**H3 — Native interaction**
- card interaction;
- lightweight transitions;
- sheets/overlays where appropriate;
- progressive disclosure;
- recoverable states.

**H4 — Responsive adaptation**
- mobile first;
- desktop adaptation without changing task hierarchy.

**H5 — QA / regression**
- run source-level and existing regression tests;
- inspect PWA/browser behavior;
- inspect actual VPS/device rendering before production sign-off.

## 17. Definition of Done

Home is complete only when:

- branch context is obvious immediately;
- operational open/online state is obvious and independent;
- today's sales is the first major business signal;
- pending orders receive clear visual priority;
- no desktop table is the primary mobile Home pattern;
- quick actions do not become duplicate navigation;
- Home does not become a KPI wall;
- Menu availability and Stock remain distinct;
- bottom navigation stays persistent;
- touch interaction is comfortable;
- exceptional states are recoverable;
- no new domain authority or state machine is introduced;
- legacy implementation is not extended as the new design basis;
- the screen visually and behaviorally belongs to the same Merchant App as the approved Home concept.

## 18. Explicit non-goals

This contract does not authorize changes to:
- authentication;
- RBAC;
- order state machine;
- payment lifecycle;
- checkout;
- Customer PWA;
- POS architecture;
- KDS architecture;
- Master Menu authority;
- Inventory authority;
- unrelated backend APIs or database contracts.

**LOCKED — Xentra Merchant Home / Beranda UI Contract v1 is the implementation source of truth for the new Home surface.**


## 🔒 IMPLEMENTATION RECORD — Home UI v1 First Pass

**Date:** 29 September 2026

The locked Home contract has been implemented as a Merchant App presentation refactor.

### Implemented

- Added surface-owned Home stylesheet:
  `apps/merchant-app/assets/css/home.css`
- Added Home presentation boot:
  `apps/merchant-app/assets/js/home.js`
- Replaced the Home section in:
  `apps/merchant-app/index.html`
- Converted pending orders from desktop table rendering to mobile-first operational cards in:
  `apps/merchant-app/assets/js/hari-ini.js`
- Converted Menu/Stock attention, Promo, and Activity projections to compact native-style Home surfaces.
- Preserved the existing authoritative operational data loading path in `hari-ini.js`.
- Preserved the existing top bar and persistent five-item mobile navigation.
- Added an explicit Home-ready presentation signal so the surface can hydrate after operational data resolves.
- Added the Home assets to the Merchant PWA service-worker static shell cache.
- Corrected the Home stock-attention filter so `NULL` / untracked stock is not incorrectly classified as low stock.
- Removed duplicate Home metric IDs and synchronized the completed-order snapshot.
- Added `tests/merchantHomeUIContract.test.js`.
- Updated Phase 4 Home structural assertions to the new semantic Home surface.

### Legacy boundary

The new Home contains no legacy Hero/table/legacy attention identifiers and does not extend the quarantined legacy Menu / Branch Override presentation.

### Verification performed

Source-level verification on 29 September 2026:
- Home JS and Hari Ini JS compile successfully through JavaScript syntax validation.
- Home test files compile successfully.
- Home contains no desktop `<table>`.
- Home contains no duplicate HTML IDs.
- Home custom CSS classes are defined.
- Legacy Home identifiers are absent from the new Home.
- PWA service-worker cache contains the new Home CSS and JS.
- The Home structure/order and five-item navigation checks pass through an equivalent source-level validator.

GitHub Actions did not expose workflow runs for the direct commits used for this pass, so the full repository test suite is **not claimed as executed** here. VPS/device visual verification remains the final production gate.

### Implementation source commits

Relevant Home implementation commits include:

- `cdb6f5220592cd6124c1697702df430efb078283` — Home styles
- `ce6b8cdfe34053b779458fed26998ccddbe5bd08` — Home presentation boot
- `3eacebdce5a5d1d3b37c8d67d0f9ebbf51a9a30c` — initial native Home composition
- `6bff5f4bc17ff9e7178516289a46ab0da07ceee9` — semantic Home structure cleanup
- `7c1ebb332110253032fb7468de014829d4a38efd` / `d79a4000bb7a4a5c0a8234b289ef8f4cfecd557f` / `a3632301837d3d14a90d3a0e13c16134cb79a36a` — operational rendering and data-boundary corrections
- `2cba1df2ece980829066d23e2371665d158f28ad` — PWA shell cache
- `cba2c3126a8357d6bf22f64a9834179185a56299` / `7ce34574b3692a06ac471eea4c7b703d82a81fbd` — Home UI contract tests
- `1c1b5b992dc57bb4a875e68a097bc2d11aa839e0` — Phase 4 structural test alignment

**Implementation state: SOURCE-CHECKED / NOT YET PRODUCTION-VISUALLY VERIFIED.**
\n\n## 🔒 LOCKED ADDENDUM — Presentation Composition\n\nMerchant Home and its downstream interactions follow `docs/decisions/xentra-presentation-shell-vs-feature-context-v1.md`. Presentation shells are reusable UI containers; feature contexts remain independent and are composed into the appropriate Page, Bottom Sheet, Dialog/Modal, Overlay, or Side Sheet. Do not encode presentation into feature/domain names or duplicate business logic when the presentation changes.\n