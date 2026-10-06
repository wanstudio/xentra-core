# Xentra — Driver Workforce Identity Contract v1

**Status:** IMPLEMENTATION BASELINE — MVP  
**Date:** 2026-10-06

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

The Driver surface is available at /driver/.

A dedicated driver subdomain is not required for the MVP path implementation. Supporting that subdomain remains compatible with the server routing boundary.

## Landing

A Driver authenticated through the unified login flow is routed to:

/driver/

Invitation acceptance also resolves Driver users to:

/driver/

Cross-domain handoff for Driver uses the tenant login surface with a Driver target, then continues to /driver/.

## Relationship to locked Driver UX

The Driver PWA remains governed by:

- docs/decisions/driver-cod-happy-path-validation-v1.md
- docs/decisions/driver-pwa-ux-ia-contract-v1.md

This document only defines the identity/RBAC prerequisite needed to implement those UX contracts safely.
