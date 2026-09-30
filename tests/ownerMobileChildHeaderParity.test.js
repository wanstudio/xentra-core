/**
 * Regression: satu gaya header untuk semua child page Owner mobile.
 *
 * Acuan resminya adalah header "Tambah Produk" (#product-editor-mobile-header):
 *   chevron kembali (bulat-persegi 40x40, latar #f1f5f9) + judul + deskripsi,
 *   dengan posisi dan jarak yang sama di semua halaman.
 *
 * Masalah yang dikunci: Kategori dan Produk Master dulu menyimpang — chevron-nya
 * 30x30 bulat dan deskripsinya menjorok 38px, karena override khusus per halaman.
 *
 * Yang diuji:
 *   HDR-01..03  markup semua child page memakai blok header yang sama
 *   HDR-04..05  Kategori & Produk Master tidak lagi memakai kelas gaya lama
 *   HDR-06..08  hanya ada SATU sumber ukuran/warna chevron & deskripsi
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.join(__dirname, '../apps/merchant-dashboard/index.html');
const CSS_PATH = path.join(__dirname, '../apps/merchant-shared/css/dashboard.css');

const html = fs.readFileSync(HTML_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function section(startAnchor, endAnchor) {
  const start = html.indexOf(startAnchor);
  const end = html.indexOf(endAnchor, start + 1);
  assert.ok(start !== -1 && end > start, 'section ' + startAnchor + '..' + endAnchor + ' harus ada');
  return html.slice(start, end);
}

// ── HDR-01..03: satu blok header untuk semua halaman ──

test('HDR-01: semua child page memakai blok header yang sama dengan acuan', () => {
  const headers = count(html, 'class="x-owner-child-mobile-header"');
  assert.ok(headers >= 8, 'harus ada minimal 8 blok header child page, dapat ' + headers);

  // Setiap tombol kembali memakai kelas kanonik yang sama.
  assert.ok(!/class="x-title-back-btn"/.test(html),
    'tombol kembali tidak boleh memakai .x-title-back-btn tanpa .x-owner-mobile-page-back');
  assert.ok(count(html, 'x-title-back-btn x-owner-mobile-page-back') >= 8,
    'semua tombol kembali harus memakai kelas kanonik yang sama');
  assert.ok(count(html, 'x-owner-page-back-icon') >= 8,
    'semua tombol kembali harus memakai ikon chevron yang sama');
});

test('HDR-02: setiap judul header dibungkus <span> seperti acuan', () => {
  // Judul sebagai teks telanjang tidak bisa di-ellipsis dan tidak seragam.
  const titleBlocks = html.match(/<h3 class="x-owner-mobile-page-title">[\s\S]*?<\/h3>/g) || [];
  assert.ok(titleBlocks.length >= 8, 'harus ada minimal 8 judul header child page');
  titleBlocks.forEach((block, i) => {
    assert.ok(/<span[^>]*>[^<]/.test(block),
      'judul header #' + i + ' harus dibungkus <span>: ' + block.replace(/\s+/g, ' ').slice(0, 120));
  });
});

test('HDR-03: deskripsi memakai kelas yang sama di semua halaman', () => {
  const subs = count(html, 'class="x-owner-mobile-page-sub"');
  assert.ok(subs >= 8, 'semua deskripsi header harus memakai .x-owner-mobile-page-sub, dapat ' + subs);
});

// ── HDR-04..05: Kategori & Produk Master ikut acuan ──

test('HDR-04: Kategori memakai blok header acuan, bukan gaya lama', () => {
  const kategori = section('id="tab-catalog-categories"', 'id="master-reference-tabs"');
  assert.ok(kategori.includes('class="x-owner-child-mobile-header"'),
    'Kategori harus memakai blok header child page');
  assert.ok(kategori.includes('<span>Kategori</span>'), 'judul Kategori harus dibungkus <span>');
  assert.ok(kategori.includes('x-title-back-btn x-owner-mobile-page-back'),
    'tombol kembali Kategori harus memakai kelas kanonik');
  assert.ok(kategori.includes('class="x-owner-mobile-page-sub"'),
    'deskripsi Kategori harus memakai kelas kanonik');
});

test('HDR-05: Produk Master memakai blok header acuan dan tetap punya CTA-nya', () => {
  const products = section('id="product-list-view"', 'id="prod-search-input"');
  assert.ok(products.includes('class="x-owner-child-mobile-header"'),
    'Produk Master harus memakai blok header child page');
  assert.ok(products.includes('<span>Produk Master</span>'), 'judul Produk Master harus dibungkus <span>');
  assert.ok(products.includes('x-title-back-btn x-owner-mobile-page-back'),
    'tombol kembali Produk Master harus memakai kelas kanonik');
  assert.ok(products.includes('id="btn-add-product-main"'),
    'CTA Tambah Produk Baru tidak boleh hilang');
});

test('HDR-06: kelas gaya lama Produk Master/Kategori sudah tidak dipakai', () => {
  assert.ok(!html.includes('x-master-products-title'),
    'HTML tidak boleh lagi memakai .x-master-products-title');
  assert.ok(!html.includes('x-master-products-sub'),
    'HTML tidak boleh lagi memakai .x-master-products-sub');
  assert.ok(!css.includes('x-master-products-title'),
    'CSS tidak boleh menyisakan aturan .x-master-products-title');
  assert.ok(!css.includes('x-master-products-sub'),
    'CSS tidak boleh menyisakan aturan .x-master-products-sub');
});

// ── HDR-07..09: satu sumber ukuran/warna ──

test('HDR-07: tidak ada override chevron khusus per halaman', () => {
  assert.ok(!css.includes('#product-list-view .x-title-back-btn'),
    'Produk Master tidak boleh punya override chevron sendiri');
  assert.ok(!css.includes('#tab-catalog-categories .x-title-back-btn'),
    'Kategori tidak boleh punya override chevron sendiri');

  // Chevron didefinisikan sekali oleh blok header bersama.
  const canonical = css.match(/\.x-title-back-btn\.x-owner-mobile-page-back \{([\s\S]*?)\}/);
  assert.ok(canonical, 'aturan kanonik .x-title-back-btn.x-owner-mobile-page-back harus ada');
  const body = canonical[1];
  assert.ok(/width:\s*40px/.test(body) && /height:\s*40px/.test(body),
    'chevron acuan harus 40x40');
  assert.ok(/border-radius:\s*12px/.test(body), 'chevron acuan harus rounded-12, bukan bulat');
  assert.ok(/background:\s*#f1f5f9/.test(body), 'latar chevron acuan harus #f1f5f9');
});

test('HDR-08: deskripsi memakai satu offset 48px seperti acuan', () => {
  const subRule = css.match(/\.x-owner-child-mobile-header \.x-owner-mobile-page-sub,[\s\S]*?\{([\s\S]*?)\}/);
  assert.ok(subRule, 'aturan deskripsi header bersama harus ada');
  assert.ok(/margin:\s*4px 0 0 48px/.test(subRule[1]),
    'deskripsi harus sejajar teks judul (margin kiri 48px), bukan 38px');
  assert.ok(!/#product-list-view \.x-master-products-sub/.test(css) &&
            !/#tab-catalog-categories \.x-master-products-sub/.test(css),
    'tidak boleh ada offset deskripsi khusus per halaman sisa gaya lama');
});

test('HDR-10: judul/deskripsi header yang diisi router punya id di markup', () => {
  // Router (dashboard.js) mengisi judul mobile secara dinamis. Kalau id-nya tidak ada,
  // halaman tampak statis dan berbeda perilaku dari acuan Tambah Produk.
  [
    'product-editor-mobile-title',
    'product-editor-mobile-subtitle',
    'product-detail-mobile-title',
    'order-detail-mobile-title',
    'branch-editor-mobile-title',
    'menus-context-title',
    'menus-context-subtitle',
    'customers-mobile-detail-subtitle'
  ].forEach((id) => {
    assert.ok(html.includes('id="' + id + '"'), id + ' harus ada di markup');
  });
});

test('HDR-09: header yang berdampingan dengan tombol aksi memakai jarak baris flex', () => {
  assert.ok(
    css.includes('.x-panel-header-flex > .x-owner-child-mobile-header'),
    'blok header di baris flex (Produk Master/Cabang/Pelanggan) tidak memakai margin bawahnya'
  );
});

// ── HDR-11..13: halaman hub Bisnis lain memakai header yang sama ──

const BUSINESS_HUB_PAGES = [
  { name: 'Stok', anchor: 'id="tab-stock"', title: 'Stok' },
  { name: 'Cabang Resto', anchor: 'id="tab-branches"', title: 'Cabang Resto' },
  { name: 'Pelanggan', anchor: 'id="tab-customers"', title: 'Pelanggan' },
  { name: 'Marketing & Promo', anchor: 'id="tab-marketing"', title: 'Marketing &amp; Promo' },
  { name: 'Tim & Akses', anchor: 'id="tab-tim"', title: 'Tim &amp; Akses' },
  { name: 'Laporan', anchor: 'id="tab-reports"', title: 'Laporan' },
  { name: 'Identitas & Branding', anchor: 'id="tab-settings"', title: 'Identitas &amp; Branding' }
];

test('HDR-11: semua halaman hub Bisnis memakai blok header + chevron kembali yang sama', () => {
  BUSINESS_HUB_PAGES.forEach((page) => {
    const section = html.slice(html.indexOf(page.anchor));
    assert.ok(section.slice(0, 1200).includes('class="x-owner-child-mobile-header"'),
      page.name + ' harus memakai blok header acuan');
    assert.ok(section.slice(0, 1200).includes('x-title-back-btn x-owner-mobile-page-back'),
      page.name + ' harus punya tombol kembali dengan kelas kanonik');
    assert.ok(section.slice(0, 1200).includes('class="x-owner-mobile-page-sub"'),
      page.name + ' harus punya deskripsi dengan kelas kanonik');
  });
});

test('HDR-12: judul tiap halaman hub Bisnis dibungkus <span> seperti acuan', () => {
  BUSINESS_HUB_PAGES.forEach((page) => {
    const section = html.slice(html.indexOf(page.anchor));
    assert.ok(section.slice(0, 1200).includes('<span>' + page.title + '</span>') ||
              section.slice(0, 1200).includes('<span id="settings-mobile-title">' + page.title + '</span>'),
      page.name + ' harus punya judul <span> berisi "' + page.title + '"');
  });
});

test('HDR-13: tidak ada lagi header gaya lama bergaya emoji/kicker di halaman hub Bisnis', () => {
  assert.ok(!html.includes('x-owner-stock-kicker'),
    'kicker INVENTORY sudah digantikan blok header acuan');
  assert.ok(!html.includes('Cabang Resto & Aturan Ongkir'),
    'judul lama Cabang harus sudah digantikan header acuan');
  assert.ok(!html.includes('Data & Loyalitas Pelanggan'),
    'judul lama Pelanggan harus sudah digantikan header acuan');
  const marketing = html.slice(html.indexOf('id="tab-marketing"'));
  assert.ok(!marketing.slice(0, 1200).includes('x-content-header'),
    'header gaya lama Marketing sudah digantikan blok header acuan');
  assert.ok(!css.includes('.x-owner-stock-kicker') && !css.includes('.x-owner-stock-header h2'),
    'CSS header Stok lama harus ikut dibuang');
});
