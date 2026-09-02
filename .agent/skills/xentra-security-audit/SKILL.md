---
name: xentra-security-audit
description: Audit Xentra for exploitable security flaws, logic defects, data leaks, tenant breaches, race conditions, and integrity failures using evidence-first analysis.
---

# Xentra Security & Logic Audit

## Primary objective
Find realistic exploitable flaws and consequential logic/data defects. Avoid false vulnerability claims.

## Prove before claim
Do not label something vulnerable merely because:
- it differs from a generic best practice,
- a field is optional,
- defaults differ,
- code looks unusual,
- another architecture is possible.

A vulnerability requires a credible attack/reachability path plus meaningful impact or violation of a protected security invariant.

## Trace method
For sensitive operations trace end-to-end:
request -> identity -> tenant context -> authorization -> validation -> domain logic -> database -> side effects -> response/audit.

Inspect both happy and adversarial paths.

## Attack questions
- Can an untrusted actor reach this code?
- Which inputs are attacker-controlled?
- Can tenant/brand/branch identity be substituted?
- Can authorization be bypassed?
- Can state be forced into an invalid transition?
- Can the same operation be replayed?
- Can concurrent requests create inconsistent state?
- Can secrets, PII, financial data, or another tenant's data leak?
- Can inventory/payment/ledger effects diverge?
- Is there a realistic impact?
- Can the finding be reproduced or demonstrated from code evidence?

## High-priority classes
- tenant isolation / IDOR-like access
- privilege escalation
- authentication/authorization bypass
- secret exposure
- sensitive data leakage
- payment manipulation
- duplicate settlement/webhook effects
- inventory race or negative/incorrect deduction
- state-machine bypass
- transaction atomicity failure
- replay/idempotency failure
- unsafe deployment/authentication boundary
- server-side trust of client-controlled authoritative fields

## Finding classification
Use one of:
1. Confirmed vulnerability
2. Logic defect
3. Business conflict
4. Data-integrity risk
5. Operational risk
6. Hardening opportunity
7. False positive / intentional behavior

## Evidence standard
Every serious finding should contain:
- location/path,
- observed behavior,
- preconditions,
- attack/reproduction path,
- impact,
- invariant violated,
- confidence,
- recommended direction.

Do not overstate severity.

## Secrets
Never commit credentials, tokens, provider secrets, signing secrets, or deployment authentication material. CI/CD secrets belong in appropriate secret storage.

## Tenant boundary
Client-supplied IDs are selectors, not authorization. Server must resolve and validate authoritative tenant/brand/branch scope.

## Fix philosophy
Prefer the smallest change that closes the actual defect while preserving business behavior. Then add regression evidence for the exploited invariant where practical.
