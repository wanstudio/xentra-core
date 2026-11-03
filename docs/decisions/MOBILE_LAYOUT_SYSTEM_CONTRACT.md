# XENTRA MOBILE LAYOUT SYSTEM CONTRACT

**Status:** LOCKED & CANONICAL  
**Scope:** Semua surface aplikasi mobile Xentra (`apps/merchant-app`, `apps/purchasing-app`, `apps/driver-app`, `apps/pos-app`, `apps/customer-pwa`, `apps/owner-app`)  
**Enforcement:** Diuji secara otomatis melalui `tests/merchantLayoutContract.test.js` & `tests/merchantHomeUIContract.test.js`.

---

## 1. Filosofi Inti: "Zero Magic Numbers, Zero Margin Leaks"

Semua aplikasi mobile di ekosistem Xentra wajib menggunakan **Design Tokens resmi** yang didefinisikan di `:root`. Tidak diperbolehkan menulis angka `px` statis secara bebas untuk tata letak halaman (margin luar, spasi bottom nav, dan ukuran icon).

---

## 2. Design Tokens Resmi Mobile

Tokens ini didefinisikan di `apps/merchant-shared/css/shared.css` dan `apps/merchant-app/assets/css/home.css`:

```css
:root {
  /* ─── Grid & Margin Layar Mobile ─── */
  --m-shell-max-w: 500px;         /* Lebar maksimum tampilan mobile saat dibuka di desktop */
  --m-gutter: 16px;               /* Margin kiri-kanan seragam di seluruh tab/halaman */
  --m-card-gap: 12px;             /* Jarak vertikal antar-kartu (rhythm) */
  --m-card-radius: 16px;          /* Sudut kelengkungan kartu */

  /* ─── Dimensi Navigasi ─── */
  --m-topbar-h: 56px;             /* Tinggi standar topbar */
  --m-bottom-nav-h: 76px;         /* Tinggi standar bottom navigation bar */
  --m-bottom-clearance-gap: 12px; /* Jarak napas visual di atas navbar */

  /* ─── Clearance Spacer Bawah (Formula Otomatis) ─── */
  /* Menjamin kartu terbawah tidak tertutup bottom nav dan tidak menyisakan ruang kosong menganga */
  --m-bottom-spacer: calc(var(--m-bottom-nav-h) + var(--m-bottom-clearance-gap) + env(safe-area-inset-bottom, 0px));

  /* ─── Standar Ukuran Icon Sistem ─── */
  --m-icon-size: 18px;            /* Ukuran standar icon tombol topbar & aksi */
  --m-icon-size-sm: 16px;         /* Ukuran icon kecil / badge */
  --m-icon-size-lg: 20px;         /* Ukuran icon besar */
  --m-branch-pill-logo-size: 26px;/* Ukuran logo tenant pada branch pill */
}
```

---

## 3. Aturan Tata Letak & Larangan (Do's & Don'ts)

### ❌ Yang DILARANG KERAS:
1. **Dilarang hardcode padding/margin horizontal selain `var(--m-gutter)`** (misal `12px`, `14px`, `20px` di level tab atau kontainer utama).
2. **Dilarang hardcode spacer bawah statis** (seperti `138px`, `90px`, `120px`). Seluruh clearance di atas bottom navigation bar wajib dikendalikan secara eksklusif oleh `var(--m-bottom-spacer)`.
3. **Dilarang menyematkan `padding-bottom` raksasa** pada elemen kontainer tab (seperti `#tab-bm-pesanan { padding-bottom: 90px; }`) karena akan memicu penumpukan spasi kosong (*double spacing*).
4. **Dilarang menggunakan raster/bitmap image (`<img>` atau `<image>` di dalam SVG) untuk icon sistem.** Seluruh icon profil, notifikasi, dan chat wajib berupa inline SVG vektor berukuran `var(--m-icon-size)`.
5. **Dilarang membuat switcher/tab internal** di dalam body jika entitas tersebut sudah memiliki tab di primary bottom nav bar (contoh: dilarang ada pill switcher "Menu Etalase | Stok & Dapur" di dalam tab Menu atau Stok).
6. **Dilarang menambahkan class subpage view (`is-subpage-view`) ke root primary tab.** Bottom navbar harus tetap aktif dan terlihat di tab "Lainnya" (`pengaturan`). Subpage view hanya diperuntukkan bagi *deep subpage* yang memiliki tombol kembali (seperti edit meja, staff, atau form modal).
7. **Dilarang melakukan *Cascading Double Clearance*:** Hanya satu elemen tunggal dalam rantai hierarki yang boleh mengatur ruang napas bawah (`var(--m-bottom-spacer)`). Container anak dilarang menyematkan `padding-bottom` tambahan jika parent tab sudah memiliki `::after` spacer.
8. **Dilarang membiarkan kebocoran margin pada elemen terbawah:** Seluruh section atau card paling bawah di dalam scroll container wajib memiliki `margin-bottom: 0 !important;` agar tidak menambah jarak kosong di atas navbar.
9. **Wajib mematikan spacer `::after` saat navbar disembunyikan:** Pada subview atau subpage yang menyembunyikan bottom navigation bar (`is-subpage-view` atau `is-bm-menu-subview`), spacer `::after` bawaan tab WAJIB dimatikan (`display: none !important; height: 0 !important;`).

### ✅ Yang WAJIB Dilakukan:
1. Setiap card di dalam tab harus mengonsumsi `width: 100%` terhadap parent container tanpa menambahkan margin horizontal mandiri.
2. Filter card dan sticky control yang berada di luar tab scroll container wajib memiliki margin `10px var(--m-gutter)` dan `width: calc(100% - (var(--m-gutter) * 2))`.
3. Jarak napas visual (*clearance gap*) antara bagian bawah kartu terakhir dan tepi atas bottom navigation bar saat di-scroll mentok adalah tepat **12px** (`--m-bottom-clearance-gap`). Dilarang ada celah kosong menganga melebihi 16px.
4. Logo tenant di topbar wajib disinkronkan secara dinamis dari endpoint backend `/api/v1/brand/info` dengan fallback ke `/assets/upload-aset/branding/Logo app mybangjo.png`.

---

## 4. Dua Pola Standar Clearance Bawah Layar Mobile (Two Screen Archetypes)

Untuk mencegah bug overlap dan celah menganga, seluruh layar mobile Xentra dikelompokkan ke dalam **Dua Pola Baku**:

### Pola A: Layar dengan Primary Bottom Navigation Bar (Beranda, Pesanan, Stok, Belanja, Lainnya)
1. **Bottom Navbar Aktif**: Navbar utama berada di bawah layar dengan tinggi `var(--m-bottom-nav-h, 76px)`.
2. **Spacer Tunggal**: Clearance ditangani **hanya oleh satu elemen**: `.x-tab-content.active::after` dengan `height: var(--m-bottom-spacer)`.
3. **Nol-kan Anak**: Container anak (seperti `.x-home-screen`, `.bm-orders-mobile-cards`, dll) wajib `padding-bottom: 0 !important;`.
4. **Nol-kan Margin Kartu Terakhir**: Elemen terakhir di dalam scroll container wajib `margin-bottom: 0 !important;`.
5. **Hasil**: Saat di-scroll mentok ke bawah, jarak dari kartu terbawah ke tepi atas navbar adalah **tepat 12px** (`--m-bottom-clearance-gap`).

### Pola B: Layar dengan Floating Bottom Action Dock / CTA Bar (seperti Kategori & Menu)
1. **Navbar Bawah Disembunyikan**: Primary bottom navigation bar disembunyikan (`display: none !important;`).
2. **Matikan Spacer `::after` Tab**: Spacer `::after` bawaan tab WAJIB dimatikan (`display: none !important; height: 0 !important;`) agar tidak ada celah ganda.
3. **Bottom Bar CTA Fixed**: Kontainer tombol aksi melayang (`.x-categories-bottom-dock`) berada di `bottom: 0` dengan padding internal `14px 16px max(14px, env(safe-area-inset-bottom, 14px)) !important;` (tinggi total ~77px).
4. **Padding Clearance pada List**: Container daftar scroll (`.x-menu-category-list`) WAJIB memiliki `padding-bottom: calc(88px + env(safe-area-inset-bottom, 0px)) !important;`. **DILARANG me-nol-kan padding-bottom container list** karena akan membuat kartu terbawah tertimpa/tertutup oleh bottom bar CTA!
5. **Nol-kan Margin Kartu**: Kartu di dalamnya (`.x-menu-category-card`) memiliki `margin-bottom: 0 !important;` (ritme vertikal antar-kartu dikendalikan murni oleh `gap: 12px;` pada parent flex).
6. **Hasil**: Saat di-scroll mentok ke bawah, jarak dari kartu terbawah ke tepi atas bottom bar CTA adalah **tepat 11px – 12px** (tidak tertutup dan tidak ada ruang kosong berlebih).

---

## 5. Prosedur Otomatisasi (Automated Verification)

Sebelum setiap deployment atau merge kode yang menyentuh CSS/HTML mobile, jalankan test guard:
```bash
node --test tests/merchantLayoutContract.test.js tests/merchantHomeUIContract.test.js
```
Jika terjadi pelanggaran margin, kebocoran switcher redundan, atau formula spacer yang melenceng, pipeline test **wajib merah (FAIL)**.
