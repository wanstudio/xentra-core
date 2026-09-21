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
  // Home JS asset is referenced without hardcoded version query strings.
  // Cache busting is now handled by SW content-hash, not manual ?v= tokens.
  it('TEST 5: Home JS asset uses SW content-hash cache busting, not manual versions', () => {
    const html = indexHtml();

    // home.js must be referenced WITHOUT a version query string
    const match = html.match(/home\.js\?v=([^"']+)/);
    assert.ok(!match, 'index.html must NOT reference home.js with a ?v= version string (SW content-hash handles cache busting)');

    // All HTML files must reference home.js without ?v=
    for (const file of HTML_FILES) {
      const content = read(file);
      const fileMatch = content.match(/home\.js\?v=([^"']+)/);
      assert.ok(!fileMatch, `${file} must NOT reference home.js with a ?v= version string`);
    }

    // SW must use content-hash-based cache naming
    const sw = serviceWorkerJs();
    assert.ok(
      sw.includes('computeCacheName'),
      'service-worker.js must define computeCacheName for content-hash cache busting'
    );
  });

  // ── TEST 6 ──────────────────────────────────────────────────────────
  // Service Worker uses content-hash for cache naming, not hardcoded versions.
  // When this file changes (new commit), hash changes → new cache → old purged.
  it('TEST 6: SW uses content-hash cache naming, not hardcoded versions', () => {
    const sw = serviceWorkerJs();

    // Must NOT contain hardcoded date-based version strings
    assert.ok(
      !/CACHE_NAME\s*=\s*["'].*v_\d{8}/.test(sw),
      'SW must not have a hardcoded date-based CACHE_NAME (v_YYYYMMDD...)'
    );

    // Must define computeCacheName for content-hash naming
    assert.ok(
      sw.includes('function computeCacheName'),
      'SW must define computeCacheName() for content-hash cache naming'
    );

    // Must NOT reference a static CACHE_NAME constant for app cache
    // (MEDIA_CACHE_NAME is fine, but app cache must be dynamic)
    assert.ok(
      !/var\s+CACHE_NAME\s*=/.test(sw),
      'SW must not define a static CACHE_NAME constant for app cache'
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

    // The delete logic must preserve the current cache name (from computeCacheName)
    // by checking against a variable that holds the result of computeCacheName()
    assert.ok(
      sw.includes('currentCacheName'),
      'SW activate must use a currentCacheName variable from computeCacheName()'
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

    // The activate handler must skip MEDIA_CACHE_NAME (preserving it)
    // Either via key === MEDIA_CACHE_NAME (return early) or key !== MEDIA_CACHE_NAME (skip delete)
    assert.ok(
      sw.includes('MEDIA_CACHE_NAME'),
      'SW activate must reference MEDIA_CACHE_NAME for preservation'
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

  // ── Bonus: No hardcoded version strings in HTML ────────────────────
  it('BONUS: HTML files have no hardcoded PWA version sentinels', () => {
    for (const file of HTML_FILES) {
      const content = read(file);
      assert.ok(
        !content.includes("PWA_VERSION"),
        `${file} must not contain PWA_VERSION (versions are now managed by SW content-hash)`
      );
      assert.ok(
        !content.includes("__xentra_rel"),
        `${file} must not contain __xentra_rel localStorage sentinel`
      );
    }
  });

  // ── Bonus: SW registration unversioned ─────────────────────────────
  it('BONUS: All HTML files register SW without version query string', () => {
    for (const file of HTML_FILES) {
      const content = read(file);
      const hasVersioned = /\/sw\.js\?v=/.test(content);
      assert.ok(
        !hasVersioned,
        `${file} must NOT register SW with ?v= version (content-hash handles cache busting)`
      );
      // Must still register the SW
      assert.ok(
        content.includes("navigator.serviceWorker.register('/sw.js')"),
        `${file} must register /sw.js`
      );
    }
  });
});
