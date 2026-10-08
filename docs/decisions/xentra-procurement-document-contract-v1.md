# Xentra — Procurement Document Contract v1

**Status:** 🔒 LOCKED / ACTIVE
**Decision date:** 2026-10-08
**Scope:** Purchase Request, Purchase Order, Purchase Order Line, Goods Receipt, partial receipt, supplier/material references, purchase UOM/pack snapshots, stock posting boundary, and procurement-to-inventory traceability.

**Prerequisite authorities:**
- docs/decisions/xentra-material-supplier-material-contract-v1.md
- docs/decisions/xentra-production-batch-posting-mutation-contract-v1.md
- docs/decisions/xentra-stock-location-stock-identity-target-data-model-v1.md
- docs/decisions/xentra-multibranch-supply-stock-topology-contract-v1.md
- docs/decisions/xentra-material-production-selling-lifecycle-contract-v1.md

## 1. Decision Summary

Xentra separates procurement documents by business meaning:

~~~
Replenishment Requirement
  = need to replenish a Material at a Stock Location

Purchase Request
  = internal request / approval work

Purchase Order
  = commercial commitment to one Supplier

Goods Receipt
  = verified physical acceptance of supplier quantity
~~~

Purchase Order does not increase stock.
Goods Receipt posting is the procurement → Inventory physical stock boundary.

## 2. Purchase Request

Purchase Request is a workflow object for requesting procurement of Materials.

A Purchase Request Line references the canonical Material, not a Product and not a Supplier Material:

`purchase_request_line.material_id → materials.id`

Conceptual line data:
- material_id;
- requested base quantity;
- Base Stock UOM;
- destination Stock Location;
- required date;
- source/replenishment context where available;
- requester and notes.

A Purchase Request may later be converted or allocated into one or more Purchase Orders.

Supplier selection is a Procurement decision and is not part of Material identity.

Purchase Request does not mutate stock.

## 3. Purchase Order Header

A Purchase Order represents one commercial purchase commitment to one Supplier.

Canonical references:
- organization_id;
- supplier_id;
- destination_stock_location_id;
- status;
- required/expected date;
- creator/approver metadata;
- timestamps and notes.

One Purchase Order has one Supplier in v1.

One Purchase Order has one primary receiving destination Stock Location in v1.

Central Procurement may consolidate demand from multiple Branches into one PO. Demand traceability is handled separately through Purchase Order Line Allocations.

## 4. Purchase Order Line

A Purchase Order Line identifies the supplier-specific sourcing choice:

`purchase_order_line.supplier_material_id → supplier_materials.id`

Therefore a PO line does not point directly to Product or raw Material as its sourcing identity.

The Supplier Material already resolves to exactly one Material.

Conceptual line data:
- supplier_material_id;
- ordered purchase quantity;
- selected purchase representation (direct Purchase UOM or Supplier Pack);
- resolved base quantity in Material Base Stock UOM;
- agreed unit price;
- currency;
- required/expected date where line-specific;
- historical conversion/pack snapshot;
- receiving progress.

Supplier Material current price is only a sourcing default. The PO line snapshots the commercial terms actually agreed for that PO.

## 5. Purchase Representation

A PO line must make its quantity representation unambiguous.

Direct Purchase UOM example:

~~~
Material Base UOM = kg
Purchase UOM = g
PO quantity = 5,000 g
Resolved Base Qty = 5 kg
~~~

Supplier Pack example:

~~~
Material Base UOM = kg
Supplier Pack = 1 sack = 25 kg
PO quantity = 4 sacks
Resolved Base Qty = 100 kg
~~~

Do not treat sack, bag, carton, or similar commercial pack names as Material identity.

The resolved Base Quantity is the quantity that Goods Receipt and Inventory can ultimately reconcile against.

Historical PO lines must preserve the actual conversion/content snapshot used at the time.

## 6. Purchase Order State

v1 operational lifecycle:

~~~
DRAFT → APPROVED → ORDERED → PARTIALLY_RECEIVED → RECEIVED
DRAFT → CANCELLED
APPROVED → CANCELLED
ORDERED → CANCELLED
~~~

Rules:
- DRAFT is editable and not a supplier commitment.
- APPROVED means the PO passed the applicable internal approval according to permission policy.
- ORDERED means the commercial order was issued/confirmed to the Supplier.
- PARTIALLY_RECEIVED means at least one receipt is posted while open quantity remains.
- RECEIVED means all ordered quantities are either accepted through receipts or otherwise reconciled by an explicit future close/short-close policy.
- CANCELLED means no further receipt is expected under the PO.

The exact approval roles, monetary thresholds, and short-close behavior remain an authorization/workflow concern.

PO status does not itself mutate stock.

## 7. Goods Receipt

Goods Receipt records what was physically accepted from the Supplier.

Canonical relationship:

`goods_receipt_line.purchase_order_line_id → purchase_order_lines.id`

Goods Receipt may be created multiple times against one PO.

Example:

~~~
PO ordered = 100 kg
Receipt 1 accepted = 60 kg
Receipt 2 accepted = 25 kg
Outstanding = 15 kg
~~~

Partial receipt is first-class.

## 8. Goods Receipt Line

A receipt line preserves both the supplier-facing quantity and the Inventory-resolved quantity.

Conceptual line data:
- purchase_order_line_id;
- accepted purchase quantity;
- rejected quantity;
- resolved accepted base quantity;
- purchase UOM / Supplier Pack snapshot;
- conversion/content snapshot;
- destination Stock Location;
- receiver;
- received timestamp;
- rejection/quarantine reason where applicable.

Accepted quantity is the quantity that may enter Material Stock.

Rejected quantity does not become usable Material Stock through this receipt.

An accepted quantity must not exceed the remaining open quantity on the PO line unless a separate over-receipt policy is explicitly enabled in a future contract.

## 9. Goods Receipt State

v1 lifecycle:

~~~
DRAFT → POSTED
DRAFT → CANCELLED
~~~

DRAFT may be edited.

POSTED is immutable operational evidence.

Once POSTED, changing accepted quantities or destination is not a normal edit. Any physical correction requires an explicit reversal/adjustment workflow.

Cancellation before posting creates no stock mutation.

## 10. Receipt → Inventory Posting Boundary

Goods Receipt posting is the only procurement document event that increases Material Stock.

~~~
Purchase Order
   ↓ no stock
Goods Receipt DRAFT
   ↓ verify
Goods Receipt POSTED
   ↓
Inventory
   ↓
Material Stock + accepted base quantity
~~~

Inventory remains the authority for the physical mutation.

Procurement must not directly update Material Stock tables.

## 11. Atomic Goods Receipt Posting

Posting a Goods Receipt and its Material Stock mutations must be atomic within the available persistence boundary.

For a receipt with several lines:

~~~
Rice +100 kg
Oil  +20 L
Eggs +120 pcs
~~~

either all accepted lines post successfully or none post.

A failed posting must not create a partially posted receipt that claims success.

This follows the same atomicity principle used by Xentra Production completion.

## 12. Idempotent Goods Receipt Posting

Goods Receipt posting must be safely retryable.

Each posting uses one stable goods_receipt_posting_id.

Replaying the same posting returns the original result and must not duplicate Material Stock mutations.

Inventory may create individual movement identities internally, but the receipt posting needs one aggregate idempotency identity.

## 13. Stock Location Semantics

The PO header has one primary destination Stock Location.

Goods Receipt uses an authorized destination Stock Location for the accepted Material.

v1 default behavior is to receive against the PO destination.

Receiving into another Stock Location requires an explicit authorized receiving exception/transfer workflow; it must never happen silently.

Material identity does not change because the destination Stock Location changes.

## 14. Central Procurement

Central Procurement can consolidate multiple Branch requirements:

~~~
Branch A → 50 kg
Branch B → 75 kg
Branch C → 25 kg
        ↓
Central Purchase Order = 150 kg
        ↓
Central Warehouse Receipt
        ↓
Central Material Stock +150 kg
        ↓
Inventory Transfer
        ↓
Branch Stock Locations
~~~

Demand traceability is modeled with Purchase Order Line Allocations.

Allocation records do not become stock records and do not mutate Inventory.

## 15. Supplier Material and Historical Snapshot

PO sourcing is through Supplier Material.

Example:

~~~
Supplier Material
  Supplier A / Rice Premium
  Pack = 25 kg bag
  Current Price = Rp300.000
        ↓
PO line
  4 bags
  Agreed Price = Rp295.000 / bag
        ↓
Goods Receipt
  3 bags accepted
        ↓
Material Stock
  +75 kg
~~~

Later changes to the Supplier Material price or pack definition must not rewrite the PO or Receipt history.

## 16. Procurement Does Not Own Stock

Procurement owns:
- Supplier;
- Supplier Material;
- Purchase Request workflow;
- Purchase Order lifecycle;
- Goods Receipt document lifecycle.

Inventory owns:
- Stock Location;
- Material Stock;
- Product Stock;
- Stock Movement;
- physical quantity mutation.

The domains communicate through explicit contracts; Procurement must not maintain a competing stock quantity.

## 17. Failure Boundaries

| Event | Result |
|---|---|
| Purchase Request canceled | No stock mutation |
| PO canceled before receipt | No stock mutation |
| PO created/ordered | No stock mutation |
| Goods Receipt draft discarded | No stock mutation |
| Goods Receipt rejected quantity | No usable Material Stock increase |
| Goods Receipt partially accepted | Only accepted quantity posts |
| Receipt posting fails | No partial stock mutation |
| Receipt posting replayed | No duplicate stock mutation |
| Supplier price changes later | Historical PO/Receipt unchanged |

## 18. Alignment with Existing Runtime

Current PurchaseOrderService and inventory_purchase_orders / inventory_po_items are Product-oriented compatibility implementation. They currently use supplier_name text and branch/product keys.

This contract does not authorize a rename-only refactor.

The future Procurement implementation must introduce canonical Supplier, Material, Supplier Material, Stock Location, Purchase Request, Purchase Order, and Goods Receipt references behind compatibility seams.

Existing legacy PO tables/services may remain during migration until canonical behavior is verified.

## 19. What Is LOCKED

1. Purchase Request is internal procurement workflow, not stock.
2. Purchase Order is a commercial commitment, not stock.
3. One PO has one Supplier in v1.
4. One PO has one primary receiving destination Stock Location in v1.
5. PO lines reference Supplier Material.
6. Supplier Material resolves to one Material.
7. Purchase UOM and Supplier Pack remain distinct.
8. PO/Receipt preserve resolved conversion/content snapshots.
9. Goods Receipt is the procurement → Inventory stock boundary.
10. Partial Goods Receipt is first-class.
11. Only accepted receipt quantity enters Material Stock.
12. Posted Goods Receipts are immutable evidence.
13. Goods Receipt posting is atomic and idempotent.
14. Procurement never directly mutates Inventory tables.
15. Central Procurement uses demand allocations rather than duplicate stock identities.
16. Historical PO/Receipt values are not rewritten by later supplier master changes.

## 20. Explicitly Open for Later Contracts

- exact Purchase Request status / approval workflow;
- exact PO monetary approval thresholds and role matrix;
- PO short-close / close-remaining-quantity behavior;
- supplier quotation/RFQ workflow;
- supplier confirmation/acknowledgment workflow;
- over-receipt policy;
- rejected/quarantine Stock Location workflow;
- purchase returns / debit-credit correction workflow;
- landed costs / freight allocation;
- vendor invoice / Accounts Payable integration;
- advanced supplier price tiers;
- branch-specific supplier terms;
- autonomous purchasing.

## 21. External Supporting Evidence

ERPNext documents Purchase Receipts as the accepted quantity from a Supplier, usually against a Purchase Order, and supports partial/closed receipt workflows. Odoo separates RFQ/PO confirmation from the later receipt validation that moves purchased goods into stock. Both also support purchase quantities in a purchasing UOM that is converted to an inventory UOM.

References:
https://docs.frappe.io/erpnext/purchase-receipt
https://docs.frappe.io/erpnext/purchase-order
https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/shipping_receiving/daily_operations/receipts_delivery_one_step.html
https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html

These references support the separation and receipt boundary; they do not override Xentra business authority.

## 22. Change Control

Any change to PO identity, Supplier Material sourcing, partial receipt semantics, Goods Receipt posting boundary, or procurement ownership requires a new explicit contract revision.

**LOCKED — Procurement Document Contract v1.**