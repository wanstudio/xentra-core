# Xentra Domain Management Architecture

**Status: LOCKED**

## Decision

Client/tenant domains MUST be managed from the Xentra Control Plane (`xentra.cloud`). Domain configuration MUST NOT be hardcoded per client in application code or manually maintained as a client-specific Nginx rule.

The Control Plane is the source of truth for domain lifecycle and domain-to-tenant/brand association.

## Required flow

`xentra.cloud Control Plane → Domain Registry → provisioning/infrastructure → generic runtime routing → tenant resolution`

A typical client flow is:

1. Operator adds a custom/client domain in Xentra Cloud.
2. Domain is associated with the correct organization/brand/tenant.
3. Domain verification is performed.
4. DNS/SSL/provisioning state is tracked.
5. Infrastructure is provisioned from the registry.
6. Runtime receives the request and resolves tenant context from the authoritative host/domain mapping.

## Infrastructure rules

- Nginx/reverse proxy configuration may contain domains technically, but client-specific entries must be generated/managed by provisioning, not manually hardcoded as application architecture.
- Adding a new client domain MUST NOT require changing application source code.
- Adding a new client domain SHOULD NOT require manually editing Nginx configuration.
- Cloudflare/DNS and SSL lifecycle belong to domain provisioning/management, not ad-hoc deployment steps.
- Do not create special cases such as `if host == app.mybangjo.com -> Bangjo`.
- Do not make `app.mybangjo.com` a special runtime identity.

## Runtime rules

- Tenant resolution MUST use an authoritative domain registry/configuration.
- Tenant identity MUST NOT be selected from an untrusted request payload, query parameter, or arbitrary client-controlled header for protected operations.
- Unknown/unregistered domains MUST fail closed.
- The runtime must remain generic and reusable for any future Xentra client.

## Separation of responsibilities

### Xentra Control Plane

Owns:
- domain registration
- domain verification
- domain-to-tenant/brand assignment
- primary/secondary domain state
- SSL/provisioning status
- domain activation/deactivation
- audit/lifecycle state

### Infrastructure / Provisioning

Consumes the domain registry and configures the required edge/routing/SSL resources automatically.

### Xentra Runtime

Consumes authoritative tenant context and serves the correct tenant experience. It must not contain client-specific domain conditionals.

## Explicit anti-patterns

The following are prohibited as the final architecture:

```text
server_name app.mybangjo.com;
if ($host = app.mybangjo.com) { ... }
if (cleanHost === 'app.mybangjo.com') { ... }
```

A domain may appear in generated infrastructure state as a consequence of provisioning, but it must originate from the Control Plane domain registry rather than source-code special casing.

## Current migration note

The existing Bangjo deployment was historically mirrored from GitHub into Bangjo shared hosting with `~/xentra-core` used as the `app.mybangjo.com` root. This is a legacy deployment workaround and is not the target architecture.

The target architecture is Xentra-controlled runtime infrastructure with client domains registered and provisioned through Xentra Cloud.

Do not migrate DNS or manually alter production Nginx configuration until Domain Management and its provisioning contract are verified/implemented.
