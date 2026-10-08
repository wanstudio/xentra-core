# Xentra — Multi-Branch Supply & Stock Topology Contract v1

**Status:** 🔒 LOCKED / ACTIVE  
**Decision date:** 2026-10-07  
**Repository:** `wanstudio/xentra-core`  
**Applies to:** Production, Material, Inventory, Procurement, Catalog branch operations, replenishment workflows, and future multi-branch supply features.

## 1. Decision Summary

Xentra adopts a **configurable multi-location supply-network model**.

Xentra does **not** require every merchant to operate with branch-direct purchasing, nor does it require every merchant to use central procurement.

The same domain architecture must support:

- Branch-direct procurement;
- Central procurement and branch distribution;
- Hybrid sourcing;
- Central kitchen production;
- Branch production;
- Inter-branch / inter-location transfer.

The operating topology is a **business policy/configuration**, not a separate domain architecture.

The fundamental inventory boundary is:

> **Branch = organizational/operational scope.**  
> **Stock Location = physical inventory custody/location.**

## 2. Supply-Network Ownership

Within Xentra's business model, the **Organization** owns the supply network and its inventory scope.

This is an application/domain ownership decision, not a statement of legal title or accounting ownership.

The model is:

```text
Organization
  └── Supply Network
        ├── Stock Location
        ├── Stock Location
        └── Stock Location
```

Brand and Branch remain organizational/operational scopes used to control catalog, sales, people, permissions, and day-to-day operations.

A Brand or Branch must not be required to own a physical stock location merely because it participates in selling or operating.

## 3. Stock Location Is a First-Class Concept

Inventory must support physical locations that are not necessarily Branches.

Target location categories include:

- Branch Stock Location;
- Central Warehouse;
- Central Kitchen;
- Other authorized inventory location;
- In-transit / transit state where required by the transfer model.

A central warehouse must not be represented as a fake Branch.

A central kitchen must not be represented as a fake Branch solely to obtain inventory storage semantics.

The exact database schema and hierarchy for Stock Location remain an implementation-design concern, but the semantic concept is LOCKED.

## 4. Supported Supply Topologies

### 4.1 Branch-direct procurement

```text
Supplier
  ↓
Branch Procurement
  ↓
Goods Receipt
  ↓
Branch Material Stock
  ↓
Branch Production
  ↓
Branch Sellable Product Stock
```

Supported.

### 4.2 Central procurement and distribution

```text
Supplier
  ↓
Central Procurement
  ↓
Central Goods Receipt
  ↓
Central Material Stock
  ↓
Inventory Transfer
  ↓
Branch Material Stock
  ↓
Branch Production
  ↓
Branch Sellable Product Stock
```

Supported.

### 4.3 Hybrid sourcing

Different Materials may use different sources or policies:

```text
Rice          → Central Warehouse
Cooking Oil   → Branch Direct
Vegetables    → Local Branch Supplier
Packaging     → Central Distribution
```

Supported.

### 4.4 Central kitchen production

```text
Central Material Stock
  ↓
Central Production
  ↓
Central Product Stock
  ↓
Inventory Transfer
  ↓
Branch Sellable Product Stock
```

Supported.

### 4.5 Inter-location transfer

```text
Location A
  ↓
Inventory Transfer
  ↓
Location B
```

Transfer is an **Inventory transaction**.

It is not a Purchase Order and is not a Production Batch.

## 5. Procurement Authority

Xentra uses a **permission-driven procurement model**.

Default workflow:

```text
Branch / Operational User
  ↓
Purchase Request
  ↓
Authorized Procurement / Owner
  ↓
Purchase Order
  ↓
Goods Receipt
  ↓
Inventory Mutation
```

Branch Managers should be able to create Purchase Requests within their authorized scope.

Direct Purchase Order creation by Branch Managers is supported as a **permission/configuration option** for businesses that operate decentralized purchasing.

The system therefore does not require two different procurement architectures for centralized and decentralized merchants.

## 6. Purchaser and Receiver Are Distinct Authorities

The actor who creates or approves a Purchase Order is not required to be the actor who receives the goods.

Therefore:

- Purchaser ≠ Receiver;
- PO creator ≠ Goods Receiver;
- Central procurement may purchase;
- Branch staff may receive;
- Warehouse staff may receive;
- Receiving authority is enforced by Core authorization and Procurement/Inventory business contracts.

Receiving must be scoped to an authorized destination Stock Location.

## 7. Purchase Order Destination Boundary

A Purchase Order must have a clear primary receiving destination.

Xentra should not require a single PO to behave as an unrestricted multi-destination shipment document.

Cross-branch demand may be consolidated before ordering:

```text
Branch A Request  → 20 kg
Branch B Request  → 30 kg
Branch C Request  → 50 kg
                    ─────────
                      100 kg

                    ↓

             Central Purchase Order
                    ↓
             Central Warehouse
```

Distribution to Branches then occurs through Inventory Transfer.

The exact handling of supplier shipment splits remains an implementation/process detail and must not redefine the ownership boundary.

## 8. Production Location

Production is location-aware.

A Production Batch must be associated with an authorized production context/location.

Production may occur:

- at a Branch;
- at a Central Kitchen;
- at another authorized production-capable location.

Production output may become stock at its production location and may subsequently be transferred.

Production does not own stock balances.

Inventory remains the stock authority.

## 9. Product / Material / Production Separation

The following distinctions remain mandatory:

```text
Product
  = Catalog identity

Production Item
  = preparation/production identity

Material
  = ingredient/input identity

Stock Balance
  = physical quantity at a Stock Location
```

These are not interchangeable entities.

A Menu may optionally have production backing.

A Recipe/BoM does not make the Menu itself a Material or a Stock record.

## 10. Material Master Scope

Material master data is **Organization-scoped and reusable**.

The same Material identity may participate in multiple Brands, Branches, Productions, and supplier relationships within the Organization's supply network.

Supplier-specific commercial information belongs to Procurement through Supplier Material / sourcing definitions.

Example:

```text
Material
  Rice Premium
      │
      ├── Supplier A → 25 kg sack
      ├── Supplier B → 50 kg sack
      └── Supplier C → 10 kg sack
```

Material identity is not duplicated merely because a different Branch buys it.

## 11. Sourcing Policy

A replenishment requirement may be satisfied through different source types:

- Buy from Supplier;
- Transfer from another Stock Location;
- Produce at an authorized Production Location.

Sourcing preference is configuration/policy.

A Branch is not inherently forced to buy from a Supplier if a central or another authorized Stock Location can supply it.

Likewise, a central warehouse is not inherently required to supply every Material.

## 12. Replenishment Boundary

The default replenishment lifecycle is:

```text
Demand / Stock Condition
          ↓
Replenishment Requirement
          ↓
Purchase Request / Shopping List
          ↓
Procurement Decision
          ↓
Purchase Order
          ↓
Verified Goods Receipt
          ↓
Inventory Mutation
```

A low-stock condition is a **signal**, not an automatic Purchase Order by default.

Autonomous purchasing must be explicitly enabled by a future business policy, with appropriate limits and authorization.

## 13. Replenishment Policy Scope

Replenishment policy is location-aware.

The business may define, per Material and Stock Location:

- reorder point;
- target/min-max level;
- safety stock;
- lead time assumptions;
- replenishment source;
- supplier preference;
- later, forecast inputs or other planning parameters.

Do not make one global reorder value the universal truth for every Branch and Warehouse.

Exact reorder algorithms remain an implementation/business-policy extension and are not fully locked here.

## 14. Units and Pack Sizes

Inventory quantity is maintained in the Material/Product's authoritative inventory unit.

Procurement may use a different commercial purchase unit or pack size, with an explicit conversion to the inventory/base unit.

Example:

```text
Material Base UOM
  Rice = kg

Supplier Pack
  1 sack = 25 kg

PO
  5 sacks

Inventory Receipt
  +125 kg
```

The exact UOM schema, conversion tables, precision rules, and costing semantics remain implementation-design work.

## 15. Transfer Authority

Inter-location movement is Inventory-owned.

Default transfer workflow:

```text
Transfer Request
      ↓
Approved
      ↓
Dispatched
      ↓
In Transit
      ↓
Received
```

The transfer lifecycle must preserve an auditable distinction between:

- source deduction;
- stock in transit;
- destination receipt.

A future one-step transfer may be supported where the operating policy allows it, but it must not remove the underlying Inventory authority or audit trail.

## 16. Existing Sellable Product Stock Contract Remains Valid

The existing Xentra sellable Product stock model remains:

- one authoritative sellable stock pool per Branch for current sales channels;
- Product/SKU stock is not split into POS/PWA/Dine-in/Delivery/WhatsApp pools;
- canonical ready-to-sell Product stock remains Inventory-owned.

Adding physical Stock Locations must not accidentally create channel-specific stock pools.

The new location model extends physical custody semantics; it does not redefine the current sales-channel stock contract.

## 17. Sale Does Not Imply Automatic Raw-Material Consumption

A customer sale does not automatically explode a Recipe/BoM into raw-material deductions merely because the Menu has production backing.

Production strategy may be:

- batch/make-to-stock;
- make-to-order/on-demand;
- other explicitly defined operational modes.

Production consumption and Product stock consumption are separate business processes unless a later decision explicitly joins them.

## 18. Configuration vs Architecture

Merchant operating models are configuration/policy:

```text
Branch-direct
Centralized
Hybrid
Central Kitchen
Inter-location replenishment
```

They must not create alternate schemas or alternate domain ownership systems.

The domain architecture remains:

```text
Catalog
Production
Material
Inventory
Procurement
```

with explicit contracts between them.

## 19. What Is Now LOCKED

The following are now business-architecture decisions:

1. Organization-wide supply-network scope.
2. Branch is organizational/operational scope, not physical inventory location.
3. Stock Location is a first-class Inventory concept.
4. Central Warehouse is supported.
5. Central Kitchen is supported.
6. Branch-direct procurement is supported.
7. Central procurement/distribution is supported.
8. Hybrid sourcing is supported.
9. Inter-location transfer is Inventory-owned.
10. Production may occur at Branch or Central/authorized locations.
11. Production output may be transferred.
12. Material master is Organization-scoped.
13. Procurement authority is permission-driven.
14. Branch Managers may request procurement by default within scope.
15. Direct Branch PO creation is an allowed permission/configuration, not a separate architecture.
16. Purchaser and receiver may be different actors.
17. Purchase Orders have a clear primary receiving destination.
18. Replenishment starts as a requirement/request signal; low stock does not inherently create an automatic PO.
19. Sourcing may be Buy / Transfer / Produce.
20. The existing Branch sellable-product stock pool contract remains intact.
21. These rules apply while preserving the active Production, Material, Procurement, Affiliate, and Internal Communication/Notifications roadmap.

## 20. What Remains OPEN

The following are implementation-design or later business-policy decisions:

- exact Stock Location table/schema and hierarchy;
- whether one Stock Location may serve multiple Brands under one Organization and the detailed scope checks;
- exact role/permission matrix for procurement, receiving, transfer, and production;
- exact UOM/conversion schema and precision;
- exact Product ↔ Production Item cardinality;
- Recipe/BoM versioning;
- production planning and batch scheduling;
- make-to-stock vs make-to-order selection at the per-Production-Item level;
- detailed waste and yield accounting;
- forecasting;
- reorder algorithm sophistication;
- automatic replenishment/autonomous PO limits;
- supplier commercial terms/costing;
- exact Goods Receipt decomposition;
- financial/accounting treatment of inventory ownership and valuation.

These OPEN items must not contradict the LOCKED ownership and topology rules above.

## 21. Refactoring / Implementation Gate

Before Production, Material, Procurement, or Stock Location schema is implemented against the existing codebase:

```text
1. Vocabulary Audit
        ↓
2. Domain Ownership Matrix
        ↓
3. Consumer / FK / API Impact Map
        ↓
4. Target Data Model
        ↓
5. Compatibility Seams
        ↓
6. Incremental Migration
        ↓
7. Data + Regression Verification
        ↓
8. Legacy Quarantine
        ↓
9. Legacy Removal only after proof
```

Known existing debts remain migration targets:

- Commerce catalog responsibilities → Catalog;
- Dining implementation under POS → Dining;
- Purchase Order implementation under Inventory → Procurement.

No blind rename, mass table split, or broad service relocation is authorized merely because this contract is now locked.

## 22. CTO Guardrail

The purpose of this contract is to make Xentra **business-model flexible without becoming architecture-flexible in an unsafe way**.

Xentra must be able to adapt supply topology through configuration while preserving stable ownership:

```text
Catalog      → What is sold
Production   → How it is made
Material     → What inputs are
Inventory    → What physical stock exists
Procurement  → What is bought / received
```

This contract supersedes the previously open topology questions from:

`docs/decisions/xentra-multibranch-supply-topology-simulation-v1.md`

The simulation document remains useful as supporting analysis/evidence.

**LOCKED — Multi-Branch Supply & Stock Topology Contract v1.**
