# Xentra Core ↔ Enterprise Connector API & Data Access Contract

**Status: LOCKED**  
**Decision date: 2026-09-10**  
**Contract baseline:** v1

## 1. Purpose

This document defines the hard architectural boundary between Xentra Core and the future `xentra-connector` repository for enterprise/client deployments.

The contract exists to preserve the Xentra IP boundary while allowing client-owned data and storage to remain inside client-controlled infrastructure where required.

This is an architecture/API boundary contract, not a complete endpoint implementation. Concrete endpoint schemas may be added later only if they remain conformant with this contract.

## 2. System boundary

```text
Xentra Core
  ├─ Control Plane
  ├─ Identity / Authorization
  ├─ Domain / Tenant Resolution
  ├─ Merchant Business Logic
  ├─ Orders / POS / Inventory / Payment / Delivery / Reporting
  ├─ Availability / Routing / Pricing / Orchestration
  └─ Proprietary Algorithms / Security-Sensitive Logic
                 │
                 │ Versioned Secure API
                 │
                 ▼
         xentra-connector
                 │
                 ▼
       Client DB / Storage
```

`xentra-core` is the authoritative decision and business-logic layer. `xentra-connector` is an integration/data-access boundary, not another application core.

## 3. Core ownership rules

The following responsibilities remain in `xentra-core`:

- Authentication and authorization policy.
- Tenant, organization, brand and branch authority.
- Domain registry and tenant resolution.
- Business workflows and state machines.
- Pricing, availability, routing and recommendation algorithms.
- Order orchestration and payment business rules.
- Subscription, entitlement and platform policy.
- Fraud/security policy and sensitive decision logic.
- Validation that is part of business meaning rather than transport/storage mechanics.

The connector MUST NOT independently reinterpret these rules.

## 4. Connector ownership rules

The connector is responsible only for client-environment integration concerns:

- Establishing the authenticated service connection to Xentra Core.
- Reading/writing client-owned records through approved typed operations.
- Translating between Xentra contract schemas and the client database/storage representation.
- Handling client-specific database drivers, storage SDKs or adapters.
- Returning structured success/error/conflict information to Xentra Core.
- Reporting connector health, supported capabilities and contract version.

The connector MUST NOT contain:

- Xentra proprietary routing/availability algorithms.
- Core pricing logic.
- Core order-state transition policy.
- Subscription/entitlement decisions.
- Platform-wide authorization policy.
- Arbitrary SQL/query execution exposed as an API to Xentra Core.
- A copy/fork/mirror of Xentra Core services.

## 5. API direction and authority

For enterprise data-residency deployments, the normal authority flow is:

`Client request → Xentra Core → authenticated connector call → client data store → connector result → Xentra Core`

Business decisions MUST originate in Xentra Core. The connector performs the requested data/integration operation and returns the result.

A connector MUST NOT accept an arbitrary tenant, organization or brand identifier from an untrusted client request and treat it as authoritative. Core-side tenant context and connector registration determine the permitted scope.

## 6. Versioning

The Core ↔ Connector protocol is versioned independently from internal implementation details.

Required baseline metadata:

- `contract_version`
- `connector_id`
- `request_id`
- `correlation_id`
- `timestamp`

Breaking contract changes require a new major contract version. Backward-compatible additions may use the same major version.

The connector MUST explicitly advertise the contract versions it supports. Core MUST reject incompatible or unsupported contract versions rather than silently guessing.

## 7. Service authentication

The connector is a service principal, not a merchant user.

Required principles:

- Service-to-service authentication MUST be cryptographically authenticated.
- mTLS SHOULD be used where operationally practical.
- Short-lived credentials/tokens are preferred over long-lived static secrets.
- Connector credentials MUST NOT be exposed to browser/client JavaScript.
- Credentials MUST be scoped to the registered client/tenant and connector identity.
- Credential rotation and revocation MUST be supported.
- Authentication failure MUST fail closed.

Merchant/user authorization remains an Xentra Core concern and MUST NOT be replaced by connector-side role logic.

## 8. Data access boundary

The client database/storage is a persistence boundary, not a business-logic boundary.

The connector SHOULD expose typed, domain-oriented operations rather than generic database primitives.

Preferred pattern:

```text
Core business service
      ↓
Typed data contract
      ↓
Connector adapter
      ↓
Client DB / Storage
```

Prohibited final pattern:

```text
Xentra Core
      ↓
/arbitrary-sql
      ↓
Client DB
```

Xentra Core MUST NOT depend on a client-specific SQL dialect, table layout, credential, or direct database network access when the connector boundary is being used.

The connector is the only component that knows the client database schema/driver details.

## 9. Data operation categories

The v1 contract establishes operation categories. Exact endpoint names and payload schemas are implementation details and must be derived from these categories.

### 9.1 Connector lifecycle

- register/activate connector
- health/readiness
- capability discovery
- contract-version negotiation
- credential rotation/revocation support

### 9.2 Read operations

Typed reads for client-owned resources required by Core, such as:

- branch operational data
- catalog/menu data
- inventory availability data
- order records/status data
- payment persistence/status records where the deployment requires client residency
- customer/business records explicitly approved for the integration

### 9.3 Write operations

Typed writes for client-owned records required by Core, such as:

- create/update order persistence
- persist order events/state snapshots as defined by Core
- inventory mutations initiated by authorized Core workflows
- payment record persistence where applicable
- approved business record synchronization

The connector stores data; Core determines whether the requested business operation is valid.

### 9.4 Storage operations

Where object/file storage must remain client-owned, the connector may expose narrowly scoped object operations such as upload, fetch, replace or delete under an approved contract.

The connector MUST NOT expose arbitrary filesystem access.

## 10. Idempotency and concurrency

Mutating operations MUST support idempotency where duplicate delivery could create duplicate business effects.

The Core contract should use an idempotency key/mutation identifier for retry-safe operations.

Connector responses MUST distinguish at minimum:

- success
- already-applied / replay
- validation rejection
- authorization rejection
- conflict
- unavailable dependency
- permanent integration failure

The connector MUST NOT silently convert a failed write into success.

## 11. Error boundary

Connector errors MUST be normalized into stable contract-level error codes. Raw SQL errors, database credentials, filesystem paths, stack traces or client infrastructure secrets MUST NOT be returned to end users or browser clients.

Core decides whether an error is retriable, user-visible or operational.

## 12. Tenant and connector binding

Every connector registration is bound to an Xentra-managed organization/tenant context.

A connector MUST NOT be reusable across tenants merely by changing a request field.

The Core-side registry MUST determine:

- connector identity
- authorized tenant/organization/brand scope
- supported capabilities
- contract versions
- connection status
- lifecycle/revocation status

Unknown, revoked or mismatched connectors MUST fail closed.

## 13. Data minimization

Only data necessary for the approved operation may cross the Core ↔ Connector boundary.

Do not mirror the entire client database into Xentra Core unless a future architecture decision explicitly requires it.

Do not return client data to the connector's caller when the requested operation does not need it.

## 14. What remains local to Xentra Core even when data is client-resident

Client data residency does not move the following out of Core:

- route/branch selection algorithms
- ETA/cost decision logic
- pricing and fee calculations
- cross-brand recommendation policy
- order state-machine rules
- subscription and entitlement rules
- authorization policy
- platform analytics logic where applicable
- other proprietary business rules

The connector may persist the resulting facts, but MUST NOT become the source of these decisions.

## 15. What may remain client-side

Client-side connector responsibilities may vary by deployment, but may include:

- DB driver/database connectivity
- storage provider integration
- client-specific field mapping
- local connection pooling/retry mechanics
- transport buffering required for reliability
- narrowly scoped synchronization mechanics

These are implementation concerns, not Core business policy.

## 16. Security invariants

The following are mandatory:

1. No readable `xentra-core` server-side proprietary implementation is deployed to the client server.
2. No Core secret or database credential is shipped to the connector unless it is specifically a connector-side credential and remains scoped to the connector's permitted capability.
3. No browser code receives connector credentials.
4. No arbitrary SQL endpoint is exposed from Core to the connector.
5. No arbitrary filesystem endpoint is exposed from Core to the connector.
6. No connector-side authorization can elevate a merchant user beyond Core authorization.
7. Unknown tenant/connector identity fails closed.
8. Revoked connector credentials fail closed.
9. Contract incompatibility fails closed.
10. Connector logs MUST NOT leak sensitive client data or secrets by default.

## 17. Migration constraint for current repository

The current `xentra-core` implementation directly accesses its local database layer from multiple runtime services. Enterprise connectorization MUST therefore be performed through an explicit data-access abstraction/boundary.

Do not perform a broad rewrite of all domain logic solely to create the connector. Refactor only the persistence/integration seams needed to preserve existing behavior while making the connector boundary explicit.

Historical Bangjo-specific seed/configuration assumptions must also be removed from the generic platform path as part of the migration.

## 18. Creation rule for `xentra-connector`

The `xentra-connector` repository MUST NOT be created from a copy of the existing `xentra-core` tree.

It MUST be created from this contract and contain only the implementation necessary to satisfy registered connector capabilities.

Initial connector repository should therefore contain, conceptually:

```text
xentra-connector/
├── contract/
├── transport/
├── auth/
├── capabilities/
├── adapters/
├── persistence/
├── storage/
├── health/
└── tests/
```

Exact language/framework structure remains an implementation choice.

## 19. Final locked topology

```text
                    XENTRA-CONTROLLED
┌──────────────────────────────────────────────────────┐
│ xentra-core                                          │
│                                                      │
│ Identity / RBAC / Domain Registry                   │
│ Control Plane                                       │
│ Business Logic / Algorithms                         │
│ Order / Payment / Routing / Pricing                 │
│ Proprietary Core                                    │
└───────────────────────┬──────────────────────────────┘
                        │
                        │ Versioned Secure API
                        │ Service Authentication
                        ▼
             ┌─────────────────────────┐
             │ xentra-connector        │
             │ separate repository     │
             │ minimal integration     │
             └────────────┬────────────┘
                          │
                          ▼
                Client DB / Storage
                client-controlled
```

**This contract is LOCKED. Future connector implementation MUST conform to it unless explicitly superseded by a new architecture decision.**
