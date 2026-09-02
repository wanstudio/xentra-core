# Xentra Agent Guide

This repository uses small, task-focused agent skills rather than one giant instruction file.

## Always start here
- Read the relevant Xentra Notion decision/requirements before coding.
- Inspect current Git status, recent commits, and relevant files.
- Identify the domain owner and preserve locked invariants.

## Skills
- `.agent/skills/xentra-context/SKILL.md` — repository context, source hierarchy, and decision discipline.
- `.agent/skills/xentra-business-logic/SKILL.md` — domain boundaries, state/lifecycle reasoning, and business invariants.
- `.agent/skills/xentra-coding-workflow/SKILL.md` — normal feature/refactor/bug-fix implementation workflow.
- `.agent/skills/xentra-yagni/SKILL.md` — YAGNI, reuse, dependency, and minimal-change discipline; prevents speculative architecture.
- `.agent/skills/xentra-backend-engineering/SKILL.md` — Node/Express backend boundaries, API contracts, authority, transactions, and idempotency.
- `.agent/skills/xentra-frontend-engineering/SKILL.md` — PWA/dashboard/workspace UI, reusable components, state, runtime wiring, and navigation.
- `.agent/skills/xentra-integration-engineering/SKILL.md` — gateways, webhooks, POS sync, delivery, hardware, and event integrations.
- `.agent/skills/xentra-database/SKILL.md` — database integrity, concurrency, transactions, inventory, and financial persistence.
- `.agent/skills/xentra-debugging/SKILL.md` — root-cause debugging and runtime investigation.
- `.agent/skills/xentra-security-audit/SKILL.md` — security and integrity audit when the task is security-sensitive or requires verification.

## Skill selection
Use the smallest relevant skill set. Combine skills when a change crosses boundaries; for example, a payment feature normally needs coding workflow + backend + database + integration context.

## Important boundaries
Notion locked decisions and invariants outrank current implementation details. Git is evidence of implementation/history, not authority to invent business rules. UI state is not domain authority.

## Completion
A coding task is complete only when the implementation matches the relevant contract, the correct runtime path is wired, affected callers remain coherent, and the changes are committed. Update durable documentation when the contract or architecture changes.
