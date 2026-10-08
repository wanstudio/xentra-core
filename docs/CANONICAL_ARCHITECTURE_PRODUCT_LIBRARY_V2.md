# 🔒 CURRENT CATALOG / MENU RECONCILIATION — 2026-10-08

This Library contains historical decisions from multiple stages of the Xentra Catalog/Menu migration. The following current contracts control forward implementation:

- `docs/decisions/catalog-menu-domain-contract-v2.md`
- `docs/decisions/xentra-menu-item-choice-template-contract-v1.md`
- `docs/decisions/xentra-domain-vocabulary-boundary-v1.md`

## Current forward Menu model

```
Menu
├── Category       → grouping/classification
├── Title          → explicit customer-facing commercial name
└── Menu Items
     └── optional Item Choices
```

Current Owner mental model:

```
Create Menu
  ↓
Choose Category
  ↓
Enter Title
  ↓
Add Menu Items
  ↓
Optional: add Item Choice to a specific Menu Item
  ↓
HPP / Price / Preview / Activate
```

Item Choice rules:
- scope is one specific Menu Item;
- Owner may fix the value (**Kamu mengatur**);
- or Customer may choose the value (**Pelanggan memilih**);
- Owner first selects an Xentra-provided Choice Template;
- template establishes semantic meaning, validation, and presentation policy;
- Owner may edit customer-facing labels and values;
- Custom means custom labels/values rendered by the generic component, not an Owner-created UI template;
- renderer selection is data-driven and must never infer semantics from the display label.

Examples of predefined presentation policy:

```
Level Pedas → scale
Sambal      → select
Ukuran      → choice/segmented
Suhu        → choice/segmented
Rasa        → choice
Topping     → multi-select
```

## What this reconciliation supersedes

Older sections in this Library may describe:
- Product-centric Menu authoring;
- Category + Sub Category + Rasa as Menu identity;
- Product Name mapped directly to Customer Menu title;
- Master Rasa/Complement/Level as universal Menu composition;
- a separate global Menu Configuration layer.

Those sections remain as **historical decision records only** where explicitly dated/superseded. They must not be treated as competing current contracts.

The active Menu identity/authoring meaning is governed by Catalog/Menu Domain v2 above.

## Governance

When an older Library section conflicts with a current locked contract:

1. keep the historical record for traceability;
2. follow the current locked contract for new implementation;
3. record a newer reconciliation rather than silently rewriting history;
4. do not make source-code compatibility behavior authoritative merely because it exists or passes legacy tests.

**LOCKED — this reconciliation is the current Library binding for Catalog/Menu work.**

---

## 22. Owner Dashboard Business / More Hub IA — 2026-09-28

The Owner mobile shell keeps the five top-level modules: Beranda, Bisnis, Pesanan, Keuangan, and Lainnya.

Within that shell:
- Beranda is the command center and contains the 2×4 Quick Access shortcut grid.
- Quick Access uses "Metode Bayar" for the shortcut to Finance → Payment Methods.
- "Lihat semua" from Quick Access opens the Bisnis hub.
- Bisnis is the discoverable hub for catalog/menu, branch/stock operations, customers/marketing, team/access, insight/reports, and brand identity.
- Lainnya is reserved for system/settings/integrations/notifications/security/account concerns and must not duplicate Team, Reports, or Brand Identity.
- This is an IA/presentation contract only; Core authority, APIs, database contracts, and bottom-nav ownership remain unchanged.

Detailed contract: docs/decisions/owner-dashboard-business-more-hub-ia-v1.md.

## 23. Governance

Future change flow:

```text
New business decision
→ reconcile Library v2
→ reconcile affected domain contracts
→ reconcile affected Git MD
→ implementation review
→ tests/evidence
```

No implementation may silently redefine a canonical concept because the current code structure is inconvenient.

## 23. Locked Owner Dashboard Focus / Navigation UX — 2026-09-28

The Owner Dashboard separates **scope selection** from **module navigation**.

- **Top Bar Focus Selector** selects the current business scope/context.
- **Bottom Navigation** selects the business module.
- Changing Focus changes the content/data context, not the fundamental bottom-navigation architecture.
- Bottom Navigation remains stable across Focus changes.
- Modules resolve their content against the selected Focus where the domain supports that scope.
- Focus is a UI context selector, **not authorization**; Core remains authoritative for identity, RBAC, permission, and scope.
- Quick Access may expose high-frequency functions such as Promo, Banner, Product, Branch, and Payment without adding them as additional bottom-nav modules.

Baseline:

```text
Top Bar
└── Focus: Semua Cabang ▼

Bottom Navigation
├── Beranda
├── Bisnis
├── Pesanan
├── Keuangan
└── Lainnya
```

Mental model:

**Top Bar:** “Saya sedang melihat scope siapa/apa?”  
**Bottom Navigation:** “Saya mau pergi ke module mana?”

Detailed contract: `docs/decisions/owner-dashboard-focus-scope-navigation-v1.md`.
\n\n## 🔒 Locked — Presentation Shell vs Feature Context v1 — 2026-09-30\n\nXentra separates reusable **presentation shells** from **feature contexts**.\n\nPresentation shells: Page, Bottom Sheet, Dialog/Modal, Overlay, Side Sheet/Panel, and applicable Picker shells. Feature contexts: Category Editor, Flavor Editor, Product Editor, Branch Editor, Promo Editor, Customer Editor, and other feature-specific contexts.\n\nThe feature context owns the task/data/view-model/validation behavior; the presentation shell owns placement, backdrop, lifecycle, dismissal, safe-area, animation, stacking, and responsive presentation. A feature context must not be permanently coupled to one shell.\n\nThe shell is selected from interaction complexity and UX context. Reuse existing mature Xentra primitives; do not create feature-specific shell duplicates or a second generic UI framework.\n\nCanonical decision: `docs/decisions/xentra-presentation-shell-vs-feature-context-v1.md`.\n