'use strict';

/**
 * CATALOG v1 — TAB JUDUL (Master Category) + API master Judul.
 *
 * Contract v1: Sub Category dihapus total dan digantikan Judul. Judul adalah
 * master yang diperlakukan sama seperti Kategori/Rasa (ON/OFF, edit, hapus/arsip)
 * dan direferensikan oleh Menu (`menus.title_id`).
 *
 * Test ini mengunci dua hal yang menentukan apakah tab Judul benar-benar tampil
 * dan terisi di dashboard:
 *   1. Markup + wiring dashboard (tab, panel, list, tombol +, META, label, ikon).
 *   2. Bentuk respons /admin/menu-titles yang PERSIS dibaca oleh dashboard
 *      (`{ success, titles: [{ id, name, slug, is_active }] }`).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../server/app');
require('./helpers/demoFixtures.js')();

const DASHBOARD_DIR = path.join(__dirname, '..', 'apps', 'merchant-dashboard');
const INDEX_HTML = fs.readFileSync(path.join(DASHBOARD_DIR, 'index.html'), 'utf8');
const DASHBOARD_JS = fs.readFileSync(path.join(DASHBOARD_DIR, 'assets', 'js', 'dashboard.js'), 'utf8');

async function mockFetch(requestPath, options = {}) {
  const method = options.method || 'GET';
  const headers = options.headers || {};
  const body = options.body ? JSON.parse(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: requestPath,
      headers: { host: 'app.mybangjo.com', 'content-type': 'application/json', ...headers },
      body,
      query: {},
      params: {}
    };

    if (requestPath.includes('?')) {
      const parts = requestPath.split('?');
      req.url = parts[0];
      const params = new URLSearchParams(parts[1]);
      for (const [k, v] of params.entries()) req.query[k] = v;
    }

    const res = {
      statusCode: 200,
      headers: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this.headers[k] = v; },
      getHeader(k) { return this.headers[k]; },
      writeHead(code, hdrs) { this.statusCode = code; if (hdrs) Object.assign(this.headers, hdrs); },
      json(data) { resolve({ status: this.statusCode, json: async () => data }); },
      send(data) {
        let parsed = data;
        if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch (_) {} }
        resolve({ status: this.statusCode, text: async () => data, json: async () => parsed });
      },
      end(data) {
        let parsed = data;
        if (typeof data === 'string') { try { parsed = JSON.parse(data); } catch (_) {} }
        resolve({ status: this.statusCode, text: async () => data, json: async () => parsed });
      }
    };

    app(req, res, (err) => { if (err) reject(err); });
  });
}

async function loginOwner() {
  const res = await mockFetch('/api/v1/auth/merchant/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'bangjo123' })
  });
  const data = await res.json();
  assert.strictEqual(data.success, true, 'owner login must succeed for test setup');
  return { authorization: 'Bearer ' + data.token };
}

const uniqueName = (label) => label + ' ' + Math.random().toString(36).slice(2, 8).toUpperCase();

// ── Markup + wiring ─────────────────────────────────────────────────────────

test('JUDUL-UI-01: dashboard punya tab Judul, panel, list, dan tombol tambah', () => {
  assert.match(INDEX_HTML, /data-master-reference-tab="title"[^>]*>\s*Judul\s*</,
    'tab Judul harus ada di #master-reference-tabs');
  assert.match(INDEX_HTML, /id="master-reference-title-panel"/, 'panel Judul harus ada');
  assert.match(INDEX_HTML, /id="master-titles-page-list"/, 'list Judul harus ada');
  assert.match(INDEX_HTML, /id="btn-add-master-title-page"/, 'tombol + Judul harus ada');
});

test('JUDUL-UI-02: dashboard.js menyambungkan tipe title di semua titik master reference', () => {
  assert.match(DASHBOARD_JS, /title:\s*\$\('master-reference-title-panel'\)/, 'panel map');
  assert.match(DASHBOARD_JS, /title:\s*'master-titles-page-list'/, 'listMap');
  assert.match(DASHBOARD_JS, /if \(type === 'title'\) return 'Judul';/, 'label tipe');
  assert.match(DASHBOARD_JS, /if \(type === 'title'\) return '<path/, 'ikon tipe');
  assert.match(DASHBOARD_JS, /endpoint:\s*function \(\) \{ return API_BASE \+ '\/admin\/menu-titles'; \}/, 'endpoint META');
  assert.match(DASHBOARD_JS, /deleteEndpoint:\s*function \(id\) \{ return API_BASE \+ '\/admin\/menu-titles\/'/, 'deleteEndpoint META');
  assert.match(DASHBOARD_JS, /openMasterReferenceQuickAdd\('title'\)/, 'tombol + terpasang');
  assert.match(DASHBOARD_JS, /data\.titles \|\| \[\]/, 'daftar Judul dibaca dari respons API');
});

test('JUDUL-UI-02b: setMasterReferenceTab mengizinkan tipe title (kalau tidak, klik tab Judul dipaksa balik ke Kategori)', () => {
  // Regresi: daftar `allowed` sempat tidak memuat 'title', sehingga tab Judul
  // tampil (markup statis) tetapi panelnya tidak pernah ditampilkan.
  const allowedLine = DASHBOARD_JS.match(/var allowed = \[([^\]]*'category'[^\]]*)\];/);
  assert.ok(allowedLine, 'daftar allowed harus ada');
  const allowed = allowedLine[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.ok(allowed.includes('title'), "daftar allowed wajib memuat 'title'");
  assert.ok(allowed.includes('category'), 'daftar allowed tetap memuat category');
});

test('JUDUL-UI-02c: bingkai card panel master reference berbasis kelas, bukan daftar ID', () => {
  // Regresi: aturan bingkai card dulu menuliskan ID panel satu per satu
  // (#master-reference-category-panel, #master-reference-flavor-panel), sehingga
  // panel baru (Judul, Kelengkapan) dirender tanpa bingkai card.
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'merchant-shared', 'css', 'dashboard.css'),
    'utf8'
  );

  const rule = css.match(/\.x-master-reference-panel\{([^}]*)\}/);
  assert.ok(rule, 'aturan .x-master-reference-panel harus ada (bingkai card satu kesatuan dengan tab)');
  assert.match(rule[1], /background:\s*var\(--bg-card\)/, 'panel harus memakai latar kartu');
  assert.match(rule[1], /border:\s*1px solid var\(--border-color\)/, 'panel harus berbingkai');
  assert.match(rule[1], /border-radius:\s*var\(--radius-md\)/, 'panel harus bersudut membulat');

  assert.ok(
    !/#master-reference-(category|flavor|title|complement)-panel\s*[,{]/.test(css),
    'panel tidak boleh dibingkai lewat daftar ID — panel baru akan terlewat lagi'
  );
});

// ── Tab Item (menggantikan Kelengkapan) ────────────────────────────────────

test('ITEM-01: deret tab Master Category = Kategori | Judul | Rasa | Item (tanpa Kelengkapan)', () => {
  const tabs = [...INDEX_HTML.matchAll(/data-master-reference-tab="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(tabs, ['category', 'title', 'flavor', 'item'], 'urutan & isi tab harus sesuai contract v1');
  assert.ok(!INDEX_HTML.includes('data-master-reference-tab="complement"'), 'Kelengkapan tidak boleh tampil lagi');
  assert.match(INDEX_HTML, /id="master-reference-item-panel"/, 'panel Item harus ada');
  assert.match(INDEX_HTML, /id="master-items-page-list"/, 'list Item harus ada');
});

test('ITEM-02: kartu Item seragam dengan tab lain — toggle, bukan ceklis, + menu aksi', () => {
  assert.match(DASHBOARD_JS, /function renderMasterItemsList\(\)/, 'daftar Item punya renderer sendiri');
  assert.match(DASHBOARD_JS, /title="Kelola stok \(pakai SKU\)"/, 'toggle harus menjelaskan dirinya (Kelola stok pakai SKU)');
  assert.match(DASHBOARD_JS, /class="x-toggle' \+ \(hasSku/, 'kartu Item memakai komponen toggle kanonik');
  assert.match(DASHBOARD_JS, /x-action-menu-trigger/, 'kartu Item harus punya menu aksi seperti tab lain');
  assert.match(DASHBOARD_JS, /XentraActionMenu\.open\(this, \[/, 'menu aksi memakai XentraActionMenu kanonik');
  assert.match(DASHBOARD_JS, /label: \\'Edit\\'/, 'menu aksi punya Edit');
  assert.match(DASHBOARD_JS, /label: \\'Arsipkan\\'/, 'menu aksi punya Arsipkan');
  assert.match(DASHBOARD_JS, /id="master-item-sku-input-/, 'input SKU harus dirender');
  assert.match(DASHBOARD_JS, /window\.toggleMasterItemStock\s*=/, 'toggle harus ter-wire');
  assert.match(DASHBOARD_JS, /window\.saveMasterItemSku\s*=/, 'penyimpanan SKU harus ter-wire');
  assert.match(DASHBOARD_JS, /\/admin\/products\/' \+ encodeURIComponent\(productId\) \+ '\/sku'/, 'memakai endpoint SKU canonical');
  assert.match(DASHBOARD_JS, /Stok harus nol dulu/, 'pesan guard stok harus dijelaskan ke merchant');
  assert.match(DASHBOARD_JS, /if \(type === 'item'\) return 'Item';/, 'label tipe Item');
  assert.ok(!DASHBOARD_JS.includes('x-master-item-stock-label'), 'ceklis berlabel sudah diganti toggle');
});

test('ITEM-03: tab Item punya tombol + (alur tambah item kanonik) dan gaya kartunya', () => {
  assert.match(INDEX_HTML, /id="btn-add-master-item-page"/, 'tombol + Item harus ada di toolbar');
  assert.match(DASHBOARD_JS, /btn-add-master-item-page/, 'tombol + Item harus di-wire');
  assert.match(DASHBOARD_JS, /window\.openAddProduct\(\)/, 'memakai alur tambah item yang sudah ada');

  // Tanpa gaya ini label ceklis terpotong dan baris SKU tampil berantakan.
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'merchant-shared', 'css', 'dashboard.css'),
    'utf8'
  );
  for (const sel of ['.x-master-item-card{', '.x-master-item-sku{']) {
    assert.ok(css.includes(sel), 'aturan ' + sel + ' harus ada di dashboard.css');
  }
  assert.ok(!/class="x-form-group x-master-item-sku/.test(DASHBOARD_JS), 'baris SKU tidak boleh memakai x-form-group (bentrok gaya)');
});

// ── Bentuk API yang dibaca UI ───────────────────────────────────────────────

test('JUDUL-UI-03: GET /admin/menu-titles mengembalikan bentuk yang dibaca dashboard', async () => {
  const auth = await loginOwner();
  const res = await mockFetch('/api/v1/admin/menu-titles', { headers: auth });
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.success, true);
  assert.ok(Array.isArray(data.titles), 'harus ada array `titles`');

  const name = uniqueName('Judul Bentuk');
  const created = await mockFetch('/api/v1/admin/menu-titles', {
    method: 'POST', headers: auth, body: JSON.stringify({ name })
  });
  const createdData = await created.json();
  assert.strictEqual(createdData.success, true);
  assert.strictEqual(createdData.title.name, name);

  const row = (await (await mockFetch('/api/v1/admin/menu-titles', { headers: auth })).json())
    .titles.find((item) => item.id === createdData.title.id);
  assert.ok(row, 'judul baru harus muncul di daftar');
  // Field yang dirender kartu master: name, is_active, id.
  assert.strictEqual(typeof row.name, 'string');
  assert.ok('is_active' in row, 'kartu butuh is_active untuk toggle ON/OFF');
  assert.ok(row.slug, 'slug dipakai konsumen lain di contract');
});

test('JUDUL-UI-04: toggle ON/OFF lewat PUT is_active (jalur yang dipakai kartu)', async () => {
  const auth = await loginOwner();
  const name = uniqueName('Judul Toggle');
  const created = await (await mockFetch('/api/v1/admin/menu-titles', {
    method: 'POST', headers: auth, body: JSON.stringify({ name })
  })).json();

  const off = await (await mockFetch('/api/v1/admin/menu-titles/' + created.title.id, {
    method: 'PUT', headers: auth, body: JSON.stringify({ is_active: 0 })
  })).json();
  assert.strictEqual(off.success, true);
  assert.strictEqual(Number(off.title.is_active), 0);

  const activeOnly = await (await mockFetch('/api/v1/admin/menu-titles?active_only=1', { headers: auth })).json();
  assert.ok(!activeOnly.titles.some((t) => t.id === created.title.id), 'judul nonaktif tidak muncul di active_only');

  const on = await (await mockFetch('/api/v1/admin/menu-titles/' + created.title.id, {
    method: 'PUT', headers: auth, body: JSON.stringify({ is_active: 1 })
  })).json();
  assert.strictEqual(Number(on.title.is_active), 1);
});

test('JUDUL-UI-05: rename lewat PUT name, dan nama kembar ditolak', async () => {
  const auth = await loginOwner();
  const first = await (await mockFetch('/api/v1/admin/menu-titles', {
    method: 'POST', headers: auth, body: JSON.stringify({ name: uniqueName('Judul A') })
  })).json();
  const second = await (await mockFetch('/api/v1/admin/menu-titles', {
    method: 'POST', headers: auth, body: JSON.stringify({ name: uniqueName('Judul B') })
  })).json();

  const renamed = await (await mockFetch('/api/v1/admin/menu-titles/' + second.title.id, {
    method: 'PUT', headers: auth, body: JSON.stringify({ name: first.title.name })
  })).json();
  assert.strictEqual(renamed.success, false, 'nama judul harus unik per brand');

  const ok = await (await mockFetch('/api/v1/admin/menu-titles/' + second.title.id, {
    method: 'PUT', headers: auth, body: JSON.stringify({ name: uniqueName('Judul B2') })
  })).json();
  assert.strictEqual(ok.success, true);
});

// ── Delete vs Arsip ────────────────────────────────────────────────────────

test('JUDUL-UI-06: DELETE = arsip (baris tetap ada, is_active=0, lapor used_by_menu_count)', async () => {
  const auth = await loginOwner();
  const created = await (await mockFetch('/api/v1/admin/menu-titles', {
    method: 'POST', headers: auth, body: JSON.stringify({ name: uniqueName('Judul Arsip') })
  })).json();

  const archived = await (await mockFetch('/api/v1/admin/menu-titles/' + created.title.id, {
    method: 'DELETE', headers: auth
  })).json();

  assert.strictEqual(archived.success, true);
  assert.strictEqual(archived.archived, true);
  assert.strictEqual(typeof archived.used_by_menu_count, 'number', 'UI perlu tahu berapa Menu yang memakainya');
  assert.strictEqual(archived.used_by_menu_count, 0);

  const all = await (await mockFetch('/api/v1/admin/menu-titles', { headers: auth })).json();
  const row = all.titles.find((t) => t.id === created.title.id);
  assert.ok(row, 'arsip bukan hapus paksa: baris tetap ada agar referensi Menu tidak putus');
  assert.strictEqual(Number(row.is_active), 0);
});

test('JUDUL-UI-07: tombol [+ ] di editor Menu cukup mengirim nama (idempotent, tanpa judul kembar)', async () => {
  const auth = await loginOwner();
  const name = uniqueName('Judul Idempotent');

  const a = await (await mockFetch('/api/v1/admin/menu-titles', {
    method: 'POST', headers: auth, body: JSON.stringify({ name })
  })).json();
  const b = await (await mockFetch('/api/v1/admin/menu-titles', {
    method: 'POST', headers: auth, body: JSON.stringify({ name })
  })).json();

  assert.strictEqual(a.success, true);
  assert.strictEqual(b.success, true);
  assert.strictEqual(String(a.title.id), String(b.title.id), 'nama sama -> judul yang sama, bukan duplikat');
});

test('JUDUL-UI-08: judul ter-scope per brand dan menolak nama kosong', async () => {
  const auth = await loginOwner();

  const empty = await (await mockFetch('/api/v1/admin/menu-titles', {
    method: 'POST', headers: auth, body: JSON.stringify({ name: '   ' })
  })).json();
  assert.strictEqual(empty.success, false, 'nama judul wajib diisi');

  const anon = await mockFetch('/api/v1/admin/menu-titles', {});
  assert.strictEqual(anon.status, 401, 'daftar judul tidak boleh terbuka tanpa auth');
});
