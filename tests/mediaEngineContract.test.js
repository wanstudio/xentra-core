'use strict';

/**
 * Canonical Media Engine Boundary Contract
 *
 * This regression suite intentionally checks the architecture boundary, not just
 * individual UI behaviours:
 * - every image upload route delegates binary handling to MediaService;
 * - generic brand/settings updates cannot inject media URLs;
 * - CropSpec enforces the canonical ratio contract server-side;
 * - ImageProcessor normalizes EXIF orientation before crop/resize;
 * - client-facing media specs do not contradict the authoritative upload policy.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const { CropSpec } = require('../core/domain/CropSpec');
const { ImageProcessor } = require('../core/media/ImageProcessor');

const ROOT = path.join(__dirname, '..');

test('MEDIA ENGINE — canonical boundary contract', async (t) => {
  await t.test('1. CropSpec rejects non-canonical product/category/logo/avatar ratios', () => {
    for (const assetType of ['product', 'category', 'logo', 'avatar']) {
      assert.throws(
        () => new CropSpec({
          x: 0, y: 0, width: 400, height: 300,
          source_width: 800, source_height: 800,
          aspect_ratio: 4 / 3,
          zoom: 1,
          asset_type: assetType
        }),
        /Crop ratio is invalid/
      );
    }
  });

  await t.test('2. CropSpec accepts canonical square and banner ratios', () => {
    assert.doesNotThrow(() => new CropSpec({
      x: 0, y: 0, width: 400, height: 400,
      source_width: 800, source_height: 800,
      aspect_ratio: 1,
      zoom: 1,
      asset_type: 'product'
    }));

    assert.doesNotThrow(() => new CropSpec({
      x: 0, y: 0, width: 350, height: 180,
      source_width: 700, source_height: 700,
      aspect_ratio: 350 / 180,
      zoom: 1,
      asset_type: 'banner'
    }));
  });

  await t.test('3. ImageProcessor normalizes EXIF orientation before crop', async () => {
    const raw = Buffer.alloc(2 * 3 * 3, 0x55);
    const source = await sharp(raw, { raw: { width: 2, height: 3, channels: 3 } })
      .jpeg({ quality: 90 })
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const processor = new ImageProcessor();
    const result = await processor.process({ sourceBuffer: source, assetType: 'product' });

    // EXIF orientation 6 rotates 2x3 into a canonical 3x2 pixel raster.
    assert.equal(result.sourceMeta.width, 3);
    assert.equal(result.sourceMeta.height, 2);
    assert.equal(result.cropSpec.width, 2);
    assert.equal(result.cropSpec.height, 2);
    assert.equal(result.derivatives[0].format, 'webp');
  });

  await t.test('4. Upload route boundary has no direct filesystem writes', () => {
    const routeFiles = [
      'server/routes/admin-brand.js',
      'server/routes/media-upload.js',
      'server/routes/media-entities.js'
    ];
    for (const rel of routeFiles) {
      const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.equal(code.includes('fs.writeFileSync'), false, rel + ' must not write upload binaries directly');
    }

    const brandCode = fs.readFileSync(path.join(ROOT, 'server/routes/admin-brand.js'), 'utf8');
    assert.match(brandCode, /mediaService\.stageUpload/);
    assert.match(brandCode, /mediaService\.processMedia/);
    assert.doesNotMatch(brandCode, /const \{ url, image_base64, mime_type \}/);
  });

  await t.test('5. Generic brand/settings updates do not write media references', () => {
    const brandCode = fs.readFileSync(path.join(ROOT, 'server/routes/admin-brand.js'), 'utf8');
    const repoCode = fs.readFileSync(path.join(ROOT, 'core/data/repositories/BrandRepository.js'), 'utf8');
    const settingsCode = fs.readFileSync(path.join(ROOT, 'server/routes/settings.js'), 'utf8');

    assert.doesNotMatch(brandCode, /logo_url\s*=\s*COALESCE/);
    assert.doesNotMatch(brandCode, /merchant_pwa_icon_url\s*=\s*CASE/);
    assert.doesNotMatch(brandCode, /pos_pwa_icon_url\s*=\s*CASE/);
    assert.doesNotMatch(repoCode, /banners\s*=\s*COALESCE/);
    assert.match(settingsCode, /Media URLs are read-only here/);
  });

  await t.test('6. UI copy matches authoritative upload policy', () => {
    const files = [
      'apps/merchant-dashboard/index.html',
      'apps/merchant-app/index.html'
    ];
    for (const rel of files) {
      const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.doesNotMatch(code, /Maks\.?\s*3\s*MB/i, rel + ' must not advertise obsolete 3MB limits');
    }

    const dashboard = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/index.html'), 'utf8');
    assert.match(dashboard, /Maks\. 20 MB · Rasio 1:1/);
    assert.match(dashboard, /Maks\. 15 MB/);
  });

  await t.test('7. PWA launcher helper transmits crop intent to the canonical endpoint', () => {
    const code = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');
    assert.match(code, /function doUploadPwaLauncherIcon\(file, endpoint, previewEl, hiddenEl, removeBtn, pickBtn, cropSpec\)/);
    assert.match(code, /crop_spec: cropSpec \|\| null/);
  });

  await t.test('8. Locked branch-product photo boundary is enforced server-side', () => {
    const entityRoutes = fs.readFileSync(path.join(ROOT, 'server/routes/media-entities.js'), 'utf8');
    const legacyRoutes = fs.readFileSync(path.join(ROOT, 'server/routes/media-upload.js'), 'utf8');

    assert.match(entityRoutes, /BRANCH_PRODUCT_IMAGE_OVERRIDE_DISABLED/);
    assert.match(entityRoutes, /res\.status\(410\)/);
    assert.match(legacyRoutes, /LEGACY_BRANCH_PRODUCT_IMAGE_OVERRIDE_DISABLED/);
    assert.match(legacyRoutes, /res\.status\(410\)/);
  });

  await t.test('9. Banner compatibility accepts only exact Media System delivery URLs', () => {
    const brandCode = fs.readFileSync(path.join(ROOT, 'server/routes/admin-brand.js'), 'utf8');
    assert.doesNotMatch(
      brandCode,
      /LIKE '\%' \|\| id \|\| '\%'/,
      'banner compatibility must not trust arbitrary URLs containing a known media id'
    );
    assert.match(brandCode, /storage\.resolveUrl\(key\) === image_url/);
  });

  await t.test('10. Branch catalog cannot resolve legacy image_override as active photo', () => {
    const catalogCode = fs.readFileSync(path.join(ROOT, 'core/data/repositories/CatalogRepository.js'), 'utf8');
    const adminCatalogCode = fs.readFileSync(path.join(ROOT, 'server/routes/admin-branch-catalog.js'), 'utf8');
    assert.doesNotMatch(catalogCode, /COALESCE\(bp\.image_override, p\.image_url\)/);
    assert.doesNotMatch(adminCatalogCode, /COALESCE\\(bp\\.image_override, p\\.image_url\\)/);
    assert.match(catalogCode, /p\.image_url as image_url/);
    assert.match(adminCatalogCode, /p\\.image_url as image_url/);
  });

  await t.test('12. Post-publish cleanup cannot downgrade a published asset', () => {
    const serviceCode = fs.readFileSync(path.join(ROOT, 'core/media/MediaService.js'), 'utf8');
    assert.match(serviceCode, /let published = false;/);
    assert.match(serviceCode, /published = true;/);
    assert.match(serviceCode, /Cleanup is best-effort and must NEVER roll back/);
    assert.match(serviceCode, /if \(published\)/);
  });

  await t.test('13. Higher-level banner transactions do not nest MediaService transactions', () => {
    const mediaCode = fs.readFileSync(path.join(ROOT, 'core/media/MediaService.js'), 'utf8');
    const bannerCode = fs.readFileSync(path.join(ROOT, 'domains/banner/services/BannerContentService.js'), 'utf8');
    assert.match(mediaCode, /manageTransaction = true/);
    assert.match(bannerCode, /manageTransaction: false/);
    assert.equal((bannerCode.match(/manageTransaction: false/g) || []).length, 3);
  });

  await t.test('14. Forward branch-product UI has no executable photo-upload state/path', () => {
    const files = [
      'apps/merchant-dashboard/assets/js/branch-catalog-ui.js',
      'apps/merchant-app/assets/js/branch-catalog-ui.js'
    ];
    for (const rel of files) {
      const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.doesNotMatch(code, /uploadBranchProductImage/);
      assert.doesNotMatch(code, /_bpSelectedFile/);
      assert.doesNotMatch(code, /XentraCropEditor\.open/);
    }
  });

  await t.test('15. HTTP JSON body limit leaves headroom for 20MB base64 media', () => {
    const appCode = fs.readFileSync(path.join(ROOT, 'server/app.js'), 'utf8');
    assert.match(appCode, /express\.json\(\{ limit: ['"]30mb['"] \}\)/);
    assert.match(appCode, /express\.urlencoded\(\{ extended: true, limit: ['"]30mb['"] \}\)/);
  });

  await t.test('11. Orphaned media cannot retain a stale entity attachment', () => {
    const repoCode = fs.readFileSync(path.join(ROOT, 'core/data/repositories/MediaRepository.js'), 'utf8');
    assert.match(repoCode, /status = 'orphan'/);
    assert.match(repoCode, /attached_to_type = NULL/);
    assert.match(repoCode, /attached_to_id = NULL/);
    assert.match(repoCode, /attached_at = NULL/);
  });
});
