# Xentra — Menu Composition Cost Resolution v1

**Status:** 🔒 LOCKED / ACTIVE
**Decision date:** 2026-10-08
**Scope:** Product component cost resolution for Menu Composition Cost.

## 1. Rule
Menu Composition Cost is calculated from effective `Menu Item` quantities multiplied by Product Unit Cost.

Product Unit Cost has one explicit basis per calculation:

```text
ACTUAL_OUTPUT
  → latest AVAILABLE Production Cost Snapshot / Production Output Unit Cost

THEORETICAL_RECIPE
  → published Recipe Version
  → current Material Moving Average
  → planned recipe quantity normalized to Material Base UOM
  → divided by planned Product output
```

Non-production-backed purchased Products use current canonical Product Stock carrying cost.

## 2. No Hidden Fallback
A caller must explicitly choose `ACTUAL_OUTPUT` or `THEORETICAL_RECIPE`.
A production-backed Product never silently switches from one basis to the other.
Missing authoritative cost returns `UNAVAILABLE`; it does not become zero or a legacy Product cost field.

## 3. UOM
Recipe component quantities are converted to the Material Base Stock UOM using canonical UOM factors and posting precision.
Product output yield is normalized to the Product Stock UOM.

## 4. Currency
All component costs contributing to one Menu Composition Cost must use one currency.
Mixed currency returns `UNAVAILABLE` / cost mismatch.
Currency conversion is a separate future contract.

## 5. Authority
Cost resolution reads canonical:
- Product Stock valuation state and Product movement currency evidence;
- Production Cost Snapshot;
- Recipe Version;
- Material Stock valuation state and Material movement currency evidence.

It never uses `products.cost_price`, `menus.cost_price`, selling price, or current supplier price as costing authority.

**LOCKED — Menu Composition Cost Resolution v1.**