# Xentra — Presentation Shell vs Feature Context v1

**Status:** 🔒 LOCKED  
**Decision date:** 2026-09-30

## Decision

Xentra separates **presentation shells** from **feature contexts**.

Presentation shells are reusable UI containers that determine **how** a feature is presented:

- Page
- Bottom Sheet
- Dialog / Modal
- Overlay
- Side Sheet / Panel
- Picker Sheet where applicable

Feature contexts determine **what** the user is doing:

- Category Editor
- Flavor Editor
- Product Editor
- Branch Editor
- Promo Editor
- Customer Editor
- other feature-specific contexts

A feature context must not be permanently coupled to one presentation shell merely because that is its current mobile or desktop presentation.

## Composition rule

Conceptual architecture:

```text
Presentation Shell
        ↓ presents / wraps
Feature Context
        ↓ uses
View Model / State / Domain API
```

Examples:

```text
BottomSheet
└── CategoryEditor

Page
└── ProductEditor

Dialog
└── DeleteCategoryConfirmation
```

The same feature context may use a different presentation shell when the UX contract requires it:

```text
Mobile       → Bottom Sheet
Tablet       → Side Sheet
Desktop      → Modal / Panel
Complex task → Page
```

This is a presentation decision, not a new domain implementation.

## Architectural rules

1. **Build reusable presentation shells once.**
2. **Build feature contexts independently from their shell.**
3. Do not create feature names that permanently encode presentation, such as `CategoryBottomSheet`, when the underlying context is reusable.
4. Do not duplicate business logic, validation, API calls, or state merely because presentation changes.
5. A presentation shell owns presentation concerns: placement, backdrop, focus/lifecycle behavior, safe area, close/dismiss behavior, animation, stacking, and responsive treatment.
6. A feature context owns feature concerns: fields, view model/state, validation, loading/error/success behavior, and domain actions.
7. Presentation selection belongs to the UX/composition layer.
8. A reusable shell must not become a universal feature-specific controller containing `if category / if product / if branch` logic.
9. Reuse existing Xentra mature primitives before creating another shell.
10. New shell primitives are justified only when an existing Xentra primitive cannot satisfy the required presentation contract.

## UX selection rule

The shell is selected from the **interaction complexity and task context**, not from the feature name alone.

Examples:

- Simple reference-data add/edit may use a Bottom Sheet.
- Short destructive confirmation uses a Dialog.
- Complex object editing may use a Page.
- Multi-step or workspace-like tasks use a Page.
- Selection/picker interactions may use a Bottom Sheet or Picker.
- The same context can be presented differently on different surfaces or viewport classes when that improves the approved UX.

The current shell choice must never be treated as part of the feature's domain identity.

## Branch surface classification (locked)

The Branch feature follows the same presentation-shell contract:

- **Branch Add/Edit → Page**: the form combines identity, address, WhatsApp contact, GPS coordinates, delivery pricing/radius, promotion thresholds, and operational state. It is a focused work surface, not a lightweight interaction.
- Canonical routes: `branches/new` and `branches/:id/edit`.
- **Branch Detail → Page**: `branches/:id` remains the canonical detail surface with Overview, Operations, Menu, Team, and Reports subtabs.
- **Branch Catalog → Branch Detail → Menu Page**: the previous standalone Branch Catalog modal is retired as a duplicate surface. `branches/:id/menu` is the canonical route for branch menu management.
- **Branch deletion/archive confirmation → generic Dialog**: destructive confirmation must use `XentraPresentation.confirm()`, while the delete/archive API behavior remains unchanged.
- Branch business/API logic stays in the dashboard/feature controller; presentation routing does not create a second domain authority.

## Xentra layering

```text
Core / API / Domain
        ↓
Feature Context
(CategoryEditor, ProductEditor, ...)
        ↓
Presentation Composition
(Page / Sheet / Dialog / Overlay / Side Sheet)
        ↓
Application Surface
(Owner / Merchant / POS / Customer as applicable)
```

The separation is structural and must not create a second router, second domain authority, or duplicated business state machine.

## Migration rule for legacy UI

When an existing screen is a large modal that behaves like a page, do not merely make the modal visually nicer. Audit whether the feature context should instead be presented by the Page shell.

When an existing page contains a tiny one-purpose interaction, do not preserve the page solely because the legacy implementation already exists. Recompose the same feature context into the appropriate lightweight shell where safe.

Preserve business/API behavior unless a separate domain decision changes it.

## Source reuse

Existing Xentra reusable UI primitives remain the first implementation source. In particular, existing merchant-shared shell, modal, sheet, overlay, navigation, toast, and related primitives should be reused and consolidated rather than duplicated.

This decision does **not** authorize creation of a second generic UI framework.

## Scope

This is an architecture + UX composition contract.

It does not change:

- Core authority;
- RBAC;
- tenant/brand/branch scope;
- domain ownership;
- API contracts;
- business state machines;
- Owner/Merchant/POS surface boundaries.

**Agent rule:** Before implementing a new Add/Edit/Detail interaction, classify the feature context separately from its presentation shell. Reuse the existing shell primitive and compose the context into the selected shell. Do not hard-wire feature logic to a modal/page implementation.
