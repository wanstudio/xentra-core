# 🔒 Xentra — POS ↔ Merchant App UI Boundary v1

**Status: LOCKED / AUTHORITATIVE**  
**Decision date: 2026-09-24**

## Decision

Xentra POS and Merchant App are intentionally similar but not identical.

- **Merchant App = Manage + Operate the Branch**
- **POS = Execute the Sale / Transaction at the Branch**

Both surfaces use the same Xentra-Core authority, APIs, domain services, branch scope, inventory pool, order/payment contracts, and audit model. They reinforce one another without becoming two competing management interfaces.

## 1. POS — execution surface

POS owns fast transaction-execution workflows:

- Kasir / Sale
- Menu selection for a Sale
- Variations / modifiers during Sale
- Hold / resume Sale
- Void / cancel subject to permission
- Meja for transaction execution
- Dining transaction execution
- Payment
- Cash tendered and change
- QRIS / non-cash payment execution where supported
- Split payment where supported
- Receipt printing / reprint
- Shift
- Opening float
- Cash In / Cash Out
- Close shift
- Expected vs actual cash
- Offline operation
- Local durable transaction queue
- Synchronization / retry status
- Conflict alert requiring Manager review

POS does not become a second back-office.

POS does not own:
- Master Product management
- Branch Category administration
- Branch assortment management as a management workflow
- Promotion governance
- Staff administration
- Operating-hours administration
- Cross-branch management
- Branch business reporting as the primary management surface

## 2. Merchant App — branch management and operations surface

Merchant App owns:

### Hari Ini
- Branch operational status
- New/pending orders requiring attention
- Table availability context
- Unavailable menu attention
- Low-stock attention
- Active approved promo attention
- Recent operational activity
- Quick operational actions

### Pesanan
- Branch-scoped order queue
- Branch Acceptance
- Accept / Reject with reason
- Preparing / Ready operational observation
- Delivery monitoring / dispatch only where authorized
- Operational order investigation

### Meja
- Current table state
- Available / occupied / reserved / blocked / out-of-service
- Operational intervention
- Reservation/occupancy context

### Menu
- Adopt approved Master Products into the Branch
- Branch Categories
- Product ↔ Branch Category membership
- Branch-local overrides
- Branch availability / sold-out operation

### Promo
- Activate / deactivate approved branch-scoped promotions

### Stok
- Branch stock monitoring
- Low-stock attention
- Operational stock actions according to the approved inventory contract

### Staff
- Branch workforce management
- Staff operational access according to Core RBAC

### Penjualan
- Branch-level sales observation / reporting

### Jam Operasional
- Branch open/close controls
- Online-order pause/resume
- Approved operational exceptions

Merchant App does not become a second cashier.

Merchant App does not own:
- Cash drawer execution
- Cash tendered / change workflow
- Shift opening/closing as the primary POS workflow
- Receipt printing as a cashier workflow
- Offline POS sale execution

## 3. Shared domain, different responsibility

| Domain | POS | Merchant App |
|---|---|---|
| Menu | Select/use menu in Sale | Manage branch assortment/configuration |
| Availability | Fast operational stop-selling when explicitly supported | Branch operational availability management/observation |
| Stock | Check/consume within Sale flow | Monitor/manage branch stock |
| Meja | Execute transaction against table/dining context | Manage/observe operational table state |
| Pesanan | Handle POS-originated transaction context | Branch acceptance + operational queue |
| Promo | Apply an already-active promo to Sale | Activate/deactivate approved promo |
| Penjualan | Cashier/shift transaction context | Branch business observation/reporting |
| Staff | Authenticated cashier identity + permission runtime | Branch staff management |
| Jam Operasional | Read current status as needed | Manage branch operational schedule/state |
| Delivery | Show only transaction-relevant information | Monitor/assign only where authorized |

## 4. Reinforcement model

**Merchant App configures/controls → Core authorizes → POS executes → Core records/reconciles → Merchant App observes**

Example:

**Merchant App marks Ayam unavailable → Core authoritative Branch state → POS receives updated state → POS stops selling the Branch Product.**

Offline exception:

**POS offline → permitted local sale/action → durable local storage → reconnect → Core reconciliation → Merchant App sees authoritative result/conflict.**

Offline capability does not transfer business authority from Core to POS.

## 5. Inventory boundary

There is **one Branch inventory pool**.

Never create:
- POS stock
- online stock
- dine-in stock
- delivery stock
- WhatsApp stock
- marketplace stock

POS and Merchant App are two operational surfaces over the same Branch inventory authority.

## 6. Navigation principle

A feature belongs in a surface based on the **job being performed**, not merely API availability.

**POS primary job:** Sell → Take Payment → Print/Complete → Reconcile

**Merchant App primary job:** Observe → Decide → Configure/Operate → Investigate

The same business object may appear in both surfaces when necessary, but the workflow and authority must remain role-appropriate.

## 7. Xentra authority boundary

- **Core:** AUTHENTICATE + AUTHORIZE + ENFORCE + PERSIST + AUDIT
- **Merchant App:** MANAGE + OPERATE + OBSERVE
- **POS:** EXECUTE
- **Owner Dashboard:** CONFIGURE + GOVERN + OBSERVE at brand / multi-branch scope

## 8. Non-goals

This decision does not create:
- a second backend
- a second inventory authority
- a second catalog authority
- a second order state machine
- a second payment authority
- a mandatory KDS surface
- a separate Web POS product

## 9. Implementation rule

For any future feature, ask:

**Does this action execute a transaction right now, or does it manage/operate the Branch?**

- Execute transaction now → **POS**
- Manage / operate / observe Branch → **Merchant App**

If the same domain is needed in both, share the Core contract and expose only the role-appropriate workflow in each surface.

Any change to this boundary requires a new explicit decision/revision.

## References

This decision is aligned with the current Xentra contracts for:
- Branch Manager Operational Center
- Merchant Operating App UX / IA
- POS Offline Operation, Branch Inventory & Multi-Channel Conflict
- Inventory Check → Commit → Consume
- Driver + COD Flow
