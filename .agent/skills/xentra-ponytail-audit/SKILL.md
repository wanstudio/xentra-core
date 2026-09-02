---
name: xentra-ponytail-audit
description: Audit the Xentra repository for accumulated over-engineering, duplicate abstractions, unnecessary dependencies, and architecture drift.
---

# Xentra Ponytail Audit

## Objective
Perform a repository-level simplicity and architecture audit focused on unnecessary complexity, while keeping Xentra's required domain boundaries and safeguards intact.

## Inspect
Review:
- repeated helpers/services/components with the same responsibility,
- parallel abstractions that should share one owner,
- dependencies whose capability is already available in the runtime or stack,
- configuration layers that duplicate domain rules,
- compatibility code left behind after migrations,
- dead or unreachable abstractions,
- overly generic frameworks used by only one concrete path,
- architecture layers that add indirection without a current boundary benefit.

## Xentra authority
Do not classify required modularity as over-engineering.
Organization, Brand, Branch, Commerce, POS, Inventory, Payment, Delivery, Reporting, Integration, RBAC, tenant isolation, financial attribution, auditability, and transaction boundaries may require explicit separation even when that increases code size.

Notion locked decisions and current requirements are the authority for whether a boundary is required.

## Evidence standard
Every finding should identify:
- affected paths,
- current responsibility ownership,
- why the complexity is unnecessary now,
- what simpler structure preserves the same contract,
- and whether cleanup is safe now or should wait for a related migration.

Do not recommend broad cleanup solely for aesthetic reasons.

## Output
Separate findings into:
- remove now,
- consolidate when touched,
- intentional complexity,
- and no action.

## Completion check
Prefer a smaller and clearer architecture where that preserves current behavior, domain ownership, security, integrity, and future-required contracts.