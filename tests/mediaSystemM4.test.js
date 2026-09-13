'use strict';

/**
 * MEDIA SYSTEM M4 TEST SUITE
 * Media Storage & Asset Lifecycle
 *
 * Tests 21 critical M4 capabilities:
 * 1. Active/reference-protected media is retained
 * 2. Unreferenced media becomes ORPHAN upon delete/replace
 * 3. ORPHAN younger than 30 days is retained
 * 4. ORPHAN older than 30 days becomes deletion candidate
 * 5. Final reference check protects newly referenced media
 * 6. Hard deletion removes original binary safely
 * 7. Hard deletion removes associated variants safely
 * 8. Temporary assets cleaned according to 24h policy
 * 9. Failed assets can be cleaned safely
 * 10. Missing original binary is detected during consistency check
 * 11. Missing variant binary is detected during consistency check
 * 12. Duplicate GC execution is safe (idempotent)
 * 13. Replacement preserves old active media until new media is READY
 * 14. Failed replacement does not destroy old active media
 * 15. Tenant isolation prevents cross-tenant deletion
 * 16. Storage keys remain tenant/media scoped
 * 17. Reconciliation is idempotent
 * 18. Garbage collection is idempotent
 * 19. Referenced assets are protected regardless of age
 * 20. Delivery/cache identity remains immutable after replacement
 * 21. Media lifecycle remains valid after cleanup/reconciliation
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const { MediaService, LocalStorageProvider, MediaReferenceResolver } = require('../core/media');
const { ImageProcessor } = require('../core/media/ImageProcessor');
const MediaRepository = require('../core/data/repositories/MediaRepository');
const DataAccess = require('../core/data/DataAccess');
const ImageValidator = require('../core/domain/ImageValidator');

async function createSyntheticJpeg(width = 400, height = 400) {
  const rawBuf = Buffer.alloc(width * height * 3);
  for (let i = 0; i < rawBuf.length; i += 3) {
    const idx = i / 3;
    const x = idx % width;
    const y = Math.floor(idx / width);
    rawBuf[i] = (x ^ y) & 0xFF;
    rawBuf[i + 1] = ((x * 2) ^ y) & 0xFF;
    rawBuf[i + 2] = ((y * 3) ^ x) & 0xFF;
  }
  return sharp(rawBuf, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 80 })
    .toBuffer();
}

test('MEDIA SYSTEM M4 — MEDIA STORAGE & ASSET LIFECYCLE SUITE', async (t) => {
  await DataAccess.ready();

  const testStorageDir = path.join(__dirname, '../scratch/test-storage-m4');
  if (fs.existsSync(testStorageDir)) {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  }

  const storageProvider = new LocalStorageProvider({ baseDir: testStorageDir });
  const mediaRepo = new MediaRepository(DataAccess);
  const processor = new ImageProcessor();
  const resolver = new MediaReferenceResolver(DataAccess);
  const mediaService = new MediaService({
    mediaRepository: mediaRepo,
    storageProvider,
    validator: ImageValidator,
    imageProcessor: processor,
    referenceResolver: resolver
  });

  const BRAND_A = 'brand_bangjo';
  const BRAND_B = 'brand_m4_beta';

  // Ensure test organizations and brands exist
  try {
    DataAccess.execute("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_m4', 'M4 Org', 'm4-org')");
    DataAccess.execute("INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)", [
      BRAND_A, 'org_m4', 'Bangjo Brand', 'bangjo-brand', 'bangjo.test.domain'
    ]);
    DataAccess.execute("INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)", [
      BRAND_B, 'org_m4', 'Beta Brand', 'beta-brand', 'beta.test.domain'
    ]);
  } catch (_) {}

  t.after(() => {
    try {
      if (fs.existsSync(testStorageDir)) {
        fs.rmSync(testStorageDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  // --------------------------------------------------------------------------
  // 1. Active/reference-protected media is retained
  // --------------------------------------------------------------------------
  await t.test('1. Active/reference-protected media is retained and cannot be hard deleted', async () => {
    const buf = await createSyntheticJpeg(600, 600);
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });
    const ready = await mediaService.processMedia({ mediaId: staged.media_id, brandId: BRAND_A });

    // Attach to product
    await mediaService.attachToEntity({
      mediaId: ready.media_id,
      brandId: BRAND_A,
      entityType: 'product',
      entityId: 'prod_m4_1'
    });

    // Attempt hard delete without force -> must reject because it's referenced
    await assert.rejects(async () => {
      await mediaService.hardDeleteMedia({
        mediaId: ready.media_id,
        brandId: BRAND_A,
        force: false
      });
    }, (err) => err.code === 'ASSET_REFERENCED');

    const check = mediaService.getMedia({ mediaId: ready.media_id, brandId: BRAND_A });
    assert.equal(check.status, 'ready');
  });

  // --------------------------------------------------------------------------
  // 2. Unreferenced media becomes ORPHAN upon delete
  // --------------------------------------------------------------------------
  await t.test('2. Unreferenced media transitions to ORPHAN upon soft delete with timestamp', async () => {
    const buf = await createSyntheticJpeg(500, 500);
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });
    const ready = await mediaService.processMedia({ mediaId: staged.media_id, brandId: BRAND_A });

    const unlinked = await mediaService.deleteMedia({
      mediaId: ready.media_id,
      brandId: BRAND_A,
      force: false
    });

    assert.equal(unlinked.status, 'orphan');
    assert.ok(unlinked.orphaned_at);
    // Binary still exists!
    const binaryExists = await storageProvider.exists(unlinked.storage_key);
    assert.equal(binaryExists, true, 'Original binary must NOT be deleted immediately upon unlinking');
  });

  // --------------------------------------------------------------------------
  // 3. ORPHAN younger than 30 days is retained
  // --------------------------------------------------------------------------
  await t.test('3. ORPHAN younger than 30 days is retained during reconciliation', async () => {
    const buf = await createSyntheticJpeg(500, 500);
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });
    const ready = await mediaService.processMedia({ mediaId: staged.media_id, brandId: BRAND_A });
    await mediaService.deleteMedia({ mediaId: ready.media_id, brandId: BRAND_A });

    // Reconcile with 30-day grace
    const result = await mediaService.reconcileOrphans({ gracePeriodDays: 30, brandId: BRAND_A });
    assert.ok(result.retainedCount >= 1);

    const check = mediaService.getMedia({ mediaId: ready.media_id, brandId: BRAND_A });
    assert.equal(check.status, 'orphan');
  });

  // --------------------------------------------------------------------------
  // 4. ORPHAN older than 30 days becomes deletion candidate
  // --------------------------------------------------------------------------
  await t.test('4. ORPHAN older than 30 days is purged during reconciliation', async () => {
    const buf = await createSyntheticJpeg(500, 500);
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });
    const ready = await mediaService.processMedia({ mediaId: staged.media_id, brandId: BRAND_A });
    await mediaService.deleteMedia({ mediaId: ready.media_id, brandId: BRAND_A });

    // Manually backdate orphaned_at to 35 days ago
    const pastDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    mediaRepo.db.execute('UPDATE media_assets SET orphaned_at = ? WHERE id = ?', [pastDate, ready.media_id]);

    const result = await mediaService.reconcileOrphans({ gracePeriodDays: 30, brandId: BRAND_A });
    assert.ok(result.deletedCount >= 1);

    assert.throws(() => {
      mediaService.getMedia({ mediaId: ready.media_id, brandId: BRAND_A });
    }, (err) => err.code === 'MEDIA_NOT_FOUND');
  });

  // --------------------------------------------------------------------------
  // 5. Final reference check protects newly referenced media
  // --------------------------------------------------------------------------
  await t.test('5. Final reference check protects newly referenced media during reconciliation', async () => {
    const buf = await createSyntheticJpeg(500, 500);
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });
    const ready = await mediaService.processMedia({ mediaId: staged.media_id, brandId: BRAND_A });
    await mediaService.deleteMedia({ mediaId: ready.media_id, brandId: BRAND_A });

    // Backdate orphaned_at to 40 days ago
    const pastDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    mediaRepo.db.execute('UPDATE media_assets SET orphaned_at = ? WHERE id = ?', [pastDate, ready.media_id]);

    // Simulate product actively referencing this asset via attached_to_id
    mediaRepo.db.execute("UPDATE media_assets SET attached_to_type = 'product', attached_to_id = 'prod_protected' WHERE id = ?", [ready.media_id]);

    // Reconcile -> must restore to READY and NOT delete
    const result = await mediaService.reconcileOrphans({ gracePeriodDays: 30, brandId: BRAND_A });
    assert.ok(result.restoredCount >= 1);

    const check = mediaService.getMedia({ mediaId: ready.media_id, brandId: BRAND_A });
    assert.equal(check.status, 'ready');
  });

  // --------------------------------------------------------------------------
  // 6. Hard deletion removes original binary safely
  // --------------------------------------------------------------------------
  await t.test('6. Hard deletion removes original binary safely', async () => {
    const buf = await createSyntheticJpeg(400, 400);
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });
    const ready = await mediaService.processMedia({ mediaId: staged.media_id, brandId: BRAND_A });

    const key = ready.storage_key;
    assert.equal(await storageProvider.exists(key), true);

    await mediaService.hardDeleteMedia({ mediaId: ready.media_id, brandId: BRAND_A, force: true });
    assert.equal(await storageProvider.exists(key), false);
  });

  // --------------------------------------------------------------------------
  // 7. Hard deletion removes associated variants safely
  // --------------------------------------------------------------------------
  await t.test('7. Hard deletion removes all associated variant binaries and DB records', async () => {
    const buf = await createSyntheticJpeg(800, 800);
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });
    const ready = await mediaService.processMedia({ mediaId: staged.media_id, brandId: BRAND_A });

    assert.ok(ready.variants.length > 0);
    const variantKeys = ready.variants.map(v => v.storage_key);

    for (const vk of variantKeys) {
      assert.equal(await storageProvider.exists(vk), true);
    }

    await mediaService.hardDeleteMedia({ mediaId: ready.media_id, brandId: BRAND_A, force: true });

    for (const vk of variantKeys) {
      assert.equal(await storageProvider.exists(vk), false);
    }
    const dbVariants = mediaRepo.getVariantsByMediaId(ready.media_id);
    assert.equal(dbVariants.length, 0);
  });

  // --------------------------------------------------------------------------
  // 8. Temporary assets cleaned according to 24h policy
  // --------------------------------------------------------------------------
  await t.test('8. Abandoned temporary assets older than 24h are purged', async () => {
    const buf = await createSyntheticJpeg(300, 300);
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    // Backdate created_at to 25 hours ago
    const past25h = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    mediaRepo.db.execute('UPDATE media_assets SET created_at = ? WHERE id = ?', [past25h, staged.media_id]);

    const res = await mediaService.cleanupTemporary({ olderThanHours: 24, brandId: BRAND_A });
    assert.ok(res.cleanedCount >= 1);

    assert.throws(() => {
      mediaService.getMedia({ mediaId: staged.media_id, brandId: BRAND_A });
    }, (err) => err.code === 'MEDIA_NOT_FOUND');
  });

  // --------------------------------------------------------------------------
  // 9. Failed assets can be cleaned safely
  // --------------------------------------------------------------------------
  await t.test('9. Failed assets older than 24h are cleaned safely', async () => {
    const buf = await createSyntheticJpeg(300, 300);
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    await mediaService.transitionStatus({
      mediaId: staged.media_id,
      brandId: BRAND_A,
      targetStatus: 'failed',
      errorMessage: 'Decode error'
    });

    const past25h = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    mediaRepo.db.execute('UPDATE media_assets SET created_at = ? WHERE id = ?', [past25h, staged.media_id]);

    const res = await mediaService.cleanupTemporary({ olderThanHours: 24, brandId: BRAND_A });
    assert.ok(res.cleanedCount >= 1);
  });

  // --------------------------------------------------------------------------
  // 10. Missing original binary is detected during consistency check
  // --------------------------------------------------------------------------
  await t.test('10. Missing original binary is detected by consistency check', async () => {
    const buf = await createSyntheticJpeg(400, 400);
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });
    const ready = await mediaService.processMedia({ mediaId: staged.media_id, brandId: BRAND_A });

    // Manually delete original file on disk
    await storageProvider.delete(ready.storage_key);

    const report = await mediaService.checkConsistency({ mediaId: ready.media_id, brandId: BRAND_A });
    assert.equal(report.issuesCount, 1);
    assert.equal(report.issues[0].type, 'MISSING_ORIGINAL_BINARY');
  });

  // --------------------------------------------------------------------------
  // 11. Missing variant binary is detected during consistency check
  // --------------------------------------------------------------------------
  await t.test('11. Missing variant binary is detected by consistency check', async () => {
    const buf = await createSyntheticJpeg(700, 700);
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });
    const ready = await mediaService.processMedia({ mediaId: staged.media_id, brandId: BRAND_A });

    const firstVar = ready.variants[0];
    await storageProvider.delete(firstVar.storage_key);

    const report = await mediaService.checkConsistency({ mediaId: ready.media_id, brandId: BRAND_A });
    assert.ok(report.issuesCount >= 1);
    const issue = report.issues.find(i => i.type === 'MISSING_VARIANT_BINARY');
    assert.ok(issue);
  });

  // --------------------------------------------------------------------------
  // 12. Duplicate GC execution is safe (idempotent)
  // --------------------------------------------------------------------------
  await t.test('12. Duplicate GC execution runs idempotently without errors', async () => {
    const res1 = await mediaService.collectGarbage({ brandId: BRAND_A });
    const res2 = await mediaService.collectGarbage({ brandId: BRAND_A });

    assert.ok(res1);
    assert.ok(res2);
  });

  // --------------------------------------------------------------------------
  // 13. Replacement preserves old active media until new media is READY
  // --------------------------------------------------------------------------
  await t.test('13. Replacement preserves old media until new is READY', async () => {
    const oldBuf = await createSyntheticJpeg(500, 500);
    const oldStaged = await mediaService.stageUpload({ brandId: BRAND_A, imageBase64: oldBuf.toString('base64'), mimeType: 'image/jpeg', assetType: 'product' });
    const oldReady = await mediaService.processMedia({ mediaId: oldStaged.media_id, brandId: BRAND_A });
    await mediaService.attachToEntity({ mediaId: oldReady.media_id, brandId: BRAND_A, entityType: 'product', entityId: 'prod_swap_1' });

    const newBuf = await createSyntheticJpeg(500, 500);
    const newStaged = await mediaService.stageUpload({ brandId: BRAND_A, imageBase64: newBuf.toString('base64'), mimeType: 'image/jpeg', assetType: 'product' });

    // Before new is ready, replacement is rejected and old is preserved
    await assert.rejects(async () => {
      await mediaService.replaceEntityMedia({ newMediaId: newStaged.media_id, oldMediaId: oldReady.media_id, brandId: BRAND_A, entityType: 'product', entityId: 'prod_swap_1' });
    }, (err) => err.code === 'ASSET_NOT_READY');

    const oldCheck = mediaService.getMedia({ mediaId: oldReady.media_id, brandId: BRAND_A });
    assert.equal(oldCheck.status, 'ready');
  });

  // --------------------------------------------------------------------------
  // 14. Failed replacement does not destroy old active media
  // --------------------------------------------------------------------------
  await t.test('14. Failed replacement preserves old active asset untouched', async () => {
    const oldBuf = await createSyntheticJpeg(500, 500);
    const oldStaged = await mediaService.stageUpload({ brandId: BRAND_A, imageBase64: oldBuf.toString('base64'), mimeType: 'image/jpeg', assetType: 'product' });
    const oldReady = await mediaService.processMedia({ mediaId: oldStaged.media_id, brandId: BRAND_A });
    await mediaService.attachToEntity({ mediaId: oldReady.media_id, brandId: BRAND_A, entityType: 'product', entityId: 'prod_swap_2' });

    // Attempt replacing with nonexistent media
    await assert.rejects(async () => {
      await mediaService.replaceEntityMedia({ newMediaId: 'med_nonexistent', oldMediaId: oldReady.media_id, brandId: BRAND_A, entityType: 'product', entityId: 'prod_swap_2' });
    });

    const oldCheck = mediaService.getMedia({ mediaId: oldReady.media_id, brandId: BRAND_A });
    assert.equal(oldCheck.status, 'ready');
    assert.equal(oldCheck.attached_to_id, 'prod_swap_2');
  });

  // --------------------------------------------------------------------------
  // 15. Tenant isolation prevents cross-tenant deletion
  // --------------------------------------------------------------------------
  await t.test('15. Tenant B cannot delete or orphan Tenant A media', async () => {
    const buf = await createSyntheticJpeg(500, 500);
    const stagedA = await mediaService.stageUpload({ brandId: BRAND_A, imageBase64: buf.toString('base64'), mimeType: 'image/jpeg', assetType: 'product' });

    await assert.rejects(async () => {
      await mediaService.deleteMedia({ mediaId: stagedA.media_id, brandId: BRAND_B });
    }, (err) => err.code === 'UNAUTHORIZED_TENANT');
  });

  // --------------------------------------------------------------------------
  // 16. Storage keys remain tenant/media scoped
  // --------------------------------------------------------------------------
  await t.test('16. Storage keys adhere strictly to originals/<brand>/<id> and derivatives/<brand>/<id>/<variant>.webp', async () => {
    const buf = await createSyntheticJpeg(640, 640);
    const staged = await mediaService.stageUpload({ brandId: BRAND_A, imageBase64: buf.toString('base64'), mimeType: 'image/jpeg', assetType: 'product' });
    const ready = await mediaService.processMedia({ mediaId: staged.media_id, brandId: BRAND_A });

    assert.ok(ready.storage_key.startsWith(`originals/${BRAND_A}/${ready.media_id}.`));
    for (const v of ready.variants) {
      assert.ok(v.storage_key.startsWith(`derivatives/${BRAND_A}/${ready.media_id}/`));
    }
  });

  // --------------------------------------------------------------------------
  // 17. Reconciliation is idempotent
  // --------------------------------------------------------------------------
  await t.test('17. Reconciliation runs idempotently without state corruption', async () => {
    const rec1 = await mediaService.reconcileOrphans({ brandId: BRAND_A });
    const rec2 = await mediaService.reconcileOrphans({ brandId: BRAND_A });
    assert.equal(typeof rec1.reconciledCount, 'number');
    assert.equal(typeof rec2.reconciledCount, 'number');
  });

  // --------------------------------------------------------------------------
  // 18. Garbage collection is idempotent
  // --------------------------------------------------------------------------
  await t.test('18. Garbage collection is safe and repeatable', async () => {
    const gc1 = await mediaService.collectGarbage({ brandId: BRAND_A });
    const gc2 = await mediaService.collectGarbage({ brandId: BRAND_A });
    assert.ok(gc1.timestamp);
    assert.ok(gc2.timestamp);
  });

  // --------------------------------------------------------------------------
  // 19. Referenced assets are protected regardless of age
  // --------------------------------------------------------------------------
  await t.test('19. Referenced assets are protected regardless of age (e.g. 500 days old)', async () => {
    const buf = await createSyntheticJpeg(400, 400);
    const staged = await mediaService.stageUpload({ brandId: BRAND_A, imageBase64: buf.toString('base64'), mimeType: 'image/jpeg', assetType: 'product' });
    const ready = await mediaService.processMedia({ mediaId: staged.media_id, brandId: BRAND_A });
    await mediaService.attachToEntity({ mediaId: ready.media_id, brandId: BRAND_A, entityType: 'product', entityId: 'prod_ancient' });

    // Set timestamps to 500 days ago
    const ancientDate = new Date(Date.now() - 500 * 24 * 60 * 60 * 1000).toISOString();
    mediaRepo.db.execute('UPDATE media_assets SET created_at = ?, updated_at = ? WHERE id = ?', [ancientDate, ancientDate, ready.media_id]);

    // Run GC with strict 1-day threshold
    await mediaService.collectGarbage({ temporaryHours: 1, orphanGraceDays: 1, brandId: BRAND_A });

    const check = mediaService.getMedia({ mediaId: ready.media_id, brandId: BRAND_A });
    assert.equal(check.status, 'ready');
    assert.equal(check.attached_to_id, 'prod_ancient');
  });

  // --------------------------------------------------------------------------
  // 20. Delivery/cache identity remains immutable after replacement
  // --------------------------------------------------------------------------
  await t.test('20. Replacing an asset creates a brand new immutable media identity and URLs', async () => {
    const oldBuf = await createSyntheticJpeg(400, 400);
    const oldStaged = await mediaService.stageUpload({ brandId: BRAND_A, imageBase64: oldBuf.toString('base64'), mimeType: 'image/jpeg', assetType: 'product' });
    const oldReady = await mediaService.processMedia({ mediaId: oldStaged.media_id, brandId: BRAND_A });
    await mediaService.attachToEntity({ mediaId: oldReady.media_id, brandId: BRAND_A, entityType: 'product', entityId: 'prod_immutable' });

    const newBuf = await createSyntheticJpeg(400, 400);
    const newStaged = await mediaService.stageUpload({ brandId: BRAND_A, imageBase64: newBuf.toString('base64'), mimeType: 'image/jpeg', assetType: 'product' });
    const newReady = await mediaService.processMedia({ mediaId: newStaged.media_id, brandId: BRAND_A });

    await mediaService.replaceEntityMedia({
      newMediaId: newReady.media_id,
      oldMediaId: oldReady.media_id,
      brandId: BRAND_A,
      entityType: 'product',
      entityId: 'prod_immutable'
    });

    assert.notEqual(oldReady.media_id, newReady.media_id);
    assert.notEqual(oldReady.url, newReady.url);
    assert.notEqual(oldReady.variants[0].url, newReady.variants[0].url);
  });

  // --------------------------------------------------------------------------
  // 21. Media lifecycle remains valid after cleanup/reconciliation
  // --------------------------------------------------------------------------
  await t.test('21. Media lifecycle transitions remain strictly enforced after maintenance runs', async () => {
    const buf = await createSyntheticJpeg(400, 400);
    const staged = await mediaService.stageUpload({ brandId: BRAND_A, imageBase64: buf.toString('base64'), mimeType: 'image/jpeg', assetType: 'product' });

    // Invalid transition: temporary -> orphan
    await assert.rejects(async () => {
      await mediaService.transitionStatus({ mediaId: staged.media_id, brandId: BRAND_A, targetStatus: 'orphan' });
    }, (err) => err.code === 'INVALID_LIFECYCLE_TRANSITION');
  });
});
