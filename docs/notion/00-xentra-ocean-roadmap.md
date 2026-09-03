<!-- SNAPSHOT FROM NOTION — source page: 00-xentra-ocean-roadmap; fetched 2026-09-04 -->

Roadmap implementasi Xentra-Core / Xentra-Core MVP. Urutan milestone mengikuti fondasi arsitektur terlebih dahulu, kemudian domain bisnis.
## Struktur
### Milestone A — Xentra Core Event Infrastructure
Fondasi komunikasi event yang dipakai lintas domain.
- [ ] A1 — Event Contract
- [ ] A2 — Event Publisher
- [ ] A3 — Event Bus
- [ ] A4 — Subscriber / Listener
- [ ] A5 — Event Dispatcher
- [ ] A6 — Event Registry
- [ ] A7 — Event Context & Metadata
- [ ] A8 — Event Logging / Audit Foundation
- [ ] A9 — Unit Test & Reference Event
### Milestone B — Identity & RBAC
Fondasi identity, organization, role, dan permission.
### Milestone C — Configuration & Feature Control
Konfigurasi bersama dan feature control yang memang dibutuhkan Core.
### Milestone D — Integration Foundation
Fondasi integrasi layanan dan perangkat eksternal.
### Milestone E — Audit & Activity
Audit/business activity foundation yang dibutuhkan lintas domain.
### Milestone F — Domain Registry
Registrasi dan discovery domain dalam Xentra-Core.
### Milestone G — Core Stabilization
Hardening, contract verification, testing, dan readiness sebelum domain bisnis dibangun.
## Rule
Jangan mengimplementasikan domain bisnis baru hanya karena milestone Core belum selesai. Setiap milestone harus memenuhi Definition of Done sebelum dianggap selesai.
## Sub-milestone Template
Setiap sub-milestone harus memiliki: Objective, Scope, Out of Scope, Dependencies, Deliverables, Definition of Done, Testing Checklist, Architecture Notes, dan Status.
## POS AUDIT BASELINE — CAPABILITIES TO REVIEW
Based on the latest POS audit, record the following as the current review baseline before detailed decisions are discussed one by one.
### Fundamental POS operational capabilities identified
1. **Shift & Cash Drawer Management** — open shift with starting float, Cash In/Cash Out, payment tracking, close shift, Actual Cash vs Expected Cash, and Over/Short variance.
2. **Order Holding / Dine-In / Table / Bill Management** — support for active/held orders, dine-in table context, adding items before settlement, and bill operations such as split/merge where applicable.
3. **Multi-Payment & Settlement** — cash, non-cash methods, and split payment capability where supported by the final payment contract.
4. **Hardware & Kitchen Routing** — customer receipt printing, cash-drawer interaction, and routing kitchen tickets to printer/KDS through the Integration boundary.
5. **Offline Resilience & Synchronization** — POS should maintain operational continuity during connectivity loss, retain local transaction work/queue, and reconcile/synchronize when connectivity returns.
### Current foundation assessment
- Core domain registration → ready.
- Core event bus / lineage → ready.
- Core RBAC / scoped identity → ready.
- Hardware integration foundation → available through Core/Integration boundary.
- Commerce pricing policy → reusable where the contract permits.
- Audit evidence/investigation foundation → available through Core Audit.
- POS-specific Shift/Cash Drawer model/service → not yet implemented.
- POS-specific order holding/table state → not yet implemented.
### Important boundary / decision note
This is an **audit baseline, not a final POS implementation specification**. The capabilities above are recorded because they are fundamental POS concerns and were also validated against industry POS patterns. Detailed Xentra decisions remain to be reviewed separately.
Do not automatically lock the following implementation details yet:
- exact offline behavior and supported offline capabilities;
- payment-method contract and settlement semantics;
- synchronization/reconciliation, retry, idempotency, and conflict behavior;
- ownership of stock/order mutation between POS, Commerce, and Inventory;
- exact hardware transport/protocol requirements;
- introduction of any new order type not already defined by Xentra.
Industry references are supporting context only. Xentra's locked contract and existing architecture remain authoritative.
## LOCKED DECISION — OFFLINE RISK LIMIT POLICY
### Offline Risk Limit Policy (Fail-Fast Rule)
1. **Owner** menetapkan batas atas risiko offline global (**Global Safety Ceiling**).
2. **Branch Manager** mengonfigurasi batas operasional offline untuk cabangnya melalui dashboard, dalam rentang yang diizinkan Owner.
3. **Validation**:
	- Jika nilai Branch \<= Safety Ceiling Owner → **diterima dan aktif**.
	- Jika nilai Branch \> Safety Ceiling Owner → **ditolak seketika** dengan validation error yang menjelaskan batas maksimum yang diizinkan.
	- Sistem **dilarang melakukan auto-clamp / silent clamping** terhadap nilai yang dimasukkan.
4. Jika kebutuhan operasional cabang melebihi Safety Ceiling, penyelesaiannya melalui **governance/escalation kepada Owner**, bukan dengan bypass konfigurasi.
### Context
This follows the same governance principle as the locked Pricing Policy `range`: a user-entered value outside the legally permitted range is explicitly rejected rather than silently changed. Example values such as Rp5.000.000 or 4 hours are illustrative only and are **not** locked numeric values unless separately decided.
### Locked principle
**Owner controls the global safety ceiling; Branch Manager controls the branch operational limit within that ceiling; invalid values fail explicitly and are never silently clamped.**
## LOCKED DECISION — ORDER CHANNEL VS FULFILLMENT TYPE
### Order Channel
`order_channel` belongs to the **Commerce Domain** and describes **where/how the order was initiated** (the source/channel of the order).
Examples:
- `pos_cashier` — order entered by cashier through POS.
- `customer_app` — order initiated directly by customer application.
- `website` — order initiated through website.
- `marketplace` — order originating from an external marketplace.
- `whatsapp` — order originating through WhatsApp/channel integration.
- `kiosk` — order initiated through a self-service kiosk.
### Fulfillment / Order Type
`fulfillment_type` also belongs to the **Commerce Domain** and describes **how the customer receives the order**.
The Xentra order types remain:
- `dine_in`
- `pickup`
- `delivery`
These are **not** `order_channel` values. Do not mix order origin with fulfillment method.
### Examples
Customer orders from an app while sitting at table 3:
- `order_channel = customer_app`
- `fulfillment_type = dine_in`
- `table_id/table_reference = 3`
Cashier enters a delivery order:
- `order_channel = pos_cashier`
- `fulfillment_type = delivery`
Customer orders online and collects at the branch:
- `order_channel = website` (or the applicable customer-facing channel)
- `fulfillment_type = pickup`
### Architectural Context
Commerce owns the order lifecycle and the distinction between **order origin/channel** and **fulfillment type**. POS and Customer App are transaction/order-entry channels, not separate fulfillment types. Delivery/logistics and other downstream capabilities consume the fulfillment information according to their domain contracts.
This decision prevents `delivery`, `pickup`, and `dine_in` from being incorrectly modeled as order channels.
# LOCKED CONTEXT — ORDER TYPE VS ORDER CHANNEL
## Prinsip Utama
**`order_type`**** dan ****`order_channel`**** adalah dua konsep yang berbeda dan wajib dipisahkan.** Keduanya tidak boleh digabung karena menjawab pertanyaan bisnis yang berbeda.
### 1. `order_type` — Jenis Transaksi Bisnis
`order_type` menjelaskan **jenis transaksi yang dilakukan customer dan lifecycle bisnis yang mengikutinya**.
Xentra memiliki 4 order type:
1. **`delivery`** — pesanan untuk diantar.
	- Default: **antar sekarang**.
	- Customer dapat memilih pengantaran pada waktu tertentu sesuai aturan/rule penjadwalan yang sudah ada di `xentra-core`.
	- Jangan membuat rumus waktu baru jika rule tersebut sudah tersedia di source code.
2. **`pickup`** — pesanan untuk **diambil sekarang** oleh customer.
3. **`dine_in`** — transaksi makan di tempat yang terikat pada konteks meja dan dapat berlangsung sebagai satu rangkaian transaksi yang memungkinkan penambahan pesanan.
	- Customer dapat datang dan membuat transaksi awal melalui POS.
	- Customer kemudian dapat menambah menu melalui Customer App menggunakan nomor/konteks meja.
	- Jika tambahan memilih **bayar cash di kasir**, tambahan tersebut harus dikaitkan ke bill/order dine-in yang sedang di-hold berdasarkan meja, sehingga kasir dapat menagihnya sebagai bagian dari tagihan dine-in.
	- Jika tambahan **dibayar online**, pembayaran tambahan tersebut selesai pada saat itu dan **tidak boleh ditagihkan kembali melalui POS**.
	- Jika seluruh transaksi diselesaikan melalui POS pada akhir kunjungan, POS menjadi sumber pembayaran akhir untuk transaksi yang masih belum dibayar.
4. **`reservation`** — customer memesan slot kedatangan untuk waktu mendatang dan memasukkan perkiraan jumlah orang.
	- Reservasi hanya untuk **besok dan seterusnya**.
	- **Reservasi pada hari yang sama tidak diperbolehkan.**
	- Minimum reservasi adalah hari berikutnya setelah waktu operasional pembukaan yang berlaku.
	- Reservation memiliki lifecycle bisnis tersendiri dan karena itu merupakan `order_type`, bukan `order_channel`.
## 2. `order_channel` — Sumber/Cara Order Dibuat
`order_channel` menjelaskan **dari mana atau melalui kanal apa order dibuat/dimasukkan ke sistem**.
Contoh channel yang relevan untuk Xentra:
- `pos` / `pos_cashier` — order dibuat atau dimasukkan oleh kasir melalui POS.
- `customer_app` — order dibuat langsung oleh customer melalui aplikasi.
- Channel lain dapat ditambahkan sesuai kebutuhan integrasi, tanpa mengubah definisi `order_type`.
## Kenapa Harus Dipisahkan?
Satu **`order_type`**** yang sama dapat datang dari channel yang berbeda**.
Contoh paling penting adalah `dine_in`:
### Dine-in dimulai melalui POS
```plain text
order_type    = dine_in
order_channel = pos
 table        = 3
```
Customer datang, kasir membuat transaksi awal untuk meja 3.
### Tambahan dine-in dibuat melalui Customer App
```plain text
order_type    = dine_in
order_channel = customer_app
table         = 3
```
Ini **bukan berarti customer membuat jenis order baru**. Tetap `dine_in`; yang berubah hanya sumber/channel masuknya order.
Kedua transaksi/order context tersebut harus dapat dikaitkan dengan **konteks dine-in/meja yang sama**, sehingga tambahan dari app dapat diperlakukan sesuai status pembayaran:
- **Cash di kasir** → masuk ke bill dine-in yang masih di-hold.
- **Online payment** → settled sendiri dan tidak ditagihkan ulang di POS.
## Contoh Kombinasi
<table header-row="true">
<tr>
<td>Situasi</td>
<td>`order_type`</td>
<td>`order_channel`</td>
</tr>
<tr>
<td>Kasir membuat pesanan delivery</td>
<td>`delivery`</td>
<td>`pos`</td>
</tr>
<tr>
<td>Customer membuat pesanan delivery di app</td>
<td>`delivery`</td>
<td>`customer_app`</td>
</tr>
<tr>
<td>Kasir membuat pesanan pickup</td>
<td>`pickup`</td>
<td>`pos`</td>
</tr>
<tr>
<td>Customer membuat pesanan pickup di app</td>
<td>`pickup`</td>
<td>`customer_app`</td>
</tr>
<tr>
<td>Kasir membuat dine-in meja 3</td>
<td>`dine_in`</td>
<td>`pos`</td>
</tr>
<tr>
<td>Customer menambah pesanan meja 3 melalui app</td>
<td>`dine_in`</td>
<td>`customer_app`</td>
</tr>
<tr>
<td>Customer membuat reservasi melalui app</td>
<td>`reservation`</td>
<td>`customer_app`</td>
</tr>
</table>
## Boundary Domain
Kedua konsep ini merupakan bagian dari **Commerce Order Model / Commerce Domain** karena Commerce memiliki tanggung jawab atas order lifecycle dan klasifikasi transaksi.
**POS bukan ****`order_type`****. POS adalah salah satu ****`order_channel`****.** Customer App juga merupakan channel, bukan order type.
Dengan demikian:
```plain text
Commerce Order
│
├── order_type
│   ├── delivery
│   ├── pickup
│   ├── dine_in
│   └── reservation
│
├── order_channel
│   ├── pos
│   ├── customer_app
│   └── channel lain sesuai integrasi
│
└── context
    ├── table / dine-in context
    ├── delivery schedule/context
    └── reservation schedule + guest estimate
```
### LOCKED PRINCIPLE
> **`order_type`**** menentukan jenis transaksi/lifecycle bisnis. ****`order_channel`**** menentukan dari mana transaksi tersebut masuk ke Xentra. Keduanya wajib dipisahkan. ****`delivery`****, ****`pickup`****, ****`dine_in`****, dan ****`reservation`**** adalah order type; POS dan Customer App adalah order channel.**
### Implementation Constraint
Jangan mengubah istilah atau membuat domain baru hanya untuk mengakomodasi channel. Implementasi harus mempertahankan pemisahan konsep ini pada Commerce Order Contract dan menjaga agar flow POS maupun Customer App dapat menghasilkan `order_type` yang sama dengan `order_channel` yang berbeda.
## LOCKED CONTEXT — RESERVATION SAME-DAY RESTRICTION
### Business Reason
Reservation tidak boleh dibuat untuk **hari yang sama**. Ini bukan sekadar batasan teknis tanggal, tetapi merupakan **operational risk control**.
Contoh kondisi restoran:
- Jam operasional 09.00–21.00.
- Periode sekitar 19.00–21.00 dapat menjadi peak hour.
- Jika customer pada pukul 13.00 dapat membuat reservasi untuk pukul 19.00 di hari yang sama, customer dapat secara mendadak memblokir kapasitas besar, misalnya untuk rombongan 200 orang.
- Restoran dapat terpaksa menolak customer lain karena kapasitas tersebut dianggap sudah dialokasikan untuk reservasi.
- Jika customer yang melakukan reservasi ternyata tidak datang, restoran mengalami kehilangan kesempatan penjualan pada periode ramai.
### Locked Rule
> **Reservation hanya dapat dibuat untuk besok atau tanggal setelahnya. Same-day reservation wajib ditolak oleh sistem.**
Jeda minimum satu hari memberikan restoran waktu untuk melakukan verifikasi dan memastikan keseriusan reservation sebelum kapasitas operasional hari berikutnya dianggap teralokasi.
### Scope Boundary
Proses operasional lanjutan seperti:
- telepon customer untuk konfirmasi,
- memastikan customer benar-benar akan datang,
- meminta DP,
- dan prosedur booking/confirmation lainnya,
berada **di luar sistem Xentra** dan tidak perlu dimodelkan sebagai business flow aplikasi untuk rule ini.
Xentra hanya bertanggung jawab memastikan **same-day reservation tidak dapat dibuat** dan reservation hanya tersedia mulai **besok dan seterusnya**.
### Implementation Requirement
Validasi reservation harus dilakukan oleh sistem berdasarkan tanggal/waktu reservation yang diminta. Jangan hanya mengandalkan UI untuk menyembunyikan tanggal hari ini; backend/domain validation juga wajib menolak request same-day reservation.
## LOCKED CONTEXT — RESERVATION → CHECK-IN / OPEN TABLE → DINE-IN
`reservation` bukan transaksi makanan aktif dan **tidak boleh diperlakukan sebagai dine-in yang langsung berjalan**. Konsepnya seperti reservasi hotel: reservation adalah booking kunjungan untuk waktu mendatang.
### Lifecycle
```plain text
reservation
    ↓
menunggu tanggal & waktu kedatangan
    ↓
customer tiba di outlet
    ↓
POS: Check-in / Open Table
    ↓
reservation → dine_in aktif
    ↓
pilih / konfirmasi meja
    ↓
order aktif / bill dibuka
    ↓
transaksi aktual berjalan
```
### Aturan Bisnis
1. Saat reservation dibuat, order tetap berstatus/bertipe **`reservation`**.
2. Reservation yang belum check-in **belum menjadi transaksi dine-in aktif** dan belum membuka bill aktif.
3. Reservation tidak memulai pemotongan stok aktual untuk konsumsi dine-in.
4. Saat customer benar-benar tiba, kasir melalui POS melakukan **Check-in / Open Table**.
5. Check-in mengalihkan konteks reservation menjadi **`dine_in`**** aktif** pada meja tertentu.
6. Setelah menjadi dine-in aktif, transaksi mengikuti flow dine-in normal: bill aktif, pemesanan tambahan, pembayaran, dan aturan Commerce/Inventory yang berlaku.
7. Setelah check-in, customer dapat menambah pesanan melalui Customer App menggunakan konteks meja yang sama.
### Hubungan dengan Order Channel
`reservation` tetap merupakan **`order_type`**, sedangkan POS atau Customer App tetap merupakan **`order_channel`**.
Contoh:
```plain text
reservation dibuat melalui Customer App
order_type    = reservation
order_channel = customer_app
        ↓
customer tiba
        ↓
POS melakukan Check-in / Open Table
        ↓
order aktif menjadi dine_in pada meja tertentu
```
### Locked Principle
> **Reservation adalah booking untuk kunjungan mendatang, bukan transaksi makanan aktif. Reservation baru berubah menjadi ****`dine_in`**** aktif ketika customer tiba dan kasir melakukan Check-in / Open Table melalui POS. Pemotongan stok aktual dan bill dine-in aktif dimulai pada tahap transaksi aktual tersebut.**
## LOCKED DECISION — RESERVATION CONVERTS DIRECTLY TO DINE-IN
Saat customer reservation tiba di outlet, **tidak dibuat order/transaksi baru dan tidak dibuat field/model transaksi tambahan**.
Flow yang dikunci:
```plain text
reservation
    ↓ customer datang
POS: Check-in / Open Table
    ↓
order menjadi dine_in
    ↓
bill aktif
    ↓
transaksi aktual
```
### Aturan
1. `reservation` hanya merepresentasikan booking sebelum customer datang.
2. Saat Check-in / Open Table dilakukan oleh POS, **order yang sama dialihkan dari ****`reservation`**** menjadi ****`dine_in`**.
3. Tidak membuat order kedua hanya untuk transaksi dine-in.
4. Tidak membuat field/model tambahan untuk membedakan transaksi hasil check-in.
5. Setelah menjadi `dine_in`, order mengikuti lifecycle dine-in normal: meja, held bill, penambahan item dari Customer App, pembayaran, dan pemotongan stok aktual.
6. Pemisahan `order_type` tetap: `reservation` sebelum check-in, `dine_in` setelah check-in.
### Locked Principle
> **Reservation adalah fase booking sebelum kedatangan. Ketika customer tiba dan melakukan Check-in / Open Table, order yang sama berubah menjadi ****`dine_in`**** aktif. Xentra tidak membuat order atau field transaksi tambahan untuk perpindahan ini.**
## PAYMENT — OPEN DECISION 01: PAYMENT STATUS vs ORDER STATUS
### External POS Documentation Reference
Dokumentasi resmi POS lain menunjukkan pola pemisahan lifecycle pembayaran dari lifecycle order/check. Toast mendokumentasikan state payment seperti processing, authorized, captured, denied, dan voided, serta membedakan status payment dengan status check/order. Square juga membedakan payment yang telah diotorisasi (`APPROVED`) dengan payment yang sudah selesai/captured (`COMPLETED`).
Referensi ini digunakan sebagai **bahan pembanding desain**, bukan sebagai aturan Xentra yang otomatis berlaku.
### Pertanyaan yang harus dikunci untuk Xentra
> **Apakah Xentra akan memisahkan ****`payment_status`**** dari ****`order_status`**** sebagai dua lifecycle yang berbeda?**
Contoh konsep yang perlu diputuskan:
```plain text
ORDER
open
  ↓
PAYMENT
pending / authorized / completed / failed
  ↓
ORDER
paid / completed
```
### Catatan
- Ini masih **OPEN DECISION**, belum menjadi business rule terkunci.
- Jawaban atas pertanyaan ini akan mempengaruhi desain QRIS, EDC, cash, split payment, refund, dan pembayaran asynchronous.
- Jangan mengimplementasikan state tambahan berdasarkan asumsi sebelum keputusan ini dikunci.
## LOCKED DECISION — PAYMENT / ORDER LIFECYCLE SEPARATION
Xentra adopts the proven POS pattern demonstrated by official Toast and Square documentation: **payment lifecycle and order lifecycle are separate concerns**.
### Locked Rule
1. `payment_status` is maintained independently from `order_status`.
2. Clicking **Pay** does not by itself make an order paid/completed.
3. The order may transition to its paid/completed state only after the applicable payment method reaches its valid successful settlement state.
4. Payment methods may have different lifecycle depth. Cash can settle directly, while card/QR/payment-gateway flows may require processing, authorization, capture/completion, or failure states.
5. Failed, canceled, denied, or otherwise incomplete payments must not be treated as successful order settlement.
6. This pattern is adopted as an Xentra business/architecture rule based on established POS practice, not invented independently.
### Reference Pattern
```plain text
ORDER
  │
  ├── order lifecycle
  │
  └── PAYMENT
        ├── pending / processing
        ├── authorized (where applicable)
        ├── completed / captured
        ├── failed
        └── canceled / voided
```
### Reference Basis
Toast and Square official documentation demonstrate separate payment/check or order lifecycle handling, including authorization vs capture/completion for non-cash payments and simpler direct settlement behavior for cash.
The external documentation is **reference evidence for the adopted pattern**; Xentra-specific naming and exact states remain subject to the existing domain contracts.
## LOCKED DECISION — CASH PAYMENT ORDER VS FINANCIAL STATUS
### Business Decision
Untuk pesanan **cash / tunai / COD / bayar di meja**, Xentra secara sengaja memisahkan lifecycle order dari lifecycle pembayaran.
- `orders.status = 'confirmed'` berarti order valid dan boleh masuk proses operasional/fulfillment, termasuk dapur menyiapkan pesanan dan inventory melakukan deduction sesuai flow Commerce/Inventory.
- `order_payments.payment_status = 'pending'` berarti uang tunai **belum diterima** dan masih menjadi outstanding payment.
- Kombinasi **`confirmed`**** + ****`pending`**** untuk cash adalah VALID** dan bukan state inconsistency.
- Saat kasir/actor yang berwenang benar-benar menerima uang tunai, payment diubah menjadi status sukses/settled (`settlement`).
- Cash yang masih `pending` tidak boleh dihitung sebagai cash revenue yang sudah diterima.
### Operational Flow
```plain text
CASH / COD

Order dibuat
    ↓
orders.status = confirmed
    ↓
Kitchen / fulfillment berjalan
    ↓
Inventory deduction mengikuti order confirmation
    ↓
order_payments.payment_status = pending
    ↓
Kasir / pihak penerima menagih uang
    ↓
Uang benar-benar diterima
    ↓
payment_status = settlement
```
### Authorization / Security Invariant
Perubahan `cash payment` dari `pending` → `settlement` adalah **financial mutation**. Customer/PWA tidak boleh dapat menyelesaikan payment cash miliknya sendiri melalui endpoint publik tanpa authorization yang sesuai. Settlement harus dilakukan oleh actor/flow yang memang berwenang menerima uang tunai.
Settlement juga harus idempotent dan terikat pada payment/order yang benar sehingga double-submit tidak menghasilkan double revenue.
### Scope
Keputusan ini hanya mengunci **semantik bisnis status order vs status pembayaran cash**. Detail actor/endpoint/UX settlement tetap mengikuti kontrak POS/Commerce yang diimplementasikan kemudian.
## LOCKED DECISION — XENTRA PAYMENT METHODS
Xentra hanya menggunakan **dua jalur pembayaran** dalam business flow saat ini:
1. **`cash`** — pembayaran tunai, termasuk pembayaran delivery maupun pembayaran melalui POS/dine-in/pickup.
2. **`midtrans`** — pembayaran online melalui Midtrans.
### Aturan
- Cash dianggap berhasil setelah kasir menerima pembayaran tunai yang valid.
- Midtrans dianggap berhasil berdasarkan konfirmasi sukses dari Midtrans.
- Tidak perlu menambahkan payment method/domain rule lain (QRIS static, EDC, kartu, split payment, approval code, dan sebagainya) ke scope Xentra saat ini.
- Jangan mengembangkan business logic payment tambahan yang tidak diperlukan oleh dua jalur pembayaran tersebut.
### Scope Principle
> **Payment Xentra = Cash atau Midtrans. Selesai.**
Payment lifecycle tetap terpisah dari order lifecycle sesuai keputusan sebelumnya; perbedaan hanya pada cara masing-masing dari dua metode tersebut mencapai status sukses/settled.
## LOCKED DECISION — INVENTORY `purchase_in` TWO-STAGE FLOW
`purchase_in` menggunakan alur dua tahap: **PO/Draft → Verified Goods Receipt → Stock Mutation**.
1. **Purchase Order / Pending Receiving**
	- PO/dokumen dibuat oleh Owner atau Branch Manager.
	- Status: `pending` / `ordered`.
	- **Stok belum berubah** dan belum ada mutasi fisik pada inventory ledger.
2. **Verified Goods Receipt**
	- Barang fisik tiba di outlet dan diperiksa kuantitas serta kualitasnya.
	- Branch Manager / Staff yang berwenang melakukan **Terima Barang / Verify**.
	- Status menjadi `received` / `verified`.
3. **Stock Mutation & Ledger**
	- Setelah verifikasi, stok cabang bertambah secara ACID.
	- Dibuat row immutable pada `inventory_movements`:
		- `movement_type = purchase_in`
		- `quantity = +N`
		- `reference_id = PO-XXXXX`
		- `actor_id = user_manager_id`
		- `notes` menjelaskan penerimaan barang.
	- Emit event `inventory.stock.received` / `inventory.movement.recorded`.
### Locked Consequences
- PO/`ordered` **tidak menambah stock-on-hand**.
- Barang baru dapat dianggap tersedia untuk penjualan setelah physical goods receipt diverifikasi.
- Pola ini konsisten dengan konsep transfer: barang yang masih in-transit tidak dihitung sebagai stok cabang tujuan sampai diverifikasi/diterima.
- Tujuan: mencegah ghost stock dan menjaga audit trail antara pihak yang membuat PO dan pihak yang menerima barang fisik.
## LOCKED DIRECTION — REPORTING DOMAIN (MODULAR)
Reporting menjadi domain modular yang **membaca data/evidence dari domain sumber dan menyajikannya sebagai laporan**, bukan tempat melakukan transaksi atau mengambil alih business logic domain sumber.
### Initial Reporting Scope
Untuk MVP, fondasi Reporting mencakup:
- Sales / Orders
- Payment & Cash
- Inventory
- POS / Shift
- Product / Menu Performance
- Branch / Multi-Branch
### Modular Extension Rule
Daftar report di atas **bukan daftar tertutup permanen**. Jika kebutuhan operasional baru muncul, report/modul baru dapat ditambahkan di dalam domain Reporting tanpa memindahkan atau menggandakan business logic transaksi dari domain sumber.
### Domain Boundary
```plain text
Domain sumber
  ↓ menghasilkan transaksi / data / evidence
Reporting
  ↓ membaca & mengolah untuk penyajian
Report / Dashboard
```
Audit tetap merupakan domain/fungsi terpisah. Reporting dapat menyajikan data yang relevan untuk kebutuhan informasi, tetapi tidak mengambil alih fungsi Audit Investigation.
> **Prinsip:** Domain sumber menghasilkan data/evidence → Reporting membaca dan menyajikannya → kebutuhan report baru ditambahkan secara modular.
## REPORTING ARCHITECTURE — Query Provider / Dimensional Report Engine
Reporting menggunakan arsitektur modular berbasis provider/service agar domain tidak menjadi kumpulan query SQL monolitik.
### Proposed Structure
```plain text
domains/reporting/
├── index.js
├── models/
│   └── ReportFilterModel.js
└── services/
    ├── SalesReportService.js
    ├── PaymentReportService.js
    ├── InventoryReportService.js
    ├── PosShiftReportService.js
    ├── ProductReportService.js
    └── BranchCompareService.js
```
### Responsibilities
- `ReportFilterModel` menjadi pintu standar untuk scope dan filter laporan, termasuk brand, branch, date range, dan group-by bila memang dibutuhkan oleh report.
- Setiap report memiliki service/provider terpisah berdasarkan area laporan.
- Reporting bersifat **read-only / zero mutation** terhadap domain sumber: service report menggunakan query agregasi/read (`SELECT`, `GROUP BY`, window functions bila diperlukan) dan tidak melakukan `INSERT`/`UPDATE` pada tabel domain lain.
- RBAC/scoped identity menjadi boundary akses laporan. Branch Manager/Kasir hanya dapat melihat scope branch yang menjadi kewenangannya; Owner/Executive dapat melihat branch tertentu atau agregasi multi-branch sesuai permission.
- REST API reporting menggunakan satu pintu: `GET /api/v1/reports/:report_type`.
- Penambahan jenis report baru dilakukan secara modular dengan menambahkan provider/service baru di domain Reporting tanpa memindahkan business logic transaksi dari domain sumber.
### Initial Providers
- `SalesReportService` — Sales, channel/order type, dan analisis waktu penjualan.
- `PaymentReportService` — Cash vs Midtrans settlement dan reconciliation.
- `InventoryReportService` — Stock ledger summary, waste/spoilage, dan low-stock information.
- `PosShiftReportService` — Shift, cashier variance, float, dan drawer accuracy.
- `ProductReportService` — Product/menu performance seperti top sellers dan category contribution.
- `BranchCompareService` — Aggregation/perbandingan performa antar-branch untuk scope Owner/Executive.
### Boundary / Non-Locked Technical Notes
Struktur provider di atas adalah **arah implementasi teknis**, bukan penambahan business rule baru. Detail filter/dimensi (`group_by`, dan sebagainya) mengikuti kebutuhan report yang benar-benar dikunci. Perhitungan margin hanya boleh digunakan apabila Xentra sudah memiliki cost basis yang valid; jangan mengasumsikan margin dapat dihitung tanpa sumber cost yang sah.
## LOCKED DECISIONS — INVENTORY / ORDER CANCELLATION / RESERVATION CONTROL
### 1. Automatic Sales Stock Ledger — `sale_deduction`
Setiap kali `OrderPlacementService` berhasil melakukan stock deduction produk terjual secara ACID, sistem **wajib otomatis mencatat** inventory ledger entry dengan `movement_type = 'sale_deduction'`.
Ledger wajib menyimpan sekurang-kurangnya:
- `order_number`
- `quantity = -N`
- `previous_stock`
- `current_stock`
Tujuan: Stock Ledger selalu merepresentasikan setiap pengurangan stok akibat penjualan dan tidak memiliki selisih yang tidak terlacak.
### 2. Cancel Order — No Automatic Restock
Order yang berubah menjadi `cancelled` **tidak melakukan auto-restock**.
Alasan: barang/makanan dapat sudah dimasak atau bahan sudah dibuka sehingga belum tentu layak dikembalikan ke stok.
Jika secara fisik masih layak disimpan, Branch Manager melakukan pemeriksaan dan dapat membuat mutasi manual yang sesuai, yaitu `audit_adjustment` atau `return_in`.
### 3. Reservation — Branch Operational Control
**Branch Manager** dapat mengatur melalui Dashboard:
- Jam layanan reservasi cabang; tidak wajib mengikuti jam buka toko secara kaku.
- `Grace Period / No-Show Tolerance`, misalnya 60 menit. Jika customer tidak melakukan check-in sampai melewati grace period setelah jadwal reservasi, reservation dapat berubah menjadi `cancelled / no_show`.
**Global Hard Guard tetap berlaku:**
- Reservation **wajib minimal besok**.
- `reservation_date >= tomorrow`.
- **Same-day reservation strictly rejected**, tanpa pengecualian dari konfigurasi branch.
## LOCKED DIRECTION — DELIVERY DOMAIN ARCHITECTURE
### Context
Delivery merupakan **domain modular mandiri** yang bertanggung jawab atas lifecycle fulfillment pesanan delivery. Domain Delivery **tidak mengunci siapa pihak yang mengantar** sebagai business rule/arsitektur inti.
Pemilihan model pengantaran adalah capability/provider yang dapat berkembang secara independen. Dengan demikian, implementasi MVP dapat menggunakan driver milik cabang sendiri tanpa membuat arsitektur Delivery bergantung secara permanen pada model tersebut.
### Delivery Core Boundary
Delivery Core menangani kebutuhan delivery yang bersifat umum, termasuk:
- delivery address
- delivery fee / ongkir
- delivery fulfillment lifecycle / status
- dispatch information
- driver/provider assignment
- delivery completion
Commerce tetap menjadi sumber order dan order type. Ketika order bertipe `delivery`, Commerce berinteraksi dengan Domain Delivery melalui contract yang sesuai. Delivery tidak mengambil alih business logic order Commerce.
### Provider / Adapter Boundary
Siapa yang melakukan pengantaran berada di belakang boundary provider/adapter:
```plain text
Commerce
   │
   │ delivery order
   ▼
Delivery Domain
   │
   ├── Delivery Core
   │   ├── address
   │   ├── fee
   │   ├── fulfillment status
   │   ├── dispatch
   │   └── completion
   │
   └── Delivery Provider / Adapter
       ├── Branch Driver (MVP)
       ├── Xentra Driver App (future)
       └── External Delivery API / Provider (future)
```
### MVP Decision
Untuk MVP, Delivery menggunakan **driver milik cabang sendiri**.
MVP **tidak memerlukan aplikasi driver terpisah**. Aplikasi driver Xentra hanya menjadi kemungkinan module/product lanjutan apabila kebutuhan operasional sudah muncul.
### Future Extension Rule
Jika Xentra di masa depan:
- membuat aplikasi Driver sendiri; atau
- mengintegrasikan layanan delivery pihak ketiga/startup delivery melalui API,
maka cukup menambahkan provider/adapter/module yang sesuai di boundary Delivery/Integration. **Commerce Order logic dan Delivery Core tidak perlu dirombak hanya karena provider pengantaran berubah.**
Contoh arah modular:
```plain text
domains/delivery/
└── providers/
    ├── BranchDriverProvider       ← MVP
    ├── XentraDriverProvider       ← future
    └── ExternalProviderAdapter    ← future
```
Nama struktur file/provider di atas merupakan **implementation direction**, bukan kontrak filename yang sudah dikunci.
### Architectural Principle
> **Delivery Core mengelola delivery lifecycle; Provider/Adapter mengelola siapa yang mengantar.**
Dengan prinsip ini, Xentra dapat memulai dari driver cabang sendiri, lalu berkembang ke aplikasi driver internal atau integrasi provider eksternal tanpa mengubah boundary dasar Commerce → Delivery.
### Reference / Industry Context
Pola ini konsisten dengan praktik POS modern yang memisahkan delivery lifecycle dari model fulfillment/provider. Dokumentasi Toast, misalnya, mendukung delivery dengan driver sendiri maupun layanan delivery eksternal. Konteks tersebut digunakan sebagai referensi arsitektur, bukan sebagai business rule Xentra.
# Development Context — Modular SaaS Architecture & Technical Evolution
## Why this discussion happened
Pertanyaan awalnya: apakah konsep Modular SaaS Platform Architecture yang sedang digunakan Xentra merupakan konsep lama, sekadar buzzword, atau memang fondasi yang masih digunakan SaaS kelas dunia; lalu apakah fondasi tersebut akan tetap relevan 5–10 tahun ke depan ketika data, tenant, branch, transaksi, integrations, dan operational complexity membesar.
Pertanyaan lanjutannya menjadi lebih kritis: apakah keseluruhan Xentra berisiko menjadi “AI slop” — arsitektur yang terlihat enterprise karena mengumpulkan istilah seperti modular, control plane, RBAC, event-driven, tenant isolation, microservices, AI, tetapi complexity-nya tidak dibayar oleh kebutuhan nyata.
Kesimpulan: Xentra saat ini tidak layak disebut AI slop, karena banyak keputusan utamanya berasal dari problem domain F&B yang konkret. Namun cara pengembangannya bisa berubah menjadi AI slop jika setiap architectural pattern diadopsi hanya karena terdengar modern.
## Business-driven evidence
- 1 cart = 1 fulfillment merchant untuk menghindari split fulfillment/payment/delivery complexity.
- Inventory pada level branch karena demand/product mix dapat berbeda antar lokasi.
- Owner policy vs branch request karena governance dan operational flexibility.
- Xentra Company ≠ Client karena internal workforce memiliki kebutuhan platform management yang berbeda dari client workspace.
- Support access harus explicit, scoped, dan auditable.
- Organization → Brand → Branch adalah business hierarchy.
## Architecture conclusion
Istilah yang dianggap paling tepat bukan sekadar modular framework, tetapi Xentra Modular SaaS Platform Architecture.
Prinsipnya: shared Core capabilities, explicit domain boundaries, tenant-aware security, policy-driven authorization, auditability, events/contracts, modular application surfaces, dan evolutionary scaling.
Microservices bukan requirement dan bukan target otomatis. Modularity adalah requirement; decomposition menjadi independently deployed services hanya dilakukan jika workload, team boundary, isolation, reliability, compliance, atau operational need benar-benar membenarkannya.
## 5–10 year durability
Modularity dipandang sebagai prinsip yang durable. Yang kemungkinan berubah adalah database technology, event infrastructure, caching, deployment topology, observability stack, AI/automation layer, service decomposition, dan infrastructure provider.
Business contracts dan security boundaries sebaiknya tetap stabil.
Data growth seharusnya terutama diserap oleh implementation/infrastructure layer, bukan dengan mengubah domain model secara sembarangan. Contoh evolusi: transactional database → partitioning/read models/analytics store ketika workload benar-benar membutuhkannya.
SaaS scale juga dapat berkembang dari shared pool menuju dedicated/silo deployment untuk tenant tertentu tanpa mengganti fundamental platform architecture.
## Anti-AI-Slop principles
### Complexity Must Be Earned
Xentra tidak mengadopsi architectural pattern, technology, abstraction, service, policy, atau infrastructure hanya karena dianggap modern, enterprise-grade, scalable, atau best practice. Setiap complexity harus mempunyai alasan dari business requirement, security, scalability, reliability, operations, atau compliance.
### Evolve, Don't Speculate
Xentra harus mampu berevolusi menuju architecture yang lebih kompleks ketika kebutuhan nyata muncul, tanpa memaksakan complexity sebelum dibutuhkan.
### Remove the Buzzword Test
Untuk setiap konsep baru: masalah apa yang diselesaikan; siapa yang mengalami; apakah masalahnya nyata; mengapa lebih baik dari solusi sederhana; apa trade-off; apa konsekuensi jika tidak dibangun; requirement sekarang atau future capability; dan apakah keputusan reversible.
## Technical assessment of current Xentra-Core
### Language
Current Node.js/JavaScript bukan masalah fundamental. Tidak ada alasan mengganti bahasa hanya demi trend. Namun TypeScript adalah kandidat strong direction medium-term karena domain Xentra semakin contract-heavy: Identity, Tenant, Scope, Permission, Order State, Payment State, Inventory, Events, Audit. Jika dipilih, prefer incremental migration, bukan big-bang rewrite.
### Modular structure
core/ + domains/ merupakan arah architecture yang baik dan sebaiknya dipertahankan sebagai target architecture.
### Legacy/server boundary
Current server/\* dan centralized API routing perlu diawasi agar tidak kembali menjadi pusat business logic. server sebaiknya semakin jelas berperan sebagai HTTP/transport/composition layer.
Target mental model: HTTP → validation → authorization → application/domain capability → repository → persistence.
### Database
SQLite/sql.js dapat berguna untuk development/testing/MVP. Jika target production adalah SaaS dengan concurrency dan data growth signifikan, PostgreSQL adalah arah production yang lebih tepat. Persistence boundary/repository abstraction perlu dibangun sejak dini.
### Reporting
Reporting perlu dijaga sebagai separate read/analytics concern. Future evolution: Transactional DB → events/CDC → read models/analytics store → dashboards. Infrastruktur ini tidak perlu dibangun sebelum workload membutuhkannya.
### Events
Event infrastructure relevan, tetapi event harus diperlakukan sebagai versioned contracts, bukan sekadar async mechanism. Event penting perlu stable identity, timestamp, actor/context, tenant identifiers, resource identifiers, payload, versioning, dan idempotency semantics.
### Identity / Authorization
Authorization tidak boleh berkembang menjadi scattered role checks. Target: Identity → Actor Type → Role → Context → Scope → Permission/Policy → Resource → Action → Audit.
Tenant resolution tidak sama dengan authorization. Host/domain resolution hanya menentukan context; server-side authorization tetap wajib.
### State machines
Explicit state transitions untuk Order, Payment, POS Shift, dan lifecycle lain adalah architectural strength dan perlu dipertahankan. Arbitrary status mutation harus dihindari.
### Idempotency
Karena Xentra memiliki payment, webhook, POS, retry, events, dan integrations, idempotency harus menjadi first-class concern. Repeated delivery/retry harus tidak menghasilkan duplicate financial or inventory effects.
## Change-now vs change-later
Jangan mempertahankan code hanya karena sudah ada. Tetapi jangan rewrite hanya karena teknologi baru terlihat modern.
### Change expensive-to-change decisions early
Tenant/security boundary, authorization model, domain boundaries, API contracts, event contracts, persistence abstraction, idempotency, transaction boundaries, dan type-safety direction sebaiknya diselesaikan sedini mungkin.
### Defer speculative complexity
Microservices, Kubernetes, distributed transactions, large-scale event infrastructure, multi-region, dan service mesh ditunda sampai ada kebutuhan nyata.
## Current technical direction
Bukan “Don't change now”, melainkan “Change expensive-to-change decisions early”.
Dan bukan “Rewrite everything”, melainkan “Harden the foundation; replace components when evidence justifies it”.
## Proposed Architecture Fitness Audit
Audit Xentra-Core terhadap: Language/Type Safety, Framework, Module boundaries, Domain boundaries, Dependency graph, Database/persistence, API boundary, Authentication, Authorization, Tenant isolation, Scope model, State machines, Events, Transactions, Idempotency, Error handling, Validation, Testing, Observability, Logging, Audit, Configuration, Secrets, Deployment, CI/CD.
Setiap area diberi keputusan: KEEP / REFACTOR / REPLACE / DEFER / REMOVE.
Tujuan audit bukan mempertahankan code yang sudah ditulis, tetapi menentukan apakah Xentra-Core saat ini layak menjadi foundation jangka panjang.
## Core development philosophy
> Code is not sacred. Boundaries and contracts are.
> Xentra should optimize for evolvability, not prediction.
> Complexity must be earned.
> Microservices are an implementation option, not the definition of a world-class SaaS.
## Decision status
Proposed / Working Principles — NOT YET LOCKED.
Keputusan final baru dibuat setelah Architecture Fitness Audit dan setelah business-domain decisions yang masih berkembang cukup stabil.
