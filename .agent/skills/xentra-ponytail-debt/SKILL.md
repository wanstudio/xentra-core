---
name: xentra-ponytail-debt
description: Manage deliberate technical shortcuts and deferred complexity in Xentra without turning temporary debt into accidental architecture.
---

# Xentra Ponytail Debt

## Objective
Make technical debt explicit, bounded, and tied to a real reason instead of allowing temporary shortcuts to become permanent architecture.

## What counts as deliberate debt
Examples include:
- a temporary compatibility path during migration,
- a known operational limitation accepted for MVP,
- a temporary adapter while an external contract stabilizes,
- a deferred refactor that is safe because the current domain contract remains correct.

Do not label required safeguards or domain separation as debt merely because they add code.

## Debt record
For meaningful debt record:
- current shortcut,
- reason it exists,
- affected contract/invariant,
- expected duration or removal trigger when known,
- risk if left in place,
- intended cleanup direction.

## Xentra authority
Notion requirements and locked decisions define what is mandatory. Git history records the implementation and migration context.
A temporary implementation is not a business rule unless explicitly decided.

## Before accepting debt
Ask:
1. Is the shortcut actually safe under the current contract?
2. Does it cross or weaken a domain/security/financial boundary?
3. Is there a simpler correct solution available now?
4. What concrete event should trigger cleanup?

Reject debt when it creates data-integrity risk, security bypass, tenant leakage, incorrect financial attribution, or irreversible architectural coupling.

## Cleanup discipline
Prefer removing debt when touching the same area for a related task. Do not launch unrelated cleanup merely because debt exists.

## Completion check
Every accepted shortcut should remain understandable, bounded, and compatible with the locked Xentra architecture.