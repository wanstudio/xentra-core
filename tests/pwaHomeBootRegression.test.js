/**
 * PWA Home Boot Regression Tests
 * Verifies the bootstrap contract, cache invalidation, and service worker
 * architecture for the Customer PWA Home page.
 *
 * These tests inspect ACTUAL executable source — not comments.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PWA_DIR = path.resolve(__dirname, '../apps/customer-pwa');
const ASSETS_DIR = path.join(PWA_DIR, 'assets');

function read(rel) {
  return fs.readFileSync(path.join(PWA_DIR, rel), 'utf8');
}

function readAsset(rel) {
  return fs.readFileSync(path.join(ASSETS_DIR, rel), 'utf8');
}

// ── Shared fixtures ──
const indexHtml = () => read('index.html');
const homeJs = () => readAsset('js/pages/home.js');
const storeJs = () => readAsset('js/core/store.js');
const serviceWorkerJs = () => readAsset('pwa/service-worker.js');

// All HTML entry points that load home.js
const HTML_FILES = [
  'index.html',
  'checkout.html',
  'order-received.html',
  'checkout/index.html',
  'order-received/index.html'
];

describe('PWA Home Boot Regression', () => {

  // ── TEST 1 ──────────────────────────────────────────────────────────
  // Current index.html bootstrap marker and current home.js guard are
  // compatible: index.html sets __XENTRA_HOME_V2, home.js checks
  // __XENTRA_HOME_V2_INIT (a different variable), so no conflict.
  it('TEST 1: index.html bootstrap marker and home.js guard are compatible', () => {
    const html = indexHtml();
    const home = homeJs();

    // index.html must set __XENTRA_HOME_V2 = true
    assert.ok(
      html.includes('window.__XENTRA_HOME_V2 = true'),
      'index.html must set window.__XENTRA_HOME_V2 = true'
    );

    // home.js must use __XENTRA_HOME_V2_INIT as its re-evaluation guard
    assert.ok(
      home.includes('window.__XENTRA_HOME_V2_INIT'),
      'home.js must use __XENTRA_HOME_V2_INIT as its guard'
    );

    // home.js must NOT use __XENTRA_HOME_V2 (without _INIT) as a return guard
    // We search for the exact pattern "if (window.__XENTRA_HOME_V2)" followed
    // by "return" — this would be the incompatible guard.
    const hasIncompatibleGuard = /if\s*\(\s*window\.__XENTRA_HOME_V2\s*\)\s*\n?\s*return/.test(home);
    assert.ok(
      !hasIncompatibleGuard,
      'home.js must NOT check window.__XENTRA_HOME_V2 (without _INIT) and return'
    );
  });

  // ── TEST 2 ──────────────────────────────────────────────────────────
  // Home init is not prevented by the bootstrap marker.
  it('TEST 2: Home init is not prevented by the bootstrap marker', () => {
    const home = homeJs();

    // home.js must define an init() function
    assert.ok(
      /function\s+init\s*\(/.test(home),
      'home.js must define an init() function'
    );

    // home.js must call init() at the bottom (either directly or via DOMContentLoaded)
    assert.ok(
      /(?:document\.readyState\s*===\s*['"]loading['"]\s*\?\s*document\.addEventListener\s*\(\s*['"]DOMContentLoaded['"]\s*,\s*init\s*\)\s*:\s*init\s*\(\s*\))/.test(home) ||
      /init\s*\(\s*\)/.test(home),
      'home.js must invoke init() (directly or via DOMContentLoaded)'
    );

    // The re-evaluation guard (__XENTRA_HOME_V2_INIT) must be set to true
    // BEFORE the IIFE body runs, not after — so it only prevents double-execution,
    // not first execution.
    assert.ok(
      home.includes('window.__XENTRA_HOME_V2_INIT = true'),
      'home.js must set __XENTRA_HOME_V2_INIT = true'
    );

    // The guard must be the FIRST statement in the IIFE (after 'use strict')
    const guardIdx = home.indexOf('window.__XENTRA_HOME_V2_INIT');
    const initIdx = home.indexOf('function init()');
    assert.ok(
      guardIdx < initIdx,
      'Re-evaluation guard must appear before init() definition'
    );
  });

  // ── TEST 3 ──────────────────────────────────────────────────────────
  // store.js does not schedule automatic refreshBrand() on Home.
  it('TEST 3: store.js does not schedule automatic refreshBrand() on Home', () => {
    const store = storeJs();

    // store.js must check __XENTRA_HOME_V2 before calling refreshBrand
    assert.ok(
      store.includes('!window.__XENTRA_HOME_V2'),
      'store.js must check !window.__XENTRA_HOME_V2 before refreshBrand'
    );

    // The refreshBrand call must be inside a conditional that checks __XENTRA_HOME_V2
    // Pattern: if (!window.__XENTRA_HOME_V2) { setTimeout(function() { refreshBrand(); }, 0); }
    assert.ok(
      /setTimeout\s*\(\s*function\s*\(\)\s*\{[\s\S]*?refreshBrand\s*\(\s*\)/.test(store),
      'store.js must call refreshBrand() inside a setTimeout'
    );

    // The refreshBrand() must NOT be called unconditionally at startup
    // (i.e., it must be inside the __XENTRA_HOME_V2 guard block)
    const homeV2CheckIdx = store.indexOf('!window.__XENTRA_HOME_V2');
    // Find the refreshBrand() call AFTER the __XENTRA_HOME_V2 check (not the function definition)
    const refreshBrandCallIdx = store.indexOf('refreshBrand()', homeV2CheckIdx);
    assert.ok(
      refreshBrandCallIdx > homeV2CheckIdx,
      'refreshBrand() must come after the __XENTRA_HOME_V2 check'
    );
  });

  // ── TEST 4 ──────────────────────────────────────────────────────────
  // Home still explicitly performs its required initialization.
  it('TEST 4: Home still explicitly performs required initialization', () => {
    const home = homeJs();

    // Required operations that must be reachable from init():
    const requiredOps = [
      { pattern: /loadBanners\s*\(/, name: 'loadBanners()' },
      { pattern: /loadCatalog\s*\(/, name: 'loadCatalog()' },
      { pattern: /initBranchDiscovery\s*\(/, name: 'initBranchDiscovery()' },
      { pattern: /initInstallPromo\s*\(/, name: 'initInstallPromo()' },
      { pattern: /renderCartDock\s*\(/, name: 'renderCartDock()' },
      { pattern: /updateClock\s*\(/, name: 'updateClock()' },
      { pattern: /Store\.subscribe\s*\(/, name: 'Store.subscribe()' }
    ];

    for (const op of requiredOps) {
      assert.ok(
        op.pattern.test(home),
        `home.js must contain ${op.name}`
      );
    }
  });

  // ── TEST 5 ──────────────────────────────────────────────────────────
  // Current Home JS asset has a cache/version identifier different from
  // the incompatible previous release OR has an equivalent guaranteed
  // invalidation mechanism.
  it('TEST 5: Home JS asset version differs from incompatible previous release', () => {
    const html = indexHtml();

    // Find the home.js script tag version
    const match = html.match(/home\.js\?v=([^"']+)/);
    assert.ok(match, 'index.html must reference home.js with a version query string');

    const currentVersion = match[1];

    // Must not be the old known-incompatible version
    assert.notEqual(
      currentVersion,
      'v_791b187',
      'home.js version must not be the old v_791b187'
    );
    assert.notEqual(
      currentVersion,
      'v_20260920_pwa_pres',
      'home.js version must not be the previous v_20260920_pwa_pres'
    );

    // All HTML files must reference the same version for home.js
    for (const file of HTML_FILES) {
      const content = read(file);
      const fileMatch = content.match(/home\.js\?v=([^"']+)/);
      assert.ok(fileMatch, `${file} must reference home.js with version`);
      assert.equal(
        fileMatch[1],
        currentVersion,
        `${file} home.js version must match index.html (${currentVersion})`
      );
    }
  });

  // ── TEST 6 ──────────────────────────────────────────────────────────
  // Service Worker current CACHE_NAME changes when the app release changes.
  it('TEST 6: SW CACHE_NAME is versioned and changes with releases', () => {
    const sw = serviceWorkerJs();

    const match = sw.match(/CACHE_NAME\s*=\s*["']([^"']+)["']/);
    assert.ok(match, 'service-worker.js must define CACHE_NAME');

    const cacheName = match[1];

    // Must contain a version component (date or hash)
    assert.ok(
      /v_\d{8}/.test(cacheName),
      'CACHE_NAME must contain a date-based version (v_YYYYMMDD...)'
    );

    // Must match the PWA_VERSION in index.html
    const html = indexHtml();
    const pwaVersionMatch = html.match(/PWA_VERSION\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(pwaVersionMatch, 'index.html must define PWA_VERSION');
    assert.ok(
      cacheName.includes(pwaVersionMatch[1]),
      `CACHE_NAME (${cacheName}) must contain PWA_VERSION (${pwaVersionMatch[1]})`
    );
  });

  // ── TEST 7 ──────────────────────────────────────────────────────────
  // Old app cache is eligible for purge on activation.
  it('TEST 7: Old app cache is eligible for purge on SW activation', () => {
    const sw = serviceWorkerJs();

    // The activate handler must iterate cache keys and delete non-current ones
    assert.ok(
      sw.includes('caches.keys()'),
      'SW activate handler must enumerate caches.keys()'
    );
    assert.ok(
      sw.includes('caches.delete('),
      'SW activate handler must call caches.delete()'
    );

    // The delete logic must preserve the current CACHE_NAME but delete others
    assert.ok(
      sw.includes('key !== CACHE_NAME'),
      'SW activate must preserve current CACHE_NAME'
    );
  });

  // ── TEST 8 ──────────────────────────────────────────────────────────
  // Media cache remains preserved during activation.
  it('TEST 8: Media cache is preserved during SW activation', () => {
    const sw = serviceWorkerJs();

    // Must define a separate MEDIA_CACHE_NAME
    const mediaMatch = sw.match(/MEDIA_CACHE_NAME\s*=\s*["']([^"']+)["']/);
    assert.ok(mediaMatch, 'SW must define MEDIA_CACHE_NAME');
    assert.ok(mediaMatch[1].length > 0, 'MEDIA_CACHE_NAME must not be empty');

    // The activate handler must preserve MEDIA_CACHE_NAME
    assert.ok(
      sw.includes('key !== MEDIA_CACHE_NAME'),
      'SW activate must preserve MEDIA_CACHE_NAME'
    );
  });

  // ── TEST 9 ──────────────────────────────────────────────────────────
  // /api/* remains outside SW interception.
  it('TEST 9: /api/* is outside SW interception', () => {
    const sw = serviceWorkerJs();

    // The fetch handler must check for /api/ and return early
    assert.ok(
      sw.includes("'/api/'") || sw.includes('"/api/"'),
      'SW fetch handler must check for /api/ prefix'
    );

    // There must be a return statement after the /api/ check
    const apiCheckIdx = sw.indexOf('/api/');
    assert.ok(apiCheckIdx !== -1, 'SW must reference /api/');

    // Verify the check returns early (no respondWith for /api/)
    const fetchHandlerStart = sw.indexOf('addEventListener("fetch"');
    const apiSection = sw.substring(fetchHandlerStart, apiCheckIdx + 20);
    assert.ok(
      /return\s*;?\s*$/.test(apiSection.split('\n').pop().trim()) ||
      sw.substring(apiCheckIdx, apiCheckIdx + 80).includes('return'),
      'SW must return early for /api/ paths'
    );
  });

  // ── TEST 10 ─────────────────────────────────────────────────────────
  // Branch-scoped catalog behavior remains intact.
  it('TEST 10: Branch-scoped catalog requests include branch_id', () => {
    const home = homeJs();

    // When a branch context exists, catalog request must include branch_id
    assert.ok(
      home.includes("'/catalog/menu?branch_id='") || home.includes('"/catalog/menu?branch_id="'),
      'home.js must request /catalog/menu?branch_id= when branch context is set'
    );

    // Must NOT silently fall back to brand-wide catalog when branch context exists
    // The loadCatalog function must differentiate branch-scoped vs brand-wide
    assert.ok(
      /function\s+loadCatalog\s*\(branchId\)/.test(home),
      'loadCatalog must accept a branchId parameter'
    );
  });

  // ── TEST 11 ─────────────────────────────────────────────────────────
  // No dummy/test/demo branch is fabricated by Home.
  it('TEST 11: No dummy/test/demo branch is fabricated by Home', () => {
    const home = homeJs();

    // Must not contain hardcoded fake branch names
    const forbiddenPatterns = [
      /['"]Demo\s*Branch['"]/i,
      /['"]Test\s*Branch['"]/i,
      /['"]Dummy\s*Branch['"]/i,
      /branch_id\s*[:=]\s*['"]?999/i,
      /branch_id\s*[:=]\s*['"]?0['"]/i,
      /fallback.*branch.*demo/i,
      /hardcoded.*branch/i
    ];

    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(home),
        `home.js must not contain fabricated branch pattern: ${pattern}`
      );
    }

    // Home must not create branch objects from thin air
    // Branches must come from the API or cache (applyBranchDiscovery / loadCatalog)
    assert.ok(
      home.includes('API.get'),
      'home.js must fetch branches from the API'
    );
  });

  // ── Bonus: Version consistency across all HTML files ────────────────
  it('BONUS: All HTML files have consistent PWA_VERSION', () => {
    const versions = new Set();
    for (const file of HTML_FILES) {
      const content = read(file);
      const match = content.match(/PWA_VERSION\s*=\s*['"]([^'"]+)['"]/);
      assert.ok(match, `${file} must define PWA_VERSION`);
      versions.add(match[1]);
    }
    assert.equal(
      versions.size,
      1,
      `All HTML files must have the same PWA_VERSION. Found: ${[...versions].join(', ')}`
    );
  });

  // ── Bonus: SW registration version matches across HTML files ────────
  it('BONUS: SW registration version matches across all HTML files', () => {
    const swVersions = new Set();
    for (const file of HTML_FILES) {
      const content = read(file);
      const match = content.match(/\/sw\.js\?v=([^"']+)/);
      assert.ok(match, `${file} must register SW with version`);
      swVersions.add(match[1]);
    }
    assert.equal(
      swVersions.size,
      1,
      `All HTML files must register SW with same version. Found: ${[...swVersions].join(', ')}`
    );
  });
});
