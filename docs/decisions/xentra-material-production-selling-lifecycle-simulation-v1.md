# Xentra — Material → Procurement → Production → Selling Lifecycle Simulation v1

**Status:** 🔎 SIMULATION / ARCHITECTURE EVIDENCE  
**Date:** 2026-10-08

## 1. Executive Result

The end-to-end lifecycle is coherent when four concepts remain separate:

~~~
Material identity
≠ Material stock
≠ Production process
≠ Sellable Menu / Product
~~~

Validated business lifecycle:

~~~
Material Master
    ↓
Demand / Stock Condition
    ↓
Replenishment Requirement
    ↓
Shopping List / Purchase Request
    ↓
Procurement
    ↓
Purchase Order
    ↓
Verified Goods Receipt
    ↓
Material Stock
    ↓
Production / Recipe / BoM
    ↓
Production Batch
    ↓
Production Output / Product Stock
    ↓
Menu / Menu Items
    ↓
Order / Sale
    ↓
Sellable Product Stock Consumption
~~~

**Result: PASS at business-lifecycle level.**

## 2. Domain Boundaries

| Domain | Business question | Authority |
|---|---|---|
| Material | Apa bahan/input-nya? | Material identity/specification |
| Procurement | Apa yang dibeli dan apa yang diterima? | Supplier, Supplier Material, Purchase Request, PO, Goods Receipt |
| Production | Bagaimana bahan menjadi output? | Recipe/BoM, Yield, Production Batch, Production Output |
| Inventory | Berapa stok fisiknya dan apa mutasinya? | Material Stock, Product Stock, Stock Balance/Movement |
| Catalog | Apa yang dijual ke customer? | Product, Menu, Menu Item, Item Choice, Menu presentation |
| Commerce / POS | Bagaimana penjualan dieksekusi? | Order/Checkout atau Sale/POS lifecycle |

## 3. Lifecycle Simulation

### A — Material

Material adalah identity, bukan quantity.

Example:

~~~
Rice Premium
Chicken
Cooking Oil
Chili
Tea
~~~

Material dapat dipakai lintas Branch, Production, dan Supplier Material dalam supply network yang sama.

### B — Demand / Replenishment

Inventory membaca kondisi stock pada Stock Location.

Example:

~~~
Chicken = 8 kg
Reorder point = 10 kg
~~~

Result:

~~~
Stock Condition
→ Replenishment Requirement: Chicken +10 kg
~~~

Low stock **tidak otomatis menjadi PO**. Sourcing masih diputuskan oleh policy:

~~~
BUY | TRANSFER | PRODUCE
~~~

### C — Belanja / Procurement

Replenishment Requirement menjadi operational work:

~~~
Replenishment Requirement
→ Shopping List / Purchase Request
→ Procurement Decision
→ Purchase Order
~~~

Purchase Order mengubah status Procurement, **bukan Material Stock**.

### D — Receiving

Barang benar-benar datang.

~~~
Purchase Order: 20 kg Chicken
Verified Receipt: 18 kg
→ Material Stock +18 kg
→ 2 kg remains outstanding
~~~

Therefore: Purchase Order ≠ Stock.

### E — Material Stock

Inventory kini mencatat:

~~~
Stock Location: Branch A Kitchen
Chicken = 18 kg
~~~

Procurement tidak membuat ledger stok kedua.

### F — Production

Production menggunakan Recipe / BoM.

Example:

~~~
Production Item: Ayam Geprek
Yield: 20 portions

Consumption:
- Chicken 4 kg
- Chili 0.6 kg
- Oil 0.4 L
~~~

Production records the batch and transformation evidence.
Inventory records the physical stock mutations through the Inventory contract:

~~~
Material Stock decreases
Production Output increases
~~~

Production bukan inventory ledger kedua.

### G — Menu

Customer tidak membeli Recipe.

Customer membeli Menu.

~~~
Menu: Ayam Geprek + Nasi
├── Ayam Geprek ×1
└── Nasi ×1
~~~

Category hanya grouping/classification.
Title adalah nama komersial Menu yang dimasukkan Owner.

### H — Item Choice

Choice berada di bawah Menu Item tertentu.

~~~
Menu Item: Ayam Geprek
└── Pilihan Item: Sambal
    ├── Sambal Geprek
    └── Sambal Ijo
~~~

Two cases:

~~~
Kamu mengatur
→ Owner menetapkan Sambal Geprek

Pelanggan memilih
→ Customer memilih Sambal Geprek atau Sambal Ijo
~~~

Choice resolution mengubah effective commercial composition.
Choice **tidak langsung mengurangi Material Stock**.

Future Production/Material rules menentukan apakah selected choice:
- mengubah production demand;
- memetakan ke Product/stocked Item lain;
- menambah stock-managed Item;
- atau tidak memiliki stock impact.

### I — Selling

Setelah Menu resolved, Commerce/POS menjalankan penjualan.

~~~
Menu resolution
→ availability check
→ Order / Sale
→ acceptance/commit boundary
→ Sellable Product Stock consumption
~~~

Example:

~~~
Ayam Geprek ready stock = 20
Customer buys 2
→ ready stock = 18
~~~

Raw Material Stock yang sudah dikonsumsi oleh Production Batch **tidak dikonsumsi ulang** oleh sale.

## 4. Full Branch-direct Example

~~~
Material Stock
  ↓
Replenishment Requirement
  ↓
Purchase Request
  ↓
Branch PO
  ↓
Branch Receiving
  ↓
Material Stock
  ↓
Production Batch
  ↓
Ready-to-sell Product Stock
  ↓
Menu
  ↓
Customer Order / POS Sale
  ↓
Sellable Product Stock
~~~

## 5. Central Kitchen Example

The same lifecycle works when production is centralized:

~~~
Supplier
  ↓
Central Procurement
  ↓
Central Material Stock
  ↓
Central Production
  ↓
Production Output
  ↓
Inventory Transfer
  ↓
Branch Product Stock
  ↓
Menu Selling
~~~

No alternate domain model is required.

## 6. Hybrid Example

~~~
Material A → central purchase → transfer → Branch
Material B → Branch purchase → Branch receiving
Production → central or Branch according to policy
~~~

Topology changes by policy/configuration, not by creating another architecture.

## 7. Failure Simulation

- PO cancelled → no stock mutation.
- PO partially received → only verified quantity enters Material Stock.
- Shipment lost before receipt → no stock receipt.
- Production batch fails → Production records failure/waste evidence; Inventory records actual physical mutations according to the Production/Inventory contract.
- Customer chooses another Item Choice → Menu resolution changes; no direct raw-material mutation.
- Ready-to-sell Product stock unavailable → selling is constrained by the active Menu/Inventory contract.
- Central transfer unavailable → sourcing may re-enter replenishment decision; Transfer is not silently converted into Purchase Order.

## 8. HPP Boundary

Conceptual cost flow:

~~~
Material purchase/cost
    ↓
Material Stock
    ↓
Production consumption + yield
    ↓
Production Output Cost
    ↓
Sellable Product / Menu effective cost
    ↓
Menu Selling Price
~~~

This simulation intentionally does not lock valuation method, UOM precision, overhead allocation, waste costing, or HPP timing.

## 9. Invariants Proven by Simulation

1. Material identifies inputs; Inventory quantifies them.
2. Procurement owns purchase documents; Inventory owns physical stock.
3. Production owns transformation records; Inventory owns stock mutations.
4. Catalog owns commercial Menu semantics.
5. Item Choice changes effective Menu composition, not stock directly.
6. Selling consumes ready-to-sell stock according to the active Inventory contract.
7. Branch-direct, central, and hybrid supply use the same domain model.
8. No domain maintains a competing stock ledger.
9. Customer/POS cannot rewrite Material, Production, Procurement, or Inventory authority.

## 10. Open Gates Kept Open

This simulation does **not** lock:
- Product ↔ Production Item cardinality;
- Recipe/BoM versioning;
- make-to-stock vs make-to-order per Production Item;
- exact production output stock identity;
- UOM/conversion precision;
- costing/valuation/HPP algorithm;
- production scheduling;
- waste accounting;
- autonomous purchasing limits;
- detailed role/permission matrix.

These require separate contracts.

**Simulation result: PASS. The end-to-end lifecycle is architecturally consistent without collapsing Material, Procurement, Production, Inventory, Catalog, Commerce, or POS responsibilities.**