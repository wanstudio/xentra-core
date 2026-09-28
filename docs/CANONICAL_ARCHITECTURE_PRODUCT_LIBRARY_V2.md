## 22. Governance

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
