# Xentra — Internal Client Communication & Notification Domain v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision date:** 2026-09-17  
**Scope:** Client Organization / Brand / Branch internal communication and in-app notifications

## 1. Decision

Xentra treats **Internal Client Communication & Notifications** as a distinct domain. The dashboard Notification Bell is a consumer of this domain, not a decorative/global UI component and not an ad-hoc message area owned by each dashboard.

The domain governs who may create an internal announcement, who may receive it, how recipients are resolved from authorized scope, and how each recipient's read state is maintained.

## 2. Core principle

**Notification audience is determined by explicit target scope + current authorization, not by UI visibility or a role string alone.**

Core resolves recipients from the sender's current `User → Role → Permission → Scope` and the requested audience. A client-supplied recipient ID, Branch ID, Brand ID, Organization ID, or audience label never grants delivery authority.

## 3. Canonical audience targets

Supported targeting levels:

- **Individual User** — one authorized user.
- **Role within Scope** — users with a specified role within an authorized Branch/Brand/Organization scope.
- **Branch** — all eligible client users in one Branch.
- **Brand** — all eligible client users across one Brand's authorized Branches.
- **Organization / Whole Client** — all eligible client users in the authorized client Organization.

Multiple targets may be selected only when the sender is authorized over every selected target.

## 4. Canonical examples

```text
Owner → Branch A
       ↓
eligible recipients in Branch A only

Owner → Brand Bangjo
       ↓
eligible recipients across Bangjo branches

Owner → whole client Organization
       ↓
eligible client users across authorized scope

Branch Manager (Branch A) → Branch A staff
       ↓
Branch A only
       ✕ Branch B
       ✕ another Brand
```

A Branch-targeted announcement must never leak into another Branch merely because both Branches belong to the same Brand.

## 5. Role-aware Notification Bell

The same notification domain is consumed differently by each portal:

| Portal | Notification visibility |
|---|---|
| **Owner Portal** | Notifications within authorized Organization/Brand scope, including branch-targeted and wider client announcements the Owner is allowed to see |
| **Brand Portal** | Notifications within authorized Brand scope |
| **Branch Portal** | Notifications relevant to the assigned Branch only |
| **Cashier / operational portal** | Notifications relevant to the actor's authorized operational scope and permissions |

The Bell must show the current actor's own unread state and must not become an aggregate inbox containing notifications outside the actor's authorized scope.

## 6. Notification sources

Keep these semantically separate:

1. **System / Operational Notification** — generated from business/domain events such as order attention, stock thresholds, branch-state changes, workforce changes, or other approved events.
2. **Direct Internal Announcement** — authored by an authorized client actor and intentionally targeted to an audience.
3. **Action Required** — notification tied to an actionable workflow.
4. **Informational** — communication that does not require a response.

Automated events and authored announcements may share infrastructure but must retain distinct source/type semantics.

## 7. Notification record model

Conceptually, a notification preserves:

```text
notification_id
source_type
source_actor_id (nullable for system events)
title
body
notification_type / priority
related_entity_type / related_entity_id (nullable)
target_scope
created_at
```

Recipient state is separate and conceptually preserves:

```text
notification_id
recipient_user_id
recipient_resolution_context
read_at / unread
created_at
```

Notification content is immutable after creation unless a future explicit amendment contract is introduced. Read/unread and delivery metadata are mutable recipient/transport state.

## 8. Authorization / recipient resolution

Every authored notification follows:

```text
Authenticated identity
→ current role / permission
→ current Organization / Brand / Branch scope
→ requested audience
→ audience authorization
→ recipient resolution
→ create notification + recipient records
→ audit where required
```

The UI may hide invalid targets for usability, but Core performs the final authorization and recipient resolution server-side.

## 9. Portal targeting behavior

### Owner
Owner may send to a specific Branch, Brand, or the whole authorized client Organization when the corresponding permission/scope permits it.

### Brand Manager
Brand Manager may target only audiences within the authorized Brand scope, subject to permission. Cross-Brand targeting is prohibited.

### Branch Manager
Branch Manager may target only audiences inside the assigned Branch scope, subject to permission. Branch Manager cannot send to another Branch, another Brand, or the whole client unless an explicit future authority contract changes this boundary.

### Cashier / operational roles
Operational roles may receive relevant notifications. Any ability to author or broadcast announcements must be explicitly permissioned; visibility of the Bell does not imply authoring authority.

## 10. In-app Bell UX contract

The top-right Bell should provide:

- unread count for the authenticated user;
- recent relevant notifications;
- read/unread state per user;
- clear type/priority distinction when useful;
- link to a Notification Center for full history and filtering;
- direct navigation to the related business surface when the notification contains an approved action/context.

The unread count is not a branch/brand/global aggregate unless the business contract explicitly defines such an aggregate separately.

## 11. Delivery channel boundary

**In-app notification** is one delivery channel, not the domain itself.

The same recipient authorization and audience resolution may later feed email or push delivery, but channel delivery must not redefine who is authorized to receive the communication.

Platform/internal Xentra communication is a separate scope from client internal communication.

## 12. Relationship to RBAC

Notification is **not a second permission system**. It consumes the existing `User → Role → Permission → Scope` authority model.

A notification target must be validated against the sender's current authority, and a recipient must be resolved from the target scope instead of accepting arbitrary client-provided recipient IDs.

## 13. Auditability

Where required by the security/audit contract, record:

- sender;
- target audience/scope;
- notification type/source;
- creation time;
- recipient resolution outcome;
- relevant business context;
- delivery failure evidence where applicable.

Do not store secrets, passwords, access tokens, or other sensitive credentials in notification content or metadata.

## 14. Non-goals

v1 does not define:

- a full chat/messaging platform;
- customer-facing notification subscriptions;
- marketing-campaign messaging;
- platform-wide Xentra employee communication;
- notification targeting that bypasses RBAC;
- arbitrary user-to-user messaging merely because both users are in the same client.

## 15. UI context binding

The portal chrome must reflect this domain boundary:

```text
Owner Portal
  → Organization / Brand / Branch-aware notifications

Brand Portal
  → Brand-scope notifications

Branch Portal
  → Branch-scope notifications

Cashier Portal
  → Operational notifications relevant to the current scope
```

The Bell therefore belongs to the portal's communication layer and must be role/scope-aware even when the visual component is shared.

## 16. Implementation rule

Before implementing or expanding Notification Bell, Notification Center, announcement composer, notification APIs, recipient resolution, or notification delivery:

1. consult this contract;
2. consult the current RBAC and scope contract;
3. reuse existing event infrastructure where suitable;
4. keep recipient authorization in Core/domain logic;
5. do not derive recipients solely from frontend role labels or selected branch IDs;
6. add cross-scope denial tests and recipient isolation tests;
7. preserve per-user unread/read semantics;
8. keep channel transport separate from audience/authorization logic.

## 17. Required minimum tests

- Owner can send to an authorized Branch and only eligible users in that Branch receive it.
- Owner can send a whole-client announcement when authorized and all eligible client users receive it.
- Brand Manager cannot target another Brand.
- Branch Manager cannot target another Branch.
- Client-provided recipient lists cannot bypass audience authorization.
- User A cannot read User B's notification inbox.
- Unread count is isolated per authenticated user.
- Notification records preserve source/target context.
- Read state persists correctly.
- Existing RBAC and tenant isolation remain green.

## 18. Status

**LOCKED — implementation contract v1.**

Any change to target levels, role authority, recipient rules, notification semantics, or platform-vs-client communication boundaries requires a new explicit decision and reconciliation of affected Notion/Git contracts.
