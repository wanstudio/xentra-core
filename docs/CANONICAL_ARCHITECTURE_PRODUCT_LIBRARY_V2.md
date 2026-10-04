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

## 🔒 LOCKED — POS Human Label Mapping: Takeaway ↔ Pickup — 2026-10-03

**Status:** LOCKED / CANONICAL

For POS cashier UX, the customer-facing transaction mode is **Takeaway**. The canonical Commerce/backend order value remains **`pickup`**.

Canonical mapping:

| Surface | Human label | Canonical value |
| --- | --- | --- |
| POS | Dine-In | `dine_in` |
| POS | Takeaway | `pickup` |
| Commerce / Fulfillment | Pickup | `pickup` |
| POS new-sale | Delivery | **not exposed** |

Rules:
- **Takeaway is a UI label, not a new domain entity or purchase type.**
- Do not introduce a separate `takeaway` backend/order_type value only to match POS language.
- Existing Commerce, fulfillment, reporting, eligibility, and persistence contracts that use `pickup` remain canonical.
- POS uses the label **Takeaway** when creating a new cashier sale and sends the existing canonical `pickup` value to Core.
- Delivery remains an independent fulfillment/order context and is not a cashier-facing POS new-sale mode.


## 🔒 LOCKED — POS Hold Bill Lifecycle / Exact UX Placement — 2026-10-03

**Status:** LOCKED / CANONICAL

POS Hold Bill is a **cashier-side Draft Sale state**, not an operational Commerce Order.

Canonical flow:
`Draft Sale → Tahan → Hold Bill → Buka/Resume → Kirim/Teruskan Pesanan → Operational transaction flow`

Locked semantics:
- **Tahan** is a direct, reversible action; the normal path does not require a confirmation modal.
- **Tahan** persists the current draft as Hold Bill and does **not** materialize a canonical Commerce Order.
- Hold must not place the sale in Merchant Order Center or start kitchen/fulfillment lifecycle.
- **Pesanan Ditahan (N)** is the list of already-held Sales and belongs under **Transaksi**.
- **Buka/Resume** restores a held draft into the Sale workspace.
- **Kirim/Teruskan Pesanan** is the explicit continuation action that submits the held draft into the applicable operational transaction flow.
- **Bayar** is a separate payment action; Hold does not imply payment settlement.
- For Dine-In, table context remains part of the held draft and table hold/release remains under Dining/Core authority.
- A **Ditahan (N)** shortcut must not replace the current Sale's **Tahan** action inside the Rincian Pesanan modal.

Implementation reconciliation:
Current legacy POS code still materializes a canonical Commerce Order from `POST /pos/held-orders`. This is non-compliant with this locked contract and must be reconciled before the Hold implementation is considered aligned.
