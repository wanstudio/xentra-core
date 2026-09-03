<!-- SNAPSHOT FROM NOTION — source page: 01-architecture-decision-log; fetched 2026-09-04 -->

## 🧩 UI Component Architecture — Reusable Components, Domain Separation & Page Composition
### Direction
Xentra should use a **reusable component architecture** for repeated UI objects such as Product Card, Upsell Card, Cart Item Card, Order Card, Address Card, and similar objects.
The goal is not to freeze a particular framework, file structure, or rendering mechanism. The goal is to establish a durable architectural direction:
**Component definition is reusable; data is contextual; business logic remains authoritative outside presentation components.**
### Separation of responsibility
The preferred conceptual flow is:
**Database / API → Domain & business services → View Model / presentation data → UI Component → Page composition**
A presentation component should primarily render the data contract it receives. It should not independently decide authoritative:
- tenant / organization / brand / branch ownership,
- fulfillment branch,
- inventory availability,
- authoritative price,
- promotion eligibility,
- payment state,
- order state,
- authorization,
- financial or inventory mutations.
Those decisions belong to the appropriate domain/service boundary.
### Page composition
Pages such as Home, Checkout, Product Detail, Cart, and Order History should compose shared components rather than maintain independent copies of the same card markup and behavior.
Conceptually:
**Checkout → UpsellSection → UpsellCard → Upsell View Model**
and similarly:
**Home → ProductSection → ProductCard**
The exact implementation may evolve.
### Performance principle
“Reusable component” does **not** mean fetching an HTML template over the network for every card.
Templates/components should normally be available as part of the application/runtime bundle or otherwise through an efficient local rendering mechanism. Database/API responses should provide data, not executable presentation templates.
Avoid architectures that repeatedly:
**fetch template → parse → clone DOM → mutate → attach**
for each card or item unless there is a verified reason to do so.
The objective is to reduce duplicated implementation and unnecessary DOM work, not to introduce a template-loading runtime.
### Multi-client / multi-brand direction
Because Xentra is intended to support many clients, brands, branches, and products, shared core components should be designed as stable contracts with controlled client/brand configuration or theming where appropriate.
Prefer:
**Core Component → Client/Brand configuration → Contextual data**
over creating independent copies such as:
**ProductCard-A / ProductCard-B / ProductCard-C**
for every client.
Client-specific variation should be configuration/theming where practical. A genuinely different business behavior should remain a domain/business decision rather than being hidden inside presentation configuration.
### Audit invariant
During code audit, verify that presentation components are not silently becoming business-authority boundaries.
A component that renders a price is not necessarily authorized to determine the price. A component that displays a branch is not necessarily authorized to choose the fulfillment branch. A component that displays inventory availability is not necessarily authoritative for inventory.
Trace authoritative decisions back to their proper domain/service boundary.
### Evolution rule
This is an **architectural direction, not a frozen implementation**.
A future implementation may use a different component/rendering strategy if it demonstrably improves performance, maintainability, accessibility, developer experience, or scalability while preserving the required business, security, tenant-isolation, financial, inventory, and data-integrity invariants.
When changing the mechanism, document:
**Requirement / problem → reason → constraints → alternatives → chosen mechanism → trade-offs → verification**
Do not preserve an implementation merely because it is already present in Git.
### Why this matters for Xentra
Xentra is expected to handle many clients and potentially large product/catalog volumes. Reusable presentation components reduce UI drift and duplicated logic, while separation from domain services prevents checkout and other pages from becoming monolithic business-logic containers.
The architecture should therefore optimize for **clear responsibility boundaries and predictable reuse**, not merely minimum line count or maximum abstraction.
## 🧭 Engineering Decision & Change Philosophy — Implementation Is Conditional
Xentra documentation defines **business intent, constraints, invariants, direction, reasoning, requirements, boundaries, and troubleshooting context**. It does **not** freeze a particular code implementation unless that implementation is itself an explicit locked decision.
### Principle
**Business contract is stable; implementation may evolve.**
Git implementation is evidence of the current system, not automatically a permanent architectural decision. A later implementation may replace the current mechanism when it provides a better result while preserving the required business/security/data invariants.
### Decision hierarchy
1. **Locked business decision / invariant** — must not be violated by implementation.
2. **Requirement / objective** — implementation must satisfy the intended outcome.
3. **Architecture direction / boundary** — preferred structure; may evolve when there is a justified improvement.
4. **Current Git implementation** — current mechanism, not automatically a locked decision.
5. **Troubleshooting / audit finding** — evidence explaining why a change was needed and what must remain protected.
### When implementation changes
A coding agent or developer should not ask only “what code is written now?” It should determine:
- What business outcome is required?
- What invariant must remain true?
- What problem is the current implementation solving?
- Why was the current mechanism chosen?
- What assumptions does it rely on?
- What alternatives were considered?
- Does the proposed change preserve authorization, tenant isolation, financial integrity, inventory integrity, idempotency, and auditability?
- What regression evidence is required?
A better implementation is allowed when it preserves the contract and has a clear technical/business reason. The documentation should record **the reason and resulting decision**, rather than unnecessarily freezing the exact code structure.
### Troubleshooting record
When an issue is found through Git/runtime audit, document the useful causal context:
**Symptom → Reproduction → Scope → Root cause → Constraint/invariant involved → Options considered → Decision → Verification → Remaining uncertainty**
Do not turn a temporary debugging hypothesis into a permanent business rule.
### Audit classification
Audit findings must distinguish:
- **Confirmed vulnerability** — realistic reachable exploit path and meaningful security impact.
- **Logic defect** — implementation can produce an incorrect system outcome.
- **Business conflict** — implementation contradicts a locked business decision.
- **Data-integrity risk** — state/data can become inconsistent or non-atomic.
- **Operational risk** — reliability/deployment/observability concern without demonstrated security exploit.
- **Hardening opportunity** — improvement without a demonstrated defect.
- **False positive / intentional behavior** — behavior is consistent with the documented contract.
Do not label something “vulnerable” merely because another implementation is more conventional or because a field is optional/default. Business requirements determine whether that behavior is actually defective.
### Evidence rule
When implementation and documentation appear different, investigate before changing either one. The difference may represent:
- a legitimate implementation evolution,
- an undocumented decision,
- an incomplete implementation,
- a stale document,
- or an actual conflict.
The correct action is to determine which case applies and update the appropriate source of truth.
### Change record expectation
For meaningful changes, preserve the chain:
**Requirement / Problem → Reasoning → Decision → Implementation → Verification**
The implementation may change later. The reasoning and invariant should remain discoverable so future developers and coding agents can safely make better implementation choices.
### Relationship to Antigravity
These principles are intended to become the basis for Xentra-specific agent skills. Agents should use Notion as the business/engineering contract and Git as the current implementation evidence. Agents must not blindly reproduce existing implementation patterns when a documented invariant or verified technical finding indicates a better solution.
### Modular by Domain
Xentra dibagi berdasarkan domain dengan tanggung jawab yang jelas.
### Xentra-Core
Core adalah fondasi bersama dan tidak menampung logika bisnis vertikal.
### Xentra-Core MVP
MVP baru adalah **Xentra-Core MVP**, bukan Xentra MVP WordPress. Scope awal: Core, Commerce, POS, Inventory.
### Product Ownership
Owner memiliki master product catalog dan menentukan branch yang mendapatkan produk.
### Branch Stock
Branch menginput stok awal karena branch mengetahui kondisi fisik di lapangan.
### Product Deactivation
Branch boleh menonaktifkan produk. Perubahan dicatat pada Business Log agar owner mengetahui branch dan produk yang dinonaktifkan.
### Price Policy
Hanya dua mode: Lock dan Range. Lock membuat harga tidak dapat diedit branch. Range mewajibkan harga berada di antara minimum dan maksimum owner.
### Price History
Override lama tidak dihapus ketika policy menjadi Lock. Histori tetap ada tetapi tidak berlaku. Saat policy dibuka kembali, field harga branch kosong dan branch harus mengisi ulang.
### RBAC
Role dan permission terpusat di Xentra-Core.
### Governance
Branch dapat mengajukan perubahan kebijakan. Owner yang approve/reject dan mengubah kebijakan.
### Reporting / Payment / Delivery / Integration
Keempatnya adalah domain mandiri.
### Core Stability
Core harus kecil dan stabil. Keputusan yang menyangkut Core harus matang sebelum implementasi.
### 🔒 WhatsApp Identity & Scope
WhatsApp identity dipisahkan berdasarkan scope, bukan dijadikan satu identity global Xentra. Customer menggunakan WhatsApp number sebagai unique identity pada customer scope. Branch menggunakan WhatsApp number sebagai unique identity/channel pada branch scope. Owner WhatsApp bukan source of truth untuk business/customer messaging dan tidak boleh dianggap sebagai identity global Xentra.
WhatsApp Branch dapat direferensikan/copy oleh flow yang membutuhkan komunikasi antara Customer dan Branch. Detail provider/integration (mis. Wablas), termasuk mekanisme transport dan konfigurasi teknisnya, tetap berada pada Integration scope dan tidak mengubah identity Customer atau Branch.
Tidak ada keputusan bahwa setiap Branch wajib memiliki WhatsApp number selain kebutuhan bahwa Branch dapat memiliki identity/channel WhatsApp sendiri; aturan kewajiban/optionalitas harus mengikuti requirement bisnis yang sudah/akan dikunci.
Hardcoded owner WhatsApp number pada legacy WhatsApp Runner adalah implementation error dan harus dihilangkan. Jangan menggunakan nomor Owner sebagai fallback trusted identity.
## 🔒 WhatsApp Identity & Scope — Contextual Decision Record
### Context / Case
Audit terhadap legacy `tools/whatsapp-runner` menemukan penggunaan `OWNER_WHATSAPP_NUMBER` dan hardcoded owner number. Pada saat yang sama, kebutuhan WhatsApp Xentra mencakup dua scope yang berbeda: Customer menggunakan WhatsApp sebagai identitas unik customer, sedangkan Branch menggunakan WhatsApp sebagai identitas/channel unik branch untuk komunikasi dengan customer. Jika nomor Owner diperlakukan sebagai identity bisnis global, identity account Owner akan tercampur dengan identity Customer, Branch, dan channel messaging.
### Decision
WhatsApp identity dipisahkan berdasarkan scope. **Customer WhatsApp** menjadi unique identity pada customer scope. **Branch WhatsApp** menjadi unique identity/channel pada branch scope. Customer dan Branch dapat saling mereferensikan identity WhatsApp ketika flow membutuhkan komunikasi.
Provider seperti Wablas diperlakukan sebagai **integration/transport layer**. Provider tidak menjadi source of truth untuk identity Customer atau Branch.
### Owner Clarification
Nomor WhatsApp Owner **bukan** business WhatsApp identity global Xentra dan bukan source of truth untuk komunikasi Customer ↔ Branch. `OWNER_WHATSAPP_NUMBER` pada legacy runner tidak boleh diperlakukan sebagai domain identity Xentra.
Hardcoded owner WhatsApp number adalah implementation/security error dan harus dihilangkan. Tidak boleh ada trusted owner number sebagai fallback di source code.
### Reason
Pemisahan berdasarkan scope menjaga agar identity akun Owner, identity Customer, identity Branch, dan WhatsApp integration tidak tercampur hanya karena semuanya menggunakan nomor WhatsApp. Ini juga memungkinkan komunikasi Customer ↔ Branch berlangsung melalui identity/channel Branch tanpa menjadikan nomor Owner sebagai pusat messaging.
### Scope Boundary / Not Decided
Keputusan ini **belum menetapkan** apakah setiap Branch wajib memiliki nomor WhatsApp sendiri, apakah nomor tersebut mandatory saat Branch dibuat, berapa banyak nomor yang dapat dimiliki sebuah Branch, atau detail konfigurasi Wablas. Hal-hal tersebut belum dikunci oleh requirement yang cukup dan tidak boleh diinventasikan dari keputusan ini.
### Implementation Implication
Legacy `OWNER_WHATSAPP_NUMBER` tetap harus diperbaiki sebagai security issue, tetapi perbaikannya tidak boleh mengubahnya menjadi konsep Owner WhatsApp global Xentra. Implementasi baru harus mengikuti scope identity yang telah diputuskan di atas.
## 🔒 LOCKED — Branch WhatsApp as Official Communication Channel
### Context / Case
Xentra membutuhkan pemisahan yang jelas antara identity Owner dan channel komunikasi bisnis. Dalam model yang dipilih, Customer memiliki WhatsApp identity pada customer scope, sementara komunikasi bisnis dan operasional harus memiliki titik kontak yang jelas pada scope Branch. Karena aktivitas seperti komunikasi Customer, notifikasi/order, customer service, hotline, dan kebutuhan operasional berasal dari branch, penggunaan nomor WhatsApp Owner sebagai channel bersama akan mencampur scope dan membuat ownership komunikasi tidak jelas.
### Decision
**Setiap Branch memiliki satu WhatsApp Business identity/channel yang menjadi official WhatsApp communication channel Branch.** Nomor WhatsApp tersebut digunakan sebagai channel komunikasi Branch dengan Customer dan sebagai channel untuk kebutuhan messaging/integration Branch, termasuk Wablas, order/customer communication, hotline, dan kebutuhan operasional lain yang menggunakan WhatsApp.
WhatsApp Branch tetap berada pada **Branch scope**. Nomor Owner tidak digunakan sebagai business WhatsApp channel Branch dan tidak menjadi shared WhatsApp identity untuk seluruh Brand/Xentra.
### Reason
Branch adalah unit operasional yang berinteraksi langsung dengan Customer. Menempatkan WhatsApp pada Branch scope membuat identity, komunikasi, dan ownership channel konsisten: Customer berkomunikasi dengan Branch yang menangani kebutuhan mereka, sementara provider seperti Wablas hanya menjadi transport/integration layer di belakang channel tersebut.
### Implication
- Setiap Branch harus memiliki WhatsApp Business identity/channel yang dapat digunakan sebagai official communication channel Branch.
- Integrasi Wablas menggunakan channel WhatsApp Branch tersebut, bukan nomor Owner.
- Customer communication, order-related messaging, hotline, dan operational messaging yang ditujukan kepada Branch menggunakan channel Branch.
- Identity WhatsApp Customer dan identity WhatsApp Branch tetap merupakan dua scope yang berbeda dan dapat saling direferensikan.
- Owner tetap merupakan User/Owner identity Xentra dan tidak berubah menjadi WhatsApp business identity hanya karena memiliki akses ke Branch.
### Scope Boundary
Keputusan ini mengunci **ownership dan scope** WhatsApp Business channel. Detail teknis provider, credential Wablas, onboarding/pairing, mekanisme failover, jumlah akun/provider, dan detail UI konfigurasi belum didefinisikan oleh keputusan ini dan tidak boleh diinventasikan tanpa requirement tambahan.
### Legacy Implementation Note
Hardcoded `OWNER_WHATSAPP_NUMBER` pada legacy WhatsApp Runner tidak sesuai dengan keputusan ini sebagai business communication identity. Hardcode tersebut tetap merupakan implementation/security issue yang harus dihilangkan; perbaikannya tidak boleh mengubah nomor Owner menjadi channel Branch secara hardcoded.
## 🔒 LOCKED — Xentra Wablas Infrastructure & Branch WhatsApp
### Context / Case
Xentra adalah platform subscription yang mengelola WhatsApp sebagai bagian dari infrastructure-nya. Karena WhatsApp digunakan pada scope Branch, kebutuhan utamanya bukan membuat setiap customer/Owner mengelola akun Wablas sendiri, melainkan menyediakan channel WhatsApp Branch yang dapat dikelola oleh Xentra. Model multi-account akan menambah kompleksitas pengelolaan provider tanpa memberikan manfaat yang diperlukan untuk scope bisnis ini. Yang dibutuhkan adalah pemisahan identity berdasarkan Branch dan mapping provider yang jelas.
Owner saat membuat Branch memasukkan nomor WhatsApp Business yang digunakan oleh Branch. Nomor tersebut menjadi identity/channel WhatsApp Branch untuk komunikasi dengan Customer dan kebutuhan operasional Branch. Xentra kemudian mengelola hubungan channel Branch tersebut dengan infrastructure Wablas.
### Decision
**Xentra menggunakan satu akun Wablas sebagai infrastructure account global untuk seluruh customer subscription Xentra.** Customer/Owner tidak membuat atau mengelola akun Wablas sendiri dan tidak memasukkan API key Wablas sebagai konfigurasi customer.
**Setiap Branch memiliki satu WhatsApp Business channel/device** yang direpresentasikan di infrastructure Wablas. Naming device/channel harus menggunakan identifier yang jelas agar mapping Brand/Branch mudah dikelola secara operasional, misalnya pola `Brand_Branch` atau identifier setara yang tidak ambigu.
Owner mengonfigurasi **nomor WhatsApp Branch melalui Dashboard Xentra**. Nomor tersebut bukan nilai hardcoded di source code. Xentra menggunakan konfigurasi Branch tersebut untuk pengelolaan integration dengan Wablas.
### Identity & Scope
- Customer WhatsApp → unique identity pada customer scope.
- Branch WhatsApp → unique business communication channel pada branch scope.
- Wablas Device → provider-side representation of the Branch WhatsApp channel.
- Wablas Account → infrastructure ownership milik Xentra.
- Owner/User → identity akun Xentra, bukan business WhatsApp channel.
### Reason
Satu Wablas account cukup karena Wablas merupakan infrastructure service yang dioperasikan Xentra, sedangkan isolasi dan pemetaan bisnis dilakukan melalui Branch/device mapping. Dengan demikian Xentra dapat mengelola banyak Branch dalam satu infrastructure tanpa membuat setiap customer harus memahami atau mengelola provider WhatsApp sendiri.
### Operational Implication
Flow konfigurasi yang dikunci adalah:
`Owner → Dashboard Xentra → Create/Configure Branch → input WhatsApp Branch → Xentra mengelola mapping/provisioning channel pada Wablas → Branch WhatsApp digunakan untuk communication.`
Detail teknis provisioning/pairing dapat mengikuti kemampuan dan API Wablas yang digunakan Xentra, tetapi tidak boleh mengubah ownership model: **Wablas account tetap milik Xentra dan channel tetap scoped ke Branch.**
### Configuration Rule
Tidak ada credential, nomor WhatsApp Branch, device identifier spesifik, atau konfigurasi tenant/Branch yang boleh di-hardcode di source code. Nilai operasional harus berasal dari Dashboard/configuration layer atau secret management server-side sesuai jenis datanya.
API credential Wablas adalah **Xentra infrastructure secret** dan hanya boleh tersedia pada server/runtime yang membutuhkan. Credential tersebut bukan data yang diinput atau dikelola oleh Owner subscription.
### Scope Boundary
Keputusan ini tidak menetapkan detail UI, endpoint API Wablas tertentu, format internal database, mekanisme pairing/QR, billing provider, atau failover. Detail tersebut adalah implementation concern dan harus mengikuti capability provider tanpa mengubah keputusan ownership dan scope di atas.
## LOCKED DECISION — Branch WhatsApp Number Is Mandatory
### Context / Case
Xentra membedakan scope WhatsApp antara Customer dan Branch. WhatsApp Customer adalah identity pada customer scope, sedangkan WhatsApp Branch adalah business communication channel milik Branch. Karena channel operasional Branch harus jelas sejak awal, Xentra tidak menggunakan nomor Owner sebagai fallback dan tidak menyediakan nomor default/hardcoded.
### Locked Decision
Saat Owner mendaftarkan/membuat Branch di Xentra, **nomor WhatsApp Branch wajib diisi**. Jika nomor WhatsApp Branch tidak diberikan, proses pendaftaran/pembuatan Branch tidak dapat diselesaikan.
Nomor yang dimasukkan tersebut menjadi WhatsApp Business channel milik Branch dan menjadi sumber configuration untuk integrasi WhatsApp/Wablas pada scope Branch.
### Operational Model
- Customer memiliki WhatsApp identity pada customer scope.
- Setiap Branch memiliki WhatsApp Business channel sendiri.
- Branch WhatsApp number wajib diberikan melalui Dashboard saat Branch dibuat.
- Tidak ada fallback ke WhatsApp Owner.
- Tidak ada nomor WhatsApp default atau hardcoded di source code.
- Xentra menggunakan satu akun Wablas sebagai infrastructure account.
- Nomor Branch dipetakan ke Wablas Device yang sesuai.
- Wablas credential tetap menjadi Xentra infrastructure secret dan tidak berasal dari input Owner.
### Consequence for Implementation
`OWNER_WHATSAPP_NUMBER` tidak boleh digunakan sebagai fallback untuk menentukan WhatsApp Business channel Branch. Jika Branch belum memiliki WhatsApp configuration, sistem tidak boleh menggantinya dengan nomor Owner atau nomor default.
Validasi wajib berada pada flow pembuatan Branch sehingga Branch tidak dapat dibuat tanpa nomor WhatsApp Branch.
### Scope Clarification
Keputusan ini mengatur **configuration dan identity scope**, bukan mengubah mekanisme transport Wablas. Wablas tetap menjadi integration layer yang digunakan Xentra untuk mengirim/ menerima komunikasi dari device WhatsApp Branch.
### Rationale
Dengan mewajibkan nomor WhatsApp pada saat Branch dibuat, setiap Branch memiliki channel komunikasi yang eksplisit dan dapat dipetakan secara deterministik. Ini menghilangkan ambiguity serta menghilangkan kebutuhan terhadap hardcoded Owner WhatsApp atau fallback number.
## 🔒 AUDIT DECISION — Customer WhatsApp Identity ≠ Authentication Credential
### Context / Finding
Audit terbaru terhadap Xentra-Core menemukan bahwa beberapa customer-facing address endpoint menerima phone dari query/header/body lalu menggunakan nomor tersebut langsung untuk membaca atau memutasi customer_addresses. Ini bertentangan dengan prinsip security bahwa WhatsApp number adalah unique customer identity, bukan bukti bahwa requestor adalah pemilik identity tersebut.
### Decision
WhatsApp number tetap menjadi unique identity pada customer scope, tetapi tidak boleh menjadi bearer credential. Resource customer harus diakses berdasarkan authenticated customer session/identity yang diverifikasi, bukan berdasarkan nomor telepon yang dikirim bebas oleh client.
Flow yang diharapkan:
Customer WhatsApp number → OTP verification → authenticated customer session/token → customer_id → authorized customer resources
### Authorization Rule
- Endpoint customer-facing tidak boleh menganggap ?phone=, x-customer-phone, atau [body.phone](http://body.phone) sebagai authentication.
- Server harus memperoleh customer identity dari authenticated session/token setelah verifikasi OTP.
- Address read/write/delete harus scoped ke authenticated customer_id dan brand_id.
- Mengetahui nomor WhatsApp customer lain tidak boleh cukup untuk membaca, menambah, mengubah, atau menghapus alamatnya.
- Customer identity tetap scoped; tidak menjadi identity global Xentra.
### Security Rationale
Alamat customer, detail alamat, catatan, latitude, dan longitude merupakan data sensitif secara operasional. Authorization berdasarkan phone saja memungkinkan identity spoofing, unauthorized read, dan unauthorized mutation. Ini dikategorikan sebagai identity/authorization boundary issue, bukan sekadar hardening kosmetik.
### Implementation Boundary
OTP/session mechanism, token format, expiry, refresh behavior, dan provider transport adalah implementation details yang belum dikunci di keputusan ini. Namun invariant-nya sudah dikunci: client-supplied phone number tidak boleh menjadi credential.
## 🔒 AUDIT DECISION — Customer Order Response Must Be Allowlisted
### Context / Finding
Audit juga menemukan risiko overexposure ketika customer-facing order endpoint mengembalikan record payment/order secara terlalu luas. Internal payment records tidak boleh otomatis menjadi API response hanya karena terkait dengan order customer.
### Decision
Customer-facing order responses menggunakan explicit allowlist, bukan SELECT \* atau serialization seluruh payment record.
Customer hanya menerima data yang diperlukan untuk customer experience, misalnya order identifier/status, items, totals, payment method/status yang relevan, serta delivery information yang memang diperlukan.
Internal fields seperti raw webhook payload, provider credentials/tokens, internal reconciliation metadata, atau field financial/integration yang tidak diperlukan customer tidak boleh keluar melalui customer-facing API.
### Security Invariant
Internal database record ≠ public API representation.
Setiap boundary customer harus memiliki response DTO/allowlist yang eksplisit.
## 🔒 AUDIT DECISION — Financial State Must Not Be Mutated Through Generic Operational State
### Context / Finding
Audit sebelumnya menemukan conflict antara cancellation/refund dan payment settlement. Keputusan implementasi sekarang harus mempertahankan pemisahan domain:
- Order status = operational/fulfillment state.
- Payment status = financial state.
- Refund = financial operation tersendiri.
- Inventory movement = inventory ledger operation tersendiri.
### Decision
cancelled, settled, dan refunded tidak boleh diperlakukan sebagai interchangeable status. Operational cancellation pada paid order harus memiliki financial resolution yang eksplisit sesuai business rule. Refund hanya melalui dedicated refund workflow, bukan generic order-status endpoint.
### Required Invariant
Tidak boleh ada workflow yang membuat sistem menyatakan refund hanya dengan mengubah orders.status. Refund harus memiliki financial record/operation dan protection terhadap duplicate execution. Inventory reversal, bila diwajibkan business rule, harus menjadi mutation yang terkoordinasi dan idempotent.
## 🔒 AUDIT DECISION — Cash Ledger Atomicity
### Context / Finding
Audit menemukan risiko orphan pos_cash_movements jika movement diinsert tetapi shift aggregate gagal diperbarui akibat race atau database error.
### Decision
Cash movement dan perubahan aggregate shift harus berada dalam satu database transaction. Jika salah satu mutation gagal, seluruh financial mutation harus rollback.
### Required Invariant
committed cash movement ↔ committed shift aggregate.
Tidak boleh ada API yang mengembalikan error sementara cash movement telah tersimpan tanpa aggregate yang sesuai.
### Audit Status
Temuan atomicity tersebut telah diperbaiki pada Git terbaru dan dinyatakan CLOSED, dengan invariant transaction boundary tetap wajib dipertahankan pada perubahan berikutnya.
