# Xentra — Catalog v1 UI/UX Contract

**Status:** DRAFT untuk review pemilik produk
**Tanggal:** 2026-10-05
**Mengikuti:** `docs/XENTRA_UI_FIRST_WORKFLOW_MENTAL_MODEL.md` (UI dulu, backend menyusul)
**Melengkapi:** `docs/decisions/catalog-menu-domain-contract-v1.md` (business contract)
**Scope:** Owner Dashboard (Catalog) + Customer PWA (kartu & detail Menu)

> Dokumen ini mendefinisikan **apa yang dilihat dan dilakukan user** lebih dulu.
> Backend hanya menyediakan minimum yang dibutuhkan layar-layar di bawah.

---

## 1. Prinsip

1. **UI dulu, backend sesudah.** Backend tidak boleh memaksa alur yang tidak intuitif.
2. **Es Teh Manis test.** Merchant biasa harus bisa membuat satu menu sederhana yang
   langsung bisa dijual tanpa berurusan dengan istilah teknis (Product, SKU, composition,
   resolver, migration).
3. **Progressive disclosure.** Hal teknis (SKU, stok, komposisi Item) muncul hanya saat
   dibutuhkan, bukan di depan.
4. **Satu istilah per konsep.** Owner memakai **Item**, bukan Product.

---

## 2. Information Architecture (Owner)

```
Catalog
├── Master Menu
└── Master Category
    ├── Category
    ├── Judul
    ├── Rasa
    └── Item
```

- Catalog tepat **2 area**. Tidak ada "Produk Master", "Menu Cabang", "Kelengkapan",
  "Level", atau "Judul" sebagai area di luar struktur ini.
- **Menu Cabang** bukan area Catalog → pindah ke grup **Cabang** (operasional cabang).
- Setiap tab Master Category memakai pola kartu yang sama: **status ON/OFF**, **Edit**,
  dan **Hapus/Arsipkan** (lihat §7).

---

## 3. Master Category

### 3.1 Category
- Daftar kartu: nama, jumlah Menu yang memakai, toggle ON/OFF, Edit, Hapus/Arsipkan.
- Category **hanya pengelompokan**. Tidak punya Rasa, tidak punya Judul sebagai child,
  tidak punya Item.
- Tidak ada Sub Category di UI mana pun.

### 3.2 Judul
- Master Brand-scoped: `name`, `sort_order`, `is_active`.
- Kartu: nama Judul, jumlah Menu yang memakai, toggle ON/OFF, Edit, Hapus/Arsipkan.
- Judul **bukan field bebas** dan **bukan child Category**. Relasinya ke Menu sama seperti
  Rasa: master yang direferensikan Menu.
- Pembuatan dari editor Menu lewat tombol `[ + ]` (bottom sheet), hasilnya langsung muncul
  sebagai opsi dropdown.
- Judul dipakai sebagai **judul customer**.

### 3.3 Rasa
- Sama seperti sekarang (master Brand-scoped, ON/OFF, edit, hapus/arsip).
- **Opsional** dan dekoratif: Menu boleh tanpa Rasa.
- Rasa "Original" tetap bukan subtitle customer.

### 3.4 Item
- Istilah UI: **Item** (bukan Product / Produk Master).
- Daftar kartu: foto, nama Item, status stok, toggle ON/OFF, Edit, Hapus/Arsipkan.
- **Kolom SKU berbentuk checkbox**, bukan textbox bebas:

```
[ ] Kelola stok (pakai SKU)

  dicentang  →  [ SKU: __________________ ]   ← textbox muncul, wajib diisi
  tidak      →  textbox tersembunyi, SKU kosong (Item non-stock)
```

- SKU terisi → Item **stock-managed** → ikut inventaris cabang.
- SKU kosong → Item **non-stock** → tidak membatasi ketersediaan Menu.
- **Guard saat mematikan**: kalau Item masih punya stok > 0 di cabang mana pun, toggle
  tidak bisa dimatikan. UI menjelaskan: "Stok Item ini masih X di Cabang Y. Nolkan stok
  dulu sebelum mematikan pengelolaan stok." Server menolak juga (bukan hanya UI).
- Jumlah/pergerakan stok tetap diatur di **Cabang → Stok**, bukan di sini.

---

## 4. Master Menu

### 4.1 Daftar Menu
- Kartu: foto Menu (placeholder netral bila kosong), Judul + Rasa, Category (grup),
  harga, badge status (Draft/Aktif/Arsip), toggle ON/OFF, Edit, Arsipkan.
- Pencarian: Judul dan Rasa (case-insensitive, spasi dirapikan). **Bukan** SKU/nama Item.
- Filter: Category, status.
- Tombol utama: **+ Tambah Menu** (tidak ada pilihan "Satuan/Paket").

### 4.2 Editor Menu (satu form, tanpa pilihan tipe)

Urutan field dari atas ke bawah:

```
1. Category            [ dropdown ]                ← wajib (pengelompokan)
2. Judul               [ dropdown ] [ + ]           ← wajib; TIDAK ada field judul bebas
3. Rasa                [ dropdown ] [ + ]           ← opsional
4. Pedas
   [x] Pedas
   [ 1 ][ 2 ][ 3 ][ 4 ]   ← horizontal scale, hanya aktif kalau checkbox dicentang
5. Harga Jual          [ input mata uang ]
6. Foto Menu           [ pilih foto ] (crop 1:1)    ← milik Menu, bukan foto Item
7. Item & jumlah       baris 1..N
      [ Item dropdown ] [ qty ] [ hapus ]
      + Tambah Item
8. Status              (Draft / Aktif)
   [ Batal ] [ Simpan Draft ] [ Simpan & Aktifkan ]
9. Preview Customer    (kartu seperti di Customer PWA)
```

Aturan interaksi:

- **Rekomendasi Judul per Category.** Begitu Category dipilih, dropdown Judul
  **difilter** ke Judul yang berkaitan dengan Category itu (mis. Category "Udang" →
  Judul yang mengandung "udang"). Kalau tidak ada yang cocok, seluruh Judul tetap
  dapat dipilih supaya Menu tidak pernah buntu, disertai keterangan singkat.
- **Judul dan Rasa memakai pola `dropdown + [ + ]`** yang sama seperti Rasa sekarang:
  `[ + ]` membuka bottom sheet master-inline, dan hasilnya langsung menjadi opsi.
- **Item 1..N.** Satu Item boleh dipakai banyak Menu. Item yang sama tidak boleh muncul
  dua kali dalam satu Menu; jumlah unit diatur lewat `qty` (bilangan bulat ≥ 1).
  Tidak ada konsep "Paket".
- **Pedas bukan dropdown.** Checkbox + horizontal scale 1..4. Kalau tidak dicentang:
  scale nonaktif dan customer tidak melihat indikator Pedas. UI tidak menamai arti tiap
  level (tidak ada "level 1 = tidak pedas").
- **Validasi**:
  - Draft  : wajib Category + Judul saja. Harga, Item, Rasa, Pedas, Foto boleh kosong.
  - Aktif  : wajib Category + Judul + harga + minimal 1 Item.
- Item/SKU/komposisi **tidak boleh muncul** di preview customer.

### 4.3 Es Teh Manis test (wajib lolos)

Merchant baru, tanpa pengetahuan teknis, harus bisa menyelesaikan ini tanpa membuka
tab lain lebih dari sekali:

```
1. Master Menu → + Tambah Menu
2. Category: Minuman
3. Judul: [ + ] → ketik "Es Teh Manis" → simpan → otomatis terpilih
4. Rasa: (dilewati)                       ← boleh kosong
5. Harga: 5.000
6. Item: [ + ] → ketik "Teh" → simpan → qty 1
7. Simpan & Aktifkan
```

Hasil: satu Menu "Es Teh Manis" Rp5.000 langsung muncul di Customer PWA. Tidak ada
istilah Product/SKU/komposisi yang perlu dipahami, dan tidak ada langkah "buat Product
dulu, baru buat Menu".

---

## 5. Menu Cabang (dipindah ke grup Cabang)

- Pindah dari Catalog ke **Cabang** sebagai surface operasional: adopsi Menu, ketersediaan
  per cabang, override harga cabang (bila didukung).
- Bukan area Master Catalog; tidak membuat Master Menu atau Item baru.
- Label menu tetap memakai Judul (+ Rasa) milik Master.

---

## 6. Customer PWA

### 6.1 Kartu Menu
- Foto: **milik Menu** (placeholder netral bila kosong). Tidak pernah otomatis memakai
  foto Item pertama.
- Judul di baris atas, Rasa di baris bawah — **satu ukuran font, satu warna** (bukan
  subtitle kecil/redup). Contoh: "Ayam Geprek" (atas) + "Sambal Ijo" (bawah).
- Harga milik Menu.
- Isi Menu ditampilkan sebagai **daftar nama Item saja**: `ayam, nasi, …`
  (tanpa label "Item:", tanpa SKU, tanpa ID, tanpa qty, tanpa flag stok).
- Indikator Pedas hanya muncul bila Pedas aktif.
- Yang **tidak boleh** tampil di Customer PWA: `menu_type`/SINGLE/PACKAGE, `package_name`,
  SKU, nama/ID Item sebagai identitas, flag stok, nama atau ID internal.

### 6.2 Pencarian Customer
- Berdasarkan Judul dan Rasa. **Bukan** SKU, bukan qty, bukan Pedas.
- Hasil diperbarui saat mengetik; query kosong mengembalikan daftar penuh.

---

## 7. Delete vs Arsip (konsisten dengan FK)

- Master yang **masih dipakai** (Category/Judul/Rasa/Item yang direferensikan Menu atau
  riwayat) → tombolnya **Arsipkan/Nonaktifkan**, bukan Hapus.
- Hapus hanya muncul untuk master yang **benar-benar tidak dipakai**.
- Kalimat UI dan perilaku server harus sama: tidak boleh ada tombol Hapus yang lalu gagal
  karena foreign key.
- Arsip = tidak muncul untuk Menu baru dan tidak muncul di Customer PWA, tetapi riwayat
  lama tetap utuh.

---

## 8. Minimum backend yang dibutuhkan UI ini

Ditulis **setelah** layar di atas disetujui (urutan UI-first). Gambaran awalnya:

- Master `menu_titles` (Judul): Brand-scoped, `name`, `slug`, `sort_order`, `is_active`,
  CRUD + proteksi dipakai.
- Menu: `title_id` (wajib), `category_id` (pengelompokan, wajib), `rasa_id` (opsional),
  `spice_enabled` + `spice_level`, `selling_price`, `media_id`, `status`, `items[]`
  (1..N, tanpa subtype). Identitas: (Category + Judul + Rasa), NULL-safe.
- Item: penanda stock dari keberadaan SKU + guard stok-nol saat mematikan.
- Customer resolver: Judul + Rasa + Category + Media + harga + Pedas + daftar nama Item.
- Sub Category: dipensiunkan dari UI; datanya dimigrasikan ke Judul dan dicatat.

---

## 9. Yang diminta dari review ini

1. Setujui/tolak **urutan field editor Menu** (§4.2).
2. Setujui/tolak **aturan rekomendasi Judul per Category** (§4.2) — saya usulkan filter
   dengan fallback "tampilkan semua" supaya tidak buntu.
3. Setujui/tolak tampilan customer **Judul (atas) + Rasa (bawah) satu ukuran font**
   (§6.1) dan daftar **nama Item saja** tanpa label "Item:".
4. Setujui/tolak aturan **Delete vs Arsip** (§7).
