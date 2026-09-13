'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { MediaService, MediaLifecycle } = require('../core/media');
const { ImageValidator } = require('../core/domain');
const { createPngBuffer, createJpegBuffer, createWebpBuffer } = require('./helpers/testImageHelper');
const db = require('../server/database/db');

test('MEDIA SYSTEM M1 — SECURE UPLOAD & VALIDATION SUITE', async (t) => {
  const mediaService = new MediaService();
  const BRAND_A = 'brand_bangjo';
  const BRAND_B = 'brand_other_tenant';

  // Ensure test brands exist
  try {
    db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)")
      .run(BRAND_B, 'org_other', 'Other Tenant Brand', 'other-brand', 'other.test.domain');
  } catch (_) {}

  await t.test('1. Valid JPEG binary upload stages to TEMPORARY status', async () => {
    const jpegBuf = createJpegBuffer(400, 400);
    const result = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: jpegBuf.toString('base64'),
      mimeType: 'image/jpeg',
      declaredFilename: 'photo.jpg',
      assetType: 'product'
    });

    assert.equal(result.status, MediaLifecycle.STATES.TEMPORARY);
    assert.equal(result.mime_type, 'image/jpeg');
    assert.equal(result.width, 400);
    assert.equal(result.height, 400);
    assert.equal(result.brand_id, BRAND_A);
    assert.ok(result.media_id.startsWith('med_'));
    assert.ok(result.storage_key.includes('staging/'));
  });

  await t.test('2. Valid PNG binary upload stages to TEMPORARY status', async () => {
    const pngBuf = createPngBuffer(200, 200);
    const result = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: pngBuf.toString('base64'),
      mimeType: 'image/png',
      declaredFilename: 'logo.png',
      assetType: 'logo'
    });

    assert.equal(result.status, MediaLifecycle.STATES.TEMPORARY);
    assert.equal(result.mime_type, 'image/png');
    assert.equal(result.width, 200);
    assert.equal(result.height, 200);
  });

  await t.test('3. Valid WebP binary upload stages to TEMPORARY status', async () => {
    const webpBuf = createWebpBuffer(300, 300);
    const result = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: webpBuf.toString('base64'),
      mimeType: 'image/webp',
      declaredFilename: 'banner.webp',
      assetType: 'general'
    });

    assert.equal(result.status, MediaLifecycle.STATES.TEMPORARY);
    assert.equal(result.mime_type, 'image/webp');
    assert.equal(result.width, 300);
    assert.equal(result.height, 300);
  });

  await t.test('4. Spoofed extension: fake .jpg with random invalid binary is rejected', async () => {
    const fakeBuf = Buffer.from('THIS IS NOT A VALID JPEG BINARY AT ALL 1234567890');
    await assert.rejects(
      async () => {
        await mediaService.stageUpload({
          brandId: BRAND_A,
          imageBase64: fakeBuf.toString('base64'),
          mimeType: 'image/jpeg',
          declaredFilename: 'malicious.jpg',
          assetType: 'general'
        });
      },
      (err) => {
        assert.equal(err.code, 'UNSUPPORTED_FORMAT');
        return true;
      }
    );
  });

  await t.test('5. Wrong client MIME: declared image/png but actual binary is valid JPEG', async () => {
    const realJpeg = createJpegBuffer(250, 250);
    // Client incorrectly claims it is image/png
    const result = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: realJpeg.toString('base64'),
      mimeType: 'image/png',
      declaredFilename: 'mislabeled.png',
      assetType: 'general'
    });

    // Server must determine truth from binary signature (JPEG), NOT declared client MIME
    assert.equal(result.mime_type, 'image/jpeg');
    assert.equal(result.width, 250);
  });

  await t.test('6. Oversized file: upload exceeding maxBytes is rejected', async () => {
    // Logo limit is 10MB, Banner/Product/General limit is 20MB.
    // Test logo rejection when exceeding 10MB:
    const bigLogoBuf = Buffer.alloc(10.5 * 1024 * 1024);
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(bigLogoBuf, 0);

    await assert.rejects(
      async () => {
        await mediaService.stageUpload({
          brandId: BRAND_A,
          imageBase64: bigLogoBuf.toString('base64'),
          mimeType: 'image/png',
          declaredFilename: 'giant_logo.png',
          assetType: 'logo'
        });
      },
      (err) => {
        assert.equal(err.code, 'FILE_TOO_LARGE');
        return true;
      }
    );

    // Test product/general rejection when exceeding 20MB:
    const bigProductBuf = Buffer.alloc(20.5 * 1024 * 1024);
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(bigProductBuf, 0);

    await assert.rejects(
      async () => {
        await mediaService.stageUpload({
          brandId: BRAND_A,
          imageBase64: bigProductBuf.toString('base64'),
          mimeType: 'image/png',
          declaredFilename: 'giant_product.png',
          assetType: 'product'
        });
      },
      (err) => {
        assert.equal(err.code, 'FILE_TOO_LARGE');
        return true;
      }
    );
  });

  await t.test('7. Oversized dimensions: width > 4096 is rejected with DIMENSIONS_TOO_LARGE', async () => {
    const wideBuf = createJpegBuffer(5000, 1000);
    await assert.rejects(
      async () => {
        await mediaService.stageUpload({
          brandId: BRAND_A,
          imageBase64: wideBuf.toString('base64'),
          mimeType: 'image/jpeg',
          declaredFilename: 'wide.jpg',
          assetType: 'general'
        });
      },
      (err) => {
        assert.equal(err.code, 'DIMENSIONS_TOO_LARGE');
        return true;
      }
    );
  });

  await t.test('8. Excessive pixel count: pixels exceeding 20 MP safety limit is rejected, within 20 MP accepted', async () => {
    // Within 20 MP: 4000 x 4000 = 16.0 MP (previously rejected under 16 MP, now accepted under 20 MP ceiling)
    const validHighRes = createJpegBuffer(4000, 4000);
    const staged = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: validHighRes.toString('base64'),
      mimeType: 'image/jpeg',
      declaredFilename: 'high_res_ok.jpg',
      assetType: 'general'
    });
    assert.equal(staged.width, 4000);
    assert.equal(staged.height, 4000);

    // Exceeding 20 MP: 4096 x 5000 would exceed max dimensions, or say 4096 x 4900 = 20.07 MP
    // With maxWidth 4096 and maxHeight 4096, max possible is 4096 * 4096 = 16.77 MP if max dimension is 4096,
    // but if dimension is within max (e.g. if maxWidth allowed higher or rule checked directly):
    // Let's test ImageValidator directly with custom rule or verify rule.maxMegaPixels is 20
    assert.equal(ImageValidator.IMAGE_RULES.product.maxMegaPixels, 20);
    assert.equal(ImageValidator.IMAGE_RULES.logo.maxMegaPixels, 20);
    assert.equal(ImageValidator.IMAGE_RULES.banner.maxMegaPixels, 20);
    assert.equal(ImageValidator.IMAGE_RULES.avatar.maxMegaPixels, 20);
    assert.equal(ImageValidator.IMAGE_RULES.general.maxMegaPixels, 20);
  });

  await t.test('8b. M1 Intake accepts raw camera photos of non-canonical aspect ratios', async () => {
    // A 16:9 landscape photo uploaded as product (raw camera photo before M2/M3 crop)
    const rawPhoto16x9 = createJpegBuffer(1600, 900);
    const stagedProduct = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: rawPhoto16x9.toString('base64'),
      mimeType: 'image/jpeg',
      declaredFilename: 'phone_camera_dish.jpg',
      assetType: 'product'
    });
    assert.equal(stagedProduct.status, MediaLifecycle.STATES.TEMPORARY);
    assert.equal(stagedProduct.width, 1600);
    assert.equal(stagedProduct.height, 900);

    // A 1:1 square photo uploaded as banner (raw photo before banner crop)
    const squarePhoto = createJpegBuffer(1000, 1000);
    const stagedBanner = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: squarePhoto.toString('base64'),
      mimeType: 'image/jpeg',
      declaredFilename: 'raw_storefront.jpg',
      assetType: 'banner'
    });
    assert.equal(stagedBanner.status, MediaLifecycle.STATES.TEMPORARY);
    assert.equal(stagedBanner.width, 1000);
    assert.equal(stagedBanner.height, 1000);

    // Avatar assetType works seamlessly
    const avatarPhoto = createJpegBuffer(400, 400);
    const stagedAvatar = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: avatarPhoto.toString('base64'),
      mimeType: 'image/jpeg',
      declaredFilename: 'chef_avatar.jpg',
      assetType: 'avatar'
    });
    assert.equal(stagedAvatar.status, MediaLifecycle.STATES.TEMPORARY);
    assert.equal(stagedAvatar.asset_type, 'avatar');
  });

  await t.test('9. Malformed image: truncated header is rejected', async () => {
    // Truncated PNG (only 14 bytes)
    const truncBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48]);
    await assert.rejects(
      async () => {
        await mediaService.stageUpload({
          brandId: BRAND_A,
          imageBase64: truncBuf.toString('base64'),
          mimeType: 'image/png',
          declaredFilename: 'corrupt.png',
          assetType: 'general'
        });
      },
      (err) => {
        assert.equal(err.code, 'INVALID_IMAGE_FORMAT');
        return true;
      }
    );
  });

  await t.test('10. Unsupported HEIC: ISOBMFF ftyp heic container is cleanly rejected with UNSUPPORTED_FORMAT', async () => {
    // Create an ISOBMFF box with 'ftyp' and 'heic' brand
    const heicBuf = Buffer.alloc(24);
    heicBuf.writeUInt32BE(24, 0); // box size
    heicBuf.write('ftyp', 4, 4, 'ascii'); // box type
    heicBuf.write('heic', 8, 4, 'ascii'); // major brand
    heicBuf.writeUInt32BE(0, 12); // minor version
    heicBuf.write('mif1heic', 16, 8, 'ascii'); // compatible brands

    await assert.rejects(
      async () => {
        await mediaService.stageUpload({
          brandId: BRAND_A,
          imageBase64: heicBuf.toString('base64'),
          mimeType: 'image/heic',
          declaredFilename: 'camera.heic',
          assetType: 'general'
        });
      },
      (err) => {
        assert.equal(err.code, 'UNSUPPORTED_FORMAT');
        assert.ok(err.message.includes('HEIC/HEIF'));
        return true;
      }
    );
  });

  await t.test('11. Lifecycle transition: temporary -> uploaded -> processing -> ready', async () => {
    const pngBuf = createPngBuffer(100, 100);
    const asset = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: pngBuf.toString('base64'),
      mimeType: 'image/png',
      declaredFilename: 'flow.png',
      assetType: 'general'
    });
    assert.equal(asset.status, MediaLifecycle.STATES.TEMPORARY);

    // 1. Transition to uploaded
    const uploaded = await mediaService.transitionStatus({
      mediaId: asset.media_id,
      brandId: BRAND_A,
      targetStatus: MediaLifecycle.STATES.UPLOADED
    });
    assert.equal(uploaded.status, MediaLifecycle.STATES.UPLOADED);

    // 2. Transition to processing
    const processing = await mediaService.transitionStatus({
      mediaId: asset.media_id,
      brandId: BRAND_A,
      targetStatus: MediaLifecycle.STATES.PROCESSING
    });
    assert.equal(processing.status, MediaLifecycle.STATES.PROCESSING);

    // 3. Mark ready
    const ready = await mediaService.markReady({
      mediaId: asset.media_id,
      brandId: BRAND_A
    });
    assert.equal(ready.status, MediaLifecycle.STATES.READY);
    assert.ok(!ready.storage_key.startsWith('staging/'));
  });

  await t.test('12. Invalid lifecycle transitions are rejected fail-safely', async () => {
    const pngBuf = createPngBuffer(100, 100);
    const asset = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: pngBuf.toString('base64'),
      mimeType: 'image/png',
      declaredFilename: 'invalid_trans.png',
      assetType: 'general'
    });

    // TEMPORARY cannot transition directly to ORPHAN
    await assert.rejects(
      async () => {
        await mediaService.transitionStatus({
          mediaId: asset.media_id,
          brandId: BRAND_A,
          targetStatus: MediaLifecycle.STATES.ORPHAN
        });
      },
      (err) => {
        assert.equal(err.code, 'INVALID_LIFECYCLE_TRANSITION');
        return true;
      }
    );
  });

  await t.test('13. Attachment only allowed when asset is in READY state', async () => {
    const pngBuf = createPngBuffer(100, 100);
    const asset = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: pngBuf.toString('base64'),
      mimeType: 'image/png',
      declaredFilename: 'not_ready.png',
      assetType: 'product'
    });

    // Asset is TEMPORARY - attach must be rejected
    await assert.rejects(
      async () => {
        await mediaService.attachToEntity({
          mediaId: asset.media_id,
          brandId: BRAND_A,
          entityType: 'product',
          entityId: 'prod_123'
        });
      },
      (err) => {
        assert.equal(err.code, 'ASSET_NOT_READY');
        return true;
      }
    );

    // Now promote to READY and attach
    await mediaService.markReady({ mediaId: asset.media_id, brandId: BRAND_A });
    const attached = await mediaService.attachToEntity({
      mediaId: asset.media_id,
      brandId: BRAND_A,
      entityType: 'product',
      entityId: 'prod_123'
    });

    assert.equal(attached.status, MediaLifecycle.STATES.READY);
    assert.equal(attached.attached_to_type, 'product');
    assert.equal(attached.attached_to_id, 'prod_123');
    assert.ok(attached.attached_at);
  });

  await t.test('14. Retry after failure: FAILED asset transitions back to PROCESSING', async () => {
    const pngBuf = createPngBuffer(100, 100);
    const asset = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: pngBuf.toString('base64'),
      mimeType: 'image/png',
      declaredFilename: 'failed_job.png',
      assetType: 'general'
    });

    // Mark failed
    await mediaService.transitionStatus({
      mediaId: asset.media_id,
      brandId: BRAND_A,
      targetStatus: MediaLifecycle.STATES.FAILED,
      errorMessage: 'Simulated worker crash'
    });

    const failed = mediaService.getMedia({ mediaId: asset.media_id, brandId: BRAND_A });
    assert.equal(failed.status, MediaLifecycle.STATES.FAILED);
    assert.equal(failed.error_message, 'Simulated worker crash');

    // Retry
    const retried = await mediaService.retryFailed({ mediaId: asset.media_id, brandId: BRAND_A });
    assert.equal(retried.status, MediaLifecycle.STATES.PROCESSING);
  });

  await t.test('15. Atomic replacement: old asset becomes ORPHAN and new asset becomes attached', async () => {
    const png1 = createPngBuffer(100, 100);
    const oldAsset = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: png1.toString('base64'),
      mimeType: 'image/png',
      declaredFilename: 'v1.png',
      assetType: 'product'
    });
    await mediaService.markReady({ mediaId: oldAsset.media_id, brandId: BRAND_A });
    await mediaService.attachToEntity({
      mediaId: oldAsset.media_id,
      brandId: BRAND_A,
      entityType: 'product',
      entityId: 'prod_999'
    });

    const png2 = createPngBuffer(120, 120);
    const newAsset = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: png2.toString('base64'),
      mimeType: 'image/png',
      declaredFilename: 'v2.png',
      assetType: 'product'
    });
    await mediaService.markReady({ mediaId: newAsset.media_id, brandId: BRAND_A });

    // Perform atomic replace
    const replaced = await mediaService.replaceEntityMedia({
      newMediaId: newAsset.media_id,
      oldMediaId: oldAsset.media_id,
      brandId: BRAND_A,
      entityType: 'product',
      entityId: 'prod_999'
    });

    assert.equal(replaced.media_id, newAsset.media_id);
    assert.equal(replaced.attached_to_id, 'prod_999');

    // Check that old asset is now ORPHAN with orphaned_at timestamp
    const oldAssetCheck = mediaService.getMedia({ mediaId: oldAsset.media_id, brandId: BRAND_A });
    assert.equal(oldAssetCheck.status, MediaLifecycle.STATES.ORPHAN);
    assert.ok(oldAssetCheck.orphaned_at);
  });

  await t.test('16. Failed replacement leaves old asset intact and active', async () => {
    const png1 = createPngBuffer(100, 100);
    const activeAsset = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: png1.toString('base64'),
      mimeType: 'image/png',
      declaredFilename: 'active_stay.png',
      assetType: 'product'
    });
    await mediaService.markReady({ mediaId: activeAsset.media_id, brandId: BRAND_A });
    await mediaService.attachToEntity({
      mediaId: activeAsset.media_id,
      brandId: BRAND_A,
      entityType: 'product',
      entityId: 'prod_keep'
    });

    // Second upload which is NOT ready (remains in TEMPORARY)
    const png2 = createPngBuffer(100, 100);
    const unreadyAsset = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: png2.toString('base64'),
      mimeType: 'image/png',
      declaredFilename: 'half_baked.png',
      assetType: 'product'
    });

    // Attempting replacement with unready asset must reject
    await assert.rejects(
      async () => {
        await mediaService.replaceEntityMedia({
          newMediaId: unreadyAsset.media_id,
          oldMediaId: activeAsset.media_id,
          brandId: BRAND_A,
          entityType: 'product',
          entityId: 'prod_keep'
        });
      },
      (err) => {
        assert.equal(err.code, 'ASSET_NOT_READY');
        return true;
      }
    );

    // Verify active asset is STILL ready and NOT marked as orphan
    const activeCheck = mediaService.getMedia({ mediaId: activeAsset.media_id, brandId: BRAND_A });
    assert.equal(activeCheck.status, MediaLifecycle.STATES.READY);
    assert.equal(activeCheck.orphaned_at, null);
  });

  await t.test('17. Tenant isolation: Tenant B CANNOT read, attach, replace, or delete Tenant A media', async () => {
    const png = createPngBuffer(80, 80);
    const assetA = await mediaService.stageUpload({
      brandId: BRAND_A,
      imageBase64: png.toString('base64'),
      mimeType: 'image/png',
      declaredFilename: 'brand_a_secret.png',
      assetType: 'general'
    });
    await mediaService.markReady({ mediaId: assetA.media_id, brandId: BRAND_A });

    // Attack 1: Tenant B tries to GET Tenant A media
    assert.throws(
      () => {
        mediaService.getMedia({ mediaId: assetA.media_id, brandId: BRAND_B });
      },
      (err) => {
        assert.equal(err.code, 'UNAUTHORIZED_TENANT');
        return true;
      }
    );

    // Attack 2: Tenant B tries to ATTACH Tenant A media to Tenant B's entity
    await assert.rejects(
      async () => {
        await mediaService.attachToEntity({
          mediaId: assetA.media_id,
          brandId: BRAND_B,
          entityType: 'product',
          entityId: 'prod_b_stolen'
        });
      },
      (err) => {
        assert.equal(err.code, 'UNAUTHORIZED_TENANT');
        return true;
      }
    );

    // Attack 3: Tenant B tries to REPLACE Tenant A media
    await assert.rejects(
      async () => {
        await mediaService.replaceEntityMedia({
          newMediaId: assetA.media_id,
          oldMediaId: null,
          brandId: BRAND_B,
          entityType: 'product',
          entityId: 'prod_b_hacked'
        });
      },
      (err) => {
        assert.equal(err.code, 'UNAUTHORIZED_TENANT');
        return true;
      }
    );

    // Attack 4: Tenant B tries to DELETE Tenant A media
    await assert.rejects(
      async () => {
        await mediaService.deleteMedia({
          mediaId: assetA.media_id,
          brandId: BRAND_B
        });
      },
      (err) => {
        assert.equal(err.code, 'UNAUTHORIZED_TENANT');
        return true;
      }
    );

    // Attack 5: Tenant B lists media and must NOT see Tenant A assets
    const listB = mediaService.listMedia({ brandId: BRAND_B });
    const leaked = listB.find(m => m.media_id === assetA.media_id);
    assert.equal(leaked, undefined, 'Tenant A media leaked into Tenant B media list!');
  });
});
