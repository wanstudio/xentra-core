# Xentra — Multi-Branch Production / Supply Topology Simulation v1

**Status:** 🔎 ANALYSIS / INPUT TO NEXT BUSINESS DECISION  
**Date:** 2026-10-07  
**Purpose:** Test the locked Catalog → Production → Material → Inventory → Procurement architecture against realistic multi-branch operating models without prematurely locking merchant policy.

## Executive Finding

The layered model passes the simulation, but only if Xentra distinguishes **organizational Branch scope** from **physical Stock Location**.

A Branch-only inventory model is sufficient for branch-direct procurement and branch production, but it cannot cleanly represent central warehouse supply, central kitchen production, or systematic inter-location transfer.

Therefore, the target architecture should support a configurable multi-location supply network rather than forcing one universal procurement topology.

## Scenario A — Branch-direct procurement

Supplier → Branch Procurement → Goods Receipt → Branch Material Stock → Branch Production → Branch Sellable Stock.

**Result:** Supported conceptually.

## Scenario B — Central procurement + Branch distribution

Supplier → Central Procurement → Central Receiving → Central Material Stock → Inventory Transfer → Branch Material Stock → Branch Production → Branch Sellable Stock.

**Result:** Supported after Inventory gains Stock Location semantics. The current Branch-only inventory model would otherwise force a central warehouse into a fake Branch.

## Scenario C — Hybrid sourcing

Some Materials are bought centrally; others are bought by individual Branches.

**Result:** Supported if procurement destination/source policy is explicit and Inventory locations are real.

## Scenario D — Central kitchen production

Central Material Stock → Central Production → Central Product Stock → Inventory Transfer → Branch Sellable Stock.

**Result:** Supported if Production has a production location and Inventory supports transfer.

## Scenario E — Inter-location transfer

Location A → Inventory Transfer → Location B.

**Result:** Inventory-owned. It is not a Purchase Order and not a Production Batch.

## Business decisions exposed by the simulation

Before schema implementation, Xentra must resolve:

- Who owns stock: Organization, Brand, or Branch?
- Can stock physically exist outside a Branch?
- Can one central location supply multiple Branches?
- Can Branch Managers create Purchase Requests?
- Can Branches create their own Purchase Orders?
- Can central procurement purchase for multiple Branches?
- Can a Branch receive centrally procured goods?
- Can production happen centrally, per Branch, or both?
- Can production output be transferred?
- Who can initiate/approve/receive transfers?
- Is Material master data centrally defined and reused?
- Should low stock create only a warning, a Shopping List, a Purchase Request, or ever an automatic Purchase Order?
- How are units, pack sizes, yields, lead times, safety stock, and reorder quantities governed?

## Recommended architectural direction

Xentra should **support branch-direct, central, and hybrid supply topology** without creating alternate domain models.

Operating mode is a **business policy/configuration**, not a separate domain.

The key architectural capability is:

**Branch = organizational/operational scope.  
Stock Location = physical inventory custody/location.**

The target Inventory domain therefore needs a location abstraction. This is a semantic requirement, not yet a final database schema.

## Replenishment safety boundary

Recommended default:

Demand / Stock Condition → Replenishment Requirement → Purchase Request / Shopping List → Procurement Decision → Purchase Order → Goods Receipt → Inventory Mutation.

A low-stock signal must not automatically place a Purchase Order unless a future explicit business policy authorizes autonomous purchasing.

## Next required contract

Create and lock a **Multi-Branch Supply & Stock Topology Contract** before implementing the Production/Material/Procurement schema. It should resolve stock ownership, locations, procurement authority, receiving, transfer, production location, replenishment authorization, and central-vs-Branch sourcing scope.

This document is analysis only and does not itself select the merchant operating model.
