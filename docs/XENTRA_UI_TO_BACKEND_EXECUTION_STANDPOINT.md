# Xentra Modern Mobile Engineering Specification: UI-to-Backend Architecture Standard

**Status:** LOCKED WORKING SPECIFICATION & ARCHITECTURAL INVARIANT  
**Effective Date:** 2026-10-28  
**Industry Benchmarks:** 
- Google Official *Guide to App Architecture* (Modern Android Architecture / MAD & Offline-First SSOT)
- React Native & TanStack Query Mobile Invariants (Optimistic Mutation Triad & AppState Sync)
- RFC 9111 HTTP Caching & Service Worker Proxy Standards
- Apple Human Interface & Navigation Stack Coordination

**Scope:** All Xentra surfaces (Owner Mobile `apps/owner-app`, Merchant Dashboard `apps/merchant-dashboard`, Merchant App `apps/merchant-app`, POS `apps/pos-web`, Customer PWA `apps/customer-pwa`, and React Microfrontends `packages/menu-editor-ui`).

---

## 1. Core Standpoint (Prinsip Dasar)

> **"Input dari Product / Stakeholder HANYALAH Tampilan UI (Visual & UX Intent).  
> Tugas Engineering adalah menurunkan arsitektur sistem, CRUD database, API contract, cache boundary, data lifecycle, dan verifikasi otomatis secara utuh, profesional, dan berstandar industri."**

Seorang engineer tidak boleh bersikap reaktif atau bekerja tambal sulam dengan sekadar menempelkan kode CSS/Tailwind ke layar lalu menunggu disuapi endpoint backend satu per satu. 

Di dalam standar industri mobile modern, **sebuah tampilan antarmuka (UI) adalah kontrak maksud bisnis (*business intent*)** yang secara otomatis memicu arsitektur lengkap 7 lapisan:

```mermaid
flowchart TD
    subgraph Client_App ["1. Mobile Client Layer (UI & State)"]
        UI["UI Component (Figma / Tailwind Input)"]
        VM["State Holder / ViewModel (UDF Pattern)"]
        UI -->|User Action / Events Up| VM
        VM -->|State Flows Down| UI
    end

    subgraph Mutation_Engine ["2. Optimistic Mutation Triad"]
        VM -->|1. onMutate: Cancel Refetch + Snapshot + Optimistic Set| Cache["Local Query Cache"]
        Cache -->|UI Instant Render (0ms)| UI
    end

    subgraph Network_Proxy ["3. Network & Service Worker Boundary"]
        VM -->|2. Fire HTTP with Idempotency Key| SW["Service Worker Proxy (sw.js)"]
        SW -->|Network-Only Bypass| API["Express API Gateway"]
    end

    subgraph Backend_Domain ["4. Backend & Domain Layer"]
        API -->|Route Context & RBAC| Svc["Domain Application Service"]
        Svc -->|Single Transaction| DB[("SQLite: Master & Projection Balances")]
    end

    subgraph Sync_Reconcile ["5. Lifecycle Reconcile & Invalidation"]
        DB -->|Authoritative Payload| API
        API -->|3. onSettled: Invalidate Query| Cache
        API -.->|If Error: onError Rollback Snapshot| Cache
    end
```

---

## 2. Tujuh Standar Industri Arsitektur Mobile Modern

### Standar 1: Unidirectional Data Flow (UDF) & Local Store as Single Source of Truth (SSOT)
Mengacu pada **Google Guide to App Architecture (MAD)**:
1. **State Flows Down, Events Flow Up**:
   - UI murni berupa fungsi dari state (`UI = f(State)`). UI tidak boleh memegang otoritas data sendiri.
   - Event pengguna (klik simpan, ganti status, input teks) mengalir ke atas ke State Holder / Hook / ViewModel.
2. **Local Store as SSOT**:
   - Layar UI membaca data dari cache/store lokal (reactive stream). 
   - Network API diperlakukan sebagai mekanisme sinkronisasi di latar belakang, bukan penyuap langsung yang menyebabkan layar blank atau menampilkan spinner berputar saat jaringan lambat.

---

### Standar 2: Optimistic Mutation Triad (`onMutate` $\rightarrow$ `onError` $\rightarrow$ `onSettled`)
Mengacu pada standar **TanStack Query / Apollo Client / React Native**:

Setiap kali pengguna melakukan aksi perubahan data (Create, Update, Toggle Status, Delete), wajib menerapkan **triad mutasi**:

1. **`onMutate` (Sebelum Request Dikirim)**:
   - **Cancel Outgoing Queries**: Batalkan refetch latar belakang yang sedang berjalan (`cancelQueries`) untuk mencegah *race condition* (data lama server menimpa state baru pengguna).
   - **Snapshot Previous State**: Ambil salinan kondisi state sebelumnya sebagai titik pemulihan (*rollback point*).
   - **Optimistic Update**: Segera perbarui cache lokal ke nilai baru secara instan (0 milidetik). Jika entitas baru dibuat, gunakan temporary client UUID (`temp-uuid`).
   - **Return Context**: Kembalikan context `{ previousData, queryKey }`.
2. **`onError` (Jika Request Gagal / Timeout)**:
   - **Atomic Rollback**: Kembalikan data cache ke snapshot `previousData`.
   - **Non-blocking Feedback**: Tampilkan pesan error ramah (Toast/Snackbar) beserta opsi *Retry*.
3. **`onSettled` (Setelah Selesai, Baik Berhasil Maupun Gagal)**:
   - **Invalidate & Refetch**: Picu `invalidateQueries(queryKey)` untuk menyelaraskan data lokal dengan data otoritatif server (*server truth reconciliation*).

---

### Standar 3: Network & Proxy Boundary (RFC 9111 & Service Worker)
Di lingkungan PWA dan Mobile Shell (Android WebView / iOS WebKit):
1. **Service Worker Proxy Bypass**:
   - Di mobile, semua `fetch()` dicegat oleh Service Worker ([sw.js](file:///home/ubuntu/xentra-core/apps/owner-app/sw.js)).
   - **Aturan Mutlak**: Seluruh endpoint transaksi dan master data (`/admin/*`, `/api/*`, `/auth/*`) **WAJIB** masuk ke kategori `network-only`.
   - Dilarang keras membiarkan endpoint mutasi masuk ke strategi `stale-while-revalidate` atau `cache-first`.
2. **HTTP Cache-Control Headers**:
   - Server Express wajib menyertakan header anti-cache pada semua respons admin:
     ```http
     Cache-Control: no-store, no-cache, must-revalidate, max-age=0
     Pragma: no-cache
     ```
3. **Asset Cache Bumping**:
   - Setiap perubahan bundle (`menu-editor.js`) wajib disertai bumping versi query string (`?v=...`) di file HTML pemanggil dan bumping `CACHE_NAME` di Service Worker.

---

### Standar 4: Lifecycle & Focus Reconcile (`AppState` & View Resume)
Di aplikasi mobile, pengguna sering berpindah aplikasi, layar dimatikan (*screen off*), atau berpindah sub-layar melalui stack navigasi:
1. **Screen Resume Invalidation**:
   - Ketika pengguna kembali dari form edit (Child Page) ke halaman daftar (Parent Page), parent view wajib mendeteksi navigasi kembali (*view resume*) dan memvalidasi ulang kebaruan data.
2. **Visibility & AppState Re-sync**:
   - Mendengarkan event `visibilitychange` di browser/PWA atau `AppState === 'active'` di native bridge untuk me-refresh data yang mungkin telah dimodifikasi oleh perangkat/kasir lain.
3. **Anti-Stale Timestamp Guard**:
   - Request refetch menggunakan cache-buster dinamis (`_t=${Date.now()}`) dan parameter `{ cache: 'no-store' }`.

---

### Standar 5: Database Multi-Table Atomic Projection & Data Integrity
Di sisi backend dan database (SQLite / PostgreSQL):
1. **Single Source of Truth & Proyeksi Atomik**:
   - Jika suatu data memiliki nilai master dan nilai saldo transaksi (contoh: harga bahan baku ada di `materials.estimated_unit_cost` dan saldo berjalan ada di `material_stock_balances.moving_average_unit_cost`):
   - **Wajib Atomik**: Update kedua entitas tersebut dalam satu transaksi database (`BEGIN TRANSACTION` ... `COMMIT`).
   - Dilarang mengupdate salah satu tabel lalu membiarkan tabel agregat/saldo menampilkan harga lama.
2. **Constraints & Triggers**:
   - Menghormati constraint bisnis (non-negatif harga, status valid, relasi foreign key, trigger integritas).

---

### Standar 6: Paket 5 Endpoint RESTful CRUD Lengkap
Tidak ada fitur mobile yang selesai jika hanya menyediakan form tambah. Begitu ada entitas baru di UI, **5 endpoint standar berikut wajib disediakan secara lengkap**:

| Method | Endpoint | Fungsi Mobile | Payload / Response |
| :--- | :--- | :--- | :--- |
| **`GET`** | `/admin/<resource>` | List data + search + filter status | `{ success: true, [resource]: [...] }` |
| **`GET`** | `/admin/<resource>/:id` | Mengambil detail lengkap 1 record untuk pre-fill form Edit | `{ success: true, [item]: { ... } }` |
| **`POST`** | `/admin/<resource>` | Membuat entitas baru + inisialisasi saldo/kebijakan | `201 Created` + full created payload |
| **`PUT`** | `/admin/<resource>/:id` | Mengubah metadata & proyeksi saldo secara atomik | `200 OK` + `fullUpdated` payload |
| **`PATCH/PUT`** | `/admin/<resource>/:id/status` | Toggle aktif / nonaktif (soft-delete) | `200 OK` + updated status |

---

### Standar 7: Hierarchical Stack Navigation & Overlay Precedence
1. **Deep Link Parameter Regex**:
   - Router shell (`dashboard.js`, `OwnerAppShell.tsx`) wajib menggunakan regex matching untuk membedah URL dinamis (`business/materials/:id/edit`).
2. **Hardware / Gesture Back Precedence**:
   - Di mobile, gestur "Back" atau tombol fisik Android memiliki hirarki:
     1. Menutup Modal / Bottom Sheet yang sedang terbuka.
     2. Jika tidak ada overlay, navigasi kembali ke parent stack (`business/materials`).
     3. Dilarang melempar pengguna ke halaman default/overview saat menekan tombol Back dari editor.

---

## 3. Template Eksekusi Otomatis Saat Menerima Desain UI

Setiap kali Anda memberikan potongan desain UI, engineering wajib mengoperasikan checklist eksekusi otomatis berikut:

```markdown
### MOBILE ARCHITECTURE DERIVATION CHECKLIST (Wajib Dipenuhi)

[ ] 1. CONTRACT OF INTENT & WORKFLOW
       - Identifikasi entitas, relasi, dan alur navigasi (List -> Edit -> Back).
       - Tentukan deep-link route regex (:id/edit).

[ ] 2. DATABASE SCHEMA & ATOMIC PROJECTION
       - Tentukan tabel master dan tabel proyeksi saldo/agregat.
       - Pastikan mutasi multi-tabel berjalan atomik dalam 1 transaksi.

[ ] 3. COMPLETE 5-ENDPOINT CRUD SUITE
       - [ ] GET /admin/[resource]
       - [ ] GET /admin/[resource]/:id
       - [ ] POST /admin/[resource]
       - [ ] PUT /admin/[resource]/:id
       - [ ] PATCH/PUT /admin/[resource]/:id/status

[ ] 4. NETWORK & SERVICE WORKER BOUNDARY
       - Daftarkan endpoint ke network-only bypass di sw.js.
       - Injeksi header Cache-Control: no-store pada router Express.
       - Bump versi query string bundle & CACHE_NAME.

[ ] 5. OPTIMISTIC MUTATION TRIAD & SCREEN RESUME
       - Implementasi onMutate (cancel queries + snapshot + optimistic update).
       - Implementasi onError (rollback snapshot + toast error).
       - Implementasi onSettled (re-fetch & invalidate cache).
       - Pasang listener screen resume saat navigasi kembali dari form.

[ ] 6. MOBILE UX INPUTS
       - Masking auto-dot untuk input nominal uang (numeric keypad).
       - Disable submit button saat proses kirim untuk cegah double submit.
       - Proteksi tombol Back terhadap modal/sheet sebelum keluar halaman.

[ ] 7. AUTOMATED VERIFICATION GATE
       - Targeted tests (node --test) lolos 100%.
       - Build bundle terkompilasi tanpa error.
       - PM2 service online dan log bersih dari unhandled exceptions.
```

---

## 4. Evaluasi Kasus: Perbandingan Tambal Sulam vs Standar Industri Modern

| Aspek | Pola Tambal Sulam (Lama) | Standar Industri Mobile Modern (Terkunci) |
| :--- | :--- | :--- |
| **Input Desain UI** | Hanya membuat styling React visual per halaman. | Menurunkan 7 lapisan arsitektur (UDF, DB, API, SW, Lifecycle). |
| **Perubahan Harga / Data** | Update satu kolom di tabel master, lupa update saldo berjalan. | **Atomic Projection**: Tabel master dan saldo diupdate serentak dalam 1 transaksi database. |
| **Data Baru Tidak Muncul** | Bingung kenapa data tidak berubah; menyuruh user reload browser (F5). | **SW Bypass & Cache Invalidation**: Bypass `sw.js` via `network-only` + `Cache-Control: no-store` + Optimistic Triad. |
| **Navigasi Card ke Editor** | Menunggu ditagih bahwa form edit 404 atau card tidak bisa diklik. | **Paket 5 Endpoint CRUD Lengkap** + regex routing deep-link sejak awal. |
| **Perpindahan Layar** | State mati setelah kembali dari child page. | **Screen Resume Lifecycle**: Invalidation otomatis saat child page pop/unmount. |
