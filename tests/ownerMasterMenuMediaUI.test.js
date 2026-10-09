'use strict';

/**
 * OWNER MASTER MENU — kontrol foto Menu.
 *
 * Contract: docs/decisions/xentra-menu-presentation-media-v1.md
 *
 *   OMM-01  form editor punya kontrol foto Menu (upload/crop/hapus)
 *   OMM-02  picker memakai shared crop editor slot `menu` (1:1)
 *   OMM-03  preview editor menampilkan foto MENU, bukan foto Product
 *   OMM-04  simpan memakai canonical entity media endpoint untuk Menu
 *   OMM-05  kartu daftar punya thumbnail foto Menu + placeholder
 *   OMM-06  tidak ada pipeline upload kedua
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '../apps/merchant-dashboard/index.html'), 'utf8');
const DASHBOARD_JS = fs.readFileSync(path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');
const CROP_EDITOR = fs.readFileSync(path.join(__dirname, '../apps/merchant-shared/js/crop-editor.js'), 'utf8');
const DASHBOARD_CSS = fs.readFileSync(path.join(__dirname, '../apps/merchant-shared/css/dashboard.css'), 'utf8');

test('OMM-01: form Master Menu punya kontrol foto Menu', () => {
  ['cm-image-preview', 'cm-image-empty', 'btn-cm-image-pick', 'btn-cm-image-remove', 'cm-image-file'].forEach((id) => {
    assert.ok(HTML.includes('id="' + id + '"'), 'elemen ' + id + ' ada di editor Menu');
  });
  assert.ok(/JPG, PNG, atau WebP · Maks\. 20 MB · Rasio 1:1/.test(HTML),
    'label format dan rasio foto Menu');
  assert.ok(/accept="image\/jpeg,image\/png,image\/webp"/.test(HTML), 'format input sesuai slot');
});

test('OMM-02: picker memakai shared crop editor slot menu', () => {
  assert.ok(/assetType:\s*'menu'/.test(DASHBOARD_JS), 'crop editor memakai assetType menu');
  assert.ok(/aspectRatio:\s*1\.0/.test(DASHBOARD_JS));
  assert.ok(/Potong & Posisikan Foto Menu \(1:1\)/.test(DASHBOARD_JS), 'judul crop khusus Menu');
  assert.ok(/menu:\s*1\.0/.test(CROP_EDITOR), 'ratioMap crop editor mengenal menu');
});

test('OMM-03: preview editor memakai foto Menu, bukan foto Product', () => {
  assert.ok(/image = _masterMenuImagePreviewSrc \|\| '';/.test(DASHBOARD_JS),
    'preview mengambil state foto Menu');
  const previewBlock = DASHBOARD_JS.slice(
    DASHBOARD_JS.indexOf('function renderOwnerMasterMenuPreview'),
    DASHBOARD_JS.indexOf('async function loadOwnerMasterMenuReferences')
  );
  assert.ok(!/firstProduct/.test(previewBlock), 'tidak lagi memilih foto Product pertama untuk Paket');
  assert.ok(!/singleProduct/.test(previewBlock), 'tidak lagi memakai foto Product untuk Satuan');
  assert.ok(/resetOwnerMasterMenuImageState\(menu\.image_url \|\| menu\.preview_url/.test(DASHBOARD_JS),
    'saat edit, foto diambil dari Menu');
});

test('OMM-04: simpan memakai canonical entity media endpoint untuk Menu', () => {
  assert.ok(/\/admin\/media\/entity\/menus\/' \+ encodeURIComponent\(savedMenuId\) \+ '\/image'/.test(DASHBOARD_JS),
    'upload memakai endpoint canonical Menu');
  const menuEntityCalls = (DASHBOARD_JS.match(/\/admin\/media\/entity\/menus\//g) || []).length;
  assert.ok(menuEntityCalls >= 2, 'upload DAN hapus foto memakai endpoint canonical Menu (2 pemanggilan)');
  assert.ok(/method:\s*'DELETE'/.test(DASHBOARD_JS), 'ada jalur penghapusan foto Menu');
  assert.ok(/image_base64[\s\S]{0,200}mime_type[\s\S]{0,200}original_filename/.test(DASHBOARD_JS),
    'payload upload sesuai kontrak Media Engine');
  assert.ok(/_masterMenuCropSpec/.test(DASHBOARD_JS), 'crop_spec diteruskan ke server');
});

test('OMM-05: kartu daftar Master Menu punya thumbnail + placeholder netral', () => {
  assert.ok(/x-master-menu-card-thumb/.test(DASHBOARD_JS), 'kartu daftar memakai thumbnail');
  assert.ok(/x-master-menu-card-thumb-empty/.test(DASHBOARD_JS), 'placeholder bila belum ada foto');
  assert.ok(/\.x-master-menu-card-thumb\s*\{/.test(DASHBOARD_CSS), 'style thumbnail tersedia');
  assert.ok(/\.x-master-menu-card-thumb-empty\s*\{/.test(DASHBOARD_CSS), 'style placeholder tersedia');
});

test('OMM-06: tidak ada pipeline upload kedua / bypass Media Engine', () => {
  assert.ok(!/FileReader[\s\S]{0,400}fs\.write|formidable|multer/.test(DASHBOARD_JS),
    'tidak ada jalur unggah file langsung');
  assert.ok(!/product-image-file[\s\S]{0,80}menu/i.test(DASHBOARD_JS), 'tidak mencampur state foto Product');
  assert.ok(/resetOwnerMasterMenuImageState\(''\)/.test(DASHBOARD_JS), 'editor baru selalu mulai tanpa foto');
});
