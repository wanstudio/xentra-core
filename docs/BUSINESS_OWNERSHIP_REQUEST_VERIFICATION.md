# 🔒 LOCKED — Business Ownership Request & Verification

**Decision Date:** 2026-09-14

## Decision

The existing Business Claim path must **not grant Owner authority immediately**.

The concept of claiming/adopting an existing tenant remains necessary for the first legitimate owner when a business already exists in Xentra, but it is converted into a controlled **Request Ownership** workflow.

The existing-tenant merge principle remains: when a business/domain already exists, do not create a duplicate tenant. Preserve the existing tenant and its data; attach an authorized owner identity only after ownership verification succeeds.

## Canonical Flow

```text
xentra.cloud
    |
    | Register / Login
    v
Existing Business Lookup
    |
    | Business exists
    v
Request Ownership
    |
    v
Ownership Request = PENDING
    |
    v
Notify existing business owner/contact by email
    |
    +---- APPROVE ----> Re-authenticate / Confirm ----> OWNER GRANTED
    |
    +---- REJECT -----> Request cancelled / security event recorded
    |
    +---- NO RESPONSE -> Request expires
```

## Locked Security Rules

- **No instant claim-to-owner.** Discovering a matching business/domain or completing the requester's own Xentra account verification must never by itself grant Owner authority.
- **Request Ownership** is the canonical UX/domain concept for an existing tenant ownership request. Avoid wording that implies ownership has already transferred.
- The existing owner/contact receives a security notification containing the business identity/domain and clear actions to approve or reject the request.
- Approval of the high-privilege ownership change requires **re-authentication / step-up confirmation** before the ownership transition is committed.
- Rejection cancels the request and records an auditable security event.
- No response must **not** automatically transfer ownership. The request expires after a defined period; the exact TTL is an implementation/configuration decision to be locked separately.
- Repeated unauthorized requests may be rate-limited or escalated to security/manual review.

## Recovery — Existing Owner Is Inaccessible

If a legitimate requester cannot access the existing owner/contact channel, Xentra provides an explicit **Verify Business Ownership** escalation path instead of bypassing verification.

Potential evidence may include:

- control of the business domain / website;
- business email/domain evidence;
- official business records or documents;
- other evidence appropriate to the risk level.

Domain control is evidence of technical control, **not automatically proof of legal business ownership**. Xentra may require additional business evidence or manual review for high-risk cases.

## Ownership State Boundary

```text
Account verified
      ≠
Business ownership verified
      ≠
Owner authority granted
```

These are separate security states.

## Email Notification Principle

The notification should say that **someone requested ownership/access to the business**, not that the business has already been claimed.

Example intent:

> Someone is requesting ownership of your business.
> Business: <business name>
> Domain: <client domain>
> If this was you or someone from your team, confirm the request. If you do not recognize it, ignore/reject it.

The exact email copy, provider/template, token mechanics, expiry TTL, and delivery implementation are not locked by this decision.

## Implementation Boundary

This is an architecture/security decision, not an instruction to blindly rewrite the current implementation.

Before implementation, inspect the current ownership-claim endpoint, existing tenant merge behavior, tests, auth/session model, tenant lifecycle, email infrastructure, audit/security-event model, and related Notion/Git contracts.

Implementation must preserve unrelated behavior and add tests for every ownership state transition and negative path, including:

- pending request;
- approval;
- approval with failed/expired authentication;
- rejection;
- expiry/no response;
- duplicate/concurrent ownership requests;
- unauthorized requester;
- inaccessible existing owner escalation;
- successful Owner activation;
- preservation of the existing tenant and its data.

## Relationship to Previous Claim Decision

This decision **supersedes the previous "claim existing tenant and immediately assign the new owner" behavior**.

The existing-tenant merge/adoption principle remains valid. Only the authorization mechanism changes: **claim is no longer an instant privilege grant; it becomes a verified ownership request.**
