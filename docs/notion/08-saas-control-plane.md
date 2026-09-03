<!-- SNAPSHOT FROM NOTION — source page: 08-saas-control-plane; fetched 2026-09-04 -->

## Status
**Proposed architectural direction — to be validated/locked**
## Purpose
Mencatat pembahasan tentang pemisahan **Xentra Company / internal workforce** dari **Client / tenant environment** pada Xentra-Core, agar dashboard, identity, RBAC, authorization, tenant isolation, support/troubleshooting, dan audit dibangun dari boundary yang benar.
## Core Context
Xentra adalah SaaS provider yang memiliki karyawan internal untuk platform operations, support, troubleshooting, QA, security, finance, engineering, dan fungsi lain. Karena itu sejak awal harus dibedakan:
1. **Xentra Company / Workforce** — internal users yang bekerja untuk Xentra.
2. **Client / Tenant** — customer organization yang menggunakan Xentra untuk menjalankan bisnis.
3. **Technical environments** — production, staging, development; ini dimensi teknis dan bukan business boundary.
Istilah “environment” tidak boleh dipakai secara ambigu.
## Proposed System Model
```javascript
XENTRA SYSTEM
│
├── XENTRA CONTROL PLANE
│   └── Xentra Company / Workforce
│       ├── Platform Owner
│       ├── Platform Admin
│       ├── Support
│       ├── Operations
│       ├── Finance
│       ├── QA
│       ├── Security
│       └── Engineering
│
└── CLIENT / TENANT WORKSPACES
    └── Organization
        ├── Brand
        │   └── Branch
        └── Users / Roles
```
## Key Principle
**Xentra Company dan Client adalah dua security/business boundaries yang berbeda.**
Xentra employee tidak otomatis menjadi user/admin di dalam client. Jika employee perlu membantu client, akses harus diberikan melalui **controlled support/access context** yang eksplisit, scoped, dan auditable.
## Control Plane vs Client Workspace
### Xentra Control Plane
- tenant/client lifecycle
- support dan troubleshooting
- platform operations
- system health
- integration monitoring
- security
- audit
- platform configuration
- feature control
- workforce/RBAC
- billing/platform operations
### Client Workspace
- organization
- brand
- branch
- products/catalog
- orders
- inventory
- staff
- reports
- business settings
- operational workflows
Client dashboard bukan versi kecil dari Xentra admin dashboard; keduanya memiliki tujuan operasional berbeda.
## Workforce Access to Client
**Jangan:** Xentra Support → login/impersonate sebagai Client.
**Model yang diusulkan:**
Xentra Employee → Support Access → Client → Brand/Branch scope → allowed actions
Contoh:
- Support dapat melihat order, logs, integration status.
- Support dapat melakukan troubleshooting action yang memang diizinkan, misalnya retry event/webhook.
- Support tidak otomatis boleh mengubah pricing, RBAC, financial settings, atau business ownership.
## Access Context
Authorization harus mempertimbangkan:
**Identity + Role + Tenant/Context + Scope + Resource + Action**
Contoh:
```javascript
Actor: Xentra Employee
Role: Support
Boundary: Xentra Company
Access Context: Client/Bangjo/Branch/Kemang
Action: RETRY_WEBHOOK
Reason: Troubleshooting ticket
```
**Context switcher hanya mengubah konteks data yang sedang dilihat; tidak mengubah authorization.** Authorization tetap ditegakkan server-side.
## Audit Requirement
Cross-boundary access harus dapat ditelusuri berdasarkan:
- actor sebenarnya
- actor type
- role
- client/tenant
- scope
- support session/access context
- reason/ticket jika diwajibkan
- action
- timestamp
- result
Jangan mencatat cross-tenant operation seolah-olah employee telah menjadi client user.
## Dashboard Design Rule
Urutan desain harus:
1. Boundary / Control Plane
2. Actor Type
3. Role
4. Scope
5. Permission
6. Dashboard
7. Menu
8. Action
Bukan mendesain menu terlebih dahulu lalu memaksa security model mengikuti UI.
### Internal Xentra Dashboard — high level
- Overview
- Clients / Organizations
- Support
- Incidents
- System Health
- Integrations
- Security
- Audit
- Operations
- Billing
- Workforce / Users
- RBAC
- Platform Configuration
### Client Dashboard — high level
- Dashboard
- Orders
- Products / Catalog
- Inventory
- Branches
- Customers
- Staff
- Reports
- Business Settings
Detail menu belum dikunci.
## Security / Isolation Principles
- Internal Xentra identity bukan client identity.
- Cross-tenant access harus explicit.
- UI hiding bukan security boundary.
- Authorization wajib ditegakkan server/domain/API.
- Support access harus scoped dan dapat diaudit.
- Impersonation bukan shortcut default troubleshooting.
- Resource access harus divalidasi terhadap tenant/context/scope yang benar.
- Audit harus mencatat boundary crossing secara eksplisit.
## Industry Guidance — Supporting Context
Pola ini didukung oleh dokumentasi enterprise SaaS dari AWS, Microsoft Azure/Entra, dan Atlassian mengenai tenant isolation, SaaS identity/access, internal vs production SaaS, resource/identity isolation, dan hierarchical admin roles.
Referensi eksternal hanya supporting context. **Locked Xentra contracts dan architecture decisions tetap menjadi source of truth.**
## Relationship to Existing Xentra Decisions
Selaras dengan:
- RBAC terpusat di Xentra-Core.
- Organization → Brand → Branch sebagai business hierarchy.
- Core kecil dan stabil.
- Audit & Activity sebagai foundation lintas domain.
- Configuration & Feature Control sebagai capability Core.
- Integration sebagai boundary tersendiri.
- Xentra-Core MVP adalah implementasi baru; Xentra MVP WordPress adalah legacy/reference.
## Open Decisions
Belum dikunci:
- nama resmi entity untuk Xentra internal boundary
- apakah “Control Plane” menjadi istilah resmi dalam code/domain
- daftar final Xentra employee roles
- permission matrix employee
- final support session model
- apakah support access membutuhkan ticket/reason
- durasi maksimum support access
- approval untuk privileged support access
- emergency/break-glass access
- authentication boundary internal workforce
- technical environment separation
- final client role hierarchy
## Next Development Discussion
Sebelum mendesain dashboard role secara detail, tetapkan:
1. Xentra Company role taxonomy.
2. Client role taxonomy.
3. Actor type dan identity model.
4. Scope model.
5. Support access model.
6. Privileged/emergency access.
7. Permission matrix.
8. Baru sitemap dan UI/UX setiap dashboard.
## Memory / Development Rule
> **Xentra Company dan Client/Tenant harus diperlakukan sebagai boundary berbeda sejak desain awal. Xentra employees memiliki internal control-plane identity. Akses employee ke client untuk support/troubleshooting harus explicit, scoped, dan auditable; employee tidak otomatis berubah menjadi client user. Dashboard mengikuti boundary → actor → role → scope → permission → UI.**
## Changelog
**2026-09-01** — Initial capture from development discussion and enterprise SaaS architecture research.
