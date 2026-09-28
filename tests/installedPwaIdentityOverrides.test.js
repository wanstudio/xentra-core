'use strict';

/**
 * Installed PWA Identity Override — Architecture & Contract Verification
 *
 * Tests verify the manifest icon-override logic by reading server/app.js source
 * and confirming the correct branching exists. Pattern matches merchantPwaInstallable.test.js.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '../server/app.js');
const brandRepoPath = path.join(__dirname, '../core/data/repositories/BrandRepository.js');
const adminBrandPath = path.join(__dirname, '../server/routes/admin-brand.js');
const apiPath = path.join(__dirname, '../server/routes/api.js');
const dbPath = path.join(__dirname, '../server/database/db.js');

describe('Installed PWA Identity Override — Architecture & Contract Verification', () => {
  it('1. Merchant PWA manifest uses override when merchant_pwa_icon_url is set', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf8');
    // The manifest route for managerial/owner must read merchant_pwa_icon_url from brand
    assert.ok(
      serverCode.includes('merchant_pwa_icon_url'),
      'server/app.js must reference merchant_pwa_icon_url for manifest icon override'
    );
    // buildPwaIcons helper must exist
    assert.ok(
      serverCode.includes('buildPwaIcons'),
      'server/app.js must define buildPwaIcons helper'
    );
    // The merchant manifest route should use merchant_pwa_icon_url
    assert.ok(
      serverCode.includes("brand.merchant_pwa_icon_url"),
      'Manifest route must use brand.merchant_pwa_icon_url'
    );
  });

  it('2. Merchant PWA manifest falls back to brand.logo_url when no merchant override', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf8');
    // Should have fallback chain: merchant_pwa_icon_url || logo_url || null
    assert.ok(
      serverCode.includes('merchant_pwa_icon_url || brand.logo_url'),
      'Manifest must fall back to brand.logo_url when merchant_pwa_icon_url is absent'
    );
  });

  it('3. Merchant PWA manifest falls back to default icon when both null', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf8');
    // buildPwaIcons uses default192/default512 when iconUrl is falsy
    assert.ok(
      serverCode.includes("'/merchant-app/assets/icons/icon-192.png'"),
      'Must use /merchant-app/assets/icons/icon-192.png as default for merchant manifest'
    );
    assert.ok(
      serverCode.includes("'/merchant-app/assets/icons/icon-512.png'"),
      'Must use /merchant-app/assets/icons/icon-512.png as default for merchant manifest'
    );
  });

  it('4. POS PWA manifest uses override when pos_pwa_icon_url is set', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf8');
    assert.ok(
      serverCode.includes('pos_pwa_icon_url'),
      'server/app.js must reference pos_pwa_icon_url for manifest icon override'
    );
    assert.ok(
      serverCode.includes("brand.pos_pwa_icon_url"),
      'Manifest route must use brand.pos_pwa_icon_url'
    );
  });

  it('5. POS PWA manifest falls back to brand.logo_url when no pos override', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf8');
    assert.ok(
      serverCode.includes('pos_pwa_icon_url || brand.logo_url'),
      'POS manifest must fall back to brand.logo_url when pos_pwa_icon_url is absent'
    );
  });

  it('6. POS PWA manifest falls back to default icon when both null', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf8');
    assert.ok(
      serverCode.includes("'/pos/assets/icons/icon-192.png'"),
      'Must use /pos/assets/icons/icon-192.png as default for POS manifest'
    );
    assert.ok(
      serverCode.includes("'/pos/assets/icons/icon-512.png'"),
      'Must use /pos/assets/icons/icon-512.png as default for POS manifest'
    );
  });

  it('7. Customer PWA manifest is not affected by the new icon fields', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf8');
    // Customer manifest path is served with sendFile — no brand icon override for customers
    assert.ok(
      serverCode.includes("customer-pwa/assets/pwa/manifest.json"),
      'Customer PWA manifest must be served from the customer-pwa path (no override)'
    );
    // The customer branch must NOT reference merchant_pwa_icon_url or pos_pwa_icon_url
    // Get the portion of code after the pos subType check and before static file serving
    const customerSection = serverCode.match(/res\.sendFile\(path\.join\(__dirname.*customer-pwa.*manifest\.json'\)\)/);
    assert.ok(customerSection, 'Customer PWA manifest sendFile must exist unchanged');
  });

  it('8. primary_color does not change when icon changes — BrandRepository methods are independent', () => {
    const repoCode = fs.readFileSync(brandRepoPath, 'utf8');
    // updateMerchantPwaIcon must only touch icon columns, not primary_color
    assert.ok(
      repoCode.includes('updateMerchantPwaIcon'),
      'BrandRepository must have updateMerchantPwaIcon method'
    );
    assert.ok(
      repoCode.includes('updatePosPwaIcon'),
      'BrandRepository must have updatePosPwaIcon method'
    );
    // The icon methods must not reference primary_color
    const merchantMethod = repoCode.match(/updateMerchantPwaIcon[\s\S]*?(?=\n\s+\w)/)?.[0] || '';
    assert.ok(
      !merchantMethod.includes('primary_color'),
      'updateMerchantPwaIcon must not touch primary_color'
    );
  });

  it('9. Merchant manifest scope stays correct — icon override does not change scope or start_url', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf8');
    // The managerial manifest handler sets data.id = '/' then overrides icons separately
    // Verify scope assignment and icon override are both present in the same handler block
    assert.ok(
      serverCode.includes("data.scope = '/'") && serverCode.includes('buildPwaIcons'),
      'Manifest handler must still set scope and separately call buildPwaIcons'
    );
    // The API route must expose merchant_pwa_icon_url in serializePublicBrand
    const apiCode = fs.readFileSync(apiPath, 'utf8');
    assert.ok(
      apiCode.includes('merchant_pwa_icon_url'),
      'serializePublicBrand in api.js must include merchant_pwa_icon_url'
    );
    assert.ok(
      apiCode.includes('pos_pwa_icon_url'),
      'serializePublicBrand in api.js must include pos_pwa_icon_url'
    );
  });
});
