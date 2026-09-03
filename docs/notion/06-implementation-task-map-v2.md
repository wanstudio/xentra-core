<!-- SNAPSHOT FROM NOTION — source page: 06-implementation-task-map-v2; fetched 2026-09-04 -->

# 06 — Implementation Task Map v2 — Prompt Ready
Task map yang mengerucut dari milestone → sub-milestone → task → sub-task. Digunakan sebagai dasar prompting implementasi. Hanya detail yang didukung requirement/locked decision yang boleh dianggap final.
## Phase 1 — Understand
- [ ] 1.1 Petakan system flow end-to-end.
- [ ] 1.2 Petakan business flow end-to-end.
- [ ] 1.3 Identifikasi entity utama per domain.
- [ ] 1.4 Identifikasi source of truth setiap entity.
- [ ] 1.5 Identifikasi dependency dan boundary antar-domain.
- [ ] 1.6 Catat gap yang masih Open Decision.
# Phase 2 — Xentra-Core
## A — Xentra Core Event Infrastructure
### A1 — Event Contract
- [ ] A1.1 Definisikan struktur contract event.
- [ ] A1.2 Definisikan field dasar wajib.
- [ ] A1.3 Definisikan metadata identifikasi/korelasi.
- [ ] A1.4 Definisikan versioning rule.
- [ ] A1.5 Definisikan validation rule.
- [ ] A1.6 Dokumentasikan contract.
- [ ] A1.7 Automated test contract.
### A2 — Event Publisher
- [ ] A2.1 Definisikan interface publisher.
- [ ] A2.2 Hubungkan publisher dengan contract.
- [ ] A2.3 Validasi event sebelum publish.
- [ ] A2.4 Tangani failure publish.
- [ ] A2.5 Automated test.
### A3 — Event Bus
- [ ] A3.1 Definisikan boundary event bus di Core.
- [ ] A3.2 Implementasikan penerimaan event.
- [ ] A3.3 Implementasikan distribusi event.
- [ ] A3.4 Hindari direct coupling domain → subscriber.
- [ ] A3.5 Tangani failure path.
- [ ] A3.6 Automated test.
### A4 — Subscriber / Listener
- [ ] A4.1 Definisikan interface subscriber.
- [ ] A4.2 Definisikan registration mechanism.
- [ ] A4.3 Validasi event yang diterima.
- [ ] A4.4 Definisikan lifecycle handler.
- [ ] A4.5 Automated test.
### A5 — Event Dispatcher
- [ ] A5.1 Definisikan routing berdasarkan event contract.
- [ ] A5.2 Implementasikan dispatch ke subscriber sesuai event.
- [ ] A5.3 Definisikan behavior saat subscriber gagal.
- [ ] A5.4 Test dispatch dan failure path.
### A6 — Event Registry
- [ ] A6.1 Definisikan registry event.
- [ ] A6.2 Registrasikan event type/version.
- [ ] A6.3 Validasi event terhadap registry.
- [ ] A6.4 Automated test.
### A7 — Event Context & Metadata
- [ ] A7.1 Definisikan event context.
- [ ] A7.2 Implementasikan correlation metadata.
- [ ] A7.3 Implementasikan causation metadata.
- [ ] A7.4 Pastikan producer dan timestamp konsisten.
- [ ] A7.5 Test context propagation.
### A8 — Event Logging / Audit Foundation
- [ ] A8.1 Definisikan kebutuhan logging infrastructure event.
- [ ] A8.2 Implementasikan pencatatan event/infrastructure activity.
- [ ] A8.3 Pastikan log dapat ditelusuri dengan context.
- [ ] A8.4 Pisahkan infrastructure logging dari business reporting.
- [ ] A8.5 Automated test logging.
### A9 — Unit Test & Reference Event
- [ ] A9.1 Buat reference event non-business.
- [ ] A9.2 Test publish → bus → dispatch → subscriber.
- [ ] A9.3 Test contract validation.
- [ ] A9.4 Test failure path utama.
- [ ] A9.5 Verifikasi tidak ada business logic vertikal di Core.
## B — Identity & RBAC
### B1 — Identity Model
- [ ] B1.1 Definisikan identity boundary.
- [ ] B1.2 Definisikan lifecycle identity.
- [ ] B1.3 Implementasikan model setelah requirement dikunci.
- [ ] B1.4 Test identity.
### B2 — Organization Model
- [ ] B2.1 Definisikan owner/brand/branch relationship.
- [ ] B2.2 Definisikan organization boundary.
- [ ] B2.3 Implementasikan relationship setelah model dikunci.
- [ ] B2.4 Test relationship.
### B3 — Role Model
- [ ] B3.1 Definisikan role model.
- [ ] B3.2 Definisikan role assignment.
- [ ] B3.3 Implementasikan role assignment.
- [ ] B3.4 Test role.
### B4 — Permission Model
- [ ] B4.1 Definisikan permission model.
- [ ] B4.2 Mapping role → permission.
- [ ] B4.3 Implementasikan permission check.
- [ ] B4.4 Test permission.
### B5 — Authorization Service
- [ ] B5.1 Definisikan authorization interface.
- [ ] B5.2 Implementasikan authorization check.
- [ ] B5.3 Test authorization.
### B6 — Role Boundary Enforcement
- [ ] B6.1 Terapkan permission boundary.
- [ ] B6.2 Verifikasi cashier hanya mendapat kewenangan yang ditetapkan.
- [ ] B6.3 Test forbidden access.
### B7 — Automated Tests
- [ ] B7.1 Test identity.
- [ ] B7.2 Test organization.
- [ ] B7.3 Test role.
- [ ] B7.4 Test permission.
- [ ] B7.5 Test authorization.
## C — Configuration & Feature Control
- [ ] C1.1 Configuration Model.
- [ ] C1.2 Configuration Scope.
- [ ] C1.3 Validation & Defaults.
- [ ] C1.4 Configuration Access.
- [ ] C1.5 Feature Control Foundation.
- [ ] C1.6 Automated Tests.
## D — Integration Foundation
- [ ] D1.1 Integration Contract.
- [ ] D1.2 Adapter Boundary.
- [ ] D1.3 External Request Handling.
- [ ] D1.4 Error & Failure Handling.
- [ ] D1.5 Credential / Secret Boundary.
- [ ] D1.6 Hardware Integration Boundary.
- [ ] D1.7 Automated Tests.
## E — Audit & Activity
- [ ] E1.1 Audit Event Model.
- [ ] E1.2 Actor & Target Context.
- [ ] E1.3 Audit Writer.
- [ ] E1.4 Audit Query Foundation.
- [ ] E1.5 Retention / Data Boundary.
- [ ] E1.6 Automated Tests.
## F — Domain Registry
- [ ] F1.1 Domain Identity.
- [ ] F1.2 Registration Model.
- [ ] F1.3 Capability Metadata.
- [ ] F1.4 Domain Lifecycle.
- [ ] F1.5 Registry Validation.
- [ ] F1.6 Automated Tests.
## G — Core Stabilization & Readiness
- [ ] G1.1 Architecture Contract Review.
- [ ] G1.2 Cross-module Integration Tests.
- [ ] G1.3 Failure-path & Recovery Tests.
- [ ] G1.4 Security & Permission Review.
- [ ] G1.5 Observability Baseline.
- [ ] G1.6 Documentation Review.
- [ ] G1.7 Core MVP Readiness Gate.
# Phase 3 — Commerce
- [ ] Product catalog consumption.
- [ ] Branch product assignment.
- [ ] Price Lock.
- [ ] Price Range.
- [ ] Customer order flow.
# Phase 4 — POS
- [ ] Transaction flow.
- [ ] Role-limited cashier UI.
- [ ] Payment integration contract.
- [ ] Hardware integration contract.
# Phase 5 — Inventory
- [ ] Stock initialization by branch.
- [ ] Stock movement.
- [ ] Product/material relationship.
- [ ] Inventory transfer flow.
# Phase 6 — Supporting Domains
- [ ] Payment domain.
- [ ] Delivery domain.
- [ ] Integration domain.
- [ ] Reporting domain.
# Phase 7 — Customer UI
- [ ] Build customer UI from stabilized business rules and data contracts.
## Task Rules
- Task harus traceable ke requirement/locked decision.
- Open Decision tidak boleh diasumsikan final.
- Setiap task harus punya output yang dapat diverifikasi.
- Task dapat menjadi input langsung untuk implementation prompt.
- Jangan mencampur Xentra MVP WordPress dengan Xentra-Core.
## LOCKED DECISION — Manager Operational User Management
**Context keputusan:** Dalam operasi multi-branch, Manager membutuhkan kemampuan untuk menangani perubahan staff operasional tanpa selalu bergantung kepada Owner. Namun, memberikan Manager kewenangan penuh atas User/Role/Permission menciptakan risiko privilege escalation dan akses lintas branch. Karena itu, kewenangan user management dipisahkan dari kewenangan authorization policy.
### Decision
**Manager BOLEH mengelola User/Staff operasional dalam Branch yang menjadi scope-nya.**
Kewenangan tersebut bersifat **scoped operational user management**, bukan kewenangan penuh terhadap Identity/RBAC.
Manager dapat melakukan aktivitas operasional seperti melihat, menambah, mengubah, dan menonaktifkan staff yang berada dalam scope Branch-nya, sesuai permission yang diberikan Core.
Manager **TIDAK BOLEH**:
- mengelola Owner;
- menaikkan authority dirinya sendiri;
- membuat atau memberikan authority yang setara/lebih tinggi dari kewenangannya;
- mengubah global Role/Permission policy;
- memberikan permission yang melampaui authority yang dimilikinya;
- mengubah scope user sehingga memperoleh akses ke Branch di luar kewenangannya.
### Security Boundary
Scope Branch adalah **security boundary**, bukan sekadar filter UI.
Request dari Manager untuk memodifikasi User/Staff di Branch di luar scope-nya harus ditolak oleh authorization layer/Core, meskipun request tersebut dikirim langsung melalui API.
### Permission Decomposition
Jangan merepresentasikan seluruh kewenangan sebagai satu permission `MANAGE_USERS` yang terlalu luas. Authorization harus memungkinkan pemisahan capability seperti:
- `USER_VIEW`
- `USER_CREATE`
- `USER_UPDATE`
- `USER_DEACTIVATE`
- `USER_ASSIGN_BRANCH`
- `ROLE_ASSIGN`
- `PERMISSION_MANAGE`
Manager hanya menerima subset capability yang diperlukan untuk operational staff management. `ROLE_MANAGE`, `PERMISSION_MANAGE`, `AUTHORITY_CHANGE`, dan `OWNER_MANAGE` tidak otomatis termasuk dalam operational user management.
### UX Consequence
Manager hanya perlu melihat dan mengelola staff yang berada dalam scope Branch-nya. Data Owner, Branch lain, dan global authorization policy tidak perlu ditampilkan kepada Manager jika tidak berada dalam authority-nya.
### Threats addressed
Keputusan ini secara khusus mencegah:
- privilege escalation;
- pembuatan Manager/authority palsu;
- pemberian permission kepada diri sendiri;
- akses lintas Branch;
- perubahan authorization policy oleh Manager;
- Owner takeover melalui user-management flow.
### Status
**LOCKED** — berlaku sebagai keputusan Identity/RBAC Xentra dan harus dipertahankan selama reconstruction.
**Scope:** Manager → operational User/Staff management pada assigned Branch. Ini tidak mengunci daftar permission final secara keseluruhan; permission matrix lengkap tetap harus ditentukan pada keputusan berikutnya.
## LOCKED DECISION — Product Catalog Authority
**Context keputusan:** Product bukan sekadar data operasional Branch. Product berkaitan dengan **Product Catalog** dan **Supply Chain**, sehingga perubahan pada Product dapat berdampak lintas Branch dan tidak tepat diberikan kepada Manager Branch sebagai kewenangan lokal. Model dual-approval/dua arah antara Manager dan Owner juga sengaja dihindari karena menambah titik koordinasi dan risiko authorization slip.
### Decision
**Manager TIDAK BOLEH mengelola Product Catalog.**
Product Catalog menjadi kewenangan pada level Owner/Brand sesuai architecture dan Product Ownership yang sudah dikunci. Manager Branch hanya menggunakan/menjalankan Product yang tersedia untuk Branch dalam scope-nya dan tidak menjadi authority untuk mengubah master Product.
### Boundary
- Manager tidak membuat Product master baru.
- Manager tidak mengubah Product master.
- Manager tidak menentukan perubahan Product Catalog.
- Manager tidak mengambil alih authority Product Ownership.
- Product yang tersedia pada Branch tetap mengikuti mekanisme Product/Branch yang sudah ditentukan oleh Core.
### Reason
Keputusan ini menjaga Product Catalog sebagai sumber data yang konsisten untuk kebutuhan lintas Branch dan Supply Chain. Perubahan lokal oleh Manager berpotensi menghasilkan divergence antar Branch dan memperumit kontrol ownership, pricing, stock, serta supply-chain dependency.
### UX Consequence
Manager tidak diberi menu/flow untuk mengelola master Product. UX Manager berfokus pada operasional Branch menggunakan catalog yang sudah ditetapkan oleh authority Product.
### Security / Governance Consequence
Authorization untuk Product Catalog tidak boleh bergantung pada persetujuan dua arah Manager ↔ Owner pada setiap perubahan. Authority ditentukan oleh role/scope yang jelas sehingga tidak ada jalur privilege yang ambigu.
### Status
**LOCKED** — berlaku selama reconstruction dan harus dipertahankan.
**Catatan:** Keputusan ini mengunci **authority Manager terhadap Product Catalog**. Detail siapa tepatnya yang melakukan setiap jenis perubahan Product/Price tetap mengikuti keputusan Product Ownership, Price Policy, dan permission matrix yang sudah/akan dikunci secara terpisah.
## LOCKED DECISION — Branch Manager Refund Authority
**Context keputusan:** Refund merupakan bagian dari keputusan operasional Branch dan tidak perlu dibuat menjadi workflow approval Owner untuk setiap transaksi. Owner tidak menginginkan proses refund yang berlapis dan berpotensi membuat operasi kasir/branch menjadi rumit. Pada saat yang sama, refund tetap memiliki financial trace yang dapat diaudit karena selalu berkaitan dengan transaksi asal dan dapat ditelusuri melalui business log, system log, serta reporting.
Dalam model Xentra, accountability tidak dibangun dengan approval manual pada setiap refund, melainkan melalui kombinasi **transaction traceability + Branch scope + business audit trail + system audit trail**. Dengan demikian Manager tetap bertanggung jawab atas keputusan refund yang dibuatnya, sementara sistem memiliki bukti yang cukup untuk melakukan penelusuran dan audit.
### Decision
**Manager Branch BOLEH melakukan refund untuk transaksi yang berada dalam Branch scope-nya.**
Refund tidak memerlukan approval Owner secara default.
### Authorization Boundary
Manager hanya dapat melakukan refund terhadap transaksi pada Branch yang menjadi scope kewenangannya.
Contoh:
- Manager Branch A → boleh refund transaksi Branch A.
- Manager Branch A → tidak boleh refund transaksi Branch B.
Branch scope harus ditegakkan oleh Core/authorization layer dan tidak boleh hanya menjadi pembatasan UI.
### Audit & Traceability Requirement
Setiap refund harus tetap dapat ditelusuri melalui:
- transaksi asal;
- money trail transaksi → refund;
- business log aktivitas refund;
- system log yang mencatat actor dan tindakan;
- reporting/audit trail.
Keputusan ini berarti **auditability menjadi mekanisme accountability**, bukan approval Owner pada setiap refund.
### UX Consequence
Manager dapat menyelesaikan refund secara langsung dalam operasional Branch tanpa menunggu Owner. Tidak diperlukan approval dua arah Manager ↔ Owner untuk setiap refund.
### Security Consequence
Kewenangan refund Manager tidak berarti akses financial global. Authorization tetap dibatasi oleh identity, role, permission/capability, dan terutama Branch scope. Refund di luar scope harus ditolak oleh Core.
### Status
**LOCKED** — berlaku selama reconstruction dan harus dipertahankan.
**Catatan:** Keputusan ini mengunci authority Manager terhadap refund transaksi Branch. Detail mekanisme pencatatan audit/log tetap harus mempertahankan business log, system log, dan reporting yang menjadi bagian dari architecture Xentra; tidak membuat approval workflow baru.
## LOCKED DECISION — Branch Manager Void / Cancel Transaction Authority
**Context keputusan:** Void/cancel transaksi merupakan keputusan operasional sehari-hari di Branch. Owner tidak perlu dilibatkan untuk menangani pembatalan transaksi yang bersifat rutin karena hal tersebut akan menambah beban operasional tanpa memberikan manfaat yang sebanding. Accountability tetap dijaga melalui keterkaitan transaksi dan audit trail yang sudah menjadi bagian dari architecture Xentra.
### Decision
**Manager Branch BOLEH melakukan void/cancel transaksi secara langsung untuk transaksi dalam Branch scope-nya, tanpa approval Owner.**
### Authorization Boundary
Manager hanya dapat melakukan void/cancel terhadap transaksi pada Branch yang menjadi scope kewenangannya. Manager tidak mendapatkan kewenangan lintas Branch hanya karena memiliki authority sebagai Manager.
### Audit / Traceability
Setiap void/cancel harus tetap dapat ditelusuri terhadap transaksi asal dan dicatat melalui business log serta system log agar aktivitas dapat diperiksa melalui reporting/audit trail.
### UX Consequence
Manager dapat menyelesaikan pembatalan transaksi operasional secara langsung tanpa menunggu Owner. Tidak diperlukan approval Owner untuk void/cancel rutin.
### Security Consequence
Kemudahan operasional tidak menghilangkan authorization boundary. Core tetap harus memvalidasi actor dan Branch scope sebelum mengizinkan void/cancel. Audit trail menjadi mekanisme accountability atas tindakan Manager.
### Status
**LOCKED** — berlaku selama reconstruction dan harus dipertahankan.
**Catatan:** Keputusan ini mengunci authority Manager terhadap void/cancel transaksi Branch. Tidak membuat approval workflow tambahan kecuali keputusan lain yang sudah/akan dikunci secara eksplisit mengharuskannya.
## LOCKED DECISION — Branch Manager Warehouse / Branch Stock Authority
**Context keputusan:** Struktur fisik inventory dapat berbeda-beda di lapangan. Satu Branch dapat memiliki satu gudang, beberapa gudang, atau inventory dapat berada pada lokasi/gudang yang memiliki hubungan dengan beberapa Branch. Jumlah dan pemetaan gudang adalah konfigurasi deployment/operasional, bukan alasan untuk mengubah model permission.
Karena itu, keputusan authorization harus berada pada level **authority terhadap inventory dalam scope**, bukan mengunci asumsi bahwa setiap Branch wajib memiliki tepat satu gudang.
### Decision
**Branch Manager BOLEH mengelola stock/gudang yang berada dalam scope Branch-nya.**
Permission tidak mengunci jumlah gudang maupun topology inventory.
Contoh kondisi lapangan yang tetap didukung:
- 1 Branch → 1 gudang;
- 1 Branch → beberapa gudang;
- 1 gudang → melayani beberapa Branch;
- banyak lokasi/gudang → melayani banyak Branch.
Yang menentukan akses adalah **scope dan assignment inventory/location**, bukan jumlah fisik gudang.
### Permission Boundary
Branch Manager memiliki kewenangan operasional untuk mengelola inventory/stock pada warehouse/location yang berada dalam scope yang diberikan kepadanya.
Manager tidak otomatis mendapatkan akses hanya karena mengetahui atau berada pada Branch tertentu apabila warehouse/location tersebut tidak termasuk dalam scope authorization-nya.
### UX / Operational Consequence
Dashboard Manager harus menampilkan warehouse/location yang memang berada dalam scope kewenangannya. Sistem tidak boleh mengasumsikan `1 Branch = 1 Warehouse` sebagai business rule.
### Architecture Consequence
Jumlah gudang, lokasi gudang, hubungan warehouse ↔ Branch, dan konfigurasi inventory distribution merupakan **configuration/topology**, bukan permission decision. Reconstruction tidak boleh hardcode asumsi jumlah atau struktur gudang.
### Open Boundary
Detail purchasing, inventory transfer antar warehouse/Branch, dan mekanisme topology inventory tetap mengikuti keputusan terpisah karena masih tercatat sebagai Open Decision. Keputusan ini hanya mengunci **authority Manager untuk mengelola inventory/stock dalam scope-nya**, bukan mekanisme transfer atau purchasing.
### Status
**LOCKED** — berlaku selama reconstruction dan harus dipertahankan.
## LOCKED DECISION — Branch Manager Delivery Operational Authority
**Context keputusan:** Manager Branch memang berfungsi sebagai operational authority untuk menjalankan aktivitas harian Branch. Owner tidak seharusnya menjadi operator daily task di setiap Branch. Karena itu, aktivitas Delivery yang merupakan bagian dari operasional order Branch harus dapat ditangani oleh Manager tanpa bergantung pada Owner.
### Decision
**Branch Manager BOLEH mengelola operasional Delivery untuk transaksi/order dalam Branch scope-nya.**
Ini mencakup kebutuhan operasional harian seperti melihat status delivery, menangani delivery order, dan melakukan tindakan operasional yang memang menjadi kewenangan Branch.
### Boundary
Kewenangan Manager tetap dibatasi oleh Branch scope. Manager tidak memperoleh authority Delivery untuk Branch lain hanya karena memiliki role Manager.
Keputusan ini mengatur **operational authority**, bukan keputusan mengenai provider Delivery, integrasi eksternal, pricing provider, atau topology Delivery. Hal-hal tersebut tetap mengikuti domain/integration policy yang terpisah.
### UX Consequence
Manager Branch harus dapat menyelesaikan daily delivery operations dari Branch-nya tanpa eskalasi ke Owner untuk aktivitas rutin.
### Security Consequence
Core tetap melakukan authorization berdasarkan identity/role/scope. Manager hanya dapat melakukan tindakan Delivery terhadap order yang berada dalam scope-nya.
### Status
**LOCKED** — berlaku selama reconstruction dan harus dipertahankan.
## LOCKED DECISION — Brand Manager Operational Authority
**Context keputusan:** Hirarki Xentra menempatkan Brand Manager pada level Brand, di atas Branch Manager. Karena fungsi Brand Manager adalah mengelola Brand, authority-nya tidak dibatasi pada satu Branch. Brand Manager membutuhkan operational visibility dan authority terhadap Branch-Branch yang berada di bawah Brand tersebut agar dapat menjalankan fungsi management pada level Brand tanpa bergantung kepada Owner untuk daily operation setiap Branch.
### Decision
**Brand Manager memiliki operational authority atas seluruh Branch yang berada dalam Brand scope-nya.**
### Hierarchy
OWNER
→ BRAND / BRAND MANAGER
→ BRANCH / BRANCH MANAGER
→ STAFF / KASIR
Brand Manager dapat mengelola aktivitas operasional pada Branch dalam Brand scope-nya, termasuk mengelola Branch Manager dan aktivitas operasional yang berada di bawah authority Brand, selama tidak melampaui governance/policy/ownership authority Owner.
### Boundary
- Brand Manager tidak otomatis memiliki authority atas Brand lain.
- Brand Manager tidak dapat menaikkan authority dirinya sendiri ke level Owner.
- Perubahan yang menyentuh peer/equal-level authority atau governance Owner tetap memerlukan authority level di atasnya.
- Branch Manager tetap menjadi operational authority pada Branch-nya; Brand Manager berada di atasnya pada scope Brand.
### Security / Scope Consequence
Scope Brand adalah boundary authorization Brand Manager. Core harus menegakkan bahwa Brand Manager hanya dapat mengakses dan melakukan tindakan terhadap Branch yang termasuk dalam Brand scope yang diberikan kepadanya.
### Status
**LOCKED** — berlaku selama reconstruction dan harus dipertahankan.
## CONFIRMATION — Brand Manager Authority
**Status:** LOCKED.
Brand Manager berada pada level Brand dan memiliki operational authority atas seluruh Branch dalam Brand scope-nya. Authority ini berada di bawah Owner dan di atas Branch Manager dalam hirarki Xentra. Scope Brand Manager tidak meluas ke Brand lain, dan governance/ownership authority Owner tetap berada di atasnya.
Keputusan ini menjadi bagian dari baseline Identity/RBAC yang wajib dipertahankan selama reconstruction.
## MILESTONE B — IMPLEMENTATION STATUS NOTE
**Current status:** Implementation sudah masuk Git untuk B1–B7, termasuk dedicated Identity/RBAC test suite. Namun status ini **belum dianggap sebagai final DoD/testing completion**.
**Context:** Beberapa keputusan RBAC dan authority boundary baru dikunci setelah implementation Milestone B dibuat/di-commit. Karena itu, alignment terhadap keputusan terbaru akan diverifikasi pada **step testing Milestone B**. Jangan melakukan perubahan atau menambahkan test secara prematur hanya untuk memaksa checklist menjadi DONE.
**Testing dependency:** Instrument test yang benar membutuhkan input/output dan data-processing path yang dapat diamati. Untuk sebagian pengujian level B, instrumentasi input → authorization/processing → output belum seluruhnya tersedia pada baseline saat ini. Oleh karena itu, test completion harus dilakukan pada tahap testing yang memang sudah menyediakan instrument tersebut.
**Recorded gaps for later testing:**
- Verifikasi penuh terhadap locked RBAC/authority decisions terbaru.
- Verifikasi capability Manager yang sudah dikunci setelah implementation awal, termasuk refund, void/cancel, inventory/warehouse, dan delivery operational authority.
- Verifikasi Brand Manager sebagai operational authority pada seluruh Branch dalam Brand scope.
- Verifikasi coherence antara permission, role hierarchy, scope enforcement, dan domain-level instrumentation.
- Jangan mengklasifikasikan gap instrumentasi sebagai implementation blocker selama reconstruction dapat berlanjut dan instrument test memang merupakan deliverable pada testing step berikutnya.
**Rule:** Milestone B boleh dilanjutkan ke tahap berikutnya. Checklist implementation tidak boleh dipaksa DONE hanya karena source file/test file sudah ada; final completion ditentukan saat instrument test yang sesuai level implementation tersedia dan DoD dapat diverifikasi.
**Status note:** `IMPLEMENTED — TESTING/FINAL VERIFICATION PENDING`.
