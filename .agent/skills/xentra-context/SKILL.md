---
name: xentra-context
description: Understand Xentra business intent, architecture, decisions, invariants, and current implementation before coding or auditing.
---

# Xentra Context

## Purpose
Establish the correct context before changing or judging Xentra code.

## Source hierarchy
1. Locked business decisions and invariants in Notion.
2. Current requirements and architectural direction in Notion.
3. Current Git implementation and history as implementation evidence.
4. Audit findings and runtime evidence.
5. Existing code patterns are not automatically permanent decisions.

## Core rule
Business contract is stable; implementation may evolve.

Never blindly preserve existing code. Never blindly rewrite it either. First determine whether the difference is:
- legitimate implementation evolution,
- undocumented decision,
- stale documentation,
- incomplete implementation,
- actual business conflict,
- logic/data defect,
- security issue,
- or intentional behavior.

## Before coding
- Inspect git status, recent commits, and relevant diff.
- Read relevant Notion business context.
- Trace the existing implementation before creating abstractions.
- Identify invariants that must survive the change.
- Separate requirement from current mechanism.

## Decision record
For meaningful changes preserve:
Problem/Requirement -> Reason -> Constraints/Invariants -> Alternatives -> Decision -> Implementation -> Verification.

## Do not freeze implementation
Do not turn a temporary mechanism, debugging hypothesis, file location, framework choice, or current code pattern into a permanent rule unless explicitly decided.

## Xentra domain reminders
Keep Organization, Brand, Branch, Product, Inventory, Order, Fulfillment, Payment, POS, and tenant/authorization responsibilities distinct. A UI representation is not automatically an authority over domain state.
