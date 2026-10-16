'use strict';

const test = require('node:test');
const assert = require('node:assert');
const db = require('../server/database/db');
const { BrandRepository } = require('../core/data/repositories');
const coreBrandRepo = new BrandRepository();

test('Brand PWA Launcher Identities (Owner, Merchant, POS Kasir, Belanja, Driver)', async (t) => {
  const brand = db.prepare('SELECT * FROM brands LIMIT 1').get();
  assert.ok(brand, 'At least one brand must exist');
  const brandId = brand.id;

  await t.test('updates and retrieves all 5 PWA names', () => {
    coreBrandRepo.updateBrandProfile(brandId, {
      owner_pwa_name: 'Bangjo Owner Hub',
      merchant_pwa_name: 'Bangjo Merchant Ops',
      pos_pwa_name: 'Bangjo Kasir POS',
      customer_pwa_name: 'Bangjo Food Order',
      driver_pwa_name: 'Bangjo Kilat Driver'
    });

    const updated = coreBrandRepo.findById(brandId);
    assert.strictEqual(updated.owner_pwa_name, 'Bangjo Owner Hub');
    assert.strictEqual(updated.merchant_pwa_name, 'Bangjo Merchant Ops');
    assert.strictEqual(updated.pos_pwa_name, 'Bangjo Kasir POS');
    assert.strictEqual(updated.customer_pwa_name, 'Bangjo Food Order');
    assert.strictEqual(updated.driver_pwa_name, 'Bangjo Kilat Driver');
  });

  await t.test('updates and removes Owner PWA icon', () => {
    coreBrandRepo.updateOwnerPwaIcon(brandId, { iconUrl: '/media/owner-icon.png', mediaId: null });
    let updated = coreBrandRepo.findById(brandId);
    assert.strictEqual(updated.owner_pwa_icon_url, '/media/owner-icon.png');

    coreBrandRepo.removeOwnerPwaIcon(brandId);
    updated = coreBrandRepo.findById(brandId);
    assert.strictEqual(updated.owner_pwa_icon_url, null);
  });

  await t.test('updates and removes Customer / Belanja PWA icon', () => {
    coreBrandRepo.updateCustomerPwaIcon(brandId, { iconUrl: '/media/belanja-icon.png', mediaId: null });
    let updated = coreBrandRepo.findById(brandId);
    assert.strictEqual(updated.customer_pwa_icon_url, '/media/belanja-icon.png');

    coreBrandRepo.removeCustomerPwaIcon(brandId);
    updated = coreBrandRepo.findById(brandId);
    assert.strictEqual(updated.customer_pwa_icon_url, null);
  });

  await t.test('updates and removes Driver PWA icon', () => {
    coreBrandRepo.updateDriverPwaIcon(brandId, { iconUrl: '/media/driver-icon.png', mediaId: null });
    let updated = coreBrandRepo.findById(brandId);
    assert.strictEqual(updated.driver_pwa_icon_url, '/media/driver-icon.png');

    coreBrandRepo.removeDriverPwaIcon(brandId);
    updated = coreBrandRepo.findById(brandId);
    assert.strictEqual(updated.driver_pwa_icon_url, null);
  });

  await t.test('restores original values', () => {
    coreBrandRepo.updateBrandProfile(brandId, {
      owner_pwa_name: brand.owner_pwa_name || null,
      merchant_pwa_name: brand.merchant_pwa_name || null,
      pos_pwa_name: brand.pos_pwa_name || null,
      customer_pwa_name: brand.customer_pwa_name || null,
      driver_pwa_name: brand.driver_pwa_name || null
    });
    if (brand.owner_pwa_icon_url) {
      coreBrandRepo.updateOwnerPwaIcon(brandId, { iconUrl: brand.owner_pwa_icon_url, mediaId: brand.owner_pwa_icon_media_id });
    }
    if (brand.customer_pwa_icon_url) {
      coreBrandRepo.updateCustomerPwaIcon(brandId, { iconUrl: brand.customer_pwa_icon_url, mediaId: brand.customer_pwa_icon_media_id });
    }
    if (brand.driver_pwa_icon_url) {
      coreBrandRepo.updateDriverPwaIcon(brandId, { iconUrl: brand.driver_pwa_icon_url, mediaId: brand.driver_pwa_icon_media_id });
    }
  });

  await t.test('form input preservation logic guards dirty and active inputs', () => {
    function shouldPreserveInputValue(inputEl, forceReset, activeEl) {
      if (!inputEl) return false;
      if (forceReset) return false;
      if (activeEl === inputEl) return true;
      if (inputEl.dataset && inputEl.dataset.dirty === 'true') return true;
      return false;
    }

    const cleanInput = { value: 'Original', dataset: {} };
    assert.strictEqual(shouldPreserveInputValue(cleanInput, false, null), false, 'clean input should be overwritable');

    const dirtyInput = { value: 'User Typed Text', dataset: { dirty: 'true' } };
    assert.strictEqual(shouldPreserveInputValue(dirtyInput, false, null), true, 'dirty input MUST be preserved during re-render');

    const focusedInput = { value: 'In-progress Typing', dataset: {} };
    assert.strictEqual(shouldPreserveInputValue(focusedInput, false, focusedInput), true, 'active/focused input MUST be preserved');

    assert.strictEqual(shouldPreserveInputValue(dirtyInput, true, null), false, 'forceReset must override preservation on explicit save/cancel');
  });
});

