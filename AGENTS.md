# Xentra Agent Guide

This repository uses small, task-focused agent skills rather than one giant instruction file.

## Before coding
- Read the relevant Xentra Notion decisions/requirements.
- Read every `.agent/skills/*/SKILL.md` relevant to the requested change; do not load unrelated skills unnecessarily.
- Inspect current Git status, recent commits, and affected files.
- Identify the domain owner, locked invariants, and existing implementation boundary.
- Do not write or modify code until the required context is understood.

## Authority
- Notion = authority for business rules, locked decisions, invariants, and architecture boundaries.
- Git = evidence of current implementation and history; never invent business rules from code alone.
- UI/client state is never domain authority.

## Skills
- `.agent/skills/xentra-context/SKILL.md` — repository context, source hierarchy, and decision discipline.
- `.agent/skills/xentra-business-logic/SKILL.md` — domain boundaries, state/lifecycle reasoning, and business invariants.
- `.agent/skills/xentra-coding-workflow/SKILL.md` — normal feature/refactor/bug-fix implementation workflow.
- `.agent/skills/xentra-yagni/SKILL.md` — YAGNI, reuse, dependency, and minimal-change discipline; prevents speculative architecture.
- `.agent/skills/xentra-ponytail-review/SKILL.md` — change-level review for unnecessary complexity, duplication, and speculative abstraction.
- `.agent/skills/xentra-ponytail-audit/SKILL.md` — repository-level audit for accumulated over-engineering and architecture drift.
- `.agent/skills/xentra-ponytail-debt/SKILL.md` — deliberate technical-debt tracking and cleanup discipline.
- `.agent/skills/xentra-backend-engineering/SKILL.md` — Node/Express backend boundaries, API contracts, authority, transactions, and idempotency.
- `.agent/skills/xentra-frontend-engineering/SKILL.md` — PWA/dashboard/workspace UI, reusable components, state, runtime wiring, and navigation.
- `.agent/skills/xentra-integration-engineering/SKILL.md` — gateways, webhooks, POS sync, delivery, hardware, and event integrations.
- `.agent/skills/xentra-database/SKILL.md` — database integrity, concurrency, transactions, inventory, and financial persistence.
- `.agent/skills/xentra-debugging/SKILL.md` — root-cause debugging and runtime investigation.
- `.agent/skills/xentra-security-audit/SKILL.md` — security and integrity audit when the task is security-sensitive or requires verification.

## Skill selection
Use the smallest relevant skill set. Combine skills when a change crosses boundaries; for example, a payment feature normally needs coding workflow + backend + database + integration context. Use Ponytail review when a change adds abstraction or refactoring, Ponytail audit for repository-wide complexity review, and Ponytail debt when accepting a deliberate temporary shortcut.

## Execution discipline
- Preserve existing domain boundaries and locked contracts.
- Follow YAGNI/minimal-change discipline: do not add speculative abstractions, dependencies, duplication, or unrelated refactors.
- Prefer existing ownership and contracts before creating parallel services/components/utilities.
- When a requirement genuinely crosses boundaries, introduce the smallest stable abstraction that satisfies it.
- Before finishing, verify affected business logic, domain boundaries, runtime wiring, and callers remain coherent.

## Completion
A coding task is complete only when the implementation matches the relevant contract, the correct runtime path is wired, affected callers remain coherent, and the changes are committed. Update durable documentation when the contract or architecture changes.
