# Xentra — Canonical Architecture & Product Library v2

**Status:** LOCKED — CANONICAL ARCHITECTURE & PRODUCT LIBRARY v2  
**Decision date:** 2026-09-17

## Purpose

This document is the canonical operating map for Xentra terminology, architecture layers, scope, domain ownership, authority, UI surfaces, lifecycle boundaries, data authority, API mutation boundaries, and AI-worker behavior.

It supersedes the narrower terminology role of the former Library v1. The v1 document remains historical/legacy terminology reference; new work must use this v2 map.

> **Core rule:** visibility, ownership, mutation authority, operational authority, and Core enforcement are different concepts. An entity appearing in a surface does not grant that surface mutation authority.

## 1. Source-of-truth hierarchy

```text
LOCKED BUSINESS DECISION
        ↓
CANONICAL LIBRARY v2
        ↓
DOMAIN / FEATURE CONTRACT
        ↓
API / DATA CONTRACT
        ↓
IMPLEMENTATION
        ↓
UI / PRESENTATION
```

Locked business decisions win conflicts. Library v2 maps and normalizes those decisions; it does not invent business rules. Git is implementation evidence and does not automatically redefine canonical terminology.

## 2. Architecture layers

| Layer | Primary responsibility | Must not become |
|---|---|---|
| Platform / Control Plane | Xentra platform governance and provisioning | merchant daily operations |
| Xentra-Core | identity, authentication, authorization, scope, persistence enforcement, audit foundation, shared integrity | business UI/domain workflow owner |
| Owner Dashboard | configure, govern, observe | branch daily operations queue |
| Branch Manager Operational Center | operate and observe one Branch, including approved branch-local menu configuration | brand-wide governance |
| Customer PWA | discover, purchase, track | business configuration |
| POS | in-store transaction execution | master business governance |
| KDS | kitchen preparation execution | business configuration |
| Catalog | master product and selling-catalog concepts | daily stock mutation |
| Commerce | Cart, Checkout, Order | POS Sale lifecycle |
| Inventory | stock and inventory movement | product identity governance |
| Payment | payment lifecycle and settlement | order acceptance |
| Delivery | delivery calculation/fulfillment | order ownership |
| Reporting | authoritative read models/analytics | source-of-truth mutation |
| Integration | external provider/hardware adapters | business policy ownership |

Physical deployment/database separation is not implied by this map unless separately locked.

## 3. Scope registry

```text
Platform
└── Organization
    └── Brand
        └── Branch
            ├── Terminal
            │   └── Shift
            └── branch-scoped operational context
```

`User` is the canonical identity. `Workforce` is an actor/context classification. Authority is determined by current Role + Permission + Scope. A client-supplied `branch_id` is context/input only and is never sufficient authorization.

## 4. Domain registry

| Domain | Owns / governs |
|---|---|
| Core | Identity, RBAC, Organization, Brand, Branch, scope, shared integrity |
| Catalog | Master Product and catalog/selling-catalog concepts |
| Commerce | Cart, Checkout, Order |
| POS | Terminal, Shift, Sale, Sale Item and POS operational flow |
| Inventory | stock and inventory movement/state |
| Payment | payment processing and settlement |
| Delivery | delivery calculation and fulfillment |
| Reporting | reporting read models and analytics |
| Integration | external services and hardware adapters |

Cross-domain orchestration does not transfer ownership.

## 5. Canonical entity registry

### Core

- **Organization** — top-level merchant ownership scope.
- **Brand** — brand identity/master business scope under Organization.
- **Branch** — physical/operational location under Brand.
- **User** — canonical identity.
- **Workforce** — actor/context classification, not an identity entity.

### Catalog

- **Master Product** — Brand-owned master product identity/content/defaults.
- **Master Category** — Brand-owned master catalog grouping.
- **Branch Product** — Branch selling assignment/configuration/state.
- **Branch Category** — independently branch-controlled category.
- **Branch Menu** — branch selling-menu configuration with Owner/Brand governance and Branch Manager local assortment/category operation.
- **Branch Product Availability** — daily branch operational state.

**Catalog invariant:** Master Product, Branch Product, Branch Menu, Availability, and Stock are distinct concepts. Master Product defaults may resolve into Branch values through explicit supported overrides. Branch operational availability must not silently mutate Master Product `is_active`.

### Commerce

- **Cart** — customer transaction that may contain multiple Branch groups.
- **Checkout** — single-Branch transaction scope.
- **Order** — single-fulfillment-Branch Commerce transaction.

Canonical boundary: **Multi-Branch Cart → Single-Branch Checkout → Single-Branch Order**. Order is not POS Sale.

### POS

Canonical vocabulary: **Terminal → Shift → Sale → Sale Item → Payment → Settlement → Receipt**, with **Cash Drawer, Cash Movement, Void, Refund, KDS** as supporting concepts. POS-specific terms explicitly marked deferred elsewhere remain deferred; this library does not silently promote them.

## 6. Configuration registry

Canonical configuration vocabulary:

- **Branch Configuration**
- **Branch Delivery Configuration**
- **Branch Pickup Configuration**
- **Branch Dine-In Configuration**
- **Operating Schedule Configuration**
- **Branch Menu Configuration**

Configuration is not a catch-all for operational state or domain workflow.

Source boundary:

```text
Dashboard / business configuration → operational value
Environment / secret store       → infrastructure secret
Code                             → invariant technical constant
```

Legacy `branch_settings` / `branch_delivery_settings` names are migration aliases, not new canonical concepts.

## 7. Policy vs configuration vs state

- **Policy** = what is allowed/required.
- **Configuration** = durable values supplied within policy boundaries.
- **Operational State** = current runtime/business condition.
- **Capability / Feature Control** = whether a capability is available; it does not execute business workflow.
- **Secret** = protected infrastructure credential; never business input.
- **Technical constant** = invariant in code.

Do not place business logic into generic configuration.

## 8. Operational state registry

### Branch
`OPEN`, `PAUSED`, `CLOSED`, `SCHEDULED_CLOSED`, `EMERGENCY_CLOSED`.

`PAUSED` means online ordering is paused/throttled while the branch may remain operational; it is not equivalent to `CLOSED`.

### Table
`AVAILABLE`, `RESERVED`, `OCCUPIED`, `BLOCKED`, `OUT_OF_SERVICE`.

### Product
Branch availability/sold-out is separate from Master Product active state and from stock quantity.

### Transaction
Order, Payment, Settlement, Sale, and Shift have separate lifecycles.

UI timers and disabled controls are never authoritative state.

## 9. Authority vocabulary

Business responsibility vocabulary:

`VIEW`, `OBSERVE`, `CONFIGURE`, `GOVERN`, `CREATE`, `EDIT`, `DELETE`, `ACTIVATE`, `DEACTIVATE`, `OPERATE`, `EXECUTE`, `APPROVE`, `ASSIGN`, `OVERRIDE`, `SETTLE`, `AUDIT`.

Canonical responsibility model:

```text
Owner          = CONFIGURE + GOVERN + OBSERVE
Branch Manager = OPERATE + OBSERVE + branch-local Menu Configuration
Xentra-Core    = AUTHENTICATE + AUTHORIZE + ENFORCE + PERSIST + AUDIT
Customer       = CONSUME
POS / KDS      = EXECUTE
```

These are business responsibility categories, not one-to-one technical permission names.

## 10. Role authority

| Role | Default scope | Workforce authority |
|---|---|---|
| Owner | authorized Organization/Brand | permitted subordinate workforce management |
| Brand Manager | delegated Brand | delegated according to RBAC |
| Branch Manager | one Branch | branch-scoped operational staff and approved branch-local menu configuration where permitted |
| Cashier | Branch/Terminal/Shift | no workforce management |
| Customer | customer context | no merchant administration |

No actor may grant itself or another identity authority exceeding its current role/scope. Core evaluates current identity, role, permission, scope, target, and action server-side.

## 11. Surface registry

### Owner Dashboard
**Purpose:** Business Control Center.  
**Mode:** Configure + Govern + Observe.

Canonical areas: Overview, Orders, Catalog (Products/Categories/Menus), Branches, Customers, Marketing, Reports, Branch Health, Finance, Team, Settings.

`Branches` is Branch Management / Configuration & Performance, not a duplicate Branch Operations dashboard.

### Branch Manager Operational Center
**Purpose:** Daily Branch Operations + branch-local Menu Configuration.  
**Mode:** Operate + Observe.

Canonical areas: Hari Ini, Pesanan, Meja, Menu, Promo activation, Stok, Staff, Reports, Jam Operasional.

### Customer PWA
Discover → Purchase → Track.

### POS
Terminal → Shift → Sale → Payment → Settlement → Receipt and related in-store execution.

### KDS
Kitchen preparation execution.

## 12. Feature responsibility matrix

| Function | Owner | Branch Manager | POS/KDS | Customer |
|---|---|---|---|---|
| Master Products | Configure/Govern | Observe + adopt approved products | Consume | Consume |
| Master Categories | Configure | Observe | Consume | Consume |
| Branch Menu Configuration | Configure/Govern | **Operate own Branch assortment + Branch Categories** | Consume | Consume |
| Branch Product Availability | Observe | Operate | Consume | Consume |
| Stock | Observe | Operate | Consume | — |
| Branch Status | Observe / exceptional override | Operate | Consume | Consume |
| Operating Schedule | Configure default | Operate daily exception | Consume | Consume |
| Online Order Pause | Observe / explicit exception | Operate | Consume | Consume |
| Tables / Floor Plan | Configure geometry | Operate status | Execute | Consume |
| Promotions | Configure/Govern | Operate approved branch promo | Consume | Consume |
| Orders | Observe/Investigate | Operate + Branch Acceptance | Execute where applicable | Consume/Track |
| Team | Govern/manage | Branch-scoped staff | — | — |
| Reports | Strategic/cross-branch | Daily branch | Shift/operational | — |

## 13. Critical cross-surface boundaries

### Catalog
Owner manages Master Products, Master Categories, Bundle/Composite composition, and brand-wide catalog policy. Branch Manager may adopt/select approved Master Products for the current Branch, manage Branch Categories and Branch Product ↔ Branch Category membership, and operate Branch Product availability. Branch Manager adoption/category authority is branch-scoped and does not grant Master Catalog authority. Sold-out must not mutate Master Product active state.

### Operating hours
Owner defines default/permanent schedule. Branch Manager applies daily/special exceptions within allowed boundaries. Core resolves effective state.

### Tables
Owner/Admin configures physical floor-plan geometry. Branch Manager operates daily table state. Core validates availability and concurrency.

### Promotions
Owner/Brand defines campaign policy. Branch Manager operates only approved branch-scoped promotions.

### Orders
Owner Orders is cross-branch observation/investigation. Branch Manager Orders is operational queue. Branch Acceptance is a dedicated mutation boundary. Payment settlement must not silently become acceptance.

### Workforce
Owner is the highest client workforce authority within authorized scope. Branch Manager is branch-scoped. Core owns authorization enforcement.

## 14. Data authority rules

1. Every mutable concept has one authoritative owner for each mutation class.
2. Read models may aggregate but do not become a second source of truth.
3. Historical transaction snapshots remain immutable where required.
4. Branch state is not inferred from Master data when Branch-specific state exists.
5. Missing authoritative evidence fails safely; arbitrary availability/permission/financial fallbacks are forbidden.
6. Restart/bootstrap must not overwrite persisted business state merely to restore demo defaults.

## 15. API / mutation boundary

Every protected mutation follows:

```text
Authenticate
→ current identity
→ current role/permission
→ current scope
→ target
→ actor-target relationship
→ requested authority
→ business invariants
→ atomic mutation
→ security side effects when required
→ audit
→ authoritative response
```

Dedicated business mutations must not be hidden inside generic status endpoints when authorization semantics differ. Branch Acceptance is the canonical example.

## 16. Lifecycle boundary

```text
Entity lifecycle
≠ Configuration lifecycle
≠ Operational state lifecycle
≠ Transaction lifecycle
≠ Financial lifecycle
```

Do not collapse Order, Sale, Payment, Settlement, Shift, or Branch Status into one generic lifecycle.

## 17. Terminology / legacy registry

Canonical distinctions:

- `Branch Configuration` ≠ generic `Settings`.
- `User` ≠ `Workforce`.
- `Master Product` ≠ `Branch Product`.
- `Master Category` ≠ `Branch Category`.
- `Branch Menu` ≠ `Branch Product Availability`.
- `Branch Product Availability` ≠ Stock.
- `Order` ≠ `Sale`.
- `Payment` ≠ `Settlement`.
- `Void` ≠ `Refund`.
- `Branch Status` ≠ `Operating Schedule` ≠ `Online Order Availability`.

Legacy names remain searchable for migration but are never promoted to canonical merely because they exist in code.

## 18. Status vocabulary

`LOCKED`, `PROPOSED`, `DEFERRED`, `SUPERSEDED`, `LEGACY`, `IMPLEMENTED`, `VERIFIED`, `NOT VERIFIED`, `OPEN GAP`.

A passing implementation test does not change business authority. `NOT VERIFIED` is preferable to pretending a dependency exists.

## 19. AI worker protocol

Before creating or modifying an entity, route, service, repository, table, event, API field, permission, dashboard menu, or UI control:

1. Find the canonical concept.
2. Identify type and scope.
3. Identify owning domain.
4. Identify business and operational authority.
5. Identify authoritative data source.
6. Check `NOT THE SAME AS`.
7. Check surface responsibility.
8. Check status.
9. Reuse existing contract.
10. If no contract exists, report the architecture gap before inventing cross-domain/core terminology.

**Stop conditions:** duplicate entity; surface exceeds authority; payload used as authorization; legacy term promoted; configuration used as business logic; generic endpoint bypasses dedicated authorization; unresolved business rule is being guessed.

## 20. Locked Product Universe & Bundle Authority — 2026-09-15

**Status:** LOCKED / CANONICAL BUSINESS DECISION

> **Owner determines what may be sold. Branch selects and operates it correctly.**

Xentra will not turn Branch Manager into a mini product manager. Product complexity, package/bundle composition, and decisions about what constitutes an official sellable product belong to the Master Catalog under Owner/Brand authority.

### Locked rules

- **Master Catalog is the sellable product universe.** Official sellable products must originate there.
- Master Catalog may contain both **SIMPLE** and **BUNDLE/COMPOSITE** products.
- If a package such as `Ayam Geprek + Es Teh` must be sold as one menu/package, **Owner creates the Package/Bundle Product in Master Catalog**. Branch does not create its own bundle.
- For the current scope, a Bundle has its own **fixed selling price**. Do not introduce a pricing-formula or promotion engine merely to support bundles.
- Branch **adopts/selects** products from Master Catalog and operates them at branch level.
- Branch Manager may perform that adoption/selection for the Manager's own Branch.
- Branch Manager may organize adopted Branch Products into **Branch Categories**. One Branch Product may belong to multiple Branch Categories without duplicating the product.
- Category membership and bundle composition are separate relationships:
  - `Branch Product ↔ Branch Category` = **many-to-many**.
  - `Bundle Product → Component Products` = **Master Catalog composition**.
- Branch Manager controls branch operational concerns such as availability/sold-out within its authority, not Master Product identity or Bundle structure.
- If a business requirement appears to require Branch-created products or compositions, **do not invent a Branch rule**. Raise it as a new architecture/business decision for Owner/Master Catalog.

### Canonical example

```text
Master Catalog (Owner)
├── Ayam Geprek
├── Es Teh
└── Paket Hemat 1 [BUNDLE]
    ├── Ayam Geprek ×1
    └── Es Teh ×1

Branch A
├── adopt Ayam Geprek
├── adopt Es Teh
├── adopt Paket Hemat 1
└── organize adopted products into Branch Categories
    ├── Ayam → Ayam Geprek
    ├── Promo → Ayam Geprek, Paket Hemat 1
    ├── Serba 10rb → Es Teh
    └── Best Seller → Ayam Geprek, Paket Hemat 1
```

### Explicit non-goal

**No Branch Bundle Engine.** Do not introduce branch-owned bundle components, bundle pricing formulas, branch-created composite products, or duplicate Master Products merely to satisfy a Branch promotion/category.

This lock intentionally keeps Branch operations simple and pushes product/business complexity to the Owner/Master Catalog where it belongs.

## 21. Open architecture gaps

These remain explicit until separately locked: final promotion domain/model; final operating-hours persistence/effective-state contract; richer Branch operational state schema; table/reservation persistence and concurrency contract; complete POS lifecycle and Sale/Order integration; detailed Inventory topology; full Reporting read-model contract; future Owner → Branch notification/version/conflict workflow for Master changes.

## 22. Governance

Future change flow:

```text
New business decision
→ reconcile Library v2
→ reconcile affected domain contracts
→ reconcile affected Git MD
→ implementation review
→ tests/evidence
```

No implementation may silently redefine a canonical concept because the current code structure is inconvenient.
