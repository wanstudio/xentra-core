# Deployment — Xentra Runtime

## Canonical topology

Xentra Core is deployed to **Xentra-controlled infrastructure**. `xentra.cloud` is the Xentra SaaS Control Plane/Admin surface. Client domains are tenant/brand entry points managed through Xentra Domain Management.

```text
GitHub
  ↓
GitHub Actions
  ↓
Xentra-controlled VPS / runtime
  ↓
Nginx / edge + Node/Express
  ↓
Xentra Core
  ↓
Tenant/brand selected from authoritative domain configuration
```

The historical Bangjo deployment on shared hosting (`~/xentra-core`, CloudLinux Passenger, cPanel) is a **legacy migration/workaround**, not the target architecture.

## Deployment rules

- GitHub Actions may deploy Xentra Core source to Xentra-controlled infrastructure.
- Do not deploy the Xentra Core source repository to a client-controlled server as the default Enterprise model.
- Do not maintain one manually edited Nginx/vhost configuration per client as the source of domain truth.
- Client domain onboarding starts in `xentra.cloud` Domain Management.
- Domain → tenant/brand mapping is managed data and must not be hardcoded in application code.
- Infrastructure-level routing/TLS configuration, when required, is generated/managed from the Domain Management/provisioning state.
- `app.mybangjo.com` is an example/configured client domain, not a special application identity.

## Xentra VPS

The current Xentra VPS deployment uses the Node/Express runtime on port `3001` behind Nginx. GitHub Actions updates the checked-out release on the Xentra VPS and restarts the runtime.

Expected production chain:

```text
GitHub → Xentra VPS → Nginx → Node :3001
```

## Domain onboarding

A new client domain must follow this lifecycle:

```text
Add domain in xentra.cloud
        ↓
Associate organization/brand/tenant
        ↓
Verify DNS ownership / pointing
        ↓
Provision routing + TLS
        ↓
Activate domain
        ↓
Runtime resolves tenant from authoritative domain mapping
```

Adding a new client domain must not require changing Xentra application source code.

## DNS / Cloudflare

Cloudflare may front client domains. The DNS record and proxy/TLS state are infrastructure concerns driven by the Domain Management/provisioning workflow. Do not use ad-hoc DNS changes as the long-term onboarding mechanism.

## Runtime verification

After a deployment or domain activation, verify:

```bash
curl -sS https://xentra.cloud/health
curl -sS https://<configured-client-domain>/health
```

The client host must resolve to the correct registered tenant. Unknown/unregistered hosts must fail closed rather than falling back to Bangjo or another tenant.

## Database boundary

The current MVP/runtime still contains a local SQLite persistence implementation. That is test/MVP infrastructure and is not, by itself, the final Enterprise data-residency boundary.

The locked Enterprise target is:

```text
Xentra Core
   ↓ secure API
Enterprise Connector
   ↓
Client/Enterprise data store
```

Do not interpret the existence of a local MVP SQLite file as permission to deploy Xentra Core source to client-controlled infrastructure.

## Failure modes

| Symptom | Meaning |
|---|---|
| `xentra.cloud` returns the Xentra Express app | Xentra runtime/edge path is working |
| Client domain reaches another hosting provider | DNS/proxy/origin has not been migrated through the provisioning path |
| Client domain reaches Xentra but returns `TENANT_NOT_FOUND` | Domain is not registered/active or mapping is missing |
| Unknown client host resolves to another tenant | **Critical isolation bug** — fail closed immediately |

## Related locked contracts

- `docs/SAAS_CONTROL_PLANE.md`
- `docs/ENTERPRISE_SAAS_IP_DATA_BOUNDARY.md`
- `docs/DOMAIN_MANAGEMENT_ARCHITECTURE.md`
