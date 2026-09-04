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

## 🔒 LOCKED — Fulfillment Branch Selection: AUTO vs CUSTOMER_SELECTED

**Decision Date:** 2026-09-04

Xentra Core v1 tetap mempertahankan invariant **1 Cart → 1 Fulfillment Branch**. Namun, cara menentukan fulfillment branch memiliki dua mode yang sah:

### 1. AUTO
Customer tidak menentukan cabang secara eksplisit. Xentra menggunakan **Branch Matching** untuk menentukan branch yang paling sesuai berdasarkan canonical eligibility dan aturan matching yang berlaku.

### 2. CUSTOMER_SELECTED
Customer boleh secara eksplisit memilih/preferensi sebuah Branch untuk fulfillment. Ini mendukung use case **remote/gift order**, misalnya buyer berada di Jakarta tetapi membeli makanan untuk recipient di Bandar Lampung dari cabang tertentu.

`customer_selected branch` **bukan bypass terhadap Core**. Branch yang dipilih customer tetap wajib melewati canonical eligibility dan seluruh invariant operasional yang sama. Jika tidak eligible, Core harus **reject/require alternative choice** dan **tidak boleh diam-diam memindahkan order ke branch lain** ketika customer secara eksplisit memilih branch tersebut.

### Authority & Boundary
- **Buyer location ≠ Delivery destination ≠ Fulfillment Branch.** Buyer dapat melakukan pembayaran dari lokasi yang berbeda dengan recipient/delivery destination.
- `BranchMatcher` adalah mekanisme untuk **AUTO**, bukan satu-satunya sumber cara penentuan branch.
- `CUSTOMER_SELECTED` adalah customer preference/selection yang harus divalidasi dan disahkan oleh Core.
- Hasil akhirnya tetap tepat **satu `fulfillment_branch_id` per cart/order**.
- **Split fulfillment tetap prohibited** dalam Core v1.
- Client-provided `branch_id` tidak boleh dianggap authoritative hanya karena dikirim client; authority final berada pada Core setelah validation.
- Tidak boleh ada silent fallback dari customer-selected Branch ke Branch lain tanpa policy/explicit user choice.

### Canonical Flow
`AUTO → Branch Matching → Canonical Eligibility → ACCEPT/REJECT`

`CUSTOMER_SELECTED → Selected Branch → Canonical Eligibility → ACCEPT/REJECT`

Kedua mode menghasilkan satu fulfillment branch yang sah dan menggunakan boundary/integrity checks Core yang sama.

### Implementation Consequence
Semua kontrak checkout/order/matching harus membedakan **branch selection mode** dari **final fulfillment branch**. Implementasi tidak boleh menghapus customer-selected branch sebagai konsep hanya karena Branch Matching digunakan untuk AUTO.

Jika policy lebih lanjut diperlukan (mis. channel/order_type mana yang mengizinkan CUSTOMER_SELECTED), policy tersebut harus dikunci secara eksplisit sebelum implementation dan tidak boleh diinvent oleh coding agent.

## Reason
Nilai utama model multi-branch Xentra adalah menghubungkan owner/brand dengan kondisi operasional cabang secara cepat, akurat, dan auditable sehingga keputusan bisnis dapat dibuat berdasarkan kondisi aktual. Optimasi fulfillment Customer adalah salah satu use case dari data Branch, bukan definisi utama Branch.

### Existing Architecture Decisions

#### UI Component Architecture
Xentra menggunakan reusable component architecture dengan business logic authoritative di luar presentation components. Flow konseptual: Database/API → Domain & business services → View Model → UI Component → Page composition. UI tidak boleh menentukan authoritative branch, inventory, price, promotion, payment/order state, authorization, atau financial/inventory mutations.

#### Engineering Decision & Change Philosophy
Business contract stabil; implementation boleh berevolusi jika menjaga invariant dan memiliki alasan teknis/bisnis yang jelas. Notion adalah authority untuk business rules, locked decisions, invariants, dan architecture boundaries; Git adalah evidence implementasi.

#### Modular by Domain
Xentra dibagi berdasarkan domain dengan tanggung jawab yang jelas. Core adalah fondasi bersama dan tidak menampung logika bisnis vertikal. Reporting, Payment, Delivery, dan Integration adalah domain mandiri.

#### Product / Branch Ownership
Owner memiliki master product catalog dan menentukan branch yang mendapatkan produk. Branch menginput stok awal karena branch mengetahui kondisi fisik di lapangan. Branch dapat menonaktifkan produk dengan pencatatan Business Log; governance policy tetap berada pada Owner/authority sesuai RBAC.
