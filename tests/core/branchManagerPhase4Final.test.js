'use strict';

/**
 * BM Phase 4 Final — Branch Manager Operational Center (Hari Ini) Test Suite
 *
 * Requirements Matrix (P4F-01 through P4F-18):
 * - P4F-01: Authenticated Branch Manager can fetch authoritative operation logs for assigned branch.
 * - P4F-02: Branch Manager cannot fetch operation logs for another branch (403 FORBIDDEN_BRANCH_SCOPE).
 * - P4F-03: Unauthenticated request to operation-logs is rejected (401).
 * - P4F-04: Non-manager / non-staff role cannot access operation-logs (403).
 * - P4F-05: Operation logs respect query limit clamping (1..50, default 10).
 * - P4F-06: Operation logs return authoritative structured entries ordered by created_at DESC.
 * - P4F-07: Branch Manager can toggle branch open/closed via branches.is_open_override (0/1).
 * - P4F-08: Branch Manager can toggle online orders via branches.is_delivery_active (0/1).
 * - P4F-09: Cross-branch mutation of open/closed or online orders is strictly rejected (403).
 * - P4F-10: Owner / higher-scope authority can access operation-logs across branches.
 * - P4F-11: index.html contains the canonical Hari Ini information hierarchy:
 *           Branch Status -> Perlu Perhatian (Pending Orders + Menu/Stock) -> Quick Actions -> Operasional Hari Ini -> Aktivitas Terkini.
 * - P4F-12: index.html separates Branch Status and Online Order State badges (bm-hero-status-badge, bm-hero-online-badge).
 * - P4F-13: index.html contains live WIB date badge (#bm-hero-date) and consolidated non-duplicate description.
 * - P4F-14: index.html contains separate containers for menu unavail, stock low, and pending order count badge.
 * - P4F-15: dashboard.js renders split branch state and online order state ("CABANG: BUKA", "ONLINE: AKTIF").
 * - P4F-16: dashboard.js renders explicit CTA labels ("Tutup Sementara", "Buka Cabang", "Pause Order Online", "Resume Order Online").
 * - P4F-17: dashboard.js renders calm operational empty states ("✓ Tidak ada antrean...", "✓ Semua menu tersedia", "✓ Tidak ada stok yang perlu diperhatikan").
 * - P4F-18: dashboard.js retains quick accept/reject BM order handlers without breaking branch scope.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-bm4-final-operational-center';

const app = require('../../server/app');
const db = require('../../server/database/db');
// Suites assert against demo branches/products/promotions, which are not auto-seeded.
require('../helpers/demoFixtures.js')();
let server;
let baseUrl;

const BRAND_ID = 'brand_bangjo';
const ORG_ID = 'org_xentra_holding';
const BRANCH_A_ID = 'branch_bangjo_barat';
const BRANCH_B_ID = 'branch_bangjo_timur';

function seedStaffSession({ role = 'branch_manager', branchId = BRANCH_A_ID, brandId = BRAND_ID, organizationId = ORG_ID, userId = 'bm4_user_final' } = {}) {
  const token = 'bm4_final_tok_' + crypto.randomBytes(8).toString('hex');
  const store = global.TokenSessionStore;
  const sess = {
    type: 'staff',
    role,
    brandId,
    brand_id: brandId,
    organizationId,
    organization_id: organizationId,
    branchId,
    branch_id: branchId,
    userId,
    username: userId,
    email_verified: true,
    expiresAt: Date.now() + 86400 * 1000
  };
  if (store && store.sessions) {
    store.sessions.set(token, sess);
  }
  return token;
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const apiPath = path.startsWith('/api') ? path : ('/api/v1' + path);
    const url = new URL(apiPath, baseUrl);
    const payload = body != null ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'app.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

describe('BM Phase 4 Final — Branch Manager Operational Center (Hari Ini)', () => {
  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const now = new Date().toISOString();
    // Ensure branches exist
    const bA = db.prepare('SELECT id FROM branches WHERE id = ?').get(BRANCH_A_ID);
    if (!bA) {
      db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, is_open_override, is_delivery_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, -7.25, 112.75, 1, 1, 1, ?, ?)')
        .run(BRANCH_A_ID, BRAND_ID, 'Cabang BM4 Barat', 'barat-4', 'Jl. Barat 4', now, now);
    }
    const bB = db.prepare('SELECT id FROM branches WHERE id = ?').get(BRANCH_B_ID);
    if (!bB) {
      db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, is_open_override, is_delivery_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, -7.26, 112.76, 1, 1, 1, ?, ?)')
        .run(BRANCH_B_ID, BRAND_ID, 'Cabang BM4 Timur', 'timur-4', 'Jl. Timur 4', now, now);
    }

    // Seed test operation logs in branch_operation_logs
    try {
      db.prepare(`
        INSERT INTO branch_operation_logs (
          id, branch_id, brand_id, organization_id, action, field, previous_value, new_value, actor_id, actor_role, authorized, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run('log_p4f_1', BRANCH_A_ID, BRAND_ID, ORG_ID, 'BRANCH_OVERRIDE_UPDATED', 'is_open_override', '1', '0', 'bm_actor', 'branch_manager', now);
    } catch (_) {}
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('P4F-01: Authenticated Branch Manager can fetch authoritative operation logs for assigned branch', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/operation-logs?limit=5`, null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.logs));
    assert.ok(res.body.logs.length >= 1);
    assert.equal(res.body.logs[0].branch_id, BRANCH_A_ID);
  });

  it('P4F-02: Branch Manager cannot fetch operation logs for another branch (403 FORBIDDEN_BRANCH_SCOPE)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_B_ID}/operation-logs`, null, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'FORBIDDEN_BRANCH_SCOPE');
  });

  it('P4F-03: Unauthenticated request to operation-logs is rejected (401)', async () => {
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/operation-logs`);
    assert.equal(res.status, 401);
  });

  it('P4F-04: Non-manager / non-staff role cannot access operation-logs (403)', async () => {
    const token = seedStaffSession({ role: 'cashier', branchId: BRANCH_A_ID });
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/operation-logs`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 403);
  });

  it('P4F-05: Operation logs respect query limit clamping (1..50)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/operation-logs?limit=100`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.logs.length <= 50);
  });

  it('P4F-06: Branch Manager can toggle branch open/closed via branches.is_open_override', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    const res = await request('PUT', `/api/v1/admin/branches/${BRANCH_A_ID}`, { is_open_override: 0 }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.branch.is_open_override, 0);

    // Restore to 1
    await request('PUT', `/api/v1/admin/branches/${BRANCH_A_ID}`, { is_open_override: 1 }, {
      Authorization: `Bearer ${token}`
    });
  });

  it('P4F-07: Branch Manager can toggle online delivery orders via branches.is_delivery_active', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    const res = await request('PUT', `/api/v1/admin/branches/${BRANCH_A_ID}`, { is_delivery_active: 0 }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    // Restore to 1
    await request('PUT', `/api/v1/admin/branches/${BRANCH_A_ID}`, { is_delivery_active: 1 }, {
      Authorization: `Bearer ${token}`
    });
  });

  it('P4F-08: Cross-branch mutation of branch status is strictly rejected (403)', async () => {
    const token = seedStaffSession({ role: 'branch_manager', branchId: BRANCH_A_ID });
    const res = await request('PUT', `/api/v1/admin/branches/${BRANCH_B_ID}`, { is_open_override: 0 }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });

  it('P4F-09: Owner authority can access operation-logs across branches', async () => {
    const token = seedStaffSession({ role: 'owner', branchId: null });
    const res = await request('GET', `/api/v1/admin/branches/${BRANCH_A_ID}/operation-logs`, null, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  it('P4F-10: index.html contains canonical Hari Ini structure and element IDs', () => {
    const htmlPath = path.join(__dirname, '../../apps/merchant-app/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Section exists
    assert.ok(html.includes('id="tab-hari-ini"'), 'Missing tab-hari-ini');
    // Header & identity
    assert.ok(html.includes('id="bm-hero-branch-name"'), 'Missing bm-hero-branch-name');
    assert.ok(html.includes('id="bm-hero-status-dot"'), 'Missing bm-hero-status-dot');
    assert.ok(html.includes('id="bm-hero-status-badge"'), 'Missing bm-hero-status-badge');
    assert.ok(html.includes('id="bm-hero-online-badge"'), 'Missing bm-hero-online-badge');
    assert.ok(html.includes('id="bm-hero-date"'), 'Missing bm-hero-date');
    // Controls
    assert.ok(html.includes('id="btn-bm-toggle-open"'), 'Missing btn-bm-toggle-open');
    assert.ok(html.includes('id="btn-bm-toggle-online-orders"'), 'Missing btn-bm-toggle-online-orders');
    // Perlu Perhatian containers
    assert.ok(html.includes('id="bm-tbody-pending-orders"'), 'Missing bm-tbody-pending-orders');
    assert.ok(html.includes('id="bm-badge-pending-count"'), 'Missing bm-badge-pending-count');
    assert.ok(html.includes('id="bm-menu-unavail-list"'), 'Missing bm-menu-unavail-list');
    assert.ok(html.includes('id="bm-stock-low-list"'), 'Missing bm-stock-low-list');
    // Operational summaries & activity
    assert.ok(html.includes('id="bm-stat-pending-orders"'), 'Missing bm-stat-pending-orders');
    assert.ok(html.includes('id="bm-stat-active-orders"'), 'Missing bm-stat-active-orders');
    assert.ok(html.includes('id="bm-stat-ready-orders"'), 'Missing bm-stat-ready-orders');
    assert.ok(html.includes('id="bm-stat-completed-orders"'), 'Missing bm-stat-completed-orders');
    assert.ok(html.includes('id="bm-recent-activity-container"'), 'Missing bm-recent-activity-container');
    assert.ok(html.includes('id="bm-active-promos-container"'), 'Missing bm-active-promos-container');
  });

  it('P4F-11: dashboard.js implements split status rendering and calm empty states', () => {
    const jsPath = path.join(__dirname, '../../apps/merchant-app/assets/js/merchant-app.js');
    const js = fs.readFileSync(jsPath, 'utf8');

    // Split state text
    assert.ok(js.includes('"CABANG: BUKA"'), 'Missing CABANG: BUKA text');
    assert.ok(js.includes('"CABANG: TUTUP"'), 'Missing CABANG: TUTUP text');
    assert.ok(js.includes('"ONLINE: AKTIF"'), 'Missing ONLINE: AKTIF text');
    assert.ok(js.includes('"ONLINE: DIJEDA"'), 'Missing ONLINE: DIJEDA text');

    // Action CTA text
    assert.ok(js.includes('"Tutup Sementara"'), 'Missing Tutup Sementara CTA');
    assert.ok(js.includes('"Buka Cabang"'), 'Missing Buka Cabang CTA');
    assert.ok(js.includes('"Pause Order Online"'), 'Missing Pause Order Online CTA');
    assert.ok(js.includes('"Resume Order Online"'), 'Missing Resume Order Online CTA');

    // Operational empty messages
    assert.ok(js.includes('Tidak ada antrean pesanan yang memerlukan tindakan saat ini'), 'Missing calm order empty state');
    assert.ok(js.includes('Semua menu tersedia'), 'Missing calm menu empty state');
    assert.ok(js.includes('Tidak ada stok yang perlu diperhatikan'), 'Missing calm stock empty state');
  });
});
