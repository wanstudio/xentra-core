# Xentra Merchant Operating App — UX / IA Contract v1

**Status:** LOCKED
**Date:** 2026-09-21

## Decision
Xentra Merchant is to be designed at the product/UX level of a modern merchant operating app such as GoFood Merchant / GrabMerchant: mobile-first, operational, action-oriented, and centered on daily restaurant operations.

This is a UX/product benchmark, not a copy of their marketplace business model or exact UI.

## Core IA
Primary navigation:
- **Beranda** — operational overview, attention items, today's business snapshot.
- **Pesanan** — operational order center; mobile cards are the primary mobile pattern.
- **Lainnya** — Menu, Stok, Delivery, Outlet, Penjualan, Keuangan, Promo, Wawasan, Karyawan, Pelanggan, Pengaturan. KDS is not an active Merchant navigation item in MVP; it is an optional future SaaS add-on.

## Product model
Xentra remains a **brand-owned Restaurant Operating System** with multi-branch support. It is not a marketplace.

## Operational UX
- Mobile-first for daily operations; desktop remains fully usable.
- Action-first: surface what needs attention and the next permitted action.
- Order Center is operational, not merely a data table.
- New pending orders use visual attention and audible alert where browser/device policy permits; existing polling is reused rather than duplicated.
- Order lifecycle and Delivery Job lifecycle remain visually distinct.
- Menu and Inventory are first-class operational areas, not merely CRUD screens.
- Outlet/branch selection is first-class.

## Authority remains locked
- Branch Manager: order acceptance/rejection, operational monitoring, driver assignment/dispatch where authorized, and the required cooking-stage actions in MVP when the outlet has no dedicated Kitchen surface.
- Head Kitchen/KDS: confirmed → preparing → ready when the optional KDS capability is enabled for dedicated kitchen staff.
- Driver: pickup → on_delivery → delivered and COD cash collection/custody.
- Cashier/POS: COD handover, cash verification, payment settlement.
- COD settlement remains separate from delivery completion.

Existing Order, Delivery, Kitchen, COD, RBAC, and branch-scope contracts remain authoritative. No duplicate state machine.

## Implementation sequence
1. Merchant IA/navigation shell.
2. Order Center operational UX.
3. Menu/Inventory UX.
4. Delivery/Driver surfaces.
5. Cashier/POS surfaces.
6. Optional KDS add-on only when the SaaS feature entitlement is enabled for a dedicated kitchen workflow.
7. Business analytics/reporting.

## Non-goals
This lock does not authorize changes to Google auth, checkout, promo, customer auth, or unrelated backend behavior. Do not delete/reseed existing business data.
