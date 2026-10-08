# Xentra — Inventory Transfer State Machine Contract v1

**Status:** 🔒 LOCKED / ACTIVE  
**Decision date:** 2026-10-08  
**Scope:** Inter-location movement of Product Stock and Material Stock, transfer authorization boundary, dispatch/receipt posting, in-transit semantics, atomicity, idempotency, and transfer lifecycle.

**Prerequisite authorities:**
- docs/decisions/xentra-multibranch-supply-stock-topology-contract-v1.md
- docs/decisions/xentra-stock-location-stock-identity-target-data-model-v1.md
- docs/decisions/xentra-production-routing-stock-location-contract-v1.md
- docs/decisions/xentra-production-batch-posting-mutation-contract-v1.md
- docs/decisions/xentra-procurement-document-contract-v1.md

## 1. Decision Summary

Xentra treats an inter-location transfer as an **Inventory transaction**.

A transfer moves physical stock from one authorized Stock Location to another authorized Stock Location without changing the underlying Product or Material identity.

Canonical flow:

~~~text
Source Stock Location
        ↓
Transfer Request
        ↓
Approved
        ↓
Dispatched
        ↓
In Transit
        ↓
Received
        ↓
Destination Stock Location
~~~

The persisted v1 state machine uses **DISPATCHED** as the state that means the source has released the stock and the quantity is now in transit. A separate persisted IN_TRANSIT state is not required in v1.

Therefore:

> **DISPATCHED = source deduction completed + stock is in transit + destination stock has not increased yet.**

The UI may present DISPATCHED as **“Dalam Perjalanan / In Transit”**.

## 2. Ownership Boundary

Inventory owns:

- Transfer Request and Transfer lifecycle;
- source/destination Stock Location references;
- Product Stock / Material Stock transfer quantities;
- dispatch posting;
- receipt posting;
- transfer audit trail;
- in-transit transfer quantity.

Transfer is **not**:

- a Purchase Order;
- a Goods Receipt from a Supplier;
- a Production Batch;
- a Sale;
- a Branch reassignment.

Procurement owns purchasing from Suppliers. Production owns transformation. Inventory owns physical movement.

## 3. What Can Be Transferred

v1 supports two transfer kinds:

1. **PRODUCT** — moves a stock-managed Product between Stock Locations.
2. **MATERIAL** — moves a Material between Stock Locations.

A single Transfer Document must contain **one stock kind only**.

Therefore a v1 transfer must be either:

~~~text
Inventory Transfer
  → Product Transfer Lines
~~~

or:

~~~text
Inventory Transfer
  → Material Transfer Lines
~~~

Do not create a polymorphic line with optional product_id and material_id in v1.

This preserves the target Inventory identity rule:

- Product Stock uses Product identity.
- Material Stock uses Material identity.

## 4. Transfer Identity

Recommended logical entity:

inventory_transfers

Core references:

- id
- organization_id
- source_stock_location_id
- destination_stock_location_id
- transfer_kind
- status
- requester / approval actor references
- dispatch / receive timestamps
- audit timestamps
- notes / reason

Product transfer lines conceptually reference:

product_id

Material transfer lines conceptually reference:

material_id

Stock identity remains stable.

A transfer does not create a new Product, Material, SKU, or Material Code.

## 5. Source and Destination Rules

Every transfer must explicitly identify:

- one source Stock Location;
- one destination Stock Location.

Both locations must:

- exist;
- belong to the same Organization supply network;
- be active;
- be authorized for the actor and requested operation.

The source and destination must be different.

Self-transfer is invalid:

~~~text
Location A → Location A
~~~

must be rejected because it has no physical movement meaning.

Branch identity is not a substitute for Stock Location identity.

Do not resolve:

~~~text
Branch A
  ↓ implicit warehouse
~~~

Instead the transfer must resolve explicit:

~~~text
source_stock_location_id
destination_stock_location_id
~~~

## 6. Transfer Quantity Boundary

Transfer quantities use the authoritative stock unit of the transferred identity.

For Material:

- quantity is represented in the Material Base Stock UOM.

For Product:

- quantity is represented in the Product's current authoritative stock unit.

v1 does not perform an implicit UOM conversion during transfer.

If a quantity needs conversion, it must already be resolved before the transfer is posted according to the relevant Product/Material stock contract.

A transfer must never alter the Product or Material's base identity because it moves between locations.

## 7. v1 State Machine

Persisted lifecycle:

~~~text
DRAFT
  ↓
REQUESTED
  ↓
APPROVED
  ↓
DISPATCHED
  ↓
PARTIALLY_RECEIVED
  ↓
RECEIVED
~~~

The direct completion path is:

~~~text
DISPATCHED
  ↓
RECEIVED
~~~

when the full dispatched quantity is received in one receipt.

Cancellation is permitted only before physical dispatch:

~~~text
DRAFT → CANCELLED
REQUESTED → CANCELLED
APPROVED → CANCELLED
~~~

After DISPATCHED, status-only cancellation is forbidden.

A physical return after dispatch is a new Inventory transaction or an explicit reversal workflow; it must not rewrite the original transfer history.

## 8. Meaning of Each State

### DRAFT

Transfer is being prepared.

No physical stock mutation has occurred.

The transfer may be edited.

### REQUESTED

The transfer has been submitted as an operational request.

No physical stock mutation has occurred.

### APPROVED

The transfer is authorized to be dispatched according to the applicable permission policy.

No physical stock mutation has occurred.

### DISPATCHED

The source has physically released the approved quantity.

At this exact boundary:

~~~text
Source Product/Material Stock
  -
Dispatched Quantity

Transfer
  +
In-Transit Quantity

Destination Product/Material Stock
  unchanged
~~~

This is the **source stock mutation boundary**.

### PARTIALLY_RECEIVED

One or more receiving operations have posted, but some dispatched quantity remains in transit.

Example:

~~~text
Dispatched = 100 kg
Received   = 60 kg
In Transit = 40 kg
Status     = PARTIALLY_RECEIVED
~~~

### RECEIVED

All dispatched quantity has been accounted for through successful receipt postings.

Example:

~~~text
Dispatched = 100 kg
Received   = 100 kg
In Transit = 0 kg
Status     = RECEIVED
~~~

RECEIVED is terminal for the original transfer document.

## 9. In-Transit Semantics

v1 deliberately represents in-transit stock through the **Transfer document and its remaining dispatched quantity**, not through a separate user-facing Stock Location balance.

Conceptually:

~~~text
Source Stock
   ↓ dispatch
Transfer Transit Quantity
   ↓ receive
Destination Stock
~~~

While in transit:

- quantity is no longer available at the source;
- quantity is not yet available at the destination;
- quantity must not be counted as Branch sellable stock at the destination;
- quantity remains auditable through the Transfer.

This avoids introducing a fake Branch or prematurely adding a permanent TRANSIT Stock Location type to the target schema.

A future dedicated Transit Stock Location model may be introduced only through a contract revision if operational requirements justify it.

## 10. Dispatch Posting Boundary

Dispatch is the first physical mutation.

Before dispatch, Inventory must validate at minimum:

- transfer exists;
- status is APPROVED;
- source and destination are valid and active;
- actor is authorized for the source operation;
- each requested quantity is valid and greater than zero;
- source stock is sufficient for every line;
- the transfer has not already been dispatched.

v1 dispatch is **all-lines / full-quantity**.

Partial dispatch is not supported by this contract.

Therefore the system must not silently dispatch 70 from a request for 100 and leave the remaining 30 in an undocumented state.

Partial dispatch requires a later explicit contract with its own state semantics.

## 11. Dispatch Atomicity

Dispatch must be atomic.

For a Product transfer:

~~~text
Product Stock Source    -
Product Movement OUT    +
Transfer status         → DISPATCHED
Transfer audit evidence +
~~~

For a Material transfer the same rule applies to Material Stock and Material Stock Movement.

Either all required mutations succeed or none succeed.

The system must never produce:

~~~text
source stock deducted
BUT
transfer remains APPROVED
~~~

or:

~~~text
transfer says DISPATCHED
BUT
source stock was not deducted
~~~

## 12. Receipt Posting Boundary

Receipt is the destination mutation boundary.

A receiving operation may accept no more than the remaining in-transit quantity.

For each line:

~~~text
remaining_in_transit
  =
dispatched_quantity
  -
received_quantity_so_far
~~~

The next receipt may be:

~~~text
0 < receipt_quantity ≤ remaining_in_transit
~~~

When receipt_quantity is less than the remaining quantity:

~~~text
Status = PARTIALLY_RECEIVED
~~~

When receipt_quantity completes the remaining quantity:

~~~text
Status = RECEIVED
~~~

Receipt is atomic across all lines included in one posting operation.

## 13. Receipt Atomicity

A multi-line receipt must either:

- increase all applicable destination stock balances and record all corresponding movement entries; or
- apply none of them.

The system must not claim a successful receipt if only some lines were posted.

This follows the same Inventory atomicity principle used by Goods Receipt and Production completion.

## 14. Receiving Authority

The actor who approved/dispatched a transfer does not automatically have to be the receiver.

The destination operation must be authorized independently.

Therefore:

- requester ≠ approver is allowed;
- approver ≠ dispatcher is allowed;
- dispatcher ≠ receiver is allowed.

Receiving authority is checked against the destination Stock Location scope.

The exact role-to-permission matrix remains an authorization contract and is not hardcoded here.

## 15. Receipt Variance / Damage / Loss

v1 supports **partial receipt because the remainder is still expected**.

v1 does not silently convert a short receipt into lost stock.

Example:

~~~text
Dispatched = 100
Received   = 90
Remaining  = 10
~~~

The remaining 10 stays in transit.

A receiver must not close the transfer as RECEIVED while 10 remains unaccounted for.

Damage, loss, theft, or other physical discrepancy during transit requires an explicit future Inventory transfer-variance/reversal contract or an authorized compensating Inventory operation.

No quantity may disappear merely because the receiving quantity was lower.

## 16. Idempotency

Every physical posting operation must have a stable posting identity.

Recommended:

- transfer_dispatch_posting_id for dispatch;
- one transfer_receipt_posting_id per receipt operation.

Rules:

1. Replaying the same posting identity must not mutate stock twice.
2. The original successful result must be returned for an exact replay.
3. Reusing the same posting identity with different transfer/location/quantity data must fail with an idempotency conflict.
4. Each receipt operation has its own posting identity because a transfer may have multiple receipts.

Inventory may derive individual movement IDs internally, but the business operation keeps one aggregate idempotency identity.

## 17. Audit Trail

Every transfer posting must be traceable to:

- transfer_id;
- transfer line;
- source and/or destination Stock Location;
- transferred Product or Material identity;
- quantity;
- actor;
- timestamp;
- posting identity;
- resulting stock quantity;
- reason/notes where required.

For Product transfers, the forward movement contract uses:

~~~text
product_stock_movements
  transfer_out
  transfer_in
~~~

For Material transfers:

~~~text
material_stock_movements
  transfer_out
  transfer_in
~~~

The legacy inventory_movements ledger may remain a compatibility ledger during migration, but it is not the target canonical Material/Product location-aware movement model.

## 18. Relationship to Branches

A Branch is not the transfer identity.

Examples:

~~~text
Central Warehouse
  → Branch A Sellable Location
~~~

and:

~~~text
Branch A Raw Material Location
  → Branch B Raw Material Location
~~~

are both Inventory transfers when authorized.

The transfer domain works from Stock Location to Stock Location.

A Branch may have multiple Stock Locations.

A Stock Location may be associated with a Branch or may be organization-level without a Branch.

## 19. Central Procurement and Central Production

This contract closes the physical movement gap created by the locked supply topology.

Central Procurement:

~~~text
Supplier
  ↓
Central Warehouse
  ↓ Material Stock
  ↓ Inventory Transfer
Branch Material Stock
~~~

Central Production:

~~~text
Central Kitchen
  ↓ Product Stock
Inventory Transfer
  ↓
Branch Product Stock
~~~

Transfer does not become a hidden Purchase Order or Production Batch.

If a transfer cannot be fulfilled, the failure remains an Inventory transfer problem unless the business explicitly creates a separate Purchase Request, Purchase Order, or Production Batch.

## 20. One-Step Transfer

A future one-step/internal transfer shortcut may be provided for locations where dispatch and receipt are effectively the same operational action.

However, the shortcut must preserve the same underlying invariants:

- explicit source;
- explicit destination;
- source deduction;
- destination addition;
- immutable audit trail;
- idempotency;
- no negative stock;
- no hidden branch assumption.

The one-step UX is therefore a convenience, not a different Inventory authority.

It is **not required for the v1 persisted state machine**.

## 21. No Stock Mutation on Request / Approval

The following states must never mutate Product Stock or Material Stock:

- DRAFT;
- REQUESTED;
- APPROVED.

This is the critical boundary:

~~~text
Request / Approval
      ↓
(no stock mutation)
      ↓
Dispatch
      ↓
source stock -
      ↓
Receive
      ↓
destination stock +
~~~

## 22. Failure Boundaries

| Event | Result |
|---|---|
| Transfer drafted | No stock mutation |
| Transfer requested | No stock mutation |
| Transfer approved | No stock mutation |
| Source stock insufficient | Dispatch fails; no partial mutation |
| Dispatch replayed with same posting identity | Original result returned |
| Dispatch replayed with conflicting payload | Idempotency conflict |
| Transfer dispatched | Source decreases; destination unchanged |
| Partial receipt | Destination increases by accepted receipt; remainder stays in transit |
| Receipt exceeds remaining quantity | Rejected; no mutation |
| Receipt posting fails | No partial destination mutation |
| Receipt replayed with same posting identity | Original result returned |
| Short receipt | Remainder remains in transit |
| Loss/damage in transit | Requires explicit compensating/variance workflow |
| Cancel before dispatch | Transfer canceled; no stock mutation |
| Cancel after dispatch | Forbidden as status-only operation |
| Physical return after dispatch | Separate transfer/reversal operation |

## 23. Current Runtime Audit / Migration Boundary

The current codebase already contains legacy movement vocabulary:

~~~text
transfer_in
transfer_out
~~~

in InventoryMovementModel and the legacy inventory_movements schema.

However:

- InventoryStockService currently operates on Branch + Product rather than Stock Location;
- InventoryRepository updates branch_product_inventory / legacy Branch Product stock;
- no canonical inventory_transfers persistence model is currently established;
- the target Material Stock movement model is not yet the runtime authority.

Therefore this contract does **not** authorize a rename-only retrofit of the existing Branch Product service.

Implementation must introduce the transfer orchestration on top of the target:

~~~text
Stock Location
+ Product Stock Balance / Material Stock Balance
+ typed Stock Movement
+ Inventory Transfer
~~~

and preserve compatibility seams for existing Product/Branch inventory while migration is staged.

## 24. Locked Invariants

The following are mandatory:

1. Transfer is Inventory-owned.
2. Transfer is Stock Location → Stock Location.
3. Source and destination are explicit.
4. Source and destination must be different.
5. Both locations must belong to the same Organization supply network.
6. One v1 Transfer Document contains one stock kind only.
7. Product and Material stock identities remain separate.
8. Request and approval never mutate stock.
9. Dispatch is the source stock mutation boundary.
10. Receive is the destination stock mutation boundary.
11. In-transit quantity is not available at source or destination.
12. v1 persists in-transit through Transfer remaining quantity; no dedicated Transit Stock Location is required.
13. v1 dispatch is full-quantity; partial dispatch is not supported.
14. Partial receipt is supported.
15. Receipt cannot exceed remaining in-transit quantity.
16. Receipt cannot close a transfer while a discrepancy remains unaccounted for.
17. Dispatch and receipt are atomic.
18. Posting operations are idempotent.
19. Conflicting reuse of a posting identity is rejected.
20. Completed transfer history is immutable; corrections use compensating Inventory operations.
21. No blind use of Branch as a substitute for Stock Location.
22. No hidden conversion of transfer failure into Procurement or Production.

## 25. Explicitly Open for Later Contracts

- detailed role / permission matrix;
- partial dispatch workflow;
- transfer priority / allocation logic;
- transfer reservation against future stock;
- transfer scheduling;
- carrier/driver assignment;
- shipment tracking;
- barcode / scan workflow;
- lot / expiry tracking;
- package / handling-unit tracking;
- transit Stock Location as a first-class balance;
- transfer loss/damage variance workflow;
- transfer returns / reverse-transfer workflow;
- accounting / valuation treatment;
- inter-company transfers;
- external supplier/customer movements.

## 26. External Supporting Evidence

ERPNext documents Material Transfer as an internal warehouse-to-warehouse stock movement and separately documents Goods in Transit, where stock leaves the source, remains in a transit state, and only becomes destination stock when the receiving operation is posted. citeturn853248search0turn853248search1

Odoo similarly models internal transfers between source and destination locations as structured inventory operations, and its inventory documentation treats transit as a distinct inventory location/state for stock moving between internal locations. citeturn853248search2turn853248search9turn853248search10

These references support the separation between transfer execution, source/destination stock, and goods-in-transit semantics. They do not override Xentra's business authority.

## 27. Change Control

Any change to:

- transfer state semantics;
- dispatch mutation boundary;
- receipt mutation boundary;
- partial dispatch policy;
- one-kind-per-transfer invariant;
- in-transit representation;
- idempotency rules;
- cancellation after dispatch

requires a new explicit contract revision.

**LOCKED — Inventory Transfer State Machine Contract v1.**
