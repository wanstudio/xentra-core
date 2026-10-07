# Xentra — Managerial Application Role-Driven Surface Architecture v1

**Status:** 🔒 LOCKED / ACTIVE  
**Decision date:** 2026-10-07  
**Repository:** wanstudio/xentra-core  
**Applies to:** Frontend application topology, managerial UX surface boundaries, role-based navigation, RBAC-driven visibility, operational task presentation, and future staff-facing workflows.

## 1. Decision Summary

Xentra adopts **one unified Managerial Application** for Owner, Manager, and authorized operational staff roles.

Different roles do **not** automatically require different applications or PWAs.

Role-appropriate UI is resolved from:

```text
Role
  +
Permission
  +
Organization / Brand / Branch / Stock Location scope
  +
Assigned Work / Responsibility
        ↓
Role-appropriate UI
```

This decision applies to the managerial/operational side of Xentra. It does not merge the Customer PWA, POS App, or Driver App into the Managerial Application.

## 2. Why This Boundary Exists

Xentra's domain architecture is business-capability based, while applications are user-workflow surfaces.

Therefore:
- Domain count must not determine application count.
- A new business domain must not automatically create a new application.
- A new operational role must not automatically create a new PWA.
- The same domain capability may be exposed through different workflows inside the same Managerial Application.

The target is to avoid turning Xentra into a collection of separate mini-applications such as Warehouse App, Procurement App, Production App, Inventory App, and Staff App when these users can safely operate within one role-driven managerial surface.

## 3. Application Topology

The current target application/surface set is:

```text
1. Customer PWA
   → Customer discovery / purchase / order tracking

2. Managerial Application
   → Owner / Manager / authorized operational staff
   → Manage / Operate / Observe / Govern according to role and scope

3. POS App
   → Cashier / POS execution
   → Execute physical sales and transaction workflows

4. Driver App
   → Driver
   → Accept / Pickup / Delivery / Completion workflows

5. Xentra Control Plane
   → Xentra internal SaaS administration
   → Organization / tenant / platform governance
```

Kitchen remains a workflow/surface inside the Managerial Application unless a future decision explicitly justifies a dedicated Kitchen/KDS application.

## 4. Managerial Application Role Model

The Managerial Application may serve roles including, but not limited to:
- Owner;
- Manager / Branch Manager;
- Staff Gudang;
- Buyer;
- Receiver;
- Production Staff;
- other authorized operational roles introduced by explicit RBAC decisions.

Role names may evolve.

What must remain stable is the principle:

> **Role changes authority and task presentation; it does not require a new application.**

## 5. Scope Model

The Managerial Application must resolve UI and data scope from server-authoritative context.

Examples:

```text
Owner
Scope = Organization / authorized Brands / Branches

Branch Manager
Scope = Branch A

Staff Gudang
Scope = Central Warehouse

Production Staff
Scope = Central Kitchen / assigned production location

Buyer
Scope = authorized procurement network
```

The exact role-permission matrix remains a separate implementation/security contract.

Frontend hiding is not an authorization boundary. Core remains responsible for authentication, authorization, scope enforcement, and persistence.

## 6. Task-Oriented UI Principle

The Managerial Application should answer:

> **What is my job right now?**

not:

> **Which database entities exist?**

Primary UI should therefore expose role-relevant tasks.

### Staff Gudang

The user may see:

```text
Belanja Hari Ini
  - Beras Premium — 75 kg
  - Minyak Goreng — 40 L
  - Cabai — 12 kg

Penerimaan
  - PO / shipment yang harus diterima

Transfer
  - Barang yang harus dikirim
  - Barang yang harus diterima

Stock Location
  - Current stock
```

They do not need access to the full planning logic that produced the requirement unless their role/permission explicitly includes it.

### Branch Manager

May see:

```text
Pesanan
Stok Cabang
Purchase Request
Production
Meja
Delivery
Operational Exceptions
```

### Owner

May see:

```text
Cross-branch business view
Master Catalog
Supply Network
Procurement Governance
Production
Reporting
Staff governance
Settings
```

## 7. Replenishment / Shopping List Example

Xentra may calculate a replenishment requirement from dynamic planning inputs such as:

```text
Demand
+ Stock On Hand
+ Open PO
+ Stock In Transit
+ Safety Stock
+ Lead Time
+ Reorder Policy
+ Production Requirements
+ Sourcing Policy
+ Supplier Pack Size
        ↓
Replenishment Requirement
        ↓
Shopping List / Purchase Request
```

The Managerial Application then exposes only the work appropriate to the authenticated role.

Example:

```text
Xentra Planning
      ↓
Shopping List
      ↓
Staff Gudang
      ↓
Physical purchasing / receiving / transfer task
```

The Staff Gudang role is an executor of the authorized operational task, not automatically the owner of Xentra's planning algorithm.

Changing quantities, suppliers, approving procurement, or overriding planning results requires explicit permission.

## 8. Domain-to-Application Rule

A domain is not an application.

For example:

```text
Procurement
   ├── Owner workflow
   ├── Buyer workflow
   ├── Branch Manager workflow
   └── Staff Gudang workflow
```

All may be presented in the same Managerial Application with different permissions and contexts.

Likewise:

```text
Inventory
   ├── Owner visibility
   ├── Branch Manager operations
   ├── Warehouse operations
   ├── Receiving
   └── Transfer
```

The domain remains one Inventory authority.

Do not create a new application merely because another role consumes the same domain.

## 9. Shared Application, Not Shared Everything

A unified Managerial Application does **not** mean every role downloads or sees the entire product.

Use:
- role-aware navigation;
- route guards;
- permission-aware data requests;
- lazy-loaded feature modules;
- scope-aware API responses;
- progressive disclosure;
- task-specific home/work queues.

A Staff Gudang device should not have to load Owner-only governance features merely because they exist elsewhere in the same application.

The application is unified at the product/surface level; feature delivery remains selective.

## 10. RBAC Boundary

Core remains the authority for:

```text
AUTHENTICATE
AUTHORIZE
ENFORCE
PERSIST
AUDIT
```

The Managerial Application presents the workflow appropriate to the authorized context.

Frontend conditions may control presentation, but must never be the sole security control.

Server-side permission and scope checks remain mandatory.

## 11. Relation to Existing Owner and Merchant Surfaces

Previous Xentra decisions treated Owner Dashboard and Merchant App as distinct frontend surfaces.

This decision **supersedes that topology choice**.

What remains valid from the older decisions:
- Owner and Branch Manager have different authorities;
- branch scope is distinct from organization/multi-branch governance scope;
- Owner is not automatically granted daily operational workflow merely because Owner can observe it;
- Branch Manager does not become a Master Catalog authority;
- POS remains a dedicated transaction-execution surface;
- RBAC, scope, audit, and business domain authority remain server/Core controlled.

The new direction is:

```text
One Managerial Application
        ↓
Owner / Manager / Staff roles
        ↓
Role + Permission + Scope + Task
        ↓
Different UI/workflows
```

This unifies the application shell without collapsing business responsibility.

## 12. Implementation / Migration Rule

This is an architecture decision, not authorization for an immediate frontend rewrite.

Current code may continue to contain separate legacy surfaces during migration.

The migration must be incremental:
1. Define the canonical Managerial Application contract.
2. Audit current Owner and Merchant routes/components.
3. Map role/permission/scope consumers.
4. Establish compatibility entry points.
5. Consolidate shared Managerial shell/auth/session primitives.
6. Move feature workflows incrementally.
7. Preserve deep links and existing role-specific behavior.
8. Run RBAC, scope-isolation, regression, and PWA tests.
9. Retire duplicate/legacy shells only after parity is demonstrated.

Do not perform a big-bang merge merely to make the directory structure look symmetrical.

## 13. Non-Goals

This decision does not:
- merge Customer PWA with Managerial Application;
- merge POS with Managerial Application;
- merge Driver App with Managerial Application;
- create a Kitchen App now;
- change backend domain ownership;
- weaken RBAC;
- allow frontend-only authorization;
- require every staff role to access every managerial feature;
- require every role to receive every frontend bundle.

## 14. CTO Guardrail

The application boundary follows **user job and operational workflow**.

The domain boundary follows **business capability and authority**.

Therefore:

```text
ROLE ≠ APPLICATION
DOMAIN ≠ APPLICATION
SUBDOMAIN ≠ APPLICATION
```

A separate application is justified only when there is a material difference in workflow, runtime requirements, device/hardware/offline behavior, security boundary, deployment lifecycle, or user experience that cannot be responsibly handled within the existing surface.

**LOCKED — Managerial Application Role-Driven Surface Architecture v1.**