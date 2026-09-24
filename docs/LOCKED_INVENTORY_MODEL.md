# 🔒 Xentra Inventory Model — Sellable Product Stock vs Procurement / Raw Material Inventory v1

**Status: LOCKED / AUTHORITATIVE**  
**Decision date:** 2026-09-24  
**Scope:** Xentra Commerce, Customer PWA, POS/Merchant operations, Branch Product stock, Purchasing, and raw-material inventory.

## 1. Core Decision

Xentra has two different inventory concepts with different business purposes:

1. **Sellable Product Stock**
   - Stock of products/menu items that are already **ready to sell**.
   - Example: Nasi Goreng = 20 portions ready for sale.
   - Used by Customer PWA, Merchant operations, and POS sales.
   - This is the stock represented by the Branch Product sellable quantity (for example the `branch_products.stock` field).
   - It is **one Branch sellable stock pool**, not separate POS/PWA/Dine-in/Delivery/WhatsApp stock pools.

2. **Procurement / Raw Material Inventory**
   - Stock of ingredients/materials used to purchase, prepare, or produce sellable products.
   - Examples: rice 20 kg, chicken 10 kg, cooking oil 5 L.
   - Used by Purchasing / Inventory / Production workflows.
   - It is a different inventory domain from customer-facing sellable product quantity.

These two concepts **must not be merged into one generic stock meaning**.

## 2. Sellable Product Stock — Order/Sales Meaning

Sellable Product Stock answers:

> “How many ready-to-sell units of this product are available for sale at this Branch?”

Example:

```
Nasi Goreng ready to sell = 10
```

For a customer order:

```
Customer Order
→ Pending
→ Merchant Accept
→ Sellable Product Stock - quantity
```

For an immediate/direct POS sale, stock may be consumed atomically with the POS sale.

A pending customer order must not permanently reduce sellable stock before the order reaches the business acceptance boundary.

## 3. Procurement / Raw Material Inventory — Purchasing Meaning

Raw Material Inventory answers:

> “How much ingredient/material does the business physically have for purchasing, storage, and production?”

Example:

```
Rice = 20 kg
Chicken = 10 kg
Oil = 5 L
```

Purchasing increases this inventory.

Production/recipe workflows may later consume this inventory when ingredients are actually used.

This inventory is **not the same thing as the ready-to-sell quantity of a menu item**.

## 4. No Channel Stock Pools

Xentra must never create:

```
POS stock
PWA stock
Dine-in stock
Delivery stock
WhatsApp stock
Marketplace stock
```

for sellable products.

The Branch has one authoritative sellable product quantity shared across all sales channels.

## 5. Important Semantic Boundary

Do not interpret the existence of a raw-material inventory lifecycle as a requirement to add a reservation/consumption state machine to sellable menu stock.

For the current Xentra sellable-product model:

```
CHECK
→ ORDER PENDING
→ MERCHANT ACCEPT / CONFIRMED
→ SELLABLE PRODUCT STOCK DECREASES
```

The raw-material inventory lifecycle is separate and may have its own:

```
PURCHASE
→ STOCK IN
→ STORE / PREPARE
→ CONSUME IN PRODUCTION
```

## 6. Canonical Examples

### Example A — Ready-to-sell menu

```
Nasi Goreng ready-to-sell = 10

Customer orders 2
→ pending
→ sellable stock remains 10

Merchant accepts
→ sellable stock becomes 8
```

### Example B — Raw material

```
Rice on hand = 20 kg

Purchasing receives 10 kg
→ rice becomes 30 kg

Production uses 2 kg
→ rice becomes 28 kg
```

The 20 kg / 30 kg / 28 kg figures are **raw-material inventory**, not menu sellable stock.

## 7. Non-Goals

This decision does not:
- create channel-specific sellable stock pools;
- redefine menu/catalog ownership;
- force every sellable product to have a recipe;
- require raw-material inventory to exist before a ready-to-sell product can be sold;
- require Customer/POS order flows to directly manipulate raw-material stock.

## 8. Source-of-Truth Rule

When code, tests, or documentation use the word **stock**, they must make the intended inventory layer clear:

- **Sellable Product Stock** = ready-to-sell product quantity for sales.
- **Procurement / Raw Material Inventory** = ingredients/materials for purchasing and production.

Any implementation that treats these as the same quantity or mixes their business rules requires an explicit architecture/business decision.

## 9. Relationship to Existing Inventory Check → Commit → Consume Contract

The existing Inventory Check → Commit → Consume contract remains useful for inventory domains that explicitly need reservation/commitment semantics.

However, it must **not** be read as redefining the `branch_products.stock` field into a raw-material or hidden reservation ledger.

For the current ready-to-sell product model, order acceptance is the stock-decrease boundary defined above.

**Git source of this lock:** https://github.com/wanstudio/xentra-core
