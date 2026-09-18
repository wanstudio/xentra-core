# Xentra Affiliate Domain & Marketing Boundary v1

**Status:** LOCKED / AUTHORITATIVE
**Decision date:** 2026-09-18
**Scope:** Marketing / Affiliate / Customer Acquisition / Commission

## Decision

Xentra treats Affiliate as a first-class Marketing domain, separate from Loyalty and Promotion.

Customer may optionally have an Affiliate Profile. Affiliate is not a system/RBAC role.

MARKETING:
- Promotions
- Loyalty
- Affiliate
- Storefront Content
- Campaigns (future orchestration)

## Program scope

Affiliate Program is Brand-level, not Branch-level.

Organization → Brand → Affiliate Program → Affiliate Profiles / Attributions / Conversions / Commissions / Payouts.

Branch remains transaction/fulfillment scope. An affiliate can generate qualified orders fulfilled by multiple branches of the same brand.

## Attribution

v1 uses LAST_CLICK attribution.

Affiliate identity is authoritative through affiliate_id. Referral code and referral link are attribution mechanisms.

Attribution evidence must be persisted:
- affiliate_id
- customer_id when resolved
- source
- referral_code
- attributed_at
- expires_at
- status

Click is not conversion and conversion is not commission.

## Qualified conversion

Commission is triggered by a qualified valid order aligned with the authoritative Xentra Order/Payment lifecycle.

Do not trigger commission from click, cart creation, checkout opening, or order creation alone.

Affiliate observes Order/Payment lifecycle; it does not redefine those domains.

## Commission

v1 commission model is percentage-based.

Commission base is eligible net merchandise subtotal after applicable discount, excluding tax, delivery, service, and payment fees.

Formula: eligible_subtotal × affiliate_rate.

v1 does not implement fixed, product-specific, category-specific, recurring, lifetime, or tiered commission models.

## Purchase policy

v1 defaults to first qualifying purchase only for a newly attributed customer.

Future policies such as first-N, every-purchase, or lifetime require a new decision.

## Commission lifecycle

PENDING → APPROVED → PAYABLE → PAID

Cancellation/refund/reversal preserves history and may produce VOIDED.

Already-paid reversals use an auditable adjustment/clawback, never silent deletion.

## Payout

v1 does not promise instant payout.

Payable Commission → Payout Eligibility → Payout Request/Batch → Processing → PAID.

Payout threshold may be configurable. No specific monetary default is locked here. Payment provider/method is not locked here.

## Fraud and idempotency

v1 must prevent obvious self-referral and duplicate conversion.

- Affiliate cannot earn from their own qualifying purchase.
- Duplicate conversion processing must be idempotent.
- Invalid/cancelled/refunded orders must not become payable commission.
- Suspicious cases may enter review.
- Shared IP/device/network alone is not definitive fraud evidence.

Conversion/commission creation must be idempotent against authoritative order/conversion identity.

## Domain boundaries

Promotion, Loyalty, and Affiliate are independent.

One order may independently produce:
- Promotion → discount/reward/redemption
- Loyalty → points/reward ledger
- Affiliate → commission

No domain owns another domain's ledger or lifecycle.

## Authority

Owner/Brand may configure the Affiliate Program, manage participation, commission policy, attribution/conversion/commission data, and payout governance.

Branch Manager remains Branch-scoped. Where explicitly exposed, BM may observe affiliate-generated activity relevant to the Branch, but does not own the Brand Affiliate Program or change Brand-wide commission/payout policy.

Core authorization is authoritative. Client-provided branch identifiers never grant authority.

## Canonical implementation boundary

domains/affiliate/ is the intended domain boundary, with these conceptual components:
- AffiliateProgram
- AffiliateProfile
- AffiliateAttribution
- AffiliateConversion
- AffiliateCommission
- AffiliatePayout
- AffiliateService

Conceptual persistence:
- affiliate_programs
- affiliate_profiles
- affiliate_attributions
- affiliate_conversions
- affiliate_commissions
- affiliate_payouts

Exact schema names remain implementation details and must follow existing Xentra persistence conventions.

## Existing Affiliate UI prototype

The current Customer PWA Affiliate/Kemitraan screen is prototype-only implementation evidence.

Its displayed commission percentages, payout wording, reward claims, and numeric/business copy are NOT authoritative and must not be used as business rules.

The prototype may be reused as a presentation shell only after reconciliation with this contract.

## v1 non-goals

Do not implement unless separately locked:
- MLM / multi-level hierarchy
- affiliate network between Xentra brands
- recurring or lifetime commission
- product/category-specific commission
- fixed or tiered commission
- multi-touch or first-click attribution
- AI fraud scoring
- instant payout
- affiliate marketplace
- campaign orchestration as an Affiliate dependency

## Implementation gate

Before implementation:
1. reconcile prototype UI with this contract;
2. map Customer identity/session and Order/Payment lifecycle integration points;
3. introduce the smallest domain/data boundary;
4. implement attribution and commission idempotency;
5. implement lifecycle and refund reversal semantics;
6. enforce Brand/Branch authorization;
7. add domain/integration tests;
8. connect production UI only after the domain is verified.

Source-of-truth rule: this decision is authoritative for Affiliate unless a newer locked decision explicitly supersedes it.