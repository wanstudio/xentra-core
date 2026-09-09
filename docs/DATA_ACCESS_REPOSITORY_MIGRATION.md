# Xentra Core — Data Access Repository Migration

**Status:** LOCKED implementation direction
**Date:** 10 September 2026

## Purpose

Move Xentra Core business services away from direct database imports while preserving existing business behavior. The migration is incremental and does not authorize unrelated rewrites.

## Boundary

`Business Service → Domain Repository → DataAccess → Current DB provider`

The repository layer exposes semantic/domain-oriented operations. SQL and storage details remain below the repository boundary.

`DataAccess.prepare/exec/query*` remains a transitional internal seam only. It is not an external Core ↔ Connector API.

## First repository set

- `CatalogRepository`
- `PromotionRepository`
- `OrderRepository`
- `PaymentRepository`
- `DiningTableRepository`

## Migration rule for large services

Large services such as `OrderPlacementService` and `PaymentGatewayService` must be migrated incrementally. Existing business logic, transaction boundaries, idempotency behavior, and security checks must not be rewritten merely to remove a DB import.

A service is considered migrated only when its persistence access is routed through semantic repository methods and boundary tests prove the service no longer depends on `server/database/db` directly.

## Connector gate

`xentra-connector` MUST NOT be created from a copy/extraction of Core. It is created only after the repository/data-access boundary and Core ↔ Connector contract are stable enough to define typed persistence operations.
