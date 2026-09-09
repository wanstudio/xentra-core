# Xentra Agent Guide

This repository uses small, task-focused agent skills rather than one giant instruction file.

## Repository facts

- **Single-process Express monolith** — CommonJS (`require`), not ESM. One `package.json`, no workspaces.
- **Entry point**: root `app.js` re-exports `server/app.js` (Passenger-compatible). `server/app.js` is the real Express app.
- **Database**: SQLite via `node:sqlite` (Node 22+) or `sql.js` fallback (Node 20). Tests always use in-memory `:memory:`.
- **Frontend**: Plain HTML/JS/CSS in `apps/` served as static files — no build step, no framework, no bundler.
- **Node requirement**: `>=20.20.2` (see `package.json` engines).
- **Runtime topology**: Xentra Core is deployed to Xentra-controlled infrastructure. `xentra.cloud` is the SaaS Control Plane/Admin surface. Client domains are tenant/brand entry points provisioned through Xentra Domain Management; they are not hardcoded production identities and do not imply a dedicated physical server.

## Commands

```bash
npm test          # only verification step — no lint, no typecheck, no formatter
npm start         # node server/app.js on port 3000
```

Tests use Node's built-in test runner (`node --test`) with `--test-concurrency=1`. Pattern: `tests/*.test.js tests/**/*.test.js`. There is no ESLint, Prettier, TypeScript, or other static analysis.

## Before coding

1. Read the relevant Xentra Notion decisions/requirements.
2. If `docs/notion/` contains a snapshot relevant to the task, read it (see `docs/notion/README.md`). It is a pinned copy of Notion — ask the user when a decision may have changed since the snapshot.
3. Read every `.agent/skills/*/SKILL.md` relevant to the requested change; do not load unrelated skills unnecessarily.
4. Inspect current Git status, recent commits, and affected files.
5. Identify the domain owner, locked invariants, and existing implementation boundary.
6. Do not write or modify code until the required context is understood.

## Authority

- Notion = authority for business rules, locked decisions, invariants, and architecture boundaries.
- Git = evidence of current implementation and history; never invent business rules from code alone.
- UI/client state is never domain authority.

## Architecture layout

```
server/          Express app, routes, middleware, services, database
 domains/        Domain logic (commerce, delivery, inventory, payment, pos, promotion, reporting)
core/            Platform foundations (events, identity/RBAC, config, integration, audit)
apps/            Static frontends (customer-pwa, kitchen-display, merchant-dashboard)
tests/           Node built-in test runner — mirrors domains/, core/, services/, client/
tools/           Utility runners (telegram-runner, whatsapp-runner)
docs/notion/     Pinned Notion decision snapshots
```

Key domain boundaries: Organization → Brand → Branch. Payment credentials resolve hierarchically (Branch → Brand → Organization). Delivery formula is a single source of truth in `server/services/DeliveryCalculator.js`. Order state machine lives in `server/services/OrderStateMachine.js`.

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

## Domain / tenant / client-domain rules

- `xentra.cloud` is the Xentra SaaS Control Plane/Admin surface.
- Client domains are first-class tenant/brand entry points managed by the Control Plane Domain Management flow.
- The Domain Registry/managed domain configuration is authoritative for domain → tenant/brand association.
- Adding a client domain must not require application-source changes.
- Client-specific domains must not be hardcoded as application routing logic or special-case tenant fallbacks.
- Infrastructure-level domain entries may exist as generated provisioning state, but must originate from Domain Management rather than hand-maintained client exceptions.
- `tenantResolver` must resolve from authoritative domain configuration and authenticated context and fail closed for unknown domains.
- Do not accept tenant identity from an untrusted query parameter or arbitrary client-controlled header for protected operations.
- Do not introduce `app.mybangjo.com` (or another client domain) as a permanent production special case.
- The historical Bangjo shared-hosting mirror deployment is legacy and is not the target runtime topology.

## Skills selection

Use the smallest relevant skill set. Combine skills when a change crosses boundaries; for example, a payment feature normally needs coding workflow + backend + database + integration context. Use Ponytail review when a change adds abstraction or refactoring, Ponytail audit for repository-wide complexity review, and Ponytail debt when accepting a deliberate temporary shortcut.

## Execution discipline

- Preserve existing domain boundaries and locked contracts.
- Follow YAGNI/minimal-change discipline: do not add speculative abstractions, dependencies, duplication, or unrelated refactors.
- Prefer existing ownership and contracts before creating parallel services/components/utilities.
- When a requirement genuinely crosses boundaries, introduce the smallest stable abstraction that satisfies it.
- Before finishing, verify affected business logic, domain boundaries, runtime wiring, and callers remain coherent.

## Completion

A coding task is complete only when the implementation matches the relevant contract, the correct runtime path is wired, affected callers remain coherent, and the changes are committed. Update durable documentation when the contract or architecture changes.
