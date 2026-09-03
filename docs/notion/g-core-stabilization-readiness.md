<!-- SNAPSHOT FROM NOTION — source page: g-core-stabilization-readiness; fetched 2026-09-04 -->

## Objective
Memastikan fondasi Xentra-Core siap menjadi platform untuk domain bisnis pertama.
## Scope
Contract review, integration tests, failure-path tests, security review, observability baseline, documentation review, dan readiness gate.
## Out of Scope
Implementasi Commerce/POS/Inventory baru.
## Sub-milestones
### G1 — Architecture Contract Review
Review boundary dan locked decisions.
### G2 — Cross-module Integration Tests
Validasi interaksi komponen Core.
### G3 — Failure-path & Recovery Tests
Validasi perilaku ketika dependency/error terjadi.
### G4 — Security & Permission Review
Review authorization dan boundary.
### G5 — Observability Baseline
Log/metrics/tracing baseline yang memang diperlukan.
### G6 — Documentation Review
Pastikan blueprint dan implementation contract sinkron.
### G7 — Core MVP Readiness Gate
Keputusan eksplisit apakah Core siap menjadi foundation domain bisnis.
## Definition of Done
Semua contract utama terdokumentasi, automated tests lulus, boundary Core terverifikasi, dan readiness gate disetujui.
## Status
**PLANNED**
## CLARIFICATION — G TESTING / READINESS
G tidak membuat jenis test baru secara abstrak dan tidak boleh memaksakan test yang instrument input/output-nya belum tersedia.
G adalah final verification terhadap evidence yang sudah dihasilkan milestone sebelumnya. Setiap pemeriksaan harus mengikuti responsibility dan instrument yang memang tersedia pada milestone terkait.
### G1 — Architecture Contract Review
Bandingkan implementation terhadap locked decisions, boundary, dan contract yang sudah terdokumentasi.
### G2 — Cross-module Integration Verification
Verifikasi hanya integration path yang memang sudah memiliki instrument input/output dan dependency yang tersedia.
### G3 — Failure-path & Recovery Verification
Verifikasi failure/recovery hanya pada component/path yang memang sudah memiliki failure-path instrument.
### G4 — Security & Permission Review
Verifikasi authorization, permission, scope, dan boundary menggunakan instrument yang sudah tersedia pada Identity/RBAC dan module terkait.
### G5 — Observability Baseline
Verifikasi evidence/log/trace yang memang menjadi responsibility Core dan sudah memiliki instrument observability.
### G6 — Documentation Review
Pastikan blueprint, locked decisions, implementation contract, dan implementation aktual tetap sinkron.
### G7 — Core MVP Readiness Gate
Review hasil G1–G6 dan seluruh evidence yang tersedia untuk menentukan readiness Core.
### Mandatory Verification Rule
Jika dependency atau instrument yang diperlukan belum tersedia, hasilnya harus dicatat sebagai **NOT VERIFIED**. Jangan membuat business logic, dependency, atau test baru hanya untuk memaksa milestone/G7 menjadi PASS.
G selesai berdasarkan evidence yang benar-benar tersedia dan terverifikasi, bukan berdasarkan jumlah test yang dipaksakan.
## IMPLEMENTATION UPDATE — E CLEANUP & G METHODOLOGY
### Execution status
The previously identified E legacy cleanup and G methodology correction have now been executed in the Git implementation.
### Milestone E — Executed
- Removed the legacy `AuditEventModel` paradigm from the Audit domain.
- Removed the legacy `ActorTargetContext` dependency from the Audit domain.
- `AuditLogRecord` is now the sole audit-log record model.
- `AuditWriter` no longer falls back to creating an audit record from a system event.
- Audit semantics now follow the locked model:
	**System/Business Event Evidence → Audit Process → Audit Log Record**.
- The Audit domain therefore records the context/result of an actual audit process rather than treating every discrete system action as an audit log.
### Milestone G — Executed
- Removed/retired E2E verification that artificially forced capabilities which do not have the required real instrument/dependency.
- Readiness evaluation is now based on an Evidence Evaluation Matrix across A–F.
- Areas whose required instrument/dependency is unavailable are explicitly recorded as **`NOT VERIFIED`**.
- G readiness must not be declared merely because synthetic/local tests pass.
- Existing evidence is evaluated according to the actual responsibility and instrument available for each milestone.
### Alignment Note
These implementation changes bring E and G into alignment with the latest locked decisions documented in this milestone plan. No new business logic or artificial test dependency is introduced merely to obtain a PASS result.
### Audit Traceability
Git implementation changes corresponding to this update have been executed. The Notion milestone record is updated to reflect the current implementation state; future verification should compare the current Git state against this locked context.
## REMINDER — CORE INFRASTRUCTURE COMPLETION STATUS
**Core Infrastructure A–G belum boleh dinyatakan DONE.**
Implementation A–G secara umum sudah aligned dengan locked decisions terbaru, termasuk cleanup E dan perubahan methodology G. Namun status milestone tidak boleh dianggap selesai hanya karena source code dan test files sudah tersedia.
Completion tetap menunggu **verification evidence yang memang diwajibkan oleh masing-masing milestone**.
Khusus area yang dependency/instrument-nya belum tersedia, status harus tetap **`NOT VERIFIED`**. Jangan membuat business logic, dependency, hardware integration, production gateway, atau test sintetis baru hanya untuk mengubah status menjadi PASS.
Contoh dependency yang saat ini belum dapat diverifikasi penuh:
- physical Bluetooth ESC/POS hardware;
- production gateway webhook/live network;
- physical server/database topology.
### Final Reminder
**Implementation aligned ≠ Core Infrastructure DONE.**
Core Infrastructure A–G baru dapat ditutup setelah evidence verification yang diwajibkan tersedia dan dapat ditelusuri. Sampai saat itu, status readiness bersifat baseline/conditional dan area yang belum dapat diuji harus tetap ditandai `NOT VERIFIED`.
Catatan ini adalah pengingat agar status implementasi Git tidak keliru dianggap sebagai status completion milestone.
