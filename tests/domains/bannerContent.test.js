'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../server/database/db');
const BannerContentService = require('../../domains/banner/services/BannerContentService');
const BannerContentRepository = require('../../core/data/repositories/BannerContentRepository');

const BRAND_ID = 'brand_bangjo';
const OTHER_BRAND_ID = 'brand_banner_other_test';
const TEST_PREFIX = 'banner_content_test_';

function cleanup() {
  db.exec("DELETE FROM media_assets WHERE id LIKE 'med_banner_content_test_%'");
  db.exec("DELETE FROM storefront_banner_revisions WHERE banner_id LIKE 'bnr_banner_content_test_%'");
  db.exec("DELETE FROM storefront_banners WHERE id LIKE 'bnr_banner_content_test_%'");
  db.exec("DELETE FROM promotions WHERE id LIKE 'prm_banner_content_test_%'");
  db.exec("DELETE FROM products WHERE id LIKE 'prod_banner_content_test_%'");
  db.exec("DELETE FROM categories WHERE id LIKE 'cat_banner_content_test_%'");
  db.prepare('DELETE FROM brands WHERE id = ?').run(OTHER_BRAND_ID);
}

test('BANNER CONTENT DOMAIN — draft, revision and publish boundary', async (t) => {
  await t.test('0. Schema exists and test prerequisites are available', () => {
    db.initSchema(db);
    const tableNames = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('storefront_banners', 'storefront_banner_revisions')
      ORDER BY name
    `).all();

    assert.deepEqual(
      tableNames.map(row => row.name),
      ['storefront_banner_revisions', 'storefront_banners']
    );

    const media = db.prepare(`
      SELECT id
      FROM media_assets
      WHERE brand_id = ? AND asset_type = 'banner' AND status = 'ready'
      LIMIT 1
    `).get(BRAND_ID);
    assert.equal(media, undefined, 'Baseline test intentionally creates its own ready media below.');
    cleanup();
  });

  await t.test('1. Create Draft with READY canonical banner media', () => {
    db.prepare(`
      INSERT INTO media_assets (
        id, tenant_id, brand_id, uploaded_by, storage_key, mime_type,
        original_filename, width, height, size_bytes, asset_type, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'banner', 'ready', ?, ?)
    `).run(
      TEST_PREFIX + 'media_1',
      'org_xentra_holding',
      BRAND_ID,
      'usr_bangjo_owner',
      'originals/' + BRAND_ID + '/test-banner-1.jpg',
      'image/jpeg',
      'test-banner-1.jpg',
      1920,
      990,
      1024,
      new Date().toISOString(),
      new Date().toISOString()
    );

    const service = new BannerContentService();
    const banner = service.createDraft({
      brandId: BRAND_ID,
      actorId: 'usr_bangjo_owner',
      mediaId: TEST_PREFIX + 'media_1',
      title: 'Promo Ramadan',
      altText: 'Promo Ramadan',
      ctaType: 'NONE'
    });

    assert.equal(banner.publication_status, 'DRAFT');
    assert.equal(banner.draft_revision.title, 'Promo Ramadan');
    assert.equal(banner.draft_revision.media_id, TEST_PREFIX + 'media_1');

    const attached = db.prepare(
      'SELECT attached_to_type, attached_to_id FROM media_assets WHERE id = ?'
    ).get(TEST_PREFIX + 'media_1');
    assert.equal(attached.attached_to_type, 'banner_content_revision');
    assert.equal(attached.attached_to_id, banner.draft_revision.id);
  });

  await t.test('2. Publish does not mutate the published content implicitly; live version is explicit', () => {
    const service = new BannerContentService();
    const bannerId = db.prepare(
      `SELECT id FROM storefront_banners WHERE brand_id = ? ORDER BY created_at DESC LIMIT 1`
    ).get(BRAND_ID).id;

    const published = service.publishDraft({
      brandId: BRAND_ID,
      bannerId,
      actorId: 'usr_bangjo_owner'
    });

    assert.equal(published.publication_status, 'PUBLISHED');
    assert.equal(published.published_revision.title, 'Promo Ramadan');
    assert.equal(published.draft_revision, null);
  });

  await t.test('3. Editing a published banner creates a separate Draft Revision', () => {
    const service = new BannerContentService();

    const bannerId = db.prepare(
      `SELECT id FROM storefront_banners WHERE brand_id = ? ORDER BY created_at DESC LIMIT 1`
    ).get(BRAND_ID).id;

    db.prepare(`
      INSERT INTO media_assets (
        id, tenant_id, brand_id, uploaded_by, storage_key, mime_type,
        original_filename, width, height, size_bytes, asset_type, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'banner', 'ready', ?, ?)
    `).run(
      TEST_PREFIX + 'media_2',
      'org_xentra_holding',
      BRAND_ID,
      'usr_bangjo_owner',
      'originals/' + BRAND_ID + '/test-banner-2.jpg',
      'image/jpeg',
      'test-banner-2.jpg',
      1920,
      990,
      1024,
      new Date().toISOString(),
      new Date().toISOString()
    );

    const updated = service.updateDraft({
      brandId: BRAND_ID,
      bannerId,
      actorId: 'usr_bangjo_owner',
      mediaId: TEST_PREFIX + 'media_2',
      title: 'Promo Oktober',
      altText: 'Promo Oktober',
      ctaType: 'NONE'
    });

    assert.equal(updated.publication_status, 'PUBLISHED');
    assert.equal(updated.published_revision.title, 'Promo Ramadan');
    assert.equal(updated.draft_revision.title, 'Promo Oktober');
    assert.notEqual(updated.published_revision.id, updated.draft_revision.id);

    const media1 = db.prepare(
      'SELECT status FROM media_assets WHERE id = ?'
    ).get(TEST_PREFIX + 'media_1');
    const media2 = db.prepare(
      'SELECT status, attached_to_id FROM media_assets WHERE id = ?'
    ).get(TEST_PREFIX + 'media_2');

    assert.equal(media1.status, 'orphan');
    assert.equal(media2.status, 'ready');
    assert.equal(media2.attached_to_id, updated.draft_revision.id);
  });

  await t.test('4. Cross-brand Promotion/Product/Category CTA references are rejected', () => {
    cleanup();
    db.prepare(`
      INSERT INTO brands (id, organization_id, name, slug, custom_domain, banners)
      VALUES (?, ?, 'Other Brand', 'other-banner-brand', 'other-banner.test', '[]')
    `).run(OTHER_BRAND_ID, 'org_xentra_holding');

    const otherPromotionId = 'prm_banner_content_test_other';
    db.prepare(`
      INSERT INTO promotions (id, brand_id, name, capability_type, stacking_policy)
      VALUES (?, ?, 'Other Promo', 'install_incentive', 'exclusive')
    `).run(otherPromotionId, OTHER_BRAND_ID);

    const mediaId = TEST_PREFIX + 'media_cross_brand';
    db.prepare(`
      INSERT INTO media_assets (
        id, tenant_id, brand_id, uploaded_by, storage_key, mime_type,
        original_filename, width, height, size_bytes, asset_type, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'banner', 'ready', ?, ?)
    `).run(
      mediaId, 'org_xentra_holding', BRAND_ID, 'usr_bangjo_owner',
      'originals/' + BRAND_ID + '/cross.jpg', 'image/jpeg', 'cross.jpg',
      1920, 990, 1024, new Date().toISOString(), new Date().toISOString()
    );

    const service = new BannerContentService();

    assert.throws(() => {
      service.createDraft({
        brandId: BRAND_ID,
        actorId: 'usr_bangjo_owner',
        mediaId,
        title: 'Cross Brand',
        ctaType: 'PROMOTION',
        promotionId: otherPromotionId
      });
    }, (err) => err.code === 'INVALID_PROMOTION_REFERENCE');

    cleanup();
  });

  await t.test('5. Non-READY media and invalid CTA contracts are rejected', () => {
    const mediaId = TEST_PREFIX + 'media_not_ready';
    db.prepare(`
      INSERT INTO media_assets (
        id, tenant_id, brand_id, uploaded_by, storage_key, mime_type,
        original_filename, width, height, size_bytes, asset_type, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'banner', 'temporary', ?, ?)
    `).run(
      mediaId, 'org_xentra_holding', BRAND_ID, 'usr_bangjo_owner',
      'staging/' + BRAND_ID + '/temp.jpg', 'image/jpeg', 'temp.jpg',
      1920, 990, 1024, new Date().toISOString(), new Date().toISOString()
    );

    const service = new BannerContentService();

    assert.throws(() => {
      service.createDraft({
        brandId: BRAND_ID,
        mediaId,
        title: 'Not Ready',
        ctaType: 'NONE'
      });
    }, (err) => err.code === 'ASSET_NOT_READY');

    const readyId = TEST_PREFIX + 'media_ready_cta';
    db.prepare(`
      INSERT INTO media_assets (
        id, tenant_id, brand_id, uploaded_by, storage_key, mime_type,
        original_filename, width, height, size_bytes, asset_type, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'banner', 'ready', ?, ?)
    `).run(
      readyId, 'org_xentra_holding', BRAND_ID, 'usr_bangjo_owner',
      'originals/' + BRAND_ID + '/cta.jpg', 'image/jpeg', 'cta.jpg',
      1920, 990, 1024, new Date().toISOString(), new Date().toISOString()
    );

    assert.throws(() => {
      service.createDraft({
        brandId: BRAND_ID,
        mediaId: readyId,
        title: 'Bad CTA',
        ctaType: 'PROMOTION'
      });
    }, (err) => err.code === 'CTA_TARGET_REQUIRED');

    cleanup();
  });

  t.after(() => cleanup());
});
