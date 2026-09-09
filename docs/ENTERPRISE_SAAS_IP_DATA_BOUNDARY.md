# Xentra Enterprise SaaS — IP & Data Boundary

**Status: LOCKED**  
**Decision date: 2026-09-10**

## Decision

Xentra is a SaaS platform. Enterprise clients such as Bangjo may require their business data to remain on infrastructure controlled by the client, but the proprietary Xentra application/core must not be deployed as readable source code onto client-controlled infrastructure.

The architecture must maintain a hard conceptual boundary between:

- **Xentra Core / SaaS:** proprietary application, shared business logic, algorithms, platform services, subscription/entitlement logic, and security-sensitive server-side logic.
- **Enterprise Client Infrastructure:** client-owned business data, database/storage where required, and only a minimal connector/adapter required to communicate securely with Xentra.

## Target topology

```text
Customer / Merchant UI
        ↓
   Xentra Cloud
   ├── SaaS / Core
   ├── proprietary business logic
   ├── availability/routing algorithms
   ├── order/pricing orchestration
   └── platform services
        │
        │ secure authenticated API / mTLS where appropriate
        ↓
 Enterprise Client Connector
        ↓
 Client-owned Database / Storage
```

The exact physical deployment may evolve, but the IP boundary must remain intact.

## Repository boundary — LOCKED

`xentra-core` and `xentra-connector` MUST be separate Git repositories and separate deployment units.

### `xentra-core`

Contains the Xentra proprietary application/core, Control Plane, business logic, algorithms, platform services, and security-sensitive server-side logic.

Rules:

1. `xentra-core` remains under Xentra-controlled repository and infrastructure access.
2. `xentra-core` MUST NOT be copied/deployed as readable source code to client-controlled infrastructure.
3. Client deployments must not depend on shipping the complete `xentra-core` repository or equivalent readable server-side source.

### `xentra-connector`

A separate repository containing only the minimum enterprise/client-side integration layer required to communicate with Xentra Core and interact with client-owned data/storage where required.

Rules:

1. The connector MUST remain minimal and replaceable.
2. The connector MUST NOT become a copy, fork, or disguised mirror of `xentra-core`.
3. Proprietary algorithms, core business rules, secrets, and security-sensitive core implementation SHOULD remain in Xentra-controlled services.
4. The connector communicates with Xentra Core through an explicit, versioned API/contract boundary.

### Important security rule

Separate repositories alone do not guarantee IP protection. Deployment artifacts, credentials, source maps, runtime permissions, build pipelines, and API boundaries must also preserve the separation.

If any readable Xentra proprietary server-side implementation is physically present on a client-controlled server, assume the client's root/administrator can access it.

## Core ↔ Connector implementation boundary — LOCKED

Current repository audit establishes the following implementation split for future enterprise separation.

### `xentra-core` — remains Xentra-controlled
- Control Plane and platform administration
- Xentra Identity / RBAC / authorization
- Domain Registry and authoritative tenant resolution
- Merchant/F&B business logic
- Orders, POS, inventory, payments, delivery and reporting logic
- Availability/routing algorithms, pricing/order orchestration and other proprietary rules
- Security-sensitive server-side logic and platform services

### `xentra-connector` — separate repository and deployment unit
- Minimal enterprise/client integration layer
- Client database adapter/access boundary where required
- Client-owned storage adapter where required
- Secure Core ↔ client communication transport
- Versioned API/contract handling
- Must not contain proprietary core algorithms or become a copy/fork of `xentra-core`

### Current-state findings that must be remediated without unrelated rewrites

1. Existing runtime services directly access the current local database layer; a formal data-access boundary is required before relocating client-owned persistence concerns.
2. Current database bootstrap/seed state still contains historical Bangjo-specific assumptions and must become tenant/configuration driven rather than hardcoded production identity.
3. Existing authorization foundation is reusable; Control Plane authority must extend the current identity → role → scope → permission model rather than introducing a second authentication system.
4. `PLATFORM_ADMIN` is not yet represented in the current merchant-only role model and must be introduced as a platform authorization concern during implementation.

## Core ↔ Connector API Contract — LOCKED

The authoritative v1 contract is defined in:

`docs/CORE_CONNECTOR_API_CONTRACT.md`

This contract defines the hard boundary for:

- Core-owned business logic and security decisions.
- Connector-owned client DB/storage integration.
- Versioned service-to-service communication.
- Connector identity and tenant binding.
- Data minimization and typed data operations.
- Idempotency, error normalization and fail-closed behavior.
- Prohibited arbitrary SQL/filesystem exposure.

The `xentra-connector` repository MUST be created from this contract, not by copying or extracting the `xentra-core` source tree.

## Data Access Boundary — LOCKED

The client database/storage is a persistence boundary, not a business-logic boundary.

The connector MUST isolate client-specific database schema, drivers, storage SDKs and infrastructure details from Xentra Core.

Xentra Core MUST consume typed, contract-defined data operations rather than relying on client-specific SQL, direct DB credentials, direct DB network access, arbitrary SQL endpoints or arbitrary filesystem endpoints.

Business decisions remain in Core. The connector executes approved persistence/integration operations and returns normalized results.

## Required next implementation boundary

Before creating and deploying the `xentra-connector` repository, implement the data-access seam in `xentra-core` and define the first concrete contract endpoints from `docs/CORE_CONNECTOR_API_CONTRACT.md`. Do not perform an unrelated architectural rewrite.

## Source-code rule

Any server-side code physically deployed onto a client-controlled server must be treated as potentially readable by that client's root/administrator. Docker/containerization, filesystem permissions, minification, or obfuscation do not provide a reliable IP boundary against a client-controlled administrator.

Therefore:

1. Do not deploy the complete Xentra backend/core to Bangjo infrastructure by default.
2. Do not place proprietary algorithms or critical business rules in a client-side connector.
3. Keep secrets and security-sensitive server-side logic in Xentra-controlled infrastructure whenever possible.
4. Browser-delivered frontend code is inherently inspectable; production source maps and secrets must not be exposed.

## Data ownership rule

Client data residency/ownership does **not** imply client ownership of Xentra source code.

If Bangjo requires data to remain inside Bangjo infrastructure, satisfy that requirement through a narrow, authenticated connector/API boundary rather than copying the complete Xentra application into Bangjo's server.

## Relationship to existing SaaS control plane

This decision is consistent with `docs/SAAS_CONTROL_PLANE.md`:

- `xentra.cloud` remains the Xentra SaaS Control Plane.
- `app.mybangjo.com` remains a tenant/client entry point, not proof that Bangjo owns an Xentra runtime.
- Default deployment remains Xentra-controlled infrastructure.
- Dedicated client runtimes are optional deployment choices and do not change the logical SaaS model.

## Engineering guardrails

- Treat client-controlled servers as hostile to source-code confidentiality, even when operated by a trusted enterprise client.
- Keep the Xentra Core/IP boundary independent from database residency decisions.
- Prefer API/connector boundaries over direct database access from Xentra Cloud.
- Do not introduce VPS-per-client or full on-premise Xentra deployments solely because an enterprise client owns its data.
- Before changing production topology, validate the current deployment against this document and `docs/SAAS_CONTROL_PLANE.md`.
- This is an architecture decision, not merely documentation. Future implementation must not silently revert to full application deployment on client infrastructure.
