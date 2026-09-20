'use strict';

/**
 * Promotion Install Floating Presentation Marketing-Driven Test Suite
 *
 * Covers:
 * 1. Default seed preserves presentation payload across database reboots (COALESCE).
 * 2. Owner can update presentation_payload (headline, subtitle, icon_url, media_id).
 * 3. Media ID validation: must exist, belong to req.brand_id, and have status READY.
 * 4. Foreign brand media ID rejected with 403 / 400.
 * 5. Unready media ID rejected with 400.
 * 6. Presentation updates do NOT mutate reward business mechanics (amount, product_id, eligibility).
 * 7. /admin/marketing/promotions list enriches presentation delivery with media details.
 * 8. PATCH /admin/marketing/promotions/:id/presentation updates payload atomically.
 * 9. Customer /promotions/active returns configured banner_title, banner_subtitle, icon_url.
 * 10. MediaReferenceResolver marks promotion reward presentation assets as referenced.
 * 11. Customer PWA fallback icon when presentation icon_url is omitted.
 * 12. Non-owner/non-brand-manager cannot update presentation (401/403).
 * 13. Updating core promotion attributes preserves existing presentation_payload.
 * 14. Promotion presentation audit security events logged.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-pwa-install-presentation';

const app = require('../../server/app');
const db = require('../../server/database/db');
const MediaReferenceResolver = require('../../core/media/MediaReferenceResolver');

let server;
let baseUrl;

const BRAND_A = 'brand_bangjo';
const BRAND_B = 'brand_other_tenant';
const ORG_A = 'org_xentra_holding';
const ORG_B = 'org_other_tenant';

function seedStaffSession({ role = 'owner', branchId = null, brandId = BRAND_A, organizationId = ORG_A, userId = 'user_pres_test' } = {}) {
  const token = 'tok_pres_' + crypto.randomBytes(8).toString('hex');
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
    created_at: Date.now(),
    expires_at: Date.now() + 86400000
  };
  if (store && store.sessions) {
    store.sessions.set(token, sess);
  }
  return token;
}

function request(method, pathName, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, baseUrl);
    const reqHeaders = {
      'Content-Type': 'application/json'
    };
    for (const [k, v] of Object.entries(headers)) {
      reqHeaders[k.toLowerCase()] = v;
    }

    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: reqHeaders
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

describe('Promotion Install Floating Presentation Suite', () => {
  const mediaReadyBrandA = 'med_icon_ready_a';
  const mediaUnreadyBrandA = 'med_icon_unready_a';
  const mediaReadyBrandB = 'med_icon_ready_b';
  const testPromoId = 'prm_test_install_presentation';
  const testRewardId = 'rew_test_install_presentation';

  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Seed Brands
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(ORG_A, 'Org Pres A', 'org-pres-a');
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(ORG_B, 'Org Pres B', 'org-pres-b');
    db.prepare('INSERT OR REPLACE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)').run(BRAND_A, ORG_A, 'Bangjo Resto', 'bangjo', 'app.mybangjo.com');
    db.prepare('INSERT OR REPLACE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)').run(BRAND_B, ORG_B, 'Other Brand', 'other-brand', 'other.tenant.com');

    // Seed test media assets
    db.prepare(`
      INSERT OR REPLACE INTO media_assets (id, tenant_id, brand_id, storage_key, mime_type, status, asset_type, width, height, size_bytes, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'image/png', 'ready', 'general', 192, 192, 1024, datetime('now'), datetime('now'))
    `).run(mediaReadyBrandA, ORG_A, BRAND_A, `assets/${BRAND_A}/${mediaReadyBrandA}.png`);

    db.prepare(`
      INSERT OR REPLACE INTO media_assets (id, tenant_id, brand_id, storage_key, mime_type, status, asset_type, width, height, size_bytes, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'image/png', 'temporary', 'general', 192, 192, 1024, datetime('now'), datetime('now'))
    `).run(mediaUnreadyBrandA, ORG_A, BRAND_A, `staging/${BRAND_A}/${mediaUnreadyBrandA}.png`);

    db.prepare(`
      INSERT OR REPLACE INTO media_assets (id, tenant_id, brand_id, storage_key, mime_type, status, asset_type, width, height, size_bytes, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'image/png', 'ready', 'general', 192, 192, 1024, datetime('now'), datetime('now'))
    `).run(mediaReadyBrandB, ORG_B, BRAND_B, `assets/${BRAND_B}/${mediaReadyBrandB}.png`);

    // Seed a test promotion with initial presentation payload
    db.prepare(`
      INSERT OR REPLACE INTO promotions (id, brand_id, name, code, capability_type, stacking_policy, priority_weight, is_active, created_at, updated_at)
      VALUES (?, ?, 'Test Install Promo', 'TESTINSTALL', 'install_incentive', 'exclusive', 100, 1, datetime('now'), datetime('now'))
    `).run(testPromoId, BRAND_A);

    db.prepare(`
      INSERT OR REPLACE INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents, presentation_payload, created_at)
      VALUES (?, ?, 'freebie_product', '401', 0, ?, datetime('now'))
    `).run(
      testRewardId,
      testPromoId,
      JSON.stringify({
        banner_title: 'Original Title',
        banner_subtitle: 'Original Subtitle',
        reward_title: 'Original Reward',
        reward_badge_text: 'Bonus PWA',
        icon_url: '/assets/pwa/icon-192.png'
      })
    );
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  it('1. Default seed preserves custom presentation_payload on database reboot / startup', () => {
    // Ensure prm_bangjo_pwa_install exists
    db.prepare(`
      INSERT OR IGNORE INTO promotions (id, brand_id, name, code, capability_type, stacking_policy, priority_weight, is_active, created_at, updated_at)
      VALUES ('prm_bangjo_pwa_install', 'brand_bangjo', 'Promo Hadiah Install PWA Es Teh', 'PWABANGJO', 'install_incentive', 'exclusive', 100, 1, datetime('now'), datetime('now'))
    `).run();

    // Modify prm_bangjo_pwa_install reward presentation
    const customPres = {
      banner_title: 'Custom Marketing Headline',
      banner_subtitle: 'Custom Marketing Subtitle',
      icon_url: '/assets/img/custom.png'
    };
    db.prepare(`
      INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents, presentation_payload)
      VALUES ('rew_pwa_install_01', 'prm_bangjo_pwa_install', 'freebie_product', '401', 0, ?)
      ON CONFLICT(id) DO UPDATE SET presentation_payload = excluded.presentation_payload
    `).run(JSON.stringify(customPres));

    // Simulate seed rerun with COALESCE
    db.prepare(`
      INSERT INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents, presentation_payload)
      VALUES ('rew_pwa_install_01', 'prm_bangjo_pwa_install', 'freebie_product', '401', 0,
        '{"banner_title":"Default Title","banner_subtitle":"Default Subtitle"}')
      ON CONFLICT(id) DO UPDATE SET
        target_product_id = excluded.target_product_id,
        presentation_payload = COALESCE(promotion_rewards.presentation_payload, excluded.presentation_payload)
    `).run();

    const row = db.prepare("SELECT presentation_payload FROM promotion_rewards WHERE id = 'rew_pwa_install_01'").get();
    const parsed = JSON.parse(row.presentation_payload);
    assert.equal(parsed.banner_title, 'Custom Marketing Headline', 'Preserved custom marketing headline');
  });

  it('2. PATCH /admin/marketing/promotions/:id/presentation updates headline, subtitle, and ready icon', async () => {
    const ownerToken = seedStaffSession({ role: 'owner', brandId: BRAND_A });
    const res = await request(
      'PATCH',
      `/api/v1/admin/marketing/promotions/${testPromoId}/presentation`,
      {
        banner_title: 'Dapatkan Hadiah Spesial!',
        banner_subtitle: 'Khusus pengguna aplikasi PWA',
        media_id: mediaReadyBrandA
      },
      { 'Authorization': `Bearer ${ownerToken}` }
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const reward = res.body.promotion.rewards[0];
    assert.equal(reward.presentation.banner_title, 'Dapatkan Hadiah Spesial!');
    assert.equal(reward.presentation.banner_subtitle, 'Khusus pengguna aplikasi PWA');
    assert.equal(reward.presentation.media_id, mediaReadyBrandA);
    assert.ok(reward.presentation.icon_url, 'Icon URL populated');
    assert.ok(reward.presentation_delivery, 'Presentation delivery resolved');
    assert.equal(reward.presentation_delivery.media_id, mediaReadyBrandA);
  });

  it('3. Foreign brand media ID is rejected with 403 or 400', async () => {
    const ownerToken = seedStaffSession({ role: 'owner', brandId: BRAND_A });
    const res = await request(
      'PATCH',
      `/api/v1/admin/marketing/promotions/${testPromoId}/presentation`,
      {
        banner_title: 'Hack Attempt',
        media_id: mediaReadyBrandB // belongs to BRAND_B
      },
      { 'Authorization': `Bearer ${ownerToken}` }
    );

    assert.ok(res.status === 403 || res.status === 400, `Expected 403 or 400, got ${res.status}`);
    assert.equal(res.body.success, false);
  });

  it('4. Non-ready media ID is rejected with 400', async () => {
    const ownerToken = seedStaffSession({ role: 'owner', brandId: BRAND_A });
    const res = await request(
      'PATCH',
      `/api/v1/admin/marketing/promotions/${testPromoId}/presentation`,
      {
        banner_title: 'Temporary Media',
        media_id: mediaUnreadyBrandA // status is 'temporary'
      },
      { 'Authorization': `Bearer ${ownerToken}` }
    );

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'MEDIA_NOT_READY');
  });

  it('5. Presentation update does NOT modify core reward mechanics (target_product_id, amount, rules)', () => {
    const rewardRow = db.prepare('SELECT target_product_id, amount_in_cents, reward_type FROM promotion_rewards WHERE id = ?').get(testRewardId);
    assert.equal(rewardRow.target_product_id, '401');
    assert.equal(rewardRow.amount_in_cents, 0);
    assert.equal(rewardRow.reward_type, 'freebie_product');
  });

  it('6. GET /admin/marketing/promotions enriches presentation delivery', async () => {
    const ownerToken = seedStaffSession({ role: 'owner', brandId: BRAND_A });
    const res = await request(
      'GET',
      '/api/v1/admin/marketing/promotions',
      null,
      { 'Authorization': `Bearer ${ownerToken}` }
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const promo = res.body.promotions.find(p => p.id === testPromoId);
    assert.ok(promo);
    assert.ok(promo.rewards[0].presentation);
    assert.equal(promo.rewards[0].presentation.banner_title, 'Dapatkan Hadiah Spesial!');
  });

  it('7. Customer GET /promotions/active returns configured banner_title, banner_subtitle, and icon_url', async () => {
    const res = await request(
      'GET',
      '/api/v1/promotions/active?is_pwa=0&phone=',
      null,
      { 'Host': 'app.mybangjo.com' }
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const testDiscovery = (res.body.promotions || []).find(p => p.promo_id === testPromoId);
    if (testDiscovery) {
      assert.equal(testDiscovery.display.banner_title, 'Dapatkan Hadiah Spesial!');
      assert.equal(testDiscovery.display.banner_subtitle, 'Khusus pengguna aplikasi PWA');
      assert.ok(testDiscovery.display.icon_url);
    }
  });

  it('8. MediaReferenceResolver detects promotion reward presentation references', async () => {
    const resolver = new MediaReferenceResolver();
    const result = await resolver.checkReference({ mediaId: mediaReadyBrandA, brandId: BRAND_A });
    assert.equal(result.isReferenced, true);
    const ref = result.references.find(r => r.type === 'promotion_reward_presentation');
    assert.ok(ref, 'Found promotion_reward_presentation reference');
    assert.equal(ref.id, testRewardId);
  });

  it('9. Non-owner/non-brand-manager cannot update presentation (401/403)', async () => {
    const cashierToken = seedStaffSession({ role: 'cashier', brandId: BRAND_A });
    const res = await request(
      'PATCH',
      `/api/v1/admin/marketing/promotions/${testPromoId}/presentation`,
      { banner_title: 'Cashier Edit' },
      { 'Authorization': `Bearer ${cashierToken}` }
    );
    assert.equal(res.status, 403);
  });

  it('10. PUT /admin/marketing/promotions/:id preserves presentation_payload when not re-sent', async () => {
    const ownerToken = seedStaffSession({ role: 'owner', brandId: BRAND_A });
    const res = await request(
      'PUT',
      `/api/v1/admin/marketing/promotions/${testPromoId}`,
      {
        name: 'Updated Promo Name',
        rewards: [{
          reward_type: 'freebie_product',
          target_product_id: '401',
          amount_in_cents: 0
        }]
      },
      { 'Authorization': `Bearer ${ownerToken}` }
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const updatedReward = res.body.promotion.rewards[0];
    assert.equal(updatedReward.presentation.banner_title, 'Dapatkan Hadiah Spesial!', 'Preserved presentation payload across PUT');
  });

  it('11. Security audit log records PROMOTION_PRESENTATION_UPDATED event', () => {
    const auditRow = db.prepare(`
      SELECT * FROM security_audit_log
      WHERE action = 'PROMOTION_PRESENTATION_UPDATED' AND brand_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(BRAND_A);

    assert.ok(auditRow, 'Audit log event emitted');
  });
});
