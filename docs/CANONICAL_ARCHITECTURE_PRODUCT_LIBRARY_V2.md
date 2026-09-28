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
