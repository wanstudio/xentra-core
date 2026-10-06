# Xentra — Driver Workforce Identity Contract v1

**Status:** LOCKED — MVP BUSINESS / ARCHITECTURE BASELINE  
**Date:** 2026-10-06  
**Revision:** v1.1

## Purpose

This document records the identity/RBAC prerequisites for the Driver PWA implementation.

It supports the already locked Driver + COD happy path and does not expand the delivery exception contract.

## Driver role

The role name is "driver" and it is a first-class Xentra workforce role.

The Driver is a **branch-scoped operator**.

A Driver account MUST have:

- active workforce status
- a valid brand/tenant
- a specific branch_id

An unassigned Driver account is not permitted to operate through the Driver PWA.

## Permissions

The Driver role receives:

- delivery:view
- delivery:execute

The Driver does **not** receive delivery:manage.

Therefore:

- Branch Manager continues to own delivery assignment/dispatch.
- Driver owns execution of an assigned delivery.
- Driver cannot acquire merchant dispatch authority through the Driver PWA.

## Resource boundary

Driver task reads and execution actions are constrained by:

- authenticated Driver identity
- tenant/brand
- Driver branch
- assigned driver_id

A Driver must not be able to read or execute a delivery belonging to another Driver or another branch.

Delivery assignment additionally requires the selected Driver to be:

- active
- role driver
- assigned to the same branch as the order

## Provisioning boundary

For the current MVP implementation:

- Owner may create/invite Driver accounts.
- Brand Manager may create/invite Driver accounts.
- Branch Manager remains the dispatch/assignment authority and is not granted a broader workforce-provisioning ceiling by this change.

This keeps the existing Manager role ceiling intact while allowing Driver workforce accounts to exist.

## Authentication and surface

Driver uses the existing Xentra workforce authentication/session infrastructure.

The Driver PWA uses a dedicated client-side token/user storage key:

- xentra_driver_token
- xentra_driver_user

The Driver PWA is a **dedicated tenant/client domain surface**.

For Bangjo, the canonical Driver access domain is:

**https://driver.mybangjo.com/**

The Driver surface MUST be served from the dedicated Driver domain, not from the Customer PWA path `/driver/` on `app.mybangjo.com`.

The domain is a tenant/client entry point and MUST resolve tenant/brand context through the authoritative Domain Registry.

## Landing

A Driver authenticated through the unified login flow is routed to:

/driver/

Invitation acceptance also resolves Driver users to:

/driver/

Cross-domain handoff for Driver may originate from the Xentra login/control-plane flow, but the authenticated Driver runtime MUST continue on the dedicated Driver domain.

The Customer domain `app.mybangjo.com` MUST NOT become the canonical Driver application URL.

## Domain architecture rule

Driver is a first-class application surface in the tenant domain architecture.

The canonical Bangjo client surfaces are:

| Surface | Canonical Bangjo domain |
|---|---|
| Customer PWA | `app.mybangjo.com` |
| Merchant / Owner | `m.mybangjo.com` |
| POS | `pos.mybangjo.com` |
| Driver | `driver.mybangjo.com` |

`driver.mybangjo.com` is a runtime/domain mapping decision, not a frontend hostname guess. The authoritative mapping belongs to `tenant_domains`.

For future tenants, the Driver domain may use another tenant-specific hostname, but the same `surface_type = driver` contract applies.

## Infrastructure requirement

The dedicated Driver hostname MUST be provisioned through the normal domain lifecycle:

`Xentra Control Plane → Domain Registry → DNS/SSL/provisioning → Runtime → tenant resolution`

The existence of `driver.mybangjo.com` on VPS/infrastructure is compatible with this architecture, but the runtime must not rely on a client-specific hostname special case as the final source of tenant identity.

The Domain Registry and tenant resolver MUST recognize the Driver surface as `surface_type = driver`.

## Relationship to locked Driver UX

The Driver PWA remains governed by:

- docs/decisions/driver-cod-happy-path-validation-v1.md
- docs/decisions/driver-pwa-ux-ia-contract-v1.md

This document defines the Driver identity and canonical access surface needed to implement those UX contracts safely.

**Locked conclusion:** For Bangjo MVP, Driver is accessed through **https://driver.mybangjo.com/**. `/driver/` remains the internal application route/surface path, but it is not the canonical public Driver URL on the Customer domain.
