# Master Menu Migration Engine v1

The migration engine reconciles existing Products into the canonical Master Menu Composition v1 lifecycle.

Rules:
- deterministic data is reconciled automatically;
- ambiguous free-text legacy semantics are never guessed;
- unresolved Products use needs_review;
- canonical Product saves mark migration state atomically with the composition save;
- legacy data is preserved until the separate contract phase.