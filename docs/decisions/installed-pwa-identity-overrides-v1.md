# Xentra — Installed PWA Identity Overrides v1

**Status: LOCKED / AUTHORITATIVE**
**Decision date:** 2026-09-28

## Context

Source-code audit confirms Xentra currently has three separate PWA surfaces:
- Customer PWA
- Merchant / Owner PWA
- POS PWA

Each already has its own manifest/runtime boundary. The current Brand persistence is single-logo based (`brands.logo_url` / `logo_media_id`). Customer public branding also exposes `primary_color`.

The requirement is intentionally narrow: **make installed apps easy to distinguish on the device launcher**. It is not a request to make Merchant or POS inherit the Customer PWA theme.

## Decision

Use one Xentra tenant/brand identity, with optional installed-app identity overrides:

| Surface | Installed-app identity | UI theme/color |
| --- | --- | --- |
| Customer PWA | Existing Brand Logo / Brand identity | Existing Brand `primary_color` behavior |
| Merchant / Owner PWA | Optional custom icon/logo override | Keep Merchant/Owner application theme |
| POS PWA | Optional custom icon/logo override | Keep POS application theme |

Therefore a VIP client such as Bangjo can have:

```text
Customer PWA       → Bangjo brand logo + existing customer brand color
Merchant/Owner PWA → optional Merchant launcher icon
POS PWA             → optional POS launcher icon
```

Merchant/POS icon overrides are for **launcher/app identity after installation**. They are not separate brands, tenant identities, auth systems, or theme systems.

## Fallback

```text
surface-specific PWA icon override
        ↓
tenant/brand logo
        ↓
normal application/default icon
```

The exact final fallback asset is implementation-specific.

## Settings

The existing Owner `Identitas & Profil Brand` surface remains the management location.

Existing fields remain the Brand configuration:
- Nama Brand / Restoran
- Tagline Brand
- Foto / Ikon Logo Brand
- Warna Tema Utama (Hex)

Add optional installed-app identity controls:
- Merchant / Owner PWA — app icon/logo override
- POS PWA — app icon/logo override

The UI must explain that these uploads change the **installed application icon/identity**, not the application's in-app theme.

## Customer PWA color rule

`primary_color` remains a Customer PWA branding concern as already implemented.

Do not propagate Customer PWA `primary_color` automatically into:
- Merchant / Owner UI
- POS UI
- Owner Dashboard visual theme

Merchant and POS retain their own application design system/theme.

## Source-code alignment

Current repository evidence:
- `apps/customer-pwa/assets/pwa/manifest.json` is the Customer PWA manifest.
- `apps/merchant-app/manifest.json` is the Merchant PWA manifest.
- `apps/pos-app/manifest.json` is the POS PWA manifest.
- `server/app.js` already selects manifest/service-worker surfaces by application/subdomain context.
- POS runtime already consumes `brand.logo_url` from `/brand/info` for the visible POS brand logo.
- Customer `/api/v1/brand/info` returns `logo_url` and `primary_color`.
- Current Brand persistence is centered on `logo_url` / `logo_media_id`.

Implementation should extend the existing PWA manifest/application-identity boundary rather than create a second branding architecture.

## Non-goals / prohibitions

- No separate brand entity for Merchant or POS.
- No separate tenant/account/identity system.
- No separate RBAC/auth model.
- No per-surface theme engine for Merchant/POS.
- No automatic propagation of Customer `primary_color` to Merchant/POS.
- No routing client domains through `biz.xentra.cloud` for branding.
- No client-specific hardcoded domain/logo exceptions.
- No product fork just because a tenant uses PWA icon overrides.

## Acceptance criteria

1. Customer PWA keeps current Brand Logo + `primary_color` behavior.
2. Merchant/Owner PWA can optionally use its own installed-app icon/logo.
3. POS PWA can optionally use its own installed-app icon/logo.
4. Merchant/Owner UI colors remain independent of Customer PWA `primary_color`.
5. POS UI colors remain independent of Customer PWA `primary_color`.
6. Customer, Merchant, and POS installed apps can therefore be visually distinguished on one device.
7. Missing overrides fall back cleanly.
8. Tenant resolution, auth, RBAC, domains, and deployment topology remain unchanged.
9. Shared and dedicated/VIP deployments both use the same logical tenant model.
10. No unrelated routing/UI/theme refactor is introduced.

## Related architecture decision

`docs/decisions/tenant-aware-branding-white-label-contract-v1.md` remains the broader platform/tenant branding contract.

This document is the specific binding for **installed PWA identity overrides** and clarifies that PWA icon identity is separate from Customer PWA color/theme behavior.

**Final rule:** Xentra has one tenant/brand identity. Customer PWA retains the existing brand logo/color behavior. Merchant/Owner PWA and POS PWA may optionally define their own installed-app icon/logo solely to distinguish the installed applications. Merchant/POS UI themes remain application-specific.