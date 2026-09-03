<!-- SNAPSHOT FROM NOTION — source page: xentra-documentation; fetched 2026-09-04 -->

# Tujuan
Dokumen induk pembangunan Xentra dari **Xentra MVP WordPress** menuju platform mandiri berbasis Node.js.
## Terminologi
- **Xentra MVP WordPress** = implementasi lama berbasis WordPress.
- **Xentra-Core / Xentra-Core MVP** = implementasi baru yang berdiri sendiri.
## Arsitektur
Xentra menggunakan arsitektur modular berbasis **domain**. Xentra-Core adalah fondasi bersama. Domain bisnis berdiri sendiri dan tidak menumpuk seluruh business logic ke Core.
## Domain
- Xentra-Core
- Xentra-Commerce
- Xentra-POS
- Xentra-Inventory
- Xentra-Payment
- Xentra-Delivery
- Xentra-Reporting
- Xentra-Integration
## Xentra-Core MVP
Scope awal yang dikunci: **Core + Commerce + POS + Inventory**.
## Keputusan yang Sudah Dikunci
- Arsitektur modular berbasis domain.
- Xentra-Core hanya fondasi bersama; Core tidak menjadi tempat logika bisnis vertikal.
- Product master disediakan owner; owner menentukan branch yang mendapat produk.
- Branch bertanggung jawab memasukkan stok awal.
- Branch dapat menonaktifkan produk; tindakan tercatat di Business Log dan diketahui owner.
- Harga hanya memiliki dua mode: **Lock** atau **Range**.
- Lock: branch tidak dapat mengubah harga.
- Range: owner menentukan minimum dan maksimum; branch wajib mengisi harga di dalam rentang.
- Jika policy berubah menjadi Lock, override lama tetap tersimpan sebagai histori tetapi tidak berlaku.
- Jika policy dibuka kembali, field harga branch kembali kosong dan branch mengisi ulang.
- Permission menggunakan RBAC terpusat di Xentra-Core.
- Branch tidak membuat kebijakan secara bebas; branch dapat mengajukan request dan owner yang memutuskan.
- Promo/kebijakan promo dibuat oleh owner.
- Reporting adalah domain mandiri.
- Payment adalah domain mandiri.
- Delivery adalah domain mandiri dan menangani ongkir/pengiriman.
- Integration adalah domain mandiri untuk API pihak ketiga dan hardware, termasuk printer Bluetooth.
- Core harus kecil, stabil, dan keputusan yang menyangkut Core harus matang sebelum implementasi.
## Role & Permission
Role di branch berbeda. Kasir fokus pada transaksi dan absensi yang menjadi kewenangannya. Kasir tidak dapat mengubah stok atau melihat data karyawan lain di luar kewenangannya. Permission dikelola terpusat melalui RBAC di Xentra-Core.
## Product & Branch Flow
Owner menambah produk ke master catalog, lalu menentukan branch yang menjualnya. Branch menerima notice produk baru. Branch menginput stok awal. Tidak diperlukan checklist panjang atau approval tambahan untuk sekadar menerima produk.
## Governance
Branch menjalankan operasional. Untuk perubahan kebijakan, branch mengajukan request. Owner melakukan approval/rejection dan perubahan dari dashboard owner.
## Boundary Database
Yang sudah dikunci adalah **pemisahan tanggung jawab by domain**. Ini tidak otomatis berarti setiap domain harus memiliki database atau server fisik terpisah. Topology fisik masih perlu diputuskan.
## Urutan Pembangunan
1. Map system flow dan business flow.
2. Tetapkan entity dan source of truth.
3. Bangun dashboard untuk input dan operasional.
4. Bangun customer UI sebagai output dari data dan business rules.
5. Pecah hasil menjadi task yang dapat dicentang.
## Belum Dikunci
Entity model detail, source of truth lintas domain, event model, API contracts, topology database fisik, offline POS, detail inventory transfer dan purchasing, integrasi external POS, provider eksternal, observability, backup/disaster recovery, deployment topology, dan final task breakdown.
## Aturan Dokumentasi
Jika membahas implementasi lama, selalu sebut **Xentra MVP WordPress**. Jika membahas implementasi baru, sebut **Xentra-Core** atau **Xentra-Core MVP**. Jangan mencampur keduanya.
Locked contract resmi Xentra tetap memiliki prioritas lebih tinggi jika terjadi konflik.
<page url="https://app.notion.com/p/3cd1ae1e12b181398da4fc4f80925c43">01 — Architecture Decision Log</page>
<page url="https://app.notion.com/p/3cd1ae1e12b181f2a47ad82e2310f54e">02 — Domain Blueprint</page>
<page url="https://app.notion.com/p/3cd1ae1e12b1815db657f8ddbe4da09a">03 — Business Flow</page>
<page url="https://app.notion.com/p/3cd1ae1e12b181e690caf2c539e203d0">04 — Role & Permission</page>
<page url="https://app.notion.com/p/3cd1ae1e12b181ad826bd6cbc596695a">05 — Open Decisions</page>
<page url="https://app.notion.com/p/3cd1ae1e12b181b293b8c89cfc69f2b4">06 — Implementation Task Map</page>
<page url="https://app.notion.com/p/3cd1ae1e12b181faa3adf6a12fe2cc59">00 — Xentra Ocean Roadmap</page>
<page url="https://app.notion.com/p/3cd1ae1e12b18144ad90eda44e71a807">A — Xentra Core Event Infrastructure</page>
<page url="https://app.notion.com/p/3cd1ae1e12b181a48a65e4f05486d23f">B — Identity & RBAC</page>
<page url="https://app.notion.com/p/3cd1ae1e12b1810ab170f7ac1ec8f64e">C — Configuration & Feature Control</page>
<page url="https://app.notion.com/p/3cd1ae1e12b181918e8df0b675294b34">D — Integration Foundation</page>
<page url="https://app.notion.com/p/3cd1ae1e12b18157aaebf10e8c9bb3e8">E — Audit & Activity</page>
<page url="https://app.notion.com/p/3cd1ae1e12b18137bd3ccba589925323">F — Domain Registry</page>
<page url="https://app.notion.com/p/3cd1ae1e12b181aea918c311fab3efd9">G — Core Stabilization & Readiness</page>
<page url="https://app.notion.com/p/3ce1ae1e12b181fbaec5e4dee8fb0b50">08 — SaaS Control Plane, Environment & Workforce Access</page>
<page url="https://app.notion.com/p/3ce1ae1e12b181029702d6dbc863052f">Technical Standard — PWA Installation & Cross-Platform Mobile Flow</page>
<page url="https://app.notion.com/p/3cf1ae1e12b181afa99ec8adc7f593ee">Engineering Reference: Nested Horizontal Carousel Scrolling in Vertical PWA</page>
