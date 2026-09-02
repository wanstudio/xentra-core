---
name: xentra-backend-engineering
description: Build and modify Xentra Node.js backend code with explicit contracts, authority boundaries, state transitions, transactions, and idempotent side effects.
---

# Xentra Backend Engineering

## Architecture
Prefer:
`route -> middleware/context -> application service -> domain/service -> repository/database -> side effects -> response`.

Controllers/routes adapt transport. Application services orchestrate use cases. Domain services own business behavior. Repositories own persistence concerns. Do not put authoritative business decisions in HTTP handlers.

## Request handling
- Validate shape, required fields, enums, and ranges at the boundary.
- Resolve tenant/organization/brand/branch from trusted server context.
- Treat client-supplied IDs as selectors, never as proof of authority.
- Keep customer identity distinct from authentication/session credentials.
- Return explicit DTOs; never expose internal rows with `SELECT *` by convenience.

## Business state
Before adding or changing a transition, define:
current state -> requested action -> authorized actor -> resulting state -> side effects -> failure behavior.
Keep order/fulfillment state separate from payment/financial state when the business contract requires it.

## Transactions
When one operation changes multiple consequential records, identify the actual transaction boundary. Keep payment, inventory, ledger, shift, order, and audit effects atomic where the invariant requires atomicity.

## Idempotency
Every retryable external operation must have a stable idempotency key or equivalent uniqueness boundary. Webhooks, payment settlement, offline POS sync, event consumers, and integration callbacks must tolerate duplicate delivery.

## Errors
Fail explicitly on invalid authoritative input. Do not silently clamp, coerce, fall back to another tenant, or continue with partial state when the documented contract requires rejection.

## Dependencies and runtime
Use the repository's declared Node/runtime contract. Do not introduce APIs unavailable in the declared production runtime. Keep optional fallbacks only when their degraded behavior is deliberate and safe.

## Side effects
Make external calls after the minimum internal state needed for correctness is committed, or use the repository's established outbox/event pattern when appropriate. Never make an external response the sole source of local financial truth.

## Database changes
Pair schema changes with the application code that depends on them. Check nullability, unique constraints, foreign keys, migrations/initialization, backward compatibility, and historical-data implications.

## Backend completion check
Trace the changed request end-to-end and verify authorization scope, domain owner, persistence, concurrency/idempotency, side effects, and response contract before considering the implementation complete.
