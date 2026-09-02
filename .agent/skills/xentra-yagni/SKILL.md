---
name: xentra-yagni
description: Prevent unnecessary abstraction, dependency, duplication, and architecture churn while coding Xentra. Apply YAGNI and reuse discipline without violating locked business contracts.
---

# Xentra YAGNI & Reuse Discipline

## Objective
Choose the smallest implementation that correctly satisfies the current Xentra requirement and preserves the relevant architecture and business invariants.

## Core rule
Do not add code, abstraction, dependency, service, helper, configuration, or architectural layer merely because it could be useful later.

Prefer:
- existing domain services before new parallel services,
- existing components/contracts before duplicated implementations,
- native platform/runtime capabilities before new dependencies,
- the smallest coherent change before broad refactors.

## Xentra authority
This skill never overrides Xentra's locked contract.

Notion business decisions, invariants, and domain boundaries remain authoritative. YAGNI must never be used as an excuse to collapse required domain boundaries or remove necessary safeguards.

## Before adding something
Ask:
1. Is this required by the current task or locked contract?
2. Does an existing service, component, utility, repository, or contract already own this responsibility?
3. Can the requirement be satisfied by extending the existing implementation without creating a competing abstraction?
4. Does the proposed abstraction solve a current repeated responsibility, or only a hypothetical future case?
5. Does a new dependency provide a capability that the current runtime/library stack cannot reasonably provide?

## Reuse discipline
Reuse when responsibility is genuinely the same.

Do not force unrelated behavior into a shared abstraction merely to reduce file count. Shared code should have a stable responsibility and compatible contract.

For UI prefer:
API/domain data -> view model -> reusable component -> page composition.

For backend prefer:
request -> application/domain service -> repository/database -> side effects.

Do not introduce client-specific forks when configuration or an existing domain contract is sufficient.

## Dependency discipline
Before adding a package, check whether:
- Node/platform APIs already solve the problem,
- an existing installed dependency already provides the capability,
- a small local implementation is safer and clearer,
- the dependency materially reduces complexity or operational risk.

Do not reject a dependency when it is genuinely justified by the requirement, reliability, security, or maintainability.

## Refactoring discipline
Do not refactor unrelated code while implementing a feature or bug fix unless the refactor is necessary to make the change correct.

A large diff is not automatically better architecture. Preserve working behavior and make architectural changes intentional.

## Anti-patterns
Avoid:
- speculative generic frameworks,
- wrappers around one trivial call without a boundary benefit,
- duplicated parallel services for the same responsibility,
- new dependencies for capabilities already available natively,
- template/runtime fetching solely to manufacture reuse,
- abstractions whose only justification is "future-proofing".

## Required exception
Introduce a larger abstraction when the current requirement genuinely crosses multiple callers/domains, establishes a stable contract, removes dangerous duplication, or is explicitly required by the architecture.

## Completion check
Before finishing, confirm:
- no unnecessary new abstraction was introduced,
- existing ownership boundaries remain clear,
- no dependency was added without a concrete reason,
- the implementation is not solving hypothetical requirements,
- and the change still satisfies the locked Xentra contract.
