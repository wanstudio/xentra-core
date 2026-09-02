---
name: xentra-integration-engineering
description: Implement Xentra integrations with external gateways, webhooks, POS sync, delivery providers, hardware, and events without leaking provider-specific behavior into core domains.
---

# Xentra Integration Engineering

## Boundary
External systems are adapters around Xentra contracts. Provider-specific request/response formats belong in the integration boundary, not in Commerce, Payment, Inventory, or POS business rules.

## Before implementation
Identify:
- Xentra-owned source of truth;
- external provider role;
- inbound vs outbound direction;
- identity/tenant/branch scope;
- retry and timeout behavior;
- idempotency key;
- failure/reconciliation path;
- audit evidence.

## Webhooks
Treat webhook payloads as untrusted input. Verify the provider's authentication/signature mechanism when defined, resolve the local resource by a stable provider reference, validate amount/status/tenant context, and make processing idempotent before applying side effects.

Do not let a webhook directly choose an arbitrary tenant, branch, payment amount, inventory quantity, or financial result.

## Payment providers
Keep payment lifecycle distinct from order lifecycle. Persist provider references and authoritative snapshots needed for historical reconstruction. Duplicate callbacks must not duplicate settlement, refund, inventory deduction, or ledger effects.

## POS/offline synchronization
Offline transactions require a stable client transaction identity, branch scope, deterministic reconciliation, and conflict rules. Replays must be safe. Never identify a transaction only through free-form notes or display text when a structural key can be used.

## Delivery/routing providers
Provider calculations are inputs to the Xentra-owned delivery contract. Validate response shape and eligibility before committing authoritative distance, fee, or branch assignment.

## Hardware/KDS
Keep hardware transport replaceable. A printer/KDS/cash-drawer failure should not silently corrupt the underlying order or financial state. Record operational failures separately from business state transitions.

## Events
Publish domain events after the source-of-truth mutation is valid. Event consumers must tolerate duplicate delivery and preserve tenant/branch context. Event metadata should support tracing and audit without becoming business state itself.

## Configuration
Provider credentials and endpoints come from secure configuration. No credentials, deployment tokens, signing secrets, or private keys in source control.

## Completion check
For each integration change verify contract mapping, authentication/trust boundary, retry/idempotency, timeout/failure behavior, local source of truth, auditability, and the recovery/reconciliation path.
