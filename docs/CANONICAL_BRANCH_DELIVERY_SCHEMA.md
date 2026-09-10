# Xentra Core — Canonical Branch Delivery Schema

**Status: LOCKED**  
**Decision date: 10 September 2026**

## Canonical table

For the current Xentra Core architecture, **`branch_delivery_settings` is the only canonical table for branch delivery/pickup capability and delivery configuration.**

`branch_settings` is **not** a supported alternative runtime schema.

The current implementation in `server/database/db.js`, the branch repositories, API routes, eligibility logic, and related tests use `branch_delivery_settings`.

## Rules

- New Core code MUST use `branch_delivery_settings`.
- New Connector code MUST use the Core contract derived from `branch_delivery_settings`.
- Do NOT add runtime compatibility logic for `branch_settings`.
- Do NOT describe the current architecture as having a `branch_settings` vs `branch_delivery_settings` schema choice.
- Historical/specification references to `branch_settings` are terminology from an older schema description and must not be treated as a second current model.
- Production database validation may still verify that a deployed database contains the canonical schema. That is an environment-validation step, not a schema-design ambiguity.

## Legacy documentation handling

Older documentation may still contain a `branch_settings` example. Such references are historical and are superseded by this decision. Future documentation updates should use `branch_delivery_settings` directly and should not reintroduce the obsolete table name as a current option.

**This document is an architecture guardrail and must be treated as authoritative unless explicitly superseded by a newer locked architecture decision.**
