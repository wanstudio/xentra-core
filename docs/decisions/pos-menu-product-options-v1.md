# Xentra POS — Menu & Product Options v1

**Status:** LOCKED / AUTHORITATIVE — 25 September 2026

## Decision

Xentra POS uses a deliberately narrow F&B menu interaction:

**Product → optional Product Options → Cart → Payment**

The model is inspired by common POS patterns used by local and international restaurant systems, but intentionally excludes enterprise modifier complexity.

## Allowed option types

### 1. Variant Group

A single-choice group for mutually exclusive alternatives.

Examples:
- Size: Regular / Large
- Spicy level: Normal / Spicy

A Variant Group can have at most one selected option. By default a Variant Group is required unless explicitly configured as optional.

### 2. Add-on Group

An optional multi-choice group for extra items or customizations.

Examples:
- Egg +Rp5.000
- Cheese +Rp4.000
- Extra Sambal +Rp2.000

A group may define minimum and maximum selections. There are no nested add-ons.

### 3. Item Note

A short free-text note belongs to the sale line and may be printed for preparation context.

## POS interaction rules

- Product with no options: tapping the product adds it directly to Cart.
- Product with options: tapping the product opens one Option Sheet.
- No nested option modal or multi-level modifier flow.
- Required groups must be satisfied before the line can enter Cart.
- Two different option configurations are two different Cart Lines even when product_id is identical.
- Quantity is merged only when product, selected options, and item note are identical.
- POS may preview the calculated line price for responsiveness, but the preview is never authoritative.

## Core authority

The POS sends product_id, quantity, selected option identifiers, item note, and expected client-side unit price for verification.

Core resolves the current Branch Product, current Branch availability, current stock, authoritative base price, authoritative option configuration, authoritative option price adjustments, and final unit price/subtotal.

Core rejects invalid, stale, unavailable, or unauthorized option selections at the final payment verification boundary.

## Order persistence

The authoritative option selection is stored as an immutable modifiers_snapshot on order_items.

The snapshot contains the resolved group/option identity, display names, type, and price adjustment used for that sale.

## Inventory boundary

Options do not create separate inventory pools.

Xentra keeps exactly one Branch inventory pool. Product options are sale configuration, not a second stock authority.

## Branch scope

For this MVP, option configuration is part of the Master Product definition and is inherited by Branches through the existing Branch Catalog model. Branch-specific option configuration or branch-specific option inventory is intentionally outside this revision.

## Offline boundary

Offline POS remains cash-only.

The local sale keeps the selected option snapshot so the sale does not lose its configuration during local persistence or later synchronization. Reconciliation still returns to Xentra Core as the authoritative order path.

## Explicit non-goals

Not included:
- nested modifiers
- modifier inheritance
- sequence pricing
- half/whole pricing
- pre-modifiers
- modifier-to-modifier dependency
- conditional modifier engines
- option-specific inventory pools
- a second POS catalog authority

## Architectural invariant

POS remains an execution surface. Merchant/Owner surfaces remain responsible for catalog management and configuration. Core remains the single authority for authentication, authorization, enforcement, persistence, pricing, inventory, payment, and audit.

**Any change to this model requires a new explicit decision/revision.**
