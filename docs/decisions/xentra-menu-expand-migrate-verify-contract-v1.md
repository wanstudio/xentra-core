# Xentra — Menu Migration Expand / Migrate / Verify / Contract v1

Status: LOCKED — DATA MIGRATION ARCHITECTURE
Date: 2026-09-30
Scope: Master Product Menu migration to Master Menu Composition v1

## 1. Decision
Xentra migrates Menu data with a staged Expand → Migrate → Verify → Contract lifecycle.
During the migration window, legacy data may remain physically present for compatibility/history while Master Menu Composition becomes the only canonical source of truth for new UI, new APIs, and new features.
Legacy and canonical data may coexist temporarily, but they are not co-equal authorities and are not maintained as a permanent two-way synchronization model.

## 2. Canonical authority
Owner Master Data → Master Product Composition → Branch Adoption → Branch Category + Operations → Customer Menu Resolver.

Canonical Master Product composition:
~~~
Product
  ├── Category    → products.category_id
  ├── Flavor      → product_flavors (0..1)
  ├── Complements → product_complements (0..N ordered)
  └── Level       → product_levels (0..1)
~~~
The legacy representation is migration input only.

## 3. Database coexistence rule
The database may temporarily contain legacy representation/state, canonical Master Menu relations, and migration lifecycle metadata.
Do not introduce permanent duplicate business columns such as name_legacy/name_new or flavor_legacy/flavor_new.
Legacy fields/tables are compatibility material. Structured values live in the normalized canonical relations. Migration lifecycle belongs in migration metadata.

## 4. Migration state model
Products carry lightweight current-state markers:
- menu_schema_version 1 = legacy/unreconciled
- menu_schema_version 2 = Master Menu Composition v1
- menu_migration_status = legacy | needs_review | migrated | verified | failed

Detailed migration evidence is stored in product_menu_migrations.
The Product row stores current state; the migration table stores the reconciliation/audit record.

## 5. Automatic conversion rule
The engine is deterministic and conservative.
It may inspect Product + canonical relations, validate Brand integrity, recognize an already-populated canonical composition, and mark that Product migrated when its canonical structure is valid.
It MUST NOT invent Flavor, Complement, or Level from ambiguous free text.
If a legacy Product contains no deterministically recoverable structured composition, the result is needs_review. The Owner completes it through the canonical Product Editor.

## 6. Canonical save integration
A successful save through the canonical Master Menu Editor records the Product as menu_schema_version 2 and menu_migration_status migrated in the same persistence path as the composition update.
Legacy content is not copied back into the canonical model as a second write direction.

## 7. Idempotency
Repeated reconciliation is safe. It must not duplicate relations, duplicate migration rows, mutate legacy values, or change canonical meaning.
Migration is restartable after failure.

## 8. Verification gate
A Product may become verified only when it has a valid Brand-scoped canonical composition:
- exactly one Master Category;
- Flavor cardinality 0..1;
- Complement cardinality 0..N with deterministic order;
- Level cardinality 0..1;
- all references belong to the same Brand;
- inactive existing relations may remain but inactive values are never treated as new selections.

Products with unresolved semantic ambiguity remain needs_review until explicitly resolved by an Owner.

## 9. Contract gate
Legacy physical fields/endpoints MUST NOT be removed when migration starts.
Removal is a separate acceptance phase after migration, verification, consumer audit, and production validation.

## 10. Runtime safety
The migration engine is explicit. It does not run automatically during ordinary production startup and it does not seed demo data.
Operator entry point:
~~~
node tools/migrate-master-menu.js --brand <brand-id>
node tools/migrate-master-menu.js --brand <brand-id> --verify
~~~

## 11. Relationship to existing Menu contract
This decision only defines the migration lifecycle. It does not change the ownership/cardinality rules in the locked Master Menu Composition & Branch Adoption contract.
The existing legacy quarantine remains authoritative for the legacy boundary.

LOCKED: temporary legacy + canonical coexistence; canonical Master Menu Composition is authoritative; migration is explicit, conservative, idempotent, auditable; legacy contract/removal is a separate final phase.