# Panduan Gaya Dropdown — Owner & Merchant PWA (v1)

Berlaku untuk **semua dropdown** di Owner (merchant-dashboard) dan Merchant PWA
(merchant-app, merchant-shared). Tujuannya: tidak ada lagi dua dropdown dengan bentuk,
ukuran, atau perilaku berbeda di satu aplikasi yang sama.

Sumber tunggalnya adalah kelas **`.x-occ-dropdown`** di
`apps/merchant-shared/css/dashboard.css` — awalnya dipakai pemilih periode di Beranda.

## Yang sudah memakainya

| Dropdown | Lokasi |
|---|---|
| Pemilih periode | Beranda Owner (`.x-occ-period-bar`) |
| Bagian keuangan | Finance (`Overview`, `Transactions`, …) |
| Filter Metode & Status | Finance → Transactions |
| Filter Kategori | Produk Master |

Dropdown baru **wajib** memakai kelas ini, bukan `select` bawaan browser.

## Struktur

```html
<div class="x-occ-dropdown" id="<nama>-dropdown">
  <button type="button" class="x-occ-dropdown-trigger" id="btn-<nama>"
          aria-haspopup="listbox" aria-expanded="false" aria-label="…"
          onclick="toggle<Nama>()">
    <span id="<nama>-label">Nilai terpilih</span>
    <svg class="x-occ-chevron-icon" aria-hidden="true" width="12" height="12"
         viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  </button>

  <div class="x-occ-dropdown-menu" id="<nama>-menu" role="listbox" aria-label="…">
    <button type="button" class="x-occ-dropdown-item active" role="option"
            data-value="…" aria-selected="true" onclick="pick<Nama>(this)">
      <span>Label</span>
      <svg class="x-occ-check-icon" width="14" height="14" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </button>
  </div>
</div>
```

Jika opsinya diisi JavaScript dari sebuah `select`, **jangan buang select-nya** —
sembunyikan dan jadikan satu-satunya sumber nilai:

```html
<div style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;overflow:hidden;">
  <select id="…">…</select>
</div>
```

Menunya dibangun dari opsi select itu, sehingga tidak ada dua daftar yang bisa berbeda.
Saat item dipilih: tulis nilainya ke select, lalu jalankan `change`-nya sehingga pendengar
yang sudah ada tetap bekerja tanpa diubah.

## Nilai yang dipakai

**Pemicu** (`.x-occ-dropdown-trigger`) — sudah diatur kelasnya, jangan ditimpa:

| Properti | Nilai |
|---|---|
| Lebar | `100%` (memenuhi lebar kolomnya) |
| Tinggi | `42px` |
| Radius | `12px` |
| Latar | `#f8fafc` |
| Garis | `1px solid #cbd5e1` |
| Padding | `0 12px` |
| Tata letak | `inline-flex`, `align-items: center`, **`justify-content: space-between`** |
| Isi | label di **kiri**, chevron di **kanan** — bukan berdempetan |
| Label panjang | dipotong **elipsis** (`text-overflow: ellipsis`), jangan mendorong chevron |

**Menu** (`.x-occ-dropdown-menu`) — tersembunyi, muncul saat induknya berkelas `.open`:
latar putih, radius `14px`, garis `#e2e8f0`, bayangan `0 10px 25px -5px rgba(0,0,0,.12)`,
animasi `occDropdownFadeIn`.

**Item** (`.x-occ-dropdown-item`): item terpilih ditandai kelas **`.active`** +
`aria-selected="true"` **dan** ikon centang (`.x-occ-check-icon`). Penanda ganda ini
disengaja — centang terbaca, kelas aktif memberi gaya.

## Perilaku yang wajib ada

1. **Chevron di kanan, memenuhi lebar** — label kiri, chevron kanan.
2. **Menutup saat menyentuh di luar** — `document.addEventListener('click', …)` dengan
   pemeriksaan `!dropdown.contains(e.target)`.
3. **`aria-expanded`** diset `true`/`false` mengikuti keadaan terbuka.
4. **Tanpa kilau fokus biru.** Fokus ditandai dari warna garis yang menggelap, bukan
   cincin biru. Lihat `.x-input:focus` (garis `#94a3b8`, tanpa `box-shadow`).
5. **Jangan pakai `display` untuk menyembunyikan.** Atribut `hidden` kalah oleh aturan
   kelas seperti `.x-form-group { display: flex }`. Pengaman global
   `[hidden] { display: none !important; }` sudah tersedia — pakai itu.

## Kesalahan yang sudah pernah terjadi

Semuanya nyata, dan semuanya karena menulis nilai baru alih-alih mencari yang sudah ada:

| Kesalahan | Akibat | Benar |
|---|---|---|
| Menulis `select` bawaan browser | bentuk & perilaku beda dari dropdown lain | pakai `.x-occ-dropdown` |
| Mengubah **semua** `#3b82f6` untuk menghapus fokus biru | token `--accent-blue`, ikon metrik, dan keadaan terpilih ikut pudar | ubah hanya aturan `:focus` |
| Menaruh gaya hanya di dalam blok `@media` | desktop kehilangan gayanya | taruh di luar, atau di kedua tempat |
| Menambah `padding` di panel tanpa cek induknya | jarak jadi berlipat (12px induk + 24px sendiri) | samakan dengan halaman pembanding |
| Memakai kelas yang tidak ada (`.x-card`) | kartu kehilangan latar, garis, dan padding | cek kelasnya ada lebih dulu |
| Label menempel ke chevron | lebar dropdown tidak terpakai | `justify-content: space-between` |

**Aturan praktisnya:** sebelum menulis nilai tampilan, cari nilai yang sudah dipakai
halaman atau komponen lain, lalu samakan. Token dan kelasnya hampir selalu sudah ada.
