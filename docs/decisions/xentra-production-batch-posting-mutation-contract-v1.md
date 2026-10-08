# Xentra — Production Batch + Posting / Mutation Contract v1

**Status:** 🔒 LOCKED / ACTIVE
**Decision date:** 2026-10-08
**Scope:** Production Batch lifecycle, planned vs actual quantities, Material consumption, Product output, production Stock Locations, atomic Inventory posting, idempotency, cancellation, and failure boundaries.

**Prerequisite authorities:**
- docs/decisions/xentra-production-item-recipe-bom-contract-v1.md
- docs/decisions/xentra-material-supplier-material-contract-v1.md
- docs/decisions/xentra-stock-location-stock-identity-target-data-model-v1.md
- docs/LOCKED_INVENTORY_MODEL.md
- docs/decisions/xentra-material-production-selling-lifecycle-contract-v1.md

## 1. Decision Summary
Production Batch is the execution record of one production run.

Production owns the batch/execution record. Inventory owns every physical stock mutation.

Production Batch is not Stock Balance, Product SKU, or Recipe Version.

## 2. Batch Identity
Every Production Batch has a stable production_batch_id.

The batch references:
- production_item_id;
- exact recipe_version_id used;
- input Material Stock Location;
- output Product Stock Location;
- planned output quantity;
- actual output quantity once completed;
- lifecycle status;
- execution timestamps and actors.

Input and output Stock Locations may be the same location or different authorized locations. branch_id is not sufficient to identify physical production stock custody.

## 3. Production Batch State Machine
v1 lifecycle:

~~~
DRAFT → PLANNED → IN_PROGRESS → COMPLETED
DRAFT → CANCELLED
PLANNED → CANCELLED
IN_PROGRESS → CANCELLED
~~~

Rules:
- DRAFT is editable planning data.
- PLANNED means the batch is released for execution according to permission.
- IN_PROGRESS means execution has started, but v1 has not posted Inventory yet.
- COMPLETED means actual production quantities are recorded and the Inventory posting succeeded.
- CANCELLED means the batch will not complete and has no Production Batch posting.
- COMPLETED cannot be changed to CANCELLED by status-only edit.

Corrections after completion require an explicit compensating/reversal Inventory operation referencing the original posting.

## 4. WIP Policy for v1
Xentra v1 does not require WIP inventory.

The MVP uses direct issue-and-produce semantics:

~~~
Material Stock at input location
        ↓
Production Batch
        ↓
Material Stock decreases
        +
Product Stock at output location increases
~~~

Starting a Production Batch does not transfer Material into a WIP Stock Location.

WIP may be added later as a multi-step manufacturing capability without changing Product, Production Item, Recipe Version, or Production Batch identity.

## 5. Planned vs Actual
Production preserves planned and actual quantities separately.

Recipe Version supplies the planned formula and nominal yield. A batch may request a different planned output quantity; planned component requirements scale from the Recipe Version yield.

Example:
~~~
Recipe Version yield = 20 pcs
Batch planned output = 40 pcs
Planned consumption is scaled ×2.
~~~

Actual execution is recorded independently.

~~~
Planned output = 40 pcs
Actual output  = 37 pcs

Planned Chicken = 8.0 kg
Actual Chicken  = 8.4 kg
~~~

Variance is evidence and must not rewrite the Recipe Version.

## 6. Actual Material Consumption
At completion, the batch records actual Material consumption lines.

Each line identifies material_id, actual quantity, compatible UOM, resolved Base Stock UOM quantity, and source Stock Location.

Actual consumption may differ from the Recipe Version planned requirement. The actual quantity is what Inventory posts.

Consumption does not create a Production-owned stock ledger.

## 7. Main Production Output
v1 supports exactly one main Product output per Production Batch.

The output Product must equal the Production Item canonical output Product.

~~~
Production Item
  output Product = PRODUCT-A
        ↓
Production Batch
  main output = PRODUCT-A
~~~

By-products and semi-finished outputs are outside v1.

The actual output quantity is posted to Product Stock at the selected output Stock Location.

The current Product Stock compatibility model is integer-based. Fractional finished-good output requires a future Product Stock UOM contract before it is enabled.

## 8. Completion Posting Boundary
Completion is the physical mutation boundary.

When a batch moves from IN_PROGRESS to COMPLETED, Production requests one atomic Inventory posting:

~~~
Material Stock
  input location
  − actual consumption

Product Stock
  output location
  + actual main output
~~~

Production must not update Inventory tables directly. Inventory validates and records the physical mutations.

## 9. Atomicity
The entire completion posting is atomic.

If several Materials are consumed and Product Stock is produced, either all required mutations commit or none commit.

Example:
~~~
Chicken −8.4 kg
Chili   −1.2 kg
Oil     −0.5 L
Product +37 pcs
~~~

If any required Material Stock balance is insufficient, completion fails before any partial Material deduction or Product Stock increase is committed.

This preserves the Inventory invariant that stock cannot become negative.

## 10. Idempotency
Production completion must be safely retryable.

Each completion operation uses one stable production_posting_id for that batch completion attempt.

If the same posting is submitted again, the system returns the original applied result and performs no additional stock mutation.

Inventory may derive child movement identities internally, but Production has one aggregate posting identity for the completion operation.

## 11. Completion Validation
Before posting, validate at minimum:
- Batch exists and is IN_PROGRESS;
- Production Item and Recipe Version remain readable;
- output Product matches the Production Item output Product;
- actual output quantity is valid for Product Stock;
- every actual Material exists and is stock-managed where required;
- each consumption resolves to the Material Base Stock UOM;
- input and output Stock Locations are authorized and active;
- no Material Stock would become negative;
- the completion posting has not already been applied.

Validation failure causes no stock mutation and the Batch does not become COMPLETED.

## 12. Recipe Version Immutability
A Batch always keeps the exact Recipe Version used for execution.

~~~
Batch PB-001 → Recipe Version 3
Later: Recipe Version 4 becomes active
PB-001 remains governed by Recipe Version 3.
~~~

## 13. Cancellation
Before Inventory posting, cancellation is a Production state transition and must record actor and reason.

Cancellation creates no Inventory mutation.

After completion, status-only cancellation is forbidden. Physical correction requires a compensating/reversal Inventory operation referencing the original Production Batch/posting.

## 14. Physical Failure / Waste Boundary
v1 does not introduce a separate FAILED stock state.

If execution stops before completion and no production posting has occurred, the batch may be CANCELLED with a reason.

If physical Material is wasted or lost, that physical mutation is recorded through the Inventory waste/adjustment contract rather than hidden inside Production status.

Exact yield variance, waste attribution, scrap workflow, and costing treatment remain later contracts.

## 15. Location Semantics
Production uses two explicit physical contexts:

~~~
Input Stock Location
  = where consumed Materials are held

Output Stock Location
  = where produced Product Stock is held
~~~

They may be the same location.

Central Kitchen example:
~~~
Central raw-material Stock Location
        ↓ consume
Production Batch
        ↓ output
Central sellable Product Stock Location
        ↓
Inventory Transfer
        ↓
Branch Product Stock
~~~

## 16. Audit References
Every Production-caused Inventory mutation must be traceable to production_batch_id and production_posting_id, plus actor, timestamp, mutated identity, Stock Location, and previous/resulting quantity.

Do not use generic batch_id when the source is a Production Batch.

## 17. Failure Boundaries
| Failure | Result |
|---|---|
| Batch canceled before posting | No Production stock mutation |
| Recipe Version unavailable | No completion / no stock mutation |
| Material stock insufficient | No completion / no partial mutation |
| Output posting fails | No partial completion |
| Completion request replayed | Original result returned; no duplicate mutation |
| Completed Batch needs correction | Compensating/reversal Inventory workflow |
| Physical waste occurs before completion | Inventory waste/adjustment records physical loss |

## 18. Existing Inventory Contract Alignment
The existing Xentra Inventory contract already establishes atomic stock mutation, idempotency, and non-negative stock. The future Material Stock implementation must preserve these principles.

The current Product/Branch Inventory service is compatibility code. This contract does not authorize converting it directly into Material Stock. Future implementation must use the target Material Stock and Product Stock identities with Inventory-owned mutation services.

## 19. What Is LOCKED
1. Production Batch is the execution record of one production run.
2. Batch references one Production Item and the exact Recipe Version used.
3. v1 does not require WIP inventory.
4. Production uses direct issue-and-produce semantics in v1.
5. Planned and actual output are separate.
6. Planned and actual Material consumption are separate.
7. v1 has one main Product output per Batch.
8. Main output Product equals the Production Item output Product.
9. Completion is the Inventory mutation boundary.
10. Completion posts actual Material consumption and actual Product output.
11. Completion posting is atomic.
12. Completion is idempotent through a stable Production posting identity.
13. Insufficient Material Stock blocks the whole completion.
14. COMPLETED Batch cannot be canceled by status-only edit.
15. Pre-posting cancellation creates no Inventory mutation.
16. Physical waste is an Inventory mutation, not a hidden Production status change.
17. Input and output Stock Locations are explicit.
18. Production never writes Inventory tables directly.

## 20. Explicitly Open for Later Contracts
- detailed Production Item → Stock Location routing schema / priority;
- detailed role/approval matrix;
- yield variance thresholds and mandatory reason rules;
- dedicated waste/scrap workflow;
- WIP and multi-step production;
- semi-finished outputs / sub-assemblies;
- by-products;
- lot / expiry tracking;
- Make-to-Order trigger/reservation semantics;
- scheduling / capacity;
- HPP / valuation;
- reversal workflow and accounting treatment;
- autonomous production/replenishment;
- detailed Product Stock UOM contract if fractional finished-goods quantities are required.

## 21. External Supporting Evidence
ERPNext documents Work Orders as manufacturing execution documents, separates material-consumption Stock Entries from Manufacture entries, and records consumed quantities and finished goods through the manufacturing flow. Odoo likewise separates manufacturing execution from Inventory movement and allows produced quantities/lots and component consumption to be registered before production is closed.

References:
https://docs.frappe.io/erpnext/work-order
https://docs.frappe.io/erpnext/material_consumption
https://docs.frappe.io/erpnext/stock-entry
https://www.odoo.com/documentation/master/applications/inventory_and_mrp/manufacturing/basic_setup/manufacturing_work_orders.html
https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/manufacturing/shop_floor/shop_floor_overview.html

These references support the separation and posting model; they do not override Xentra business authority.

## 22. Change Control
Any change to the Production Batch state machine, WIP policy, planned/actual semantics, output identity, atomic posting boundary, or idempotency contract requires a new explicit contract revision.

**LOCKED — Production Batch + Posting / Mutation Contract v1.**