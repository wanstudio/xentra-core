# XENTRA UI TRANSLATION STANDARD: FIGMA / PURE UI TO PRODUCTION CODE

**Status:** LOCKED & CANONICAL  
**Decision Date:** 28 Oktober 2026  
**Scope:** Semua surface aplikasi Xentra (`apps/merchant-app`, `apps/purchasing-app`, `apps/driver-app`, `apps/pos-app`, `apps/customer-pwa`, `apps/owner-app`, `apps/merchant-dashboard`)  
**Target Audience:** AI Coding Assistant, Frontend Engineers, UI/UX Integrator  

---

## 1. Filosofi Inti: "Maksud Desain vs Hardcode Visual"

Setiap cuplikan kode visual mentah yang diekspor dari Figma (seperti Tailwind JSX, export HTML absolute coordinates, CSS canvas generator, atau AI mockup snippet) adalah **Visual Blueprint & Design Token Extraction Source**, BUKAN kode produksi jadi.

### 🚫 Yang DILARANG KERAS (Anti-Patterns):
1. **Dilarang melakukan literal copy-paste** dari koordinat absolut (`top-[16px] left-[14px] absolute`, `left-[22px]`, dsb).
2. **Dilarang menggunakan ukuran viewport statis** (`w-96` = 384px, `w-[375px]`, `h-28`) yang membuat UI rusak/gepeng saat dibuka di layar perangkat lain atau desktop simulator.
3. **Dilarang memasukkan mockup OS chrome/device artifacts** (seperti garis iOS Home Indicator `w-32 h-[5px] bg-zinc-800 rounded-[100px]`, status bar baterai/jam fiktif) ke dalam DOM produksi.
4. **Dilarang menggunakan `<div>` tanpa semantik** untuk tombol interaktif, navigasi, dan link.
5. **Dilarang mengabaikan arsitektur stack proyek** (misalnya menaruh React/JSX syntax atau dependensi Tailwind CLI ke dalam surface Vanilla HTML5/CSS/JS seperti `merchant-app`).

### ✅ Yang WAJIB Dilakukan (Semantic Reverse Engineering):
1. **Pahami Maksud & Hirarki Informasi (IA)**: Apa fungsi komponen ini? (Navigasi bawah, kartu pesanan, bottom sheet, header operasional).
2. **Ekstrak Design Tokens**: Ambil nilai warna, border radius, box shadow, spacing rhythm, dan font hierarchy.
3. **Bungkus dalam Kontainer Responsif**: Sesuaikan dengan batas viewport surface (misal mobile-locked `max-width: 500px; width: 100%; margin: 0 auto;`).
4. **Terapkan Semantik HTML5 & ARIA**: Gunakan `<nav>`, `<button type="button">`, `<main>`, `aria-current="page"`, `aria-label`, dsb.
5. **Hubungkan dengan State & Routing Aplikasi**: Sambungkan tombol ke fungsi router yang sudah ada (`navigateTo(route)`, event delegation, class `.active`).
6. **Dinamisasi Indikator Aktif**: Indikator posisi aktif (seperti garis hijau aksen atas) harus dinamis mengikuti tab yang aktif, bukan koordinat statis.

---

## 2. Protokol Translasi 6 Langkah (The 6-Step Protocol)

Setiap kali menerima cuplikan kode UI mentah dari pengguna, jalankan protokol berikut secara otomatis:

```
[Input: Raw UI / Figma Snippet]
       │
       ▼
[Langkah 1: Normalisasi Kontainer & Layout Flow] ──► Hapus absolute coords, ganti ke Flex/Grid responsif
       │
       ▼
[Langkah 2: Ekstraksi & Pemetaan Token Desain]  ──► Radius, Shadow, Warna Aktif/Inaktif, Tipografi
       │
       ▼
[Langkah 3: Pembersihan Device Chrome / OS Mock] ──► Hapus Home Bar dummy, ganti safe-area-inset CSS
       │
       ▼
[Langkah 4: Rekonstruksi Semantik HTML & ARIA]  ──► <div> ➔ <nav>/<button>, placeholder ➔ SVG icon
       │
       ▼
[Langkah 5: Penyelarasan Stack & Scope CSS]     ──► Vanilla JS/CSS, BEM naming, hindari konflik global
       │
       ▼
[Langkah 6: Wiring Logika Router & State Engine]──► data-route, onclick/listener, dynamic active indicator
       │
       ▼
[Output: Clean, Production-Ready Code]
```

---

### Langkah 1: Normalisasi Kontainer & Layout Flow

| Figma / Tailwind Snippet | Produksi Xentra (CSS / Semantic) | Alasan Teknis |
| :--- | :--- | :--- |
| `w-96` (384px) | `width: 100%; max-width: 500px; margin: 0 auto;` | Mencegah layout overflow / underflow pada variasi ukuran HP (360px – 430px). |
| `h-28` (112px fixed) | `min-height: 64px; height: calc(64px + env(safe-area-inset-bottom, 0px));` | Menghormati area gestur iOS/Android tanpa terpotong atau terlalu tinggi. |
| `left-[14px] top-[16px] absolute inline-flex gap-4` | `display: flex; justify-content: space-around; align-items: center; width: 100%;` | Menggunakan Flexbox fluid agar jarak antar tab proporsional otomatis di semua lebar HP. |
| `absolute` layout per item | `position: relative; flex: 1;` | Mengalir secara natural dalam document flow, mudah di-tap jari (touch target min 44x44px). |

---

### Langkah 2: Ekstraksi & Pemetaan Token Desain

Ambil nilai desain dari snippet Tailwind dan petakan ke CSS variable / nilai token standar Xentra:

1. **Border Radius**:
   - `rounded-tl-[20px] rounded-tr-[20px]` ➔ `border-radius: 20px 20px 0 0;` (Sudut membulat modern di bagian atas bottom bar).
2. **Elevasi & Bayangan (Box Shadow)**:
   - `shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]` ➔ `box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.12);` (Memberikan efek kedalaman melayang di atas konten).
3. **Warna Brand & Status**:
   - Aktif: `bg-green-600` / `#16a34a` ➔ Terapkan sebagai warna teks, icon fill, dan garis aksen aktif (`#16a34a` atau `--x-brand-green: #08a94f`).
   - Inaktif: `text-slate-900` / `bg-slate-900` (`#0f172a` atau `#334155`) ➔ Terapkan sebagai warna teks & icon inaktif default.
   - Latar: `bg-white` ➔ `background: #ffffff;` (atau `var(--card-bg, #ffffff)` untuk dark mode support).
4. **Tipografi**:
   - `font-['Plus_Jakarta_Sans'] text-xs font-bold` ➔
     ```css
     font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
     font-size: 11px;
     font-weight: 700;
     line-height: 1.2;
     ```

---

### Langkah 3: Pembersihan Device Chrome / OS Mock

Cuplikan Figma sering kali menyertakan imitasi perangkat keras iPhone/Android seperti:
```html
<!-- DUMMY DARI FIGMA - WAJIB DIBUANG DARI DOM -->
<div className="w-96 h-8 left-[1px] top-[76px] absolute">
  <div className="w-32 h-[5px] left-[128px] top-[21px] absolute bg-zinc-800 rounded-[100px]" />
</div>
```
**Tindakan Wajib:**
- **HAPUS elemen DOM ini seutuhnya!**
- Gantikan dengan CSS Safe Area Inset standar W3C:
  ```css
  padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  ```
  Ini menjamin perangkat iOS asli (dengan notch & gesture pill) maupun Android menampilkan padding yang benar secara native tanpa menghasilkan batang hitam ganda.

---

### Langkah 4: Rekonstruksi Semantik HTML & ARIA

Struktur `<div>` bertingkat dari export UI harus diubah menjadi markup semantik:

```html
<!-- STANDAR PRODUKSI XENTRA: Semantic HTML5 + ARIA -->
<nav class="x-merchant-mobile-nav" id="x-merchant-mobile-nav" aria-label="Navigasi Utama Merchant">
  
  <button type="button" class="x-merchant-mobile-nav-item active" data-route="hari-ini" onclick="navigateTo('hari-ini')" aria-current="page">
    <div class="x-nav-icon-wrap">
      <!-- SVG Asli dengan fill="currentColor" agar otomatis adaptif terhadap active state -->
      <svg class="x-nav-icon" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        ...
      </svg>
    </div>
    <span class="x-nav-label">Beranda</span>
  </button>

  ...
</nav>
```

#### Aturan Ikon & Penggunaan Aset Repositori (Canonical Asset Reuse):
- Dummy div warna seperti `<div className="size-5 left-[0.50px] top-[0.50px] absolute bg-green-600" />` adalah hasil ekspor vektor rusak / path placeholder dari Figma.
- **Wajib gunakan aset ikon kanonikal yang sudah ada di repositori/GitHub**:
  Repositori telah memiliki pustaka aset ikon SVG resmi di `assets/upload-aset/icons/` dan `apps/*/assets/icons/`:
  * **Beranda**: `fa7-solid_home.svg`
  * **Pesanan**: `fluent_task-list-rectangle-28-filled.svg`
  * **Menu & Stok**: `reicon_menu-board-filled.svg`
  * **Belanja**: `dashicons_store.svg`
  * **Lainnya**: `bxs_category.svg`
- **DILARANG MENGARANG ATAU MEMBUAT SVG GENERIK BARU** jika ikon kanonikalnya sudah tersedia di repositori.
- Pasang aset ikon melalui elemen `<img src="/<app>/assets/icons/<nama-icon>.svg" width="22" height="22" alt="" aria-hidden="true">` dengan CSS filter active state:
  ```css
  /* Inactive icon (default slate-900 / dark) */
  .x-nav-item img {
    opacity: 0.85;
    transition: filter .15s ease, opacity .15s ease;
  }
  /* Active icon: Green 600 (#16a34a) */
  .x-nav-item.active img {
    opacity: 1;
    filter: brightness(0) saturate(100%) invert(48%) sepia(97%) saturate(1451%) hue-rotate(116deg) brightness(92%) contrast(101%) !important;
  }
  ```
  Atau gunakan path SVG resmi dari file tersebut dengan `fill="currentColor"`.

---

### Langkah 5: Penyelarasan Stack & Scope CSS (Zero Hardcoding)

Arsitektur aplikasi Xentra pada surface operasional (`apps/merchant-app`, `apps/purchasing-app`, dsb) berbasis **Vanilla HTML5, Scoped CSS, dan Vanilla JS (No Bundler, No React)**.

- Semua styling dituliskan pada file CSS yang relevan (misalnya `apps/merchant-app/assets/css/home.css`).
- Gunakan class name prefix scoped (misalnya `.x-merchant-mobile-nav` dan `.x-merchant-mobile-nav-item`) untuk mencegah pencemaran style antar-komponen.
- Tetapkan `box-sizing: border-box;` dan hilangkan default button chrome (`outline: none; background: transparent; border: none; cursor: pointer;`).

---

### Langkah 6: Wiring Logika Router & Dynamic Indicator

Jangan pernah membuat indikator posisi aktif dengan koordinat tetap (`left-[22px] top-0 absolute`), karena ketika pengguna mengklik tab kedua ("Pesanan"), indikator tersebut akan tertinggal di tab pertama!

Gunakan **Top Indicator via Pseudo-element atau Glider CSS**:
```css
### State Aktif Dinamis & Warna Token:
- Warna Aktif: `#00A637` (Hijau resmi Xentra, diterapkan HANYA pada icon yang aktif).
- Warna Inaktif: `#0F172A` (Slate gelap diterapkan pada seluruh label teks dan icon inaktif).
- Label teks: Semua label tetap `#0F172A`, font 12px, font-weight 700, font-family Plus Jakarta Sans.
- Jangan menambahkan aksen garis atas (top line) jika pada spesifikasi Figma tidak memilikinya.

```css
.x-merchant-mobile-nav-item svg {
  color: #0F172A;
  fill: currentColor;
}

.x-merchant-mobile-nav-item > span {
  color: #0F172A;
  font-size: 12px;
  font-weight: 700;
  font-family: 'Plus Jakarta Sans', sans-serif;
}

/* Hanya icon yang berubah warna saat aktif */
.x-merchant-mobile-nav-item.active svg {
  color: #00A637;
  fill: #00A637;
}
```
```

Ketika JavaScript mengubah route:
```javascript
// Otomatis sinkron dengan URL hash dan state routing
document.querySelectorAll('#x-merchant-mobile-nav .x-merchant-mobile-nav-item[data-route]').forEach(function (btn) {
  var isActive = btn.dataset.route === route;
  btn.classList.toggle('active', isActive);
  btn.setAttribute('aria-current', isActive ? 'page' : 'false');
});
```
Garis aksen hijau dan warna teks/ikon otomatis berpindah mengikuti tab yang aktif secara responsif dan bebas bug.

---

## 3. Studi Kasus Standar Canonical: Bottom Navigation Merchant App

### Sumber Kebenaran Desain (Design Source of Truth):
- 🎨 **Master SVG Design**: [`docs/design-references/pages/bottom navbar merchant.svg`](file:///home/ubuntu/xentra-core/docs/design-references/pages/bottom%20navbar%20merchant.svg)
- 📁 **Canonical Icon Directory**: [`assets/upload-aset/merchant icon/`](file:///home/ubuntu/xentra-core/assets/upload-aset/merchant%20icon/)

### Pemetaan Resmi Tab, Rute, & Aset Ikon:
| No | Tab Label | Lebar | Icon Box | Asset Ikon GitHub (`merchant icon/`) | Rute Merchant App |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **Beranda** | `55px` | `21x21 px` | [`fa7-solid_home.svg`](file:///home/ubuntu/xentra-core/assets/upload-aset/merchant%20icon/fa7-solid_home.svg) | `hari-ini` |
| 2 | **Pesanan** | `55px` | `21x19 px` | [`fluent_service-bell-20-filled.svg`](file:///home/ubuntu/xentra-core/assets/upload-aset/merchant%20icon/fluent_service-bell-20-filled.svg) | `pesanan` |
| 3 | **Menu & Stok** | `75px` | `19x20 px` | [`ion_restaurant.svg`](file:///home/ubuntu/xentra-core/assets/upload-aset/merchant%20icon/ion_restaurant.svg) | `menu` / `stok` |
| 4 | **Belanja** | `55px` | `21x18 px` | [`reicon_wallet-money-filled.svg`](file:///home/ubuntu/xentra-core/assets/upload-aset/merchant%20icon/reicon_wallet-money-filled.svg) | `belanja` |
| 5 | **Lainnya** | `55px` | `21x19 px` | [`reicon_menu-board-filled.svg`](file:///home/ubuntu/xentra-core/assets/upload-aset/merchant%20icon/reicon_menu-board-filled.svg) | `pengaturan` |

### Token Desain yang Dibakukan:
- **Card Background**: `#FFFFFF`
- **Border Radius**: Top-left `20px`, Top-right `20px` (`border-top-left-radius: 20px; border-top-right-radius: 20px;`)
- **Box Shadow**: `0px 0px 15px rgba(0, 0, 0, 0.15)`
- **Container Sizing**: `max-width: 500px; width: 100%; margin: 0 auto; min-height: 76px; height: calc(76px + env(safe-area-inset-bottom, 0px)); padding: 0 14px calc(env(safe-area-inset-bottom, 0px)) 14px; overflow: hidden;`
  *(Catatan Arsitektur: Padding atas container harus `0` agar pseudo-element indikator aktif di `top: 0` tidak terpotong atau tergeser oleh `overflow: hidden`)*.
- **Inner Tab Spacing & Items**:
  - Item container: `display: flex; justify-content: center; align-items: stretch; gap: 17px;`
  - Setiap item tab memiliki `height: 76px; padding: 16px 0 0 0; position: relative;`
  - Lebar item: Tab regular = `width: 55px; flex: 0 0 55px;`, Tab Menu & Stok = `width: 75px; flex: 0 0 75px;`
- **Prinsip Perataan Ikon & Baseline Teks (Rata Bawah / Bottom Alignment)**:
  - Masalah umum: Karena bounding box icon berbeda-beda (21x21, 21x19, 19x20, 21x18), jika tidak diatur rata bawah, baseline teks di bawahnya akan naik-turun dan bergelombang.
  - Solusi baku:
    1. Bungkus setiap ikon di dalam `.x-nav-icon-box`:
       ```css
       height: 22px;
       width: 24px;
       min-height: 22px;
       max-height: 22px;
       display: flex;
       align-items: flex-end; /* Ikon rata bawah di dalam box */
       justify-content: center;
       margin: 0 0 9px 0;
       ```
    2. Label teks menggunakan kotak seragam:
       ```css
       width: 100%;
       height: 14px;
       line-height: 14px;
       display: flex;
       align-items: center;
       justify-content: center;
       font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
       font-size: 12px;
       font-weight: 700;
       color: #0F172A;
       white-space: nowrap;
       ```
    Dengan rumus ini, seluruh teks menu dijamin **100% rata bawah (baseline horizontal sempurna)** di koordinat Y yang identik.
- **State Aktif**:
  - **Top Indicator Bar**: Bar hijau aksen menempel di sisi paling atas item aktif:
    ```css
    .x-merchant-mobile-nav-item.active::before {
      content: "" !important;
      position: absolute !important;
      top: 0 !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      width: 40px !important;
      height: 5px !important;
      border-radius: 0 0 5px 5px !important;
      background: #00A637 !important;
      z-index: 10 !important;
    }
    ```
  - **Ikon Aktif**: Warna berubah menjadi `#00A637` (`color: #00A637; fill: #00A637;`)
  - **Ikon Inaktif**: Warna default `#0F172A` (`color: #0F172A; fill: #0F172A;`)
  - **Label Teks**: Tetap `#0F172A` (baik aktif maupun inaktif, konsisten sesuai desain Figma).
- **Pembersihan Dummy OS Chrome**: Mockup iOS Home Bar (`w-32 h-[5px] bg-zinc-800 rounded-[100px]`) digantikan sepenuhnya oleh safe-area CSS `env(safe-area-inset-bottom)`.

---

## 4. Checklist Wajib Sebelum Menghasilkan Kode

Sebelum menuliskan kode ke dalam repositori saat menerima snippet desain baru:

- [ ] **Tidak ada atribut `className`** (hanya `class` standar HTML).
- [ ] **Tidak ada koordinat pixel absolut** (`top-[Xpx] left-[Ypx]`) untuk menyusun urutan layout.
- [ ] **Tidak ada kontainer fixed viewport** (`w-96`, `w-[375px]`) pada container level terluar.
- [ ] **Tidak ada dummy OS mockup element** (home bar, status bar tiruan).
- [ ] **Semua elemen interaktif menggunakan `<button type="button">` atau `<a>`** dengan atribut aksesibilitas (`aria-label`, `aria-current`).
- [ ] **Ikon vektor menggunakan SVG bersih dengan `fill="currentColor"`**.
- [ ] **Styling ditempatkan di file CSS yang relevan** dengan scoped selector, bukan inline styling yang berantakan.
- [ ] **Logika interaksi terhubung end-to-end** dengan controller JavaScript dan router yang aktif.

---
**Dokumen ini adalah aturan wajib yang mengikat. Setiap agen AI diinstruksikan untuk mematuhi dokumen ini tanpa perlu diperingatkan ulang oleh pengguna.**
