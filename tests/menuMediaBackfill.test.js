'use strict';

/**
 * MENU PRESENTATION MEDIA BACKFILL — tool migrasi eksplisit.
 *
 * Contract: docs/decisions/xentra-menu-presentation-media-v1.md
 *
 * Runtime fallback bukan mekanisme migrasi. Tool `tools/backfill-menu-media.js`:
 *   BFM-01  dry-run tidak mengubah database
 *   BFM-02  Menu SATUAN menyalin foto komponen tunggalnya + mencatat bukti COPIED
 *   BFM-03  Menu PAKET tidak pernah disalin otomatis
 *   BFM-04  idempotent, dan bukti COPIED tidak tertimpa
 *   BFM-05  --limit dan --brand bekerja (resumable / ter-scope)
 *
 * Test ini menjalankan proses seed + tool sungguhan pada database terpisah.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const TOOL = path.join(REPO, 'tools/backfill-menu-media.js');
const DB_FILE = path.join(os.tmpdir(), 'xentra-menu-backfill-' + process.pid + '.db');

const SEED = `
const db = require(${JSON.stringify(path.join(REPO, 'server/database/db'))});
const Service = require(${JSON.stringify(path.join(REPO, 'domains/catalog/services/ComposedMenuService'))});
db.readyPromise.then(() => {
  db.prepare("INSERT OR IGNORE INTO organizations (id,name,slug) VALUES ('bfm_org','BFM Org','bfm-org')").run();
  db.prepare("INSERT OR IGNORE INTO brands (id,organization_id,name,slug) VALUES ('bfm_brand','bfm_org','BFM Brand','bfm-brand')").run();
  db.prepare("INSERT OR IGNORE INTO categories (id,brand_id,name,slug,is_active) VALUES ('bfm_cat','bfm_brand','Makanan','makanan-bfm',1)").run();
  db.prepare("INSERT OR IGNORE INTO sub_categories (id,brand_id,category_id,name,slug,sort_order,is_active) VALUES ('bfm_sub','bfm_brand','bfm_cat','Geprek','geprek-bfm',1,1)").run();
  db.prepare("INSERT OR IGNORE INTO sub_categories (id,brand_id,category_id,name,slug,sort_order,is_active) VALUES ('bfm_sub2','bfm_brand','bfm_cat','Paket','paket-bfm',2,1)").run();
  db.prepare("INSERT OR IGNORE INTO media_assets (id,brand_id,storage_key,mime_type,asset_type,status) VALUES ('bfm_media','bfm_brand','originals/bfm.webp','image/webp','product','ready')").run();
  db.prepare("INSERT OR IGNORE INTO products (id,brand_id,category_id,name,slug,price,media_id,image_url,is_active) VALUES ('bfm_p1','bfm_brand','bfm_cat','Ayam BFM','ayam-bfm',0,'bfm_media','/img/ayam-bfm.webp',1)").run();
  db.prepare("INSERT OR IGNORE INTO products (id,brand_id,category_id,name,slug,price,image_url,is_active) VALUES ('bfm_p2','bfm_brand','bfm_cat','Nasi BFM','nasi-bfm',0,'/img/nasi-bfm.jpg',1)").run();
  Service.createSingleMenu({ brandId: 'bfm_brand', productId: 'bfm_p1', subCategoryId: 'bfm_sub', sellingPrice: 15000, status: 'ACTIVE' });
  Service.createPackageMenu({ brandId: 'bfm_brand', packageName: 'Paket BFM', sellingPrice: 35000, status: 'ACTIVE',
    components: [{ productId: 'bfm_p1', quantity: 1 }, { productId: 'bfm_p2', quantity: 1 }] });
  console.log('SEEDED');
});
`;

function runNode(script) {
  return execFileSync(process.execPath, ['-e', script], {
    cwd: REPO,
    env: { ...process.env, DB_PATH: DB_FILE },
    encoding: 'utf8'
  });
}

function runTool(args) {
  return execFileSync(process.execPath, [TOOL, ...args], {
    cwd: REPO,
    env: { ...process.env, DB_PATH: DB_FILE },
    encoding: 'utf8'
  });
}

function readState() {
  const out = runNode(`
    const db = require(${JSON.stringify(path.join(REPO, 'server/database/db'))});
    db.readyPromise.then(() => {
      const menus = db.prepare('SELECT id, menu_type, media_id, image_url FROM menus ORDER BY id').all();
      const log = db.prepare('SELECT menu_id, status, media_id FROM menu_media_migrations ORDER BY menu_id').all();
      console.log('STATE:' + JSON.stringify({ menus, log }));
    });
  `);
  return JSON.parse(out.slice(out.indexOf('STATE:') + 6).trim());
}

function summaryOf(output) {
  const pick = (label) => Number((output.match(new RegExp(label + '\\s*:\\s*(\\d+)')) || [])[1] || 0);
  return {
    COPIED: pick('COPIED'),
    SKIPPED_PACKAGE: pick('SKIPPED_PACKAGE'),
    SKIPPED_NO_SOURCE: pick('SKIPPED_NO_SOURCE'),
    SKIPPED_ALREADY_SET: pick('SKIPPED_ALREADY_SET'),
    FAILED: pick('FAILED')
  };
}

test.before(() => {
  try { fs.unlinkSync(DB_FILE); } catch (_) {}
  assert.ok(runNode(SEED).includes('SEEDED'), 'dataset uji siap');
});

test.after(() => {
  try { fs.unlinkSync(DB_FILE); } catch (_) {}
});

test('BFM-01: dry-run melaporkan rencana tanpa mengubah database', () => {
  const before = readState();
  assert.ok(before.menus.every((menu) => !menu.media_id && !menu.image_url), 'awalnya belum ada foto Menu');

  const output = runTool(['--dry-run']);
  const summary = summaryOf(output);
  assert.equal(summary.COPIED, 1, 'satu Menu Satuan punya sumber foto');
  assert.equal(summary.SKIPPED_PACKAGE, 1, 'paket dilaporkan terpisah');
  assert.match(output, /DRY-RUN/);

  const after = readState();
  assert.deepEqual(after.menus, before.menus, 'dry-run tidak mengubah satu baris pun');
  assert.equal(after.log.length, 0, 'dry-run tidak menulis bukti migrasi');
});

test('BFM-02: apply menyalin foto Menu Satuan dan mencatat bukti COPIED', () => {
  const summary = summaryOf(runTool(['--apply']));
  assert.equal(summary.COPIED, 1);
  assert.equal(summary.SKIPPED_PACKAGE, 1);
  assert.equal(summary.FAILED, 0);

  const state = readState();
  const single = state.menus.find((menu) => menu.menu_type === 'SINGLE');
  assert.equal(single.media_id, 'bfm_media', 'media Product komponen tunggal tersalin ke Menu');
  assert.equal(single.image_url, '/img/ayam-bfm.webp');

  const copied = state.log.find((row) => row.status === 'COPIED');
  assert.ok(copied, 'bukti migrasi tercatat');
  assert.equal(copied.menu_id, single.id);
  assert.equal(copied.media_id, 'bfm_media');
});

test('BFM-03: Menu Paket tidak pernah disalin otomatis', () => {
  const state = readState();
  const pkg = state.menus.find((menu) => menu.menu_type === 'PACKAGE');
  assert.equal(pkg.media_id, null, 'paket tetap tanpa foto');
  assert.equal(pkg.image_url, null, 'paket tidak mengambil salah satu foto komponen');

  const row = state.log.find((entry) => entry.menu_id === pkg.id);
  assert.equal(row.status, 'SKIPPED_PACKAGE');
});

test('BFM-04: apply ulang idempotent dan bukti COPIED tidak tertimpa', () => {
  const first = readState().log.find((row) => row.status === 'COPIED');
  const summary = summaryOf(runTool(['--apply']));
  assert.equal(summary.COPIED, 0, 'tidak menyalin ulang');

  const after = readState().log.find((row) => row.menu_id === first.menu_id);
  assert.equal(after.status, 'COPIED', 'bukti COPIED tetap final');
  assert.equal(after.media_id, 'bfm_media');
});

test('BFM-05: --limit dan --brand bekerja', () => {
  const limited = runTool(['--dry-run', '--limit', '1']);
  assert.match(limited, /Menu diperiksa\s*:\s*1/);

  const scoped = runTool(['--dry-run', '--brand', 'bfm_brand']);
  assert.match(scoped, /Menu diperiksa\s*:\s*2/);

  const other = runTool(['--dry-run', '--brand', 'brand_tidak_ada']);
  assert.match(other, /Menu diperiksa\s*:\s*0/);
});
