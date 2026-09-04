# Xentra Home Composition Contract

**Status:** LOCKED BUSINESS/UX CONTRACT
**Decision Date:** 2026-09-04
**Authority:** Current Notion locked decisions

## Purpose

Customer Home is a dynamic container/composition layer. It must not hardcode Branch count, Branch IDs, menu/catalog structure, or business authority.

## Canonical Flow

```text
Destination Context
      ↓
Branch Discovery / Resolution
      ↓
Branch Context
      ↓
Category
      ↓
Product
      ↓
Cart
```

## Branch Count Behavior

### Exactly 1 relevant/eligible Branch

- Hide branch discovery/selector.
- Hide the text/section `Cabang terdekat dari tempatmu`.
- Directly render `Category → Product` for the resolved Branch.
- Preserve the authoritative Branch context internally for catalog, eligibility, cart, checkout, and order.

### More than 1 relevant/eligible Branch

- Render Branch discovery/selector from data.
- Present Branches ordered by authoritative ETA from the matching/routing layer.
- Distance may be shown as supporting information.
- Customer may select a valid Branch.
- After selection, render `Category → Product` for that Branch.

### Large Branch counts

1, 2, 50, or more Branches use the same composition model. Do not create fixed Branch slots, Branch-specific Home variants, or hardcoded catalog structures. Pagination, lazy loading, or virtualization may be used as presentation optimizations without changing business semantics.

## Authority Boundary

Home receives authoritative data/view models and renders them. Home must not independently determine:

- fulfillment Branch;
- ETA/ranking;
- inventory availability;
- authoritative price;
- eligibility;
- Branch acceptance;
- authorization;
- business policy;
- financial or inventory mutations.

`Cabang terdekat` is a discovery/presentation concept, not a rule that the nearest Branch must be the final fulfillment Branch.

## Fulfillment Selection

Xentra Core v1 remains:

```text
1 Cart → 1 Fulfillment Branch
```

Selection modes remain distinct:

```text
AUTO
  → BranchMatcher
  → Canonical Eligibility
  → Branch Acceptance

CUSTOMER_SELECTED
  → Selected Branch
  → Canonical Eligibility
  → Branch Acceptance
```

Customer-selected Branch is not a bypass. Invalid or ineligible selection must not silently rematch to another Branch.

## Location Context

```text
Buyer Location ≠ Delivery Destination ≠ Fulfillment Branch
```

For remote/gift orders, destination context is used for delivery discovery/matching. Buyer location must not be assumed to be the delivery destination.

## Catalog Composition

After Branch context is resolved/selected:

```text
Resolved/Selected Branch → Category → Product
```

Catalog content is data-driven and Branch-aware. Presentation must not maintain fixed menus per Branch.

## Acceptance Boundary

System eligibility and Branch operational acceptance remain separate:

```text
Order Request
  → Core Eligibility
  → ELIGIBLE
  → Branch Acceptance
  → ACCEPT / REJECT
```

An eligible Branch/order is not automatically accepted merely because the Home UI displays it.

## Verification Matrix

Implementation must verify at least:

1. One Branch: selector hidden and direct Category → Product.
2. Two Branches: selector rendered from data and ordered by authoritative ETA.
3. Many Branches: no fixed count/slots or Branch-specific code.
4. Invalid/unavailable selected Branch cannot be forced through client/UI state.
5. Selected Branch context reaches catalog and cart correctly.
6. Remote/gift buyer and delivery destination remain separate.
7. AUTO and CUSTOMER_SELECTED preserve their distinct semantics.
8. One Cart → One Fulfillment Branch remains enforced.
9. UI remains a composition layer and does not become business authority.
10. Existing reusable components are used where applicable.

## Agent Rule

Coding agents must implement this contract, not invent additional Home business rules. If a required policy is absent or contradictory, report the gap and stop at the decision boundary rather than guessing.
