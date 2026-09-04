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

## 🔒 LOCKED — Eligibility ≠ Branch Acceptance

**Decision Date:** 2026-09-04

Xentra membedakan **system eligibility** dengan **operational acceptance oleh Branch**. `ELIGIBLE` tidak berarti order otomatis diterima.

Flow:

`Order Request → Core Eligibility → ELIGIBLE → Branch Acceptance → ACCEPT / REJECT`

Branch memiliki operational authority untuk menerima atau menolak request yang secara sistem eligible sesuai kondisi operasional aktual dan policy yang berlaku. Branch acceptance tidak boleh bypass canonical eligibility, dan Core tidak boleh mengubah rejection menjadi acceptance secara diam-diam. Acceptance/rejection harus menjadi state transition yang dapat diaudit.

Berlaku sebagai boundary untuk order/request yang membutuhkan tindakan operasional Branch, termasuk delivery, pickup, dine-in, reservation, dan flow lain sejauh order type tersebut memiliki Branch acceptance step.

Timeout, rejection reason taxonomy, dan UX setelah rejection belum dikunci; coding agent wajib report GAP dan tidak boleh mengarang policy.

Fulfillment selection dan acceptance adalah tahap berbeda:

`AUTO → BranchMatcher → Eligibility → Branch Acceptance`

`CUSTOMER_SELECTED → Selected Branch → Eligibility → Branch Acceptance`

Keduanya tetap menghasilkan tepat satu fulfillment branch dan tidak mengizinkan split fulfillment.

## 🔒 LOCKED — Customer / Branch / Fulfillment Context

Untuk order delivery, **buyer**, **recipient/delivery destination**, dan **fulfillment Branch** adalah context yang berbeda. Buyer dapat berada di kota/lokasi berbeda dari recipient. Branch discovery/matching dan delivery eligibility harus menggunakan delivery destination sebagai tujuan fulfillment, bukan mengasumsikan lokasi buyer sebagai delivery origin.

Customer dapat menentukan destination context terlebih dahulu dan memilih Branch yang tersedia, atau menyerahkan pemilihan Branch kepada Xentra melalui AUTO mode. Customer-selected Branch tetap harus melalui canonical eligibility.

## 🔒 LOCKED — Home as Dynamic Container & Branch-Aware Composition

**Decision Date:** 2026-09-04

Home Xentra adalah **container/presentation composition**, bukan halaman yang meng-hardcode jumlah atau struktur Branch. Home menggunakan data/context dari domain/application layer untuk merender bagian yang relevan.

### Core Principle

**Business/data contract → View Model → Home container → reusable UI components**

Home tidak menjadi authority untuk menentukan fulfillment Branch, inventory, price, eligibility, acceptance, authorization, atau business policy. Home hanya mengomposisikan dan menampilkan state/data yang diberikan oleh layer authoritative.

### Branch-Aware Home Behavior

Jumlah Branch tidak menjadi batas arsitektur dan tidak boleh menghasilkan implementasi khusus per jumlah Branch. Brand dengan 1, 2, 50, atau jumlah Branch lainnya menggunakan composition model yang sama.

#### Jika hanya 1 Branch yang relevan/eligible
- Teks/section **“Cabang terdekat dari tempatmu”** tidak ditampilkan.
- Branch selector/carousel tidak ditampilkan karena tidak ada pilihan yang perlu diberikan kepada Customer.
- Home langsung masuk ke context catalog Branch tersebut: **Category → Product**.
- Secara domain, Branch tetap authoritative dan tetap menjadi `fulfillment_branch_id`; penyederhanaan hanya terjadi pada presentation.

#### Jika lebih dari 1 Branch yang relevan/eligible
- Home menampilkan Branch discovery/selector.
- Branch ditampilkan dalam urutan berdasarkan **ETA** dari delivery destination/customer destination context sesuai routing/matching contract.
- Jarak dapat ditampilkan sebagai informasi pendukung, tetapi Home tidak menghitung ulang atau menggantikan ranking authoritative dari domain/matching layer.
- Customer dapat memilih Branch yang tersedia sesuai selection contract.
- Setelah Branch dipilih, Home menampilkan catalog Branch tersebut: **Category → Product**.

#### Jika jumlah Branch besar
- Tidak ada hardcoded limit berdasarkan jumlah Branch.
- Rendering harus tetap berbasis data/view model dan reusable component.
- Pagination, lazy loading, virtualization, atau presentation optimization boleh digunakan bila diperlukan untuk performa, tetapi tidak boleh mengubah business authority atau selection semantics.

### Important Boundary

**“Cabang terdekat” adalah presentation/discovery concept, bukan kewajiban bahwa Branch terdekat harus menjadi fulfillment Branch.** AUTO menggunakan BranchMatcher sesuai contract; CUSTOMER_SELECTED tetap memungkinkan Customer memilih Branch yang valid. Customer-selected Branch tetap melewati canonical eligibility dan Branch Acceptance.

### Single-Branch Simplification

UI boleh menyembunyikan pilihan yang tidak memiliki nilai bagi Customer. **UI simplification tidak boleh menghapus domain state.** Dalam kasus satu Branch, sistem tetap harus membawa context Branch secara authoritative untuk catalog, eligibility, cart, checkout, dan order.

### Catalog Composition

Setelah Branch context ditetapkan, Home mengonsumsi catalog Branch tersebut secara dinamis:

**Selected/Resolved Branch → Category → Product**

Category dan Product yang tampil harus mengikuti data/contract catalog yang authoritative untuk Branch tersebut. Home tidak membuat daftar menu statis per Branch.

### Architectural Invariants

- Home adalah **container/composition layer**, bukan business-rule container.
- Tidak ada hardcode jumlah Branch.
- Tidak ada hardcode catalog/menu per Branch.
- Branch selection dan final `fulfillment_branch_id` adalah konsep yang berbeda tetapi harus tetap konsisten.
- Customer destination context digunakan untuk discovery/matching delivery; buyer location tidak boleh diasumsikan sama dengan delivery destination.
- UI tidak boleh mem-bypass canonical eligibility atau Branch Acceptance.
- One Cart → One Fulfillment Branch tetap berlaku.
- Reusable component architecture tetap menjadi arah implementasi.

### Verification Expectation

Audit implementasi Home harus memverifikasi minimal:
1. Brand dengan 1 Branch tidak menampilkan branch selector dan langsung menampilkan Category → Product.
2. Brand dengan >1 Branch menampilkan Branch discovery/selector secara data-driven.
3. Branch list tidak bergantung pada hardcoded count atau fixed branch IDs.
4. Ordering Branch mengikuti authoritative ETA/matching data, bukan kalkulasi ranking ad-hoc di UI.
5. Pemilihan Branch menghasilkan context yang benar untuk catalog dan cart.
6. Invalid/unavailable Branch tidak dapat dipaksa melalui UI.
7. Remote/gift destination tetap memisahkan buyer location dari delivery destination.
8. Reuse component tetap dipertahankan tanpa menjadikan component sebagai business authority.

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
