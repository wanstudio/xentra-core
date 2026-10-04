# Xentra — Catalog Information Architecture Contract v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision date:** 2026-10-05  
**Branch:** `proposal/xentra-taxonomy-composed-menu-v1`

## Canonical Catalog structure

```text
Catalog
├── Master Menu
└── Master Category
    ├── Category
    ├── Judul
    ├── Rasa
    └── Item
```

## Rules

1. Catalog has exactly two top-level areas for this contract: **Master Menu** and **Master Category**.
2. Master Category contains four independent master vocabularies: **Category, Judul, Rasa, Item**.
3. Category, Judul, Rasa, and Item are not a parent-child hierarchy with one another.
4. Master Menu is a separate top-level Catalog area. It is not a child of Master Category and it is not **Menu Cabang**.
5. **Judul is canonical Master Category data** and must not be removed from the Master Category UI/domain vocabulary.
6. Do not introduce **Produk Master**, **Menu Cabang**, or any additional Catalog navigation node as a substitute/synonym for the locked structure.
7. Owner Catalog UI, routes, labels, navigation, AI-worker prompts, and related implementation must follow this structure unless a later explicit decision supersedes it.

## UI impact

The Catalog navigation must expose:

```text
Catalog
├── Master Menu
└── Master Category
```

Inside Master Category, the four management areas are:

```text
Category | Judul | Rasa | Item
```

The existence of legacy tables, endpoints, or historical terminology does not change this forward UI/IA contract.

## Relationship to Menu

Master Menu is where the commercial **Menu** entity is authored/configured.

Master Category provides reusable master vocabularies consumed by Menu authoring:
- Category
- Judul
- Rasa
- Item

Item is an internal composition/stock concept and must not be exposed as a Customer PWA commercial identity.

## Governance

This file is the Git-side evidence for the 2026-10-05 Catalog IA lock. It complements the broader Menu domain contract in `docs/proposals/xentra-menu-domain-v2.md`.

**main must remain unchanged until the proposal branch passes its final verification gate.**