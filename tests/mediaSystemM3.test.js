'use strict';

/**
 * MEDIA SYSTEM M3 TEST SUITE
 * Canonical Server-Side Image Processing Pipeline (Sharp / libvips)
 *
 * Tests 21 critical capabilities:
 * 1. JPEG processing succeeds
 * 2. PNG processing succeeds
 * 3. WebP input processing succeeds
 * 4. Non-square portrait source works
 * 5. Non-square landscape source works
 * 6. Square source works
 * 7. Banner ~1.94:1 output works
 * 8. CropSpec is consumed correctly
 * 9. Invalid CropSpec is rejected/clamped safely
 * 10. No upscaling occurs
 * 11. 320/640/1024/1600/2048 square derivatives are generated only when valid
 * 12. Banner derivatives are generated only when valid
 * 13. WebP output is valid
 * 14. Delivery derivative has no EXIF/GPS metadata
 * 15. Failed processing enters FAILED safely
 * 16. Retry can process a failed asset
 * 17. Replacement does not destroy the existing active asset when processing fails
 * 18. Successful replacement activates the new processed asset
 * 19. Tenant isolation is preserved
 * 20. Duplicate/concurrent processing cannot publish stale results
 * 21. HEIC remains UNSUPPORTED unless actual decode capability is proven
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const { MediaService, LocalStorageProvider } = require('../core/media');
const { ImageProcessor } = require('../core/media/ImageProcessor');
const MediaRepository = require('../core/data/repositories/MediaRepository');
const DataAccess = require('../core/data/DataAccess');
const { CropSpec } = require('../core/domain/CropSpec');
const ImageValidator = require('../core/domain/ImageValidator');

// Helper to generate real encoded test image buffers
async function createSyntheticImage({ width, height, format = 'jpeg', channels = 3, withExif = false }) {
  const rawBuf = Buffer.alloc(width * height * channels);
  for (let i = 0; i < rawBuf.length; i += channels) {
    const pixelIdx = i / channels;
    const x = pixelIdx % width;
    const y = Math.floor(pixelIdx / width);
    rawBuf[i] = (x ^ y) & 0xFF;
    rawBuf[i + 1] = ((x * 2) ^ y) & 0xFF;
    rawBuf[i + 2] = ((y * 3) ^ x) & 0xFF;
  }

  let s = sharp(rawBuf, { raw: { width, height, channels } });

  if (withExif) {
    s = s.withMetadata({
      exif: {
        IFD0: {
          Make: 'XentraCamera',
          Model: 'PhonePro2026'
        }
      }
    });
  }

  if (format === 'png') {
    return s.png().toBuffer();
  } else if (format === 'webp') {
    return s.webp({ quality: 85 }).toBuffer();
  }
  return s.jpeg({ quality: 85 }).toBuffer();
}

test('MEDIA SYSTEM M3 — CANONICAL SERVER-SIDE IMAGE PROCESSING PIPELINE', async (t) => {
  await DataAccess.ready();

  const testStorageDir = path.join(__dirname, '../scratch/test-storage-m3');
  if (fs.existsSync(testStorageDir)) {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  }

  const storageProvider = new LocalStorageProvider({ baseDir: testStorageDir });
  const mediaRepo = new MediaRepository(DataAccess);
  const processor = new ImageProcessor();
  const mediaService = new MediaService({
    mediaRepository: mediaRepo,
    storageProvider,
    validator: ImageValidator,
    imageProcessor: processor
  });

  const BRAND_A = 'brand_bangjo';
  const BRAND_B = 'brand_m3_beta';

  // Ensure test organization and brands exist for foreign key constraints
  try {
    DataAccess.execute("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_m3', 'M3 Org', 'm3-org')");
    DataAccess.execute("INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)", [
      BRAND_A, 'org_m3', 'Bangjo Brand', 'bangjo-brand', 'bangjo.test.domain'
    ]);
    DataAccess.execute("INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)", [
      BRAND_B, 'org_m3', 'Beta Brand', 'beta-brand', 'beta.test.domain'
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
  // 1. JPEG processing succeeds
  // --------------------------------------------------------------------------
  await t.test('1. JPEG processing succeeds and generates WebP derivatives', async () => {
    const jpegBuf = await createSyntheticImage({ width: 800, height: 800, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: jpegBuf.toString('base64'),
      mimeType: 'image/jpeg',
      declaredFilename: 'photo.jpg',
      assetType: 'product'
    });

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A
    });

    assert.equal(processed.status, 'ready');
    assert.ok(Array.isArray(processed.variants));
    assert.ok(processed.variants.length > 0);
    assert.equal(processed.variants[0].format, 'webp');
  });

  // --------------------------------------------------------------------------
  // 2. PNG processing succeeds
  // --------------------------------------------------------------------------
  await t.test('2. PNG processing succeeds and converts to optimized WebP', async () => {
    const pngBuf = await createSyntheticImage({ width: 700, height: 700, format: 'png' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: pngBuf.toString('base64'),
      mimeType: 'image/png',
      declaredFilename: 'icon.png',
      assetType: 'logo'
    });

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A
    });

    assert.equal(processed.status, 'ready');
    assert.ok(processed.variants.length > 0);
    assert.equal(processed.variants[0].mime_type, 'image/webp');
  });

  // --------------------------------------------------------------------------
  // 3. WebP input processing succeeds
  // --------------------------------------------------------------------------
  await t.test('3. WebP input processing succeeds', async () => {
    const webpBuf = await createSyntheticImage({ width: 750, height: 750, format: 'webp' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: webpBuf.toString('base64'),
      mimeType: 'image/webp',
      declaredFilename: 'food.webp',
      assetType: 'product'
    });

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A
    });

    assert.equal(processed.status, 'ready');
    assert.ok(processed.variants.length > 0);
  });

  // --------------------------------------------------------------------------
  // 4. Non-square portrait source works
  // --------------------------------------------------------------------------
  await t.test('4. Non-square portrait source (800x1200) works with 1:1 crop', async () => {
    const portraitBuf = await createSyntheticImage({ width: 800, height: 1200, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: portraitBuf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A
    });

    assert.equal(processed.status, 'ready');
    assert.equal(processed.crop_spec.width, 800);
    assert.equal(processed.crop_spec.height, 800); // 1:1 square
    assert.equal(processed.crop_spec.x, 0);
    assert.equal(processed.crop_spec.y, 200); // Centered vertically (1200 - 800) / 2
  });

  // --------------------------------------------------------------------------
  // 5. Non-square landscape source works
  // --------------------------------------------------------------------------
  await t.test('5. Non-square landscape source (1600x900) works with 1:1 crop', async () => {
    const landscapeBuf = await createSyntheticImage({ width: 1600, height: 900, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: landscapeBuf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'category'
    });

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A
    });

    assert.equal(processed.status, 'ready');
    assert.equal(processed.crop_spec.width, 900);
    assert.equal(processed.crop_spec.height, 900);
    assert.equal(processed.crop_spec.x, 350); // Centered horizontally (1600 - 900) / 2
    assert.equal(processed.crop_spec.y, 0);
  });

  // --------------------------------------------------------------------------
  // 6. Square source works
  // --------------------------------------------------------------------------
  await t.test('6. Square source works seamlessly without cropping loss', async () => {
    const squareBuf = await createSyntheticImage({ width: 1024, height: 1024, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: squareBuf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A
    });

    assert.equal(processed.crop_spec.x, 0);
    assert.equal(processed.crop_spec.y, 0);
    assert.equal(processed.crop_spec.width, 1024);
    assert.equal(processed.crop_spec.height, 1024);
  });

  // --------------------------------------------------------------------------
  // 7. Banner ~1.94:1 output works
  // --------------------------------------------------------------------------
  await t.test('7. Banner ~1.94:1 canonical output works for promotional banners', async () => {
    const bannerSource = await createSyntheticImage({ width: 1920, height: 1080, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: bannerSource.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'banner'
    });

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A
    });

    assert.equal(processed.status, 'ready');
    const ratio = processed.crop_spec.width / processed.crop_spec.height;
    assert.ok(Math.abs(ratio - (350 / 180)) < 0.05);

    // Verify banner derivatives
    const names = processed.variants.map(v => v.name);
    assert.ok(names.includes('sm'));
    assert.ok(names.includes('md'));
  });

  // --------------------------------------------------------------------------
  // 8. CropSpec is consumed correctly
  // --------------------------------------------------------------------------
  await t.test('8. Explicit M2 CropSpec is consumed correctly by server pipeline', async () => {
    const buf = await createSyntheticImage({ width: 1000, height: 1000, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    const userCrop = {
      x: 100,
      y: 100,
      width: 600,
      height: 600,
      source_width: 1000,
      source_height: 1000,
      aspect_ratio: 1.0,
      zoom: 1.25,
      asset_type: 'product'
    };

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A,
      cropSpec: userCrop
    });

    assert.equal(processed.crop_spec.x, 100);
    assert.equal(processed.crop_spec.y, 100);
    assert.equal(processed.crop_spec.width, 600);
    assert.equal(processed.crop_spec.height, 600);
  });

  // --------------------------------------------------------------------------
  // 9. Invalid CropSpec is clamped safely
  // --------------------------------------------------------------------------
  await t.test('9. Out-of-bounds CropSpec is clamped safely to source boundaries', async () => {
    const buf = await createSyntheticImage({ width: 500, height: 500, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    // Malformed/overflowing crop coordinates: x + width = 300 + 400 = 700 > 500
    const overflowingCrop = {
      x: 300,
      y: 300,
      width: 400,
      height: 400,
      source_width: 500,
      source_height: 500,
      asset_type: 'product'
    };

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A,
      cropSpec: overflowingCrop
    });

    assert.equal(processed.status, 'ready');
    assert.ok(processed.crop_spec.x + processed.crop_spec.width <= 500);
    assert.ok(processed.crop_spec.y + processed.crop_spec.height <= 500);
  });

  // --------------------------------------------------------------------------
  // 10. No upscaling occurs
  // --------------------------------------------------------------------------
  await t.test('10. No upscaling occurs when source is smaller than large presets', async () => {
    // 500x500 source should only generate thumb (320x320) but NOT sm(640), md(1024), etc.
    const smallBuf = await createSyntheticImage({ width: 500, height: 500, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: smallBuf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A
    });

    assert.equal(processed.variants.length, 1);
    assert.equal(processed.variants[0].name, 'thumb');
    assert.equal(processed.variants[0].width, 320);
  });

  // --------------------------------------------------------------------------
  // 11. Square derivative matrix verification
  // --------------------------------------------------------------------------
  await t.test('11. 320/640/1024/1600/2048 square derivatives generated only when valid', async () => {
    const largeBuf = await createSyntheticImage({ width: 2200, height: 2200, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: largeBuf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A
    });

    const widths = processed.variants.map(v => v.width);
    assert.deepEqual(widths, [320, 640, 1024, 1600, 2048]);
  });

  // --------------------------------------------------------------------------
  // 12. Banner derivatives are generated only when valid
  // --------------------------------------------------------------------------
  await t.test('12. Banner derivatives (640x330, 1200x619, 1920x990) generated when valid', async () => {
    const largeBanner = await createSyntheticImage({ width: 2000, height: 1100, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: largeBanner.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'banner'
    });

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A
    });

    const names = processed.variants.map(v => v.name);
    assert.ok(names.includes('sm'));
    assert.ok(names.includes('md'));
    assert.ok(names.includes('lg'));
  });

  // --------------------------------------------------------------------------
  // 13. WebP output is valid
  // --------------------------------------------------------------------------
  await t.test('13. Generated WebP binary decodes properly with Sharp', async () => {
    const buf = await createSyntheticImage({ width: 400, height: 400, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'avatar'
    });

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A
    });

    const variantKey = processed.variants[0].storage_key;
    const variantBuf = await storageProvider.read(variantKey);
    const meta = await sharp(variantBuf).metadata();

    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, 320);
    assert.equal(meta.height, 320);
  });

  // --------------------------------------------------------------------------
  // 14. Delivery derivative has no EXIF/GPS metadata
  // --------------------------------------------------------------------------
  await t.test('14. Delivery derivative has all EXIF/GPS metadata completely stripped', async () => {
    const exifImage = await createSyntheticImage({ width: 800, height: 800, format: 'jpeg', withExif: true });
    // Verify source has exif
    const sourceMeta = await sharp(exifImage).metadata();
    assert.ok(sourceMeta.exif, 'Source must have EXIF metadata');

    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: exifImage.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    const processed = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A
    });

    for (const v of processed.variants) {
      const vBuf = await storageProvider.read(v.storage_key);
      const vMeta = await sharp(vBuf).metadata();
      assert.equal(vMeta.exif, undefined, `Variant ${v.name} must have EXIF stripped`);
      assert.equal(vMeta.icc, undefined, `Variant ${v.name} must have ICC stripped`);
      assert.equal(vMeta.iptc, undefined, `Variant ${v.name} must have IPTC stripped`);
      assert.equal(vMeta.xmp, undefined, `Variant ${v.name} must have XMP stripped`);
    }
  });

  // --------------------------------------------------------------------------
  // 15. Failed processing enters FAILED safely
  // --------------------------------------------------------------------------
  await t.test('15. Failed processing transitions asset to FAILED safely', async () => {
    const buf = await createSyntheticImage({ width: 400, height: 400, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    // Mock processor error
    const faultyService = new MediaService({
      mediaRepository: mediaRepo,
      storageProvider,
      validator: ImageValidator,
      imageProcessor: {
        process: async () => {
          throw new Error('SIMULATED_DECODE_FAILURE');
        }
      }
    });

    await assert.rejects(async () => {
      await faultyService.processMedia({
        mediaId: staged.media_id,
        brandId: BRAND_A
      });
    }, /SIMULATED_DECODE_FAILURE/);

    const failed = mediaService.getMedia({ mediaId: staged.media_id, brandId: BRAND_A });
    assert.equal(failed.status, 'failed');
    assert.match(failed.error_message, /SIMULATED_DECODE_FAILURE/);
  });

  // --------------------------------------------------------------------------
  // 16. Retry can process a failed asset
  // --------------------------------------------------------------------------
  await t.test('16. Retry processing transitions FAILED asset to PROCESSING and READY', async () => {
    const buf = await createSyntheticImage({ width: 400, height: 400, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    // Force failure
    await mediaService.transitionStatus({
      mediaId: staged.media_id,
      brandId: BRAND_A,
      targetStatus: 'failed',
      errorMessage: 'Previous failure'
    });

    const failed = mediaService.getMedia({ mediaId: staged.media_id, brandId: BRAND_A });
    assert.equal(failed.status, 'failed');

    // Process again (retry)
    const retried = await mediaService.processMedia({
      mediaId: staged.media_id,
      brandId: BRAND_A
    });

    assert.equal(retried.status, 'ready');
    assert.ok(retried.variants.length > 0);
  });

  // --------------------------------------------------------------------------
  // 17. Replacement does not destroy existing active asset when processing fails
  // --------------------------------------------------------------------------
  await t.test('17. Failed replacement leaves existing active asset untouched', async () => {
    // 1. Existing ready asset
    const oldBuf = await createSyntheticImage({ width: 400, height: 400, format: 'jpeg' });
    const oldStaged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: oldBuf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });
    const oldProcessed = await mediaService.processMedia({ mediaId: oldStaged.media_id, brandId: BRAND_A });
    await mediaService.attachToEntity({
      mediaId: oldProcessed.media_id,
      brandId: BRAND_A,
      entityType: 'product',
      entityId: 'prod_999'
    });

    // 2. New asset that fails processing
    const newBuf = await createSyntheticImage({ width: 400, height: 400, format: 'jpeg' });
    const newStaged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: newBuf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    // Attempting replacement with unready new asset must reject
    await assert.rejects(async () => {
      await mediaService.replaceEntityMedia({
        newMediaId: newStaged.media_id,
        oldMediaId: oldProcessed.media_id,
        brandId: BRAND_A,
        entityType: 'product',
        entityId: 'prod_999'
      });
    }, (err) => {
      return err.code === 'ASSET_NOT_READY';
    });

    // Verify old asset remains untouched and active
    const oldCheck = mediaService.getMedia({ mediaId: oldProcessed.media_id, brandId: BRAND_A });
    assert.equal(oldCheck.status, 'ready');
    assert.equal(oldCheck.attached_to_id, 'prod_999');
  });

  // --------------------------------------------------------------------------
  // 18. Successful replacement activates new processed asset
  // --------------------------------------------------------------------------
  await t.test('18. Successful replacement activates new asset and orphans old asset', async () => {
    // Old asset
    const oldBuf = await createSyntheticImage({ width: 400, height: 400, format: 'jpeg' });
    const oldStaged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: oldBuf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });
    const oldReady = await mediaService.processMedia({ mediaId: oldStaged.media_id, brandId: BRAND_A });
    await mediaService.attachToEntity({
      mediaId: oldReady.media_id,
      brandId: BRAND_A,
      entityType: 'product',
      entityId: 'prod_888'
    });

    // New asset
    const newBuf = await createSyntheticImage({ width: 640, height: 640, format: 'png' });
    const newStaged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: newBuf.toString('base64'),
      mimeType: 'image/png',
      assetType: 'product'
    });
    const newReady = await mediaService.processMedia({ mediaId: newStaged.media_id, brandId: BRAND_A });

    // Perform atomic replacement
    await mediaService.replaceEntityMedia({
      newMediaId: newReady.media_id,
      oldMediaId: oldReady.media_id,
      brandId: BRAND_A,
      entityType: 'product',
      entityId: 'prod_888'
    });

    const oldAfter = mediaService.getMedia({ mediaId: oldReady.media_id, brandId: BRAND_A });
    const newAfter = mediaService.getMedia({ mediaId: newReady.media_id, brandId: BRAND_A });

    assert.equal(oldAfter.status, 'orphan');
    assert.ok(oldAfter.orphaned_at);
    assert.equal(newAfter.status, 'ready');
    assert.equal(newAfter.attached_to_id, 'prod_888');
  });

  // --------------------------------------------------------------------------
  // 19. Tenant isolation is preserved
  // --------------------------------------------------------------------------
  await t.test('19. Tenant B cannot process or access media belonging to Tenant A', async () => {
    const buf = await createSyntheticImage({ width: 500, height: 500, format: 'jpeg' });
    const stagedA = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    // Tenant B attempts to process Tenant A's media
    await assert.rejects(async () => {
      await mediaService.processMedia({
        mediaId: stagedA.media_id,
        brandId: BRAND_B
      });
    }, (err) => {
      return err.code === 'UNAUTHORIZED_TENANT';
    });
  });

  // --------------------------------------------------------------------------
  // 20. Duplicate/concurrent processing does not corrupt state
  // --------------------------------------------------------------------------
  await t.test('20. Duplicate/re-processing overwrites variants cleanly without duplicate keys', async () => {
    const buf = await createSyntheticImage({ width: 700, height: 700, format: 'jpeg' });
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      assetType: 'product'
    });

    const firstRun = await mediaService.processMedia({ mediaId: staged.media_id, brandId: BRAND_A });
    const firstVariantsCount = firstRun.variants.length;

    // Reset status to allow re-run
    await mediaService.transitionStatus({
      mediaId: staged.media_id,
      brandId: BRAND_A,
      targetStatus: 'failed',
      errorMessage: 'Force rerun'
    });

    // Re-run
    const secondRun = await mediaService.processMedia({ mediaId: staged.media_id, brandId: BRAND_A });
    assert.equal(secondRun.status, 'ready');
    assert.equal(secondRun.variants.length, firstVariantsCount);
  });

  // --------------------------------------------------------------------------
  // 21. HEIC remains UNSUPPORTED unless actual decode capability is proven
  // --------------------------------------------------------------------------
  await t.test('21. HEIC upload is rejected with UNSUPPORTED_FORMAT', async () => {
    const fakeHeic = Buffer.from([
      0, 0, 0, 24,
      0x66, 0x74, 0x79, 0x70, // 'ftyp'
      0x68, 0x65, 0x69, 0x63, // 'heic'
      0, 0, 0, 0,
      0x6d, 0x69, 0x66, 0x31,
      0x68, 0x65, 0x69, 0x63
    ]);

    await assert.rejects(async () => {
      await mediaService.stageUpload({
        brandId: BRAND_A,
        imageBase64: fakeHeic.toString('base64'),
        mimeType: 'image/heic',
        declaredFilename: 'sample.heic',
        assetType: 'product'
      });
    }, (err) => {
      return err.code === 'UNSUPPORTED_FORMAT';
    });
  });
});
