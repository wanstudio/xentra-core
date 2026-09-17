# Workforce Invitation Email — Client-First Branding v1

**Status:** LOCKED — PRODUCT / EMAIL UX DECISION  
**Decision date:** 2026-09-17

## Core principle

Workforce invitation is sent **on behalf of the client/brand**, not as if Xentra itself is the business inviting the recipient.

The client/Owner is the principal who invites the prospective workforce member. Xentra Cloud is only the SaaS/provider infrastructure.

## Canonical message positioning

The invitation should communicate:

> **[Client / Brand] mengundang Anda**

not:

> Xentra mengundang Anda

Xentra branding should be subtle provider attribution, not the primary inviter identity.

## Email visual hierarchy

- **Header:** Client/Brand identity.
- **Hero:** Clear invitation from the client/brand.
- **Inviter:** Authorized client actor who sent the invitation, when safely available.
- **Workspace:** Brand/workspace name.
- **Role:** Human-readable workforce role.
- **Branch:** Branch name when invitation is branch-scoped.
- **CTA:** `Terima Undangan` using the existing secure invitation URL.
- **Expiry/security note:** Use the canonical invitation TTL/state; do not invent a different value.
- **Fallback URL:** Preserve the existing invitation URL fallback.
- **Footer:** `Provided by Xentra Cloud` with optional subtle Xentra mark/logo.

## Example copy

**Subject:** `Anda diundang bergabung dengan Bangjo Resto`

**Hero:** `Anda Diundang`

**Body:** `Ikhwan Sujatmiko mengundang Anda untuk bergabung sebagai Branch Manager dan membantu mengelola operasional Bangjo Pringsewu.`

**CTA:** `Terima Undangan`

**Footer:** `Provided by Xentra Cloud` / `Restaurant Operating Engine`

## Branding rule

Do not present Xentra as the owner of the merchant business.

Do not use wording such as:

- `Xentra mengundang Anda`
- `Anda diundang oleh Xentra`
- `Undangan Bergabung ke Xentra Cloud`

The recipient is joining the **client's business/workspace**, while Xentra is the underlying platform.

## Technical boundary

This decision affects the presentation/content of the `TEAM_INVITATION` email only.

It does **not** change:

- invitation authorization
- invitation token lifecycle
- recipient matching
- workforce role/scope enforcement
- Google authentication
- Resend provider configuration
- Xentra email abstraction

Canonical implementation target when this decision is implemented: `core/identity/ResendEmailAdapter.js`, using only safe server-side invitation/inviter/brand/branch display data already available through the existing contract.

## Implementation status

**LOCKED FOR LATER IMPLEMENTATION.**

Do not implement this decision as part of the current work unless explicitly requested. Keep the existing invitation functionality unchanged until the dedicated email redesign task is started.
