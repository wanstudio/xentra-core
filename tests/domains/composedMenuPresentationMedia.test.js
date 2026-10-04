'use strict';

/**
 * MENU PRESENTATION MEDIA — Menu memiliki foto customer-facing sendiri.
 *
 * Contract: docs/decisions/xentra-menu-presentation-media-v1.md
 *
 * Sebelumnya "foto menu" selalu diambil transitif dari komponen Product, sehingga
 * Menu Paket (3 komponen) tidak bisa punya foto sendiri. Test ini mengunci:
 *   MPM-01..02  schema media Menu + tabel bukti migrasi
 *   MPM-03..04  Media Engine mengenal entity/asset `menu`
 *   MPM-05      resolver mengeluarkan media Menu, TANPA fallback foto Product
 *   MPM-06      komponen tetap membawa foto Product (isi komposisi)
 *   MPM-07      update Menu tidak menimpa media
 *   MPM-08      media Menu dilindungi dari garbage collection
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const ComposedMenuService = require('../../domains/catalog/services/ComposedMenuService');
const ComposedMenuResolver = require('../../domains/catalog/services/ComposedMenuResolver');
const DataAccess = require('../../core/data/DataAccess');
const MediaService = require('../../core/media/MediaService');
const { IMAGE_RULES } = require('../../core/domain/ImageValidator');
const MediaReferenceResolver = require('../../core/media/MediaReferenceResolver');

const ORG = 'mpm_org';
const BRAND = 'mpm_brand';
const CATEGORY = 'mpm_category';
const SUB_GEPREK = 'mpm_sub_geprek';
const SUB_PAKET = 'mpm_sub_paket';
const PRODUCT_A = 'mpm_product_a';
const PRODUCT_B = 'mpm_product_b';
const MENU_MEDIA = 'mpm_media_menu';

function columnNames(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

test.before(async () => {
  await db.ready;
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'MPM Org', 'mpm-org')").run(ORG);
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'MPM Brand', 'mpm-brand')").run(BRAND, ORG);
  db.prepare("INSERT OR IGNORE INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, 'Makanan MPM', 'makanan-mpm', 1)").run(CATEGORY, BRAND);
  db.prepare("INSERT OR IGNORE INTO sub_categories (id, brand_id, category_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'Geprek', 'geprek-mpm', 1, 1)").run(SUB_GEPREK, BRAND, CATEGORY);
  db.prepare("INSERT OR IGNORE INTO sub_categories (id, brand_id, category_id, name, slug, sort_order, is_active) VALUES (?, ?, ?, 'Paket', 'paket-mpm', 2, 1)").run(SUB_PAKET, BRAND, CATEGORY);
  // Product A punya foto Product (media + legacy). Product B hanya legacy image_url.
  db.prepare("INSERT OR IGNORE INTO media_assets (id, brand_id, storage_key, mime_type, asset_type, status) VALUES (?, ?, 'originals/mpm-a.webp', 'image/webp', 'product', 'ready')").run('mpm_media_product_a', BRAND);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, media_id, image_url, image, is_active) VALUES (?, ?, ?, 'Ayam MPM', 'ayam-mpm', 0, 'mpm_media_product_a', '/img/ayam-mpm.webp', '/img/ayam-mpm.webp', 1)").run(PRODUCT_A, BRAND, CATEGORY);
  db.prepare("INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, price, image_url, is_active) VALUES (?, ?, ?, 'Nasi MPM', 'nasi-mpm', 0, '/img/nasi-mpm.jpg', 1)").run(PRODUCT_B, BRAND, CATEGORY);
});

function masterMenus() {
  return ComposedMenuResolver.resolveMasterMenu({ brandId: BRAND });
}

function findMenu(menuId) {
  return masterMenus().find((menu) => String(menu.id) === String(menuId));
}

test('MPM-01: menus punya kolom presentation media + tabel bukti migrasi', () => {
  const columns = columnNames('menus');
  assert.ok(columns.includes('media_id'), 'menus.media_id canonical');
  assert.ok(columns.includes('image_url'), 'menus.image_url delivery-compatible');
  assert.ok(columns.includes('image'), 'menus.image delivery-compatible');

  const logColumns = columnNames('menu_media_migrations');
  assert.ok(logColumns.includes('menu_id'));
  assert.ok(logColumns.includes('source_product_id'));
  assert.ok(logColumns.includes('status'), 'status migrasi eksplisit (COPIED/SKIPPED_*)');
  assert.ok(logColumns.includes('media_id'), 'media hasil salinan tercatat');

  const index = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_menus_media_id'").get();
  assert.ok(index, 'index media_id ada');
});

test('MPM-02: schema media Menu idempotent (init ulang tidak gagal/duplikat)', () => {
  const { ensureComposedMenuSchema } = require('../../domains/catalog/schema/ComposedMenuSchema');
  assert.doesNotThrow(() => ensureComposedMenuSchema(db));
  const mediaColumns = columnNames('menus').filter((name) => name === 'media_id');
  assert.equal(mediaColumns.length, 1, 'tidak ada kolom duplikat');
});

test('MPM-04: slot media menu = 20 MB, rasio 1:1 (policy sama dengan Product)', () => {
  const rule = IMAGE_RULES.menu;
  assert.ok(rule, 'rule menu terdaftar di ImageValidator');
  assert.equal(rule.maxBytes, 20 * 1024 * 1024);
  assert.equal(rule.targetRatio, 1.0);
  assert.equal(rule.maxMegaPixels, 20);
  assert.deepEqual(rule.allowedExtensions, ['jpg', 'jpeg', 'png', 'webp']);
  assert.equal(rule.label, 'Foto Menu');
});

test('MPM-05: Menu tanpa media TIDAK memakai foto Product sebagai fallback', () => {
  const single = ComposedMenuService.createSingleMenu({
    brandId: BRAND, productId: PRODUCT_A, subCategoryId: SUB_GEPREK, sellingPrice: 15000, status: 'ACTIVE'
  });
  const singleId = single.id || single.menu_id;
  const resolvedSingle = findMenu(singleId);

  // Product A punya media + image_url, tetapi Menu Satuan ini belum punya foto sendiri.
  assert.equal(resolvedSingle.media_id, null, 'menu media_id null, bukan media Product');
  assert.equal(resolvedSingle.image_url, null, 'tidak mengambil /img/ayam-mpm.webp');
  assert.equal(resolvedSingle.image, null);

  const pkg = ComposedMenuService.createPackageMenu({
    brandId: BRAND, packageName: 'Paket MPM', sellingPrice: 35000, status: 'ACTIVE',
    components: [{ productId: PRODUCT_A, quantity: 1 }, { productId: PRODUCT_B, quantity: 1 }]
  });
  const pkgId = pkg.id || pkg.menu_id;
  const resolvedPkg = findMenu(pkgId);
  assert.equal(resolvedPkg.image_url, null, 'Paket tidak mengambil foto komponen mana pun');
  assert.equal(resolvedPkg.media_id, null);
});

test('MPM-05b: Menu Satuan dan Paket masing-masing punya foto sendiri', () => {
  const menus = masterMenus();
  const singleId = menus.find((menu) => menu.menu_type === 'SINGLE' && menu.sub_category && menu.sub_category.id === SUB_GEPREK).id;
  const pkgId = menus.find((menu) => menu.menu_type === 'PACKAGE').id;

  db.prepare("INSERT OR IGNORE INTO media_assets (id, brand_id, storage_key, mime_type, asset_type, status) VALUES (?, ?, 'originals/mpm-menu.webp', 'image/webp', 'menu', 'ready')").run(MENU_MEDIA, BRAND);
  db.prepare("UPDATE menus SET media_id = ?, image_url = ?, image = ? WHERE id = ?").run(MENU_MEDIA, '/menu/mpm-satuan.webp', '/menu/mpm-satuan.webp', singleId);
  db.prepare("UPDATE menus SET image_url = ?, image = ? WHERE id = ?").run('/menu/mpm-paket.webp', '/menu/mpm-paket.webp', pkgId);

  const resolvedSingle = findMenu(singleId);
  assert.equal(resolvedSingle.media_id, MENU_MEDIA, 'foto Menu Satuan milik Menu');
  assert.equal(resolvedSingle.image_url, '/menu/mpm-satuan.webp');

  const resolvedPkg = findMenu(pkgId);
  assert.equal(resolvedPkg.image_url, '/menu/mpm-paket.webp', 'Paket punya foto sendiri, bukan foto komponen');
  assert.notEqual(resolvedPkg.image_url, '/img/ayam-mpm.webp');
});

test('MPM-06: komponen tetap membawa foto Product (isi komposisi, bukan fallback)', () => {
  const menus = masterMenus();
  const pkg = menus.find((menu) => menu.menu_type === 'PACKAGE');
  const images = pkg.components.map((component) => component.image_url || component.image || '');
  assert.ok(images.includes('/img/ayam-mpm.webp'), 'foto Product A tetap tampil di daftar komposisi');
  assert.ok(images.includes('/img/nasi-mpm.jpg'), 'foto Product B tetap tampil di daftar komposisi');
});

test('MPM-07: update Menu (nama/harga/komposisi) tidak menimpa media Menu', () => {
  const menus = masterMenus();
  const pkgId = menus.find((menu) => menu.menu_type === 'PACKAGE').id;
  db.prepare("UPDATE menus SET image_url = ?, image = ? WHERE id = ?").run('/menu/mpm-paket.webp', '/menu/mpm-paket.webp', pkgId);

  ComposedMenuService.updatePackageMenu({
    brandId: BRAND, menuId: pkgId, packageName: 'Paket MPM v2', sellingPrice: 40000,
    components: [{ productId: PRODUCT_A, quantity: 1 }, { productId: PRODUCT_B, quantity: 1 }]
  });

  const row = db.prepare('SELECT image_url, media_id FROM menus WHERE id = ?').get(pkgId);
  assert.equal(row.image_url, '/menu/mpm-paket.webp', 'foto Menu bertahan setelah update');
  assert.equal(findMenu(pkgId).image_url, '/menu/mpm-paket.webp');
});

test('MPM-03: Media Engine menerima entity_type menu dan menolak pasangan asset_type yang salah', async () => {
  db.prepare("INSERT OR IGNORE INTO media_assets (id, brand_id, storage_key, mime_type, asset_type, status) VALUES (?, ?, 'originals/mpm-menu-03.webp', 'image/webp', 'menu', 'ready')").run('mpm_media_menu_03', BRAND);
  const menuId = db.prepare("SELECT id FROM menus WHERE brand_id = ? ORDER BY id LIMIT 1").get(BRAND).id;
  const mediaService = new MediaService();

  await mediaService.attachToEntity({
    mediaId: 'mpm_media_menu_03', brandId: BRAND, entityType: 'menu', entityId: String(menuId)
  });
  const asset = DataAccess.prepare('SELECT attached_to_type, attached_to_id FROM media_assets WHERE id = ?').get('mpm_media_menu_03');
  assert.equal(asset.attached_to_type, 'menu');
  assert.equal(String(asset.attached_to_id), String(menuId));

  // Aset bertipe 'menu' tidak boleh dipakai sebagai foto entity lain, dan sebaliknya.
  await assert.rejects(
    () => mediaService.attachToEntity({
      mediaId: 'mpm_media_menu_03', brandId: BRAND, entityType: 'product', entityId: PRODUCT_A
    }),
    /MEDIA_ASSET_TYPE_MISMATCH|tidak kompatibel/
  );
  await assert.rejects(
    () => mediaService.attachToEntity({
      mediaId: 'mpm_media_product_a', brandId: BRAND, entityType: 'menu', entityId: String(menuId)
    }),
    /MEDIA_ASSET_TYPE_MISMATCH|tidak kompatibel/
  );
});

test('MPM-08: media yang dipakai Menu dilindungi dari garbage collection', async () => {
  const resolver = new MediaReferenceResolver(DataAccess);
  const check = await resolver.checkReference({ mediaId: MENU_MEDIA, brandId: BRAND });
  assert.equal(check.isReferenced, true, 'aset menu dianggap dipakai');
  assert.ok(check.references.some((ref) => ref.type === 'menu'),
    'referensi bertipe menu terdeteksi: ' + JSON.stringify(check.references));
});
