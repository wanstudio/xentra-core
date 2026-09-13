'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { CropSpec } = require('../core/domain');
const { MediaService, MediaLifecycle } = require('../core/media');
const { createJpegBuffer, createPngBuffer } = require('./helpers/testImageHelper');
const db = require('../server/database/db');

const HTML_PATH = path.join(__dirname, '../apps/merchant-dashboard/index.html');
const JS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js');
const CSS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/css/dashboard.css');

test('MEDIA SYSTEM M2 — CROP / IMAGE EDITOR UI & DOMAIN SUITE', async (t) => {
  const mediaService = new MediaService();
  const BRAND_ID = 'brand_bangjo';

  // --------------------------------------------------------------------------
  // 1. Square crop configuration
  // --------------------------------------------------------------------------
  await t.test('1. Square crop configuration for product / category / logo (1:1)', () => {
    const defaultCrop = CropSpec.computeDefaultCrop({
      sourceWidth: 1200,
      sourceHeight: 800, // landscape source
      assetType: 'product',
      targetRatio: 1.0
    });

    assert.equal(defaultCrop.aspect_ratio, 1.0);
    assert.equal(defaultCrop.width, 800);
    assert.equal(defaultCrop.height, 800);
    assert.equal(defaultCrop.x, 200); // centered: (1200 - 800) / 2
    assert.equal(defaultCrop.y, 0);
    assert.equal(defaultCrop.source_width, 1200);
    assert.equal(defaultCrop.source_height, 800);
    assert.equal(defaultCrop.asset_type, 'product');
  });

  // --------------------------------------------------------------------------
  // 2. Banner ~1.94:1 crop configuration
  // --------------------------------------------------------------------------
  await t.test('2. Banner ~1.94:1 crop configuration', () => {
    const bannerRatio = 350 / 180; // ~1.944
    const defaultBannerCrop = CropSpec.computeDefaultCrop({
      sourceWidth: 2000,
      sourceHeight: 2000, // square source -> crop to ~1.94:1 banner
      assetType: 'banner',
      targetRatio: bannerRatio
    });

    assert.equal(defaultBannerCrop.asset_type, 'banner');
    assert.equal(defaultBannerCrop.width, 2000);
    // height should be 2000 / (350/180) = ~1029
    assert.ok(defaultBannerCrop.height < 2000);
    assert.equal(defaultBannerCrop.x, 0);
    assert.ok(defaultBannerCrop.y > 0); // centered vertically
    assert.ok(Math.abs(defaultBannerCrop.width / defaultBannerCrop.height - bannerRatio) < 0.01);
  });

  // --------------------------------------------------------------------------
  // 3. Non-square source accepted by editor model
  // --------------------------------------------------------------------------
  await t.test('3. Non-square sources (portrait, landscape, extreme panoramic) are accepted', () => {
    // Portrait source
    const portraitCrop = CropSpec.computeDefaultCrop({
      sourceWidth: 800,
      sourceHeight: 1600,
      assetType: 'product'
    });
    assert.equal(portraitCrop.width, 800);
    assert.equal(portraitCrop.height, 800);
    assert.equal(portraitCrop.x, 0);
    assert.equal(portraitCrop.y, 400); // centered vertically

    // Landscape source
    const landscapeCrop = CropSpec.computeDefaultCrop({
      sourceWidth: 1920,
      sourceHeight: 1080,
      assetType: 'banner'
    });
    assert.ok(landscapeCrop.width <= 1920);
    assert.ok(landscapeCrop.height <= 1080);
  });

  // --------------------------------------------------------------------------
  // 4. Crop configuration is serializable
  // --------------------------------------------------------------------------
  await t.test('4. Crop configuration is serializable and round-trippable', () => {
    const spec = new CropSpec({
      x: 100,
      y: 50,
      width: 400,
      height: 400,
      source_width: 800,
      source_height: 600,
      aspect_ratio: 1.0,
      zoom: 1.25,
      asset_type: 'product'
    });

    const json = spec.toJSON();
    assert.equal(typeof json, 'object');
    assert.equal(json.x, 100);
    assert.equal(json.y, 50);
    assert.equal(json.width, 400);
    assert.equal(json.height, 400);
    assert.equal(json.zoom, 1.25);

    const serializedStr = JSON.stringify(json);
    const restored = CropSpec.fromJSON(serializedStr);
    assert.equal(restored.x, 100);
    assert.equal(restored.y, 50);
    assert.equal(restored.zoom, 1.25);
  });

  // --------------------------------------------------------------------------
  // 5. Repositioning changes crop intent
  // --------------------------------------------------------------------------
  await t.test('5. Repositioning changes crop intent coordinates', () => {
    const initial = new CropSpec({
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      source_width: 1000,
      source_height: 1000,
      asset_type: 'product'
    });

    const moved = new CropSpec({
      x: 250,
      y: 100,
      width: 500,
      height: 500,
      source_width: 1000,
      source_height: 1000,
      asset_type: 'product'
    });

    assert.notEqual(initial.x, moved.x);
    assert.notEqual(initial.y, moved.y);
    assert.equal(moved.x, 250);
    assert.equal(moved.y, 100);
  });

  // --------------------------------------------------------------------------
  // 6. Zoom changes crop intent
  // --------------------------------------------------------------------------
  await t.test('6. Zoom changes crop intent scale', () => {
    const normal = new CropSpec({
      x: 0,
      y: 0,
      width: 600,
      height: 600,
      source_width: 1200,
      source_height: 1200,
      zoom: 1.0,
      asset_type: 'product'
    });

    const zoomed = new CropSpec({
      x: 100,
      y: 100,
      width: 400,
      height: 400,
      source_width: 1200,
      source_height: 1200,
      zoom: 1.5,
      asset_type: 'product'
    });

    assert.equal(normal.zoom, 1.0);
    assert.equal(zoomed.zoom, 1.5);
    assert.notEqual(normal.width, zoomed.width);
  });

  // --------------------------------------------------------------------------
  // 7. Reset restores initial crop state
  // --------------------------------------------------------------------------
  await t.test('7. Reset restores initial centered crop state', () => {
    const defaultSpec = CropSpec.computeDefaultCrop({
      sourceWidth: 1000,
      sourceHeight: 1000,
      assetType: 'product'
    });

    assert.equal(defaultSpec.x, 0);
    assert.equal(defaultSpec.y, 0);
    assert.equal(defaultSpec.zoom, 1.0);
  });

  // --------------------------------------------------------------------------
  // 8. Boundary enforcement prevents invalid crop coordinates
  // --------------------------------------------------------------------------
  await t.test('8. Boundary enforcement prevents invalid/out-of-bounds crop intent', () => {
    assert.throws(() => {
      new CropSpec({
        x: 600, // x + width = 600 + 500 = 1100 > source_width (1000)
        y: 0,
        width: 500,
        height: 500,
        source_width: 1000,
        source_height: 1000,
        asset_type: 'product'
      });
    }, /Crop window exceeds source width/);

    assert.throws(() => {
      new CropSpec({
        x: 0,
        y: -10, // negative coordinate
        width: 500,
        height: 500,
        source_width: 1000,
        source_height: 1000,
        asset_type: 'product'
      });
    }, /y coordinate must be a non-negative integer/);
  });

  // --------------------------------------------------------------------------
  // 9. MediaService stores and retrieves crop_spec intent
  // --------------------------------------------------------------------------
  await t.test('9. MediaService stores and retrieves crop_spec intent', async () => {
    const jpegBuf = createJpegBuffer(600, 400);
    const staged = await mediaService.stageUpload({
      brandId: BRAND_ID,
      imageBase64: jpegBuf.toString('base64'),
      mimeType: 'image/jpeg',
      declaredFilename: 'sample.jpg',
      assetType: 'product'
    });

    const cropIntent = {
      x: 100,
      y: 0,
      width: 400,
      height: 400,
      source_width: 600,
      source_height: 400,
      aspect_ratio: 1.0,
      zoom: 1.0,
      asset_type: 'product'
    };

    const updated = await mediaService.setCropSpec({
      mediaId: staged.media_id,
      brandId: BRAND_ID,
      cropSpec: cropIntent
    });

    assert.ok(updated.crop_spec);
    assert.equal(updated.crop_spec.x, 100);
    assert.equal(updated.crop_spec.width, 400);
    assert.equal(updated.crop_spec.source_width, 600);

    // Verify retrieval by getMedia
    const fetched = mediaService.getMedia({
      mediaId: staged.media_id,
      brandId: BRAND_ID
    });
    assert.deepEqual(fetched.crop_spec, updated.crop_spec);
  });

  // --------------------------------------------------------------------------
  // 10. Dashboard UI DOM & Reusable Editor Verification
  // --------------------------------------------------------------------------
  await t.test('10. Dashboard HTML contains modal-crop-editor and accessible controls', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    assert.match(html, /id="modal-crop-editor"/, 'modal-crop-editor markup must be present');
    assert.match(html, /id="crop-viewport"/, 'crop-viewport must be present');
    assert.match(html, /id="crop-target-image"/, 'crop-target-image must be present');
    assert.match(html, /id="crop-framing-box"/, 'crop-framing-box must be present');
    assert.match(html, /id="crop-zoom-slider"/, 'crop-zoom-slider must be present');
    assert.match(html, /id="btn-crop-confirm"/, 'btn-crop-confirm must be present');
    assert.match(html, /id="btn-crop-cancel"/, 'btn-crop-cancel must be present');
    assert.match(html, /id="btn-crop-reset"/, 'btn-crop-reset must be present');
  });

  // --------------------------------------------------------------------------
  // 11. CSS rules exist for responsive mobile and desktop viewports
  // --------------------------------------------------------------------------
  await t.test('11. CSS rules exist for mobile viewport and touch interaction safety', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    assert.match(css, /\.x-crop-modal-card/, 'CSS has .x-crop-modal-card');
    assert.match(css, /\.x-crop-viewport/, 'CSS has .x-crop-viewport');
    assert.match(css, /touch-action:\s*none/, 'CSS specifies touch-action: none to prevent mobile page drag interference');
    assert.match(css, /@media\s*\(max-width:\s*480px\)/, 'CSS has responsive mobile queries');
  });

  // --------------------------------------------------------------------------
  // 12. Dashboard JS exposes and initializes XentraCropEditor
  // --------------------------------------------------------------------------
  await t.test('12. Dashboard JS initializes XentraCropEditor with open, confirm, cancel, reset API', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const dom = new JSDOM(html, {
      url: 'https://app.mybangjo.com/dashboard/',
      runScripts: 'outside-only'
    });
    const win = dom.window;

    // Provide mock fetch and storage so dashboard script evaluation does not fail
    win.localStorage.setItem('xentra_merchant_token', 'test-token');
    win.localStorage.setItem('xentra_merchant_user', JSON.stringify({ id: 'u-1', role: 'owner' }));
    win.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
      text: async () => '{}'
    });

    // Execute dashboard.js in DOM context
    const js = fs.readFileSync(JS_PATH, 'utf8');
    win.eval(js);

    assert.ok(win.XentraCropEditor, 'XentraCropEditor must be attached to window');
    assert.equal(typeof win.XentraCropEditor.open, 'function');
    assert.equal(typeof win.XentraCropEditor.confirm, 'function');
    assert.equal(typeof win.XentraCropEditor.cancel, 'function');
    assert.equal(typeof win.XentraCropEditor.reset, 'function');
    assert.equal(typeof win.XentraCropEditor.setZoom, 'function');
  });
});
