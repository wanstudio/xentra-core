<!-- SNAPSHOT FROM NOTION — source page: 01-architecture-decision-log; fetched 2026-09-04 -->

# 🔒 Branch as Operational Truth Boundary

## Context / Decision
Branch adalah **unit operasional dan operational truth boundary Xentra**, bukan semata-mata mekanisme untuk memenuhi order Customer. Branch menghasilkan fakta operasional realtime yang menjadi dasar sistem dan pihak berwenang untuk mengambil keputusan bisnis.

**Branch adalah sumber fakta operasional, bukan ultimate business-policy authority.**

Fakta pada scope operasional Branch dapat mencakup inventory/stok, product availability, fulfillment capability, operating status, operational activity, dan event operasional lainnya. Xentra Core menjaga state, scope, authority, consistency, idempotency, dan auditability atas fakta tersebut.

## Authority Boundary
- **Branch** menjalankan operasional dan menghasilkan/menyampaikan kondisi aktual lapangan.
- **Branch Manager** memiliki operational authority sesuai scope dan permission.
- **Owner/Brand authority** menentukan business policy dan keputusan lintas-branch sesuai hierarchy dan RBAC.
- **Xentra Core** menegakkan scope, permission, state transition, dan integrity; UI/client bukan authority.
- **Xentra-Reporting** mengubah data operasional menjadi reporting/analytics dan business insight; Reporting bukan pengganti operational source of truth.

## Operational Visibility → Business Decision
Informasi Branch yang realtime dan terpercaya memungkinkan Owner/Brand melihat kondisi aktual dan mengambil keputusan bisnis spesifik, misalnya terkait product assignment, availability, operational limits, promotion/policy request, atau keputusan lintas-branch.

Conceptual flow:

**Branch operation → operational facts/events → Xentra Core → visibility/reporting → authorized Owner/Manager decision → business policy/control → Branch operation**

## Customer Fulfillment Implication
Branch Matching adalah **salah satu consumer** dari operational truth Branch, bukan tujuan utama keberadaan Branch. Untuk Xentra Core v1, satu cart menggunakan **satu fulfillment branch** yang mampu memenuhi seluruh cart. Split fulfillment lintas-branch tidak menjadi mekanisme fallback otomatis. Jika tidak ada satu branch yang eligible untuk memenuhi seluruh cart, checkout mengikuti business policy dan tidak boleh memecah cart secara diam-diam.

## Architectural Invariants
- Jangan menyamakan Branch sebagai operational truth boundary dengan Branch sebagai business-policy authority.
- Jangan menyamakan Branch data visibility dengan izin mengubah policy.
- Jangan menyamakan Branch Matching dengan keseluruhan Branch domain.
- Jangan menyamakan realtime operational state dengan analytics/reporting.
- Authoritative decisions harus ditelusuri ke domain/service boundary yang tepat.

## Reason
Nilai utama model multi-branch Xentra adalah menghubungkan owner/brand dengan kondisi operasional cabang secara cepat, akurat, dan auditable sehingga keputusan bisnis dapat dibuat berdasarkan kondisi aktual. Optimasi fulfillment Customer adalah salah satu use case dari data Branch, bukan definisi utama Branch.

---

## Existing Architecture Decisions

### UI Component Architecture
Xentra menggunakan reusable component architecture dengan business logic authoritative di luar presentation components. Flow konseptual: Database/API → Domain & business services → View Model → UI Component → Page composition. UI tidak boleh menentukan authoritative branch, inventory, price, promotion, payment/order state, authorization, atau financial/inventory mutations.

### Engineering Decision & Change Philosophy
Business contract stabil; implementation boleh berevolusi jika menjaga invariant dan memiliki alasan teknis/bisnis yang jelas. Notion adalah authority untuk business rules, locked decisions, invariants, dan architecture boundaries; Git adalah evidence implementasi.

### Modular by Domain
Xentra dibagi berdasarkan domain dengan tanggung jawab yang jelas. Core adalah fondasi bersama dan tidak menampung logika bisnis vertikal. Reporting, Payment, Delivery, dan Integration adalah domain mandiri.

### Product / Branch Ownership
Owner memiliki master product catalog dan menentukan branch yang mendapatkan produk. Branch menginput stok awal karena branch mengetahui kondisi fisik di lapangan. Branch dapat menonaktifkan produk dengan pencatatan Business Log; governance policy tetap berada pada Owner/authority sesuai RBAC.
