# Xentra — POS Split Bill / Payment Allocation Contract v1

**Status:** LOCKED CONTRACT / IMPLEMENTATION PENDING  
**Decision date:** 2026-09-26  
**Scope:** POS dine-in billing when multiple people at one table want to pay separately

## Decision

Xentra POS treats **Split Bill as allocation of one canonical Order's outstanding amount across multiple payer checks/payments**.

The fundamental object being split is the **bill amount**, not the Commerce Order.

- `orders` remains the single canonical commercial transaction.
- One table remains one Dining Session.
- Split Bill never creates a second Commerce Order.
- Split Bill never creates a second Dining Session.
- Split Bill never creates a synthetic table.
- Multiple checks/payer allocations belong to the same canonical Order.
- The total allocated amount must never exceed the Order's remaining payable balance.
- When all allocations/payments equal the Order total, the canonical Order can complete through the normal payment lifecycle.

## Two customer-facing ways to allocate the bill

### A. Split by Amount — primary/general-purpose flow

Use when customers simply want to pay different amounts.

Example:

```
Order total: Rp150.000

A pays: Rp85.000
B pays: Rp65.000
```

The POS does not need to know which products belong to A or B.

This is the simplest and most flexible flow for statements such as:

> "Saya bayar 85 ribu, sisanya dia."

The cashier can continue allocating additional amounts until the remaining balance is zero.

### B. Split by Item — optional itemized flow

Use when a customer explicitly wants to pay for what they personally ordered.

Example:

```
A:
Nasi Goreng  Rp40.000
Es Teh       Rp10.000
              --------
              Rp50.000

B:
Ayam Bakar   Rp50.000
Es Teh       Rp10.000
              --------
              Rp60.000
```

For shared/identical items, item quantities may be allocated across checks when necessary.

Item selection is therefore a **way to calculate a payer's amount**, not the definition of Split Bill itself.

## Optional future allocation modes

The contract leaves room for additional allocation helpers without changing the canonical model:

- Equal amount / N-way split.
- Split by seat, if Xentra later captures seat ownership during ordering.
- Percentage allocation.

These are convenience methods that produce payer amounts/check allocations. They must not create duplicate Commerce Orders.

## Core model

```
                    1 Table
                       |
                1 Dining Session
                       |
                1 Commerce Order
                       |
             Total payable Rp150k
                       |
          +------------+------------+
          |                         |
       Check A                   Check B
       Rp85k                     Rp65k
       Paid                      Paid
```

For itemized payment:

```
                    1 Commerce Order
                           |
                 Total payable Rp150k
                           |
          +----------------+----------------+
          |                                 |
      Check A                           Check B
   selected items                   remaining items
      Rp50k                             Rp100k
```

Both representations remain under the same Order.

## Important boundary: Check vs Payment

A **Check** represents an allocation of the Order's bill for a payer.

A **Payment** represents the actual settlement event and payment method.

**A Check is not the same thing as a payer or a single payment.**

Therefore:

- A Check can be created/allocated before payment.
- A Check may be partially or fully paid according to the payment lifecycle.
- **One Check may be settled by multiple Payments.**
- **One Payment settles one contribution amount and records its own payment method/actor metadata.**
- A payer does not need a dedicated Check merely because they contribute money.
- Example: Check B = Rp100.000 can be settled by B = Rp70.000 + C = Rp30.000.
- B and C do not need separate Checks in that scenario.
- If a Check is partially paid, its remaining unpaid balance stays attached to that same Check.
- Multiple payments may settle the same Check until its allocated amount is fully paid.
- Multiple payments/checks remain children of the same canonical Order.
- Payment processing must not create duplicate Orders.
- The canonical Order remains the accounting/commercial anchor.

### Example: A pays own food, B and C combine to pay the remainder

```
Order total: Rp150.000

Check A — Rp50.000
  Payment A → Rp50.000
  Status: PAID

Check B — Rp100.000
  Payment B → Rp70.000
  Payment C → Rp30.000
  Status: PAID

Order
  └── Rp150.000 fully settled
```

This is a valid **combined payment** scenario.

The model must also support:

```
Check B — Rp100.000
  Payment B → Rp40.000
  Payment C → Rp35.000
  Payment D → Rp25.000
```

The number of payment contributors is not constrained to the number of checks.

## Remaining-balance invariant

At every point:

```
remaining = order_total - valid_paid_amounts - outstanding_allocations
```

The system must reject any allocation that would make the sum of payer allocations exceed the remaining payable amount.

Example:

```
Order total       Rp150.000
A allocation       Rp85.000
Remaining          Rp65.000

B can allocate     Rp65.000 maximum
B cannot allocate  Rp70.000
```

For an already-created Check, payment validation is separate:

```
check_remaining = check_allocation - valid_paid_amounts_for_that_check
```

A payment may never exceed the remaining amount of its target Check.

Rounding, discounts, service charges, tax, and other order-level adjustments must be resolved into the canonical payable total before the final allocation amount is accepted.

## UX contract

The primary POS action should be understandable as:

**Split Bill**

Then the cashier can choose how to determine the next payer's amount:

1. **Nominal** — enter how much this person pays.
2. **Item** — select what this person pays for.

Equal split can be presented as a quick helper rather than a separate business model.

During payment, the cashier must be able to select an existing Check and record one or more payments against that Check until its balance reaches zero.

The UI should always show:

- Original Order total.
- Amount already paid.
- Amount allocated to other checks/payers.
- Current remaining balance.
- Current Check allocation.
- Current Check amount already paid.
- Current Check remaining balance.
- Amount being assigned/paid now.
- Final Order remaining balance.

## Cross-reference: established restaurant POS patterns

The same separation appears in major restaurant POS products:

- **Square for Restaurants** documents splitting a bill/check by item or seat, and separately describes splitting a payment by amount. It explicitly describes amount splitting as entering amounts until the full balance is covered. [Square for Restaurants split bill/payment documentation](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants)
- **Toast POS** documents splitting payments evenly and splitting checks by item; its documentation also describes manually entering payment amounts when the desired split is not covered by the standard item split flow. [Toast POS split checks documentation](https://support.toasttab.com/en/article/Splitting-Checks-by-Item-1492811097734)
- **Lightspeed Restaurant** documents equal-part splitting and selected-item splitting, with separate numbered receipts/checks under the same payment workflow. [Lightspeed Restaurant bill splitting documentation](https://resto-support.lightspeedhq.com/hc/en-us/articles/226405708-Splitting-a-bill)

These references validate the business need for multiple allocation methods. Xentra-specific canonical Order/Dining invariants remain defined by this contract.

## Relationship to current implementation

The current P1 implementation already establishes:

- one canonical Order;
- multiple checks under that Order;
- item/quantity allocation;
- no duplicate Order or Dining Session.

The next implementation step is to extend the check/payment layer so **amount-based allocation is first-class** and **multiple payments per Check are first-class**, while preserving the current item-based option.

No implementation should introduce duplicate Commerce Orders, duplicate Dining Sessions, or synthetic tables to model split payments.

## Related

- `docs/decisions/pos-split-merge-canonical-check-v1.md`
- `docs/decisions/pos-flow-audit-backlog-v1.md`
- `docs/decisions/pos-cashier-pending-dine-in-table-reservation-v1.md`
