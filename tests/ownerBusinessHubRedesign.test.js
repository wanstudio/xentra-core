const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUSINESS_HUB_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/BusinessHub.jsx');
const BUNDLE_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');

test('Owner Business Hub Redesign Suite (1:1 Figma Spec)', async (t) => {
  const businessHubSrc = fs.readFileSync(BUSINESS_HUB_PATH, 'utf8');
  const bundleSrc = fs.readFileSync(BUNDLE_PATH, 'utf8');

  await t.test('1. BusinessHub.jsx defines the 3 canonical sections matching Figma spec', () => {
    assert.ok(businessHubSrc.includes("title: 'Produk & Dapur'"), 'Must contain section Produk & Dapur');
    assert.ok(businessHubSrc.includes("title: 'Outlet & Karyawan'"), 'Must contain section Outlet & Karyawan');
    assert.ok(businessHubSrc.includes("title: 'Pemasaran & Brand'"), 'Must contain section Pemasaran & Brand');
  });

  await t.test('2. Produk & Dapur section contains the 3 kitchen chain pillars in order', () => {
    // Bahan Baku -> Item Master + Resep -> Kategori & Menu
    const bahanIdx = businessHubSrc.indexOf("title: 'Bahan Baku'");
    const itemIdx = businessHubSrc.indexOf("title: 'Item Master + Resep'");
    const catIdx = businessHubSrc.indexOf("title: 'Kategori & Menu'");

    assert.ok(bahanIdx > -1, 'Must contain Bahan Baku card');
    assert.ok(itemIdx > -1, 'Must contain Item Master + Resep card');
    assert.ok(catIdx > -1, 'Must contain Kategori & Menu card');

    assert.ok(bahanIdx < itemIdx && itemIdx < catIdx,
      'Order must be: Bahan Baku -> Item Master + Resep -> Kategori & Menu');

    assert.ok(businessHubSrc.includes("'#business/materials'"), 'Bahan Baku must route to #business/materials');
    assert.ok(businessHubSrc.includes("'#catalog/products'"), 'Item Master + Resep must route to #catalog/products');
    assert.ok(businessHubSrc.includes("'#catalog/categories'"), 'Kategori & Menu must route to #catalog/categories');
  });

  await t.test('3. Outlet & Karyawan section contains Cabang Restoran and Tim & Akses', () => {
    assert.ok(businessHubSrc.includes("title: 'Cabang Restoran'"), 'Must contain Cabang Restoran card');
    assert.ok(businessHubSrc.includes("title: 'Tim & Akses'"), 'Must contain Tim & Akses card');
    assert.ok(businessHubSrc.includes("'#branches'"), 'Cabang Restoran must route to #branches');
    assert.ok(businessHubSrc.includes("'#team'"), 'Tim & Akses must route to #team');
    // Ensure no 'meja' is in the title
    assert.ok(!businessHubSrc.includes("title: 'Cabang & Meja'"), 'Must not have Cabang & Meja');
  });

  await t.test('4. Pemasaran & Brand section contains Promosi, Pelanggan, and Brand', () => {
    assert.ok(businessHubSrc.includes("title: 'Promosi & Banner'"), 'Must contain Promosi & Banner card');
    assert.ok(businessHubSrc.includes("title: 'Pelanggan (CRM)'"), 'Must contain Pelanggan (CRM) card');
    assert.ok(businessHubSrc.includes("title: 'Brand & Kanal Digital'"), 'Must contain Brand & Kanal Digital card');
  });

  await t.test('5. Card and search styling conforms to 1:1 Figma tokens', () => {
    assert.ok(businessHubSrc.includes('rounded-[14px]'), 'Cards must have rounded-[14px]');
    assert.ok(businessHubSrc.includes('outline-[#CBD5E1]'), 'Outline must use #CBD5E1');
    assert.ok(businessHubSrc.includes('w-[45px] h-[45px]'), 'Icon box must be 45x45');
    assert.ok(businessHubSrc.includes('rounded-[10px]'), 'Icon box must have rounded-[10px]');
    assert.ok(businessHubSrc.includes('Cari menu atau pengaturan bisnis'), 'Search placeholder must match Figma');
  });

  await t.test('6. Production bundle contains compiled new Business Hub sections', () => {
    assert.ok(bundleSrc.includes('Produk & Dapur'), 'Compiled bundle must contain Produk & Dapur');
    assert.ok(bundleSrc.includes('Item Master + Resep'), 'Compiled bundle must contain Item Master + Resep');
    assert.ok(bundleSrc.includes('Cabang Restoran'), 'Compiled bundle must contain Cabang Restoran');
    assert.ok(bundleSrc.includes('Outlet & Karyawan'), 'Compiled bundle must contain Outlet & Karyawan');
    assert.ok(bundleSrc.includes('Pemasaran & Brand'), 'Compiled bundle must contain Pemasaran & Brand');
  });
});
