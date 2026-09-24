# 🔒 Xentra — POS Cashier PIN Credential v1

**Status: LOCKED — implementation/product contract**  
**Decision date:** 25 September 2026

## Decision
Xentra keeps **one canonical workforce identity per employee**. A Cashier may have multiple authentication credentials attached to that same identity.

For Cashier POS access:
- normal account authentication remains available through the canonical Xentra account (Google/password where applicable);
- **POS PIN is an additional credential**, not a second identity and not a replacement password;
- POS PIN is scoped specifically to the **POS surface**;
- PIN login creates the same canonical Xentra session/identity with `role = cashier` and the cashier's existing `branch_id`;
- PIN cannot be used as a universal login credential for Owner Dashboard, Merchant App, or other non-POS surfaces.

## PIN contract
- Exactly **6 numeric digits**.
- Stored only as a salted PBKDF2 verifier; raw PIN is never stored or returned.
- One active Cashier PIN must uniquely identify one Cashier within a Branch.
- PIN is set by the Cashier after authenticating normally; Owner/Manager does not choose or receive the Cashier's PIN.
- Changing the PIN replaces the verifier and resets its server-side PIN failure state.
- A POS terminal may cache only the derived offline verifier, salt/KDF parameters, and non-sensitive user/branch identity needed to unlock POS locally. The raw PIN must never be cached.

## Authentication surfaces
```text
Canonical Xentra User
├── Google / Password
│   └── general account authentication
└── POS PIN
    └── /auth/pos/pin
        └── POS cashier session only
```

## Offline / slow connectivity
When connectivity is unavailable or sufficiently slow:
1. POS may show the cached **PIN Unlock** gate for a Cashier previously enrolled on that terminal.
2. Local verification uses the cached KDF verifier; no raw PIN is persisted.
3. Successful local verification restores the cached Cashier identity/context.
4. Reconnection returns control to Xentra-Core for authoritative session, authorization, and reconciliation.
5. Offline PIN unlock does **not** become a second backend or second identity authority.

**Important:** PIN unlock alone does not imply that every POS operation is available without Core/network access. Existing POS offline transaction capabilities remain governed by the existing POS offline/reconciliation contract.

## Security boundary
- No PIN in URLs, logs, audit metadata, analytics, or API responses.
- PIN is never accepted by `/auth/merchant/login`.
- PIN authentication is branch-scoped and cashier-only.
- Branch/role are derived from the server-side user record, not trusted from the PIN payload.
- Repeated online PIN attempts are rate-limited at the authentication boundary.
- The terminal must not store the raw PIN.

## Non-goals
This decision does not create:
- a second workforce/user identity;
- a universal PIN login;
- a separate POS RBAC system;
- Owner-selected staff PINs;
- a separate POS password database.

Any change to this model requires a new explicit decision.
