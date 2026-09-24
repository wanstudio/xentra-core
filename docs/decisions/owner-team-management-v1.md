# Xentra — Owner Team Management & Invitation Lifecycle v1

**Status: LOCKED / AUTHORITATIVE**  
**Locked date: 2026-09-25**

This contract defines the Owner Dashboard `Team` management model for Xentra-Core. It complements `workforce_memberships` and the existing transactional workforce invitation contract.

## 1. Decision

Owner `Team` is a complete workforce-management surface for the current authorized business scope.

Owner capabilities:
- View workforce members.
- Add/create members.
- Edit member profile data.
- Assign/change role.
- Assign/change authorized branch scope.
- Deactivate/reactivate members.
- Reset credentials where authorized.
- Permanently delete members subject to locked RBAC safety rules.
- Create/send invitations.
- View invitation history and delivery state.
- Resend eligible invitations.
- Cancel/revoke pending invitations.
- View team activity/history.

The UI is not the authorization source. Xentra-Core remains authoritative for identity, workforce membership, RBAC, scope, authorization, persistence, and audit.

## 2. Identity vs Membership

A person has one global Xentra workforce `User` identity.

Business access is represented by a per-business `Workforce Membership`:

`User → Workforce Membership → Role + Scope + Status`

Rules:
- Adding an existing person to another business attaches another membership; it does not create a duplicate User identity.
- Changing a role changes the target membership.
- Removing a membership does not delete the global User when other memberships remain.
- One User may have different roles/scopes in different businesses.

This contract is downstream of the locked multi-business membership architecture.

## 3. Team Information Architecture

Owner `Team` is organized as:

### Members
Current active/inactive workforce members for the authorized business.

Member detail exposes:
- Profile
- Role
- Branch scope
- Effective permission summary
- Available login methods/credentials
- Status
- Activity

### Invitations
Invitation records and their lifecycle, including pending, accepted, expired, cancelled/revoked, and delivery failures.

### Activity
Business-facing team history: actor, action, target, before/after values where applicable, and timestamp.

## 4. Member CRUD

### Create
Owner may add a member directly when the product flow supports immediate account creation, or create an invitation when the recipient must complete account setup.

### Read
Owner can list and inspect members only within the current authorized business scope.

### Update
Owner can edit profile fields and membership attributes.

Role promotion/demotion is a normal membership update. Example:

`Cashier → Branch Manager`

This does not create a new User and does not require a new invitation for an already-active member.

Scope changes are also membership updates when allowed by RBAC policy.

### Deactivate / Reactivate
Deactivation suspends workforce access for that business without destroying the global identity or unrelated business memberships.

Reactivation restores access when authorized.

### Permanent Delete
Existing locked Owner workforce authority remains binding:
- Owner may permanently delete workforce members within authorized scope.
- Owner cannot delete their own account through ordinary Team management.
- Membership deletion must not erase historical business records.
- Core must enforce deletion server-side.

## 5. Role, Scope and Permission

Team management uses:

`Membership → Role + Scope → RBAC Permission Evaluation`

Definitions:
- **Role** = workforce job/access assignment.
- **Scope** = business/branch context in which the membership can act.
- **Permission** = capability granted by Core RBAC for that role and scope.

For v1, Team UI should expose an effective permission summary for the selected role/scope.

Arbitrary per-user permission overrides are **not** introduced by this lock unless a separate RBAC decision explicitly adds them.

## 6. Invitation Lifecycle

Invitation is a first-class domain object, not merely an email timestamp.

Canonical lifecycle:

`DRAFT → SENDING → SENT → PENDING → ACCEPTED`

Failure/terminal paths may include:
- `FAILED`
- `EXPIRED`
- `CANCELLED`

Invitation history should retain:
- recipient identity/contact
- target business
- proposed role
- proposed branch scope
- inviter/actor
- created/sent timestamps
- expiration
- current status
- resend/attempt history
- delivery outcome where available

### Resend
Owner may resend an eligible invitation.

Resend must:
- create a fresh invitation attempt/token;
- supersede the previous usable token;
- retain the previous attempt as history;
- preserve business/role/scope unless explicitly edited.

A superseded token must not remain independently usable.

### Failed delivery
A delivery failure is recorded as invitation history and must remain distinguishable from an invitation that was never sent.

The UI must distinguish:
- pending recipient action
- delivery failed
- expired
- cancelled/revoked
- accepted

## 7. Activity / History

Team activity is business/audit evidence, not just UI telemetry.

Examples:
- member created
- invitation created
- invitation sent
- invitation delivery failed
- invitation resent
- invitation cancelled/revoked
- invitation accepted
- role changed
- branch scope changed
- member deactivated
- member reactivated
- member permanently deleted
- credential reset where the existing security contract audits it

Role/scope history must preserve before → after values, e.g.:

`Agus — Cashier → Branch Manager`

The audit record must make actor, target, authorized business/branch context, and timestamp reconstructable.

## 8. Security

- Team actions are authorized against the current target business membership.
- A role in Business A never implicitly authorizes Business B.
- UI visibility is never authorization.
- Invitation URLs are not sessions and do not grant the invited role by themselves.
- Invitation tokens remain server-validated and single-use under the existing invitation contract.
- Deactivation/deletion of a membership is scoped to that business.
- Historical business/audit records remain preserved.

## 9. Login Credentials

Credentials are separate from membership.

One workforce User may have multiple login methods while remaining one User identity. This includes the locked cashier PIN concept: PIN is an additional credential for the same workforce User, not a second account.

Changing a role does not require changing identity or credentials unless the existing auth/security contract explicitly requires session invalidation or re-authentication.

## 10. UI Principles

Primary Team actions:
- Add Member
- Invite Member
- Edit
- Change Role
- Change Scope
- Deactivate
- Reactivate
- Reset Credential
- Delete
- Resend Invitation
- Cancel Invitation

A role change should be represented as an understandable state transition, with the effective permission result visible before confirmation where practical.

## 11. Non-goals for v1

This lock does not introduce:
- a second workforce identity system;
- duplicate User rows per business;
- a separate KDS identity;
- a second RBAC authority inside Owner UI;
- arbitrary per-user permission matrices without a separate RBAC decision;
- silent cross-business access;
- deletion of historical business/audit records.

## 12. Implementation Binding

Future Owner Team UI/API work must treat this contract, the multi-business workforce membership contract, and the transactional invitation contract as one baseline.

If implementation conflicts with this document, stop at the affected boundary and reconcile the decision before coding.

Notion canonical lock:
https://app.notion.com/p/3e51ae1e12b1817c9371f1a10f3e0166
