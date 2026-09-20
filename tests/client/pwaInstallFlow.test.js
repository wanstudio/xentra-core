/**
 * PWA Install Flow — regression + corrective tests
 *
 * Covers the two bugs fixed in this corrective:
 *  1. CSS overflow: checkout.css must not override canonical home.css
 *     .x-pwa-banner / .x-pwa-banner-left layout (fixed-positioning
 *     contract, no horizontal overflow, button inside viewport).
 *  2. Install flow: click must call promptInstall() directly. No
 *     delayed waitForPrompt() between click and native prompt().
 *
 * SECURITY / STATE INVARIANTS:
 *  - accepted != installed (verified only via appinstalled/standalone)
 *  - raw Google credential never passed in URL / stored as session token
 *  - xnt_cust_ prefix for customer sessions
 *  - Home and Checkout share the same PwaRuntime mechanism
 *
 * Environment: NODE_ENV=test (in-memory DB, isolated).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HOME_CSS = fs.readFileSync(
  path.resolve(__dirname, '../../apps/customer-pwa/assets/css/home.css'), 'utf8'
);
const CHECKOUT_CSS = fs.readFileSync(
  path.resolve(__dirname, '../../apps/customer-pwa/assets/css/checkout.css'), 'utf8'
);
const HOME_JS = fs.readFileSync(
  path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/home.js'), 'utf8'
);
const CHECKOUT_JS = fs.readFileSync(
  path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/checkout.js'), 'utf8'
);
const PWA_RUNTIME_JS = fs.readFileSync(
  path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/pwa-runtime.js'), 'utf8'
);

// ── A. CSS overflow / layout contract ──────────────────────────────

test('AC-H1: home.css .x-pwa-banner is fixed-positioned (canonical layout)', () => {
  assert.match(HOME_CSS, /\.x-pwa-banner\s*\{[^}]*position\s*:\s*fixed/s,
    'home.css must fix .x-pwa-banner');
});

test('AC-H2: home.css .x-pwa-banner-card uses box-sizing border-box', () => {
  assert.match(HOME_CSS, /\.x-pwa-banner-card\s*\{[^}]*box-sizing\s*:\s*border-box/s,
    'banner card must use border-box');
});

test('AC-H3: home.css banner text allows shrinking (min-width:0)', () => {
  assert.match(HOME_CSS, /\.x-pwa-banner-text\s*\{[^}]*min-width\s*:\s*0/s,
    'banner text must allow flex shrink');
});

test('AC-H4: home.css right column flex-shrink:0 so button stays visible', () => {
  assert.match(HOME_CSS, /\.x-pwa-banner-right\s*\{[^}]*flex-shrink\s*:\s*0/s,
    'banner right must not shrink');
});

test('AC-H5: home.css install button has no hardcoded width exceeding viewport', () => {
  const btnRule = HOME_CSS.match(/\.x-pwa-btn-install\s*\{([^}]*)\}/s);
  assert.ok(btnRule, 'install button rule must exist');
  assert.ok(!/width\s*:\s*\d+px/.test(btnRule[1]),
    'button must not have fixed width that can exceed viewport');
});

test('AC-H6: checkout.css does NOT redefine canonical .x-pwa-banner layout', () => {
  // checkout.css may comment about the banner, but must not re-declare
  // the layout properties that home.css owns (position, flex, overflow contract).
  const banned = [
    /\.x-pwa-banner\s*\{[^}]*display\s*:\s*flex/s,
    /\.x-pwa-banner\s*\{[^}]*padding\s*:/s,
    /\.x-pwa-banner\s*\{[^}]*background\s*:/s,
    /\.x-pwa-banner-left\s*\{[^}]*flex\s*:/s,
    /\.x-pwa-banner-left\s*\{[^}]*display\s*:\s*flex/s,
  ];
  for (const re of banned) {
    assert.ok(!re.test(CHECKOUT_CSS),
      `checkout.css must not override canonical banner property: ${re}`);
  }
});

test('AC-H7: checkout.css has comment acknowledging home.css as canonical', () => {
  assert.ok(/canonical|lives in home\.css|checkout\.css must not override/.test(CHECKOUT_CSS),
    'checkout.css should have a comment acknowledging canonical home.css banner');
});

// ── B. Install flow: no delayed prompt after click ─────────────────

test('AC-B1: home.js Install click does NOT call waitForPrompt', () => {
  // Find the installBtn click handler block
  const clickIdx = HOME_JS.indexOf("installBtn.addEventListener('click'");
  assert.ok(clickIdx !== -1, 'home.js must have installBtn click handler');
  const block = HOME_JS.substring(clickIdx, clickIdx + 1800);
  assert.ok(!/waitForPrompt/.test(block),
    'home.js click handler must not use waitForPrompt (delayed prompt after click)');
});

test('AC-B2: home.js click handler calls promptInstall() directly', () => {
  const clickIdx = HOME_JS.indexOf("installBtn.addEventListener('click'");
  const block = HOME_JS.substring(clickIdx, clickIdx + 900);
  assert.ok(/\bpromptInstall\(\)/.test(block),
    'home.js click must call promptInstall() directly');
});

test('AC-B3: home.js fallback when prompt not ready is immediate manual guide', () => {
  const clickIdx = HOME_JS.indexOf("installBtn.addEventListener('click'");
  const block = HOME_JS.substring(clickIdx, clickIdx + 1400);
  assert.ok(/showPwaGuideSheet|alert/.test(block),
    'home.js must fall back to manual guide immediately when prompt unavailable');
  assert.ok(!/setTimeout|setInterval|waitForPrompt/.test(block),
    'home.js must not delay fallback');
});

test('AC-B4: checkout.js Install click does NOT call waitForPrompt', () => {
  const clickIdx = CHECKOUT_JS.indexOf("installBtn.addEventListener('click'");
  // checkout uses delegated click; find handleInstallClick instead
  const handlerIdx = CHECKOUT_JS.indexOf('function handleInstallClick');
  assert.ok(handlerIdx !== -1, 'checkout.js must have handleInstallClick');
  const block = CHECKOUT_JS.substring(handlerIdx, handlerIdx + 1400);
  assert.ok(!/waitForPrompt/.test(block),
    'checkout.js click handler must not use waitForPrompt');
});

test('AC-B5: checkout.js click calls promptInstall() directly', () => {
  const handlerIdx = CHECKOUT_JS.indexOf('function handleInstallClick');
  const block = CHECKOUT_JS.substring(handlerIdx, handlerIdx + 900);
  assert.ok(/\bpromptInstall\(\)/.test(block),
    'checkout.js click must call promptInstall() directly');
});

test('AC-B6: checkout.js fallback is immediate manual guide, no delay', () => {
  const handlerIdx = CHECKOUT_JS.indexOf('function handleInstallClick');
  const block = CHECKOUT_JS.substring(handlerIdx, handlerIdx + 1400);
  assert.ok(/showPwaGuideSheet/.test(block),
    'checkout.js must fall back to showPwaGuideSheet immediately');
  assert.ok(!/setTimeout|setInterval|waitForPrompt/.test(block),
    'checkout.js must not delay fallback');
});

// ── C. State machine / security invariants ─────────────────────────

test('AC-C1: PwaRuntime exposes required API', () => {
  assert.ok(/getDeferredInstallPrompt/.test(PWA_RUNTIME_JS), 'must expose getDeferredInstallPrompt');
  assert.ok(/isNativePromptReady/.test(PWA_RUNTIME_JS), 'must expose isNativePromptReady');
  assert.ok(/promptInstall/.test(PWA_RUNTIME_JS), 'must expose promptInstall');
  assert.ok(/isStandalone/.test(PWA_RUNTIME_JS), 'must expose isStandalone');
  assert.ok(/getPwaRuntimeContext/.test(PWA_RUNTIME_JS), 'must expose getPwaRuntimeContext');
});

test('AC-C2: accepted != installed — acceptedPrompt is transient only', () => {
  assert.ok(/acceptedPrompt/.test(PWA_RUNTIME_JS), 'transient accepted state must exist');
  assert.ok(/recordVerifiedInstall/.test(PWA_RUNTIME_JS), 'verified marker writer must exist');
  // recordVerifiedInstall must be the ONLY writer of the permanent marker
  const writerCount = (PWA_RUNTIME_JS.match(/localStorage\.setItem\(VERIFIED_MARKER_KEY/g) || []).length;
  assert.strictEqual(writerCount, 1, 'only recordVerifiedInstall writes the verified marker');
});

test('AC-C3: verified install requires appinstalled OR standalone', () => {
  assert.ok(/appinstalled/.test(PWA_RUNTIME_JS), 'appinstalled event is authoritative');
  assert.ok(/display-mode:\s*standalone/.test(PWA_RUNTIME_JS), 'standalone detection required');
});

test('AC-C4: promptInstall returns { prompted, outcome, accepted }', () => {
  assert.ok(/\{[^}]*prompted[^}]*outcome[^}]*accepted[^}]*\}/.test(PWA_RUNTIME_JS) ||
    /return\s*\{[^}]*prompted\s*:/s.test(PWA_RUNTIME_JS),
    'promptInstall must return prompted/outcome/accepted shape');
});

test('AC-C5: waitForPrompt exists but is NOT called from install click handlers', () => {
  // Utility may exist but must not be used to delay prompt after click
  assert.ok(/waitForPrompt/.test(PWA_RUNTIME_JS), 'waitForPrompt utility must exist in runtime');
  // Home/checkout click blocks already verified above (AC-B1/B4)
});

// ── D. Session / identity safety ────────────────────────────────────

test('AC-D1: customer session uses xnt_cust_ prefix (not Google credential)', () => {
  assert.ok(/xnt_cust_/.test(CHECKOUT_JS) || /xnt_cust_/.test(HOME_JS),
    'customer session must use xnt_cust_ prefix');
});

test('AC-D2: checkout.js exchanges Google credential server-side only', () => {
  // Raw credential goes to POST /customer/auth/google or broker, never stored in Store
  const storesCredential = /Store\.setCustomerSession\([^)]*credential/.test(CHECKOUT_JS);
  assert.ok(!storesCredential, 'checkout must not store raw Google credential as session token');
});

test('AC-D3: Home and Checkout share same PwaRuntime mechanism', () => {
  assert.ok(/window\.Xentra\.PwaRuntime/.test(HOME_JS), 'home.js uses Xentra.PwaRuntime');
  assert.ok(/window\.Xentra\.PwaRuntime/.test(CHECKOUT_JS), 'checkout.js uses Xentra.PwaRuntime');
});

// ── E. DOM overflow lint (static) ───────────────────────────────────

test('AC-E1: checkout.css no longer forces .x-pwa-banner display:flex', () => {
  // The removed rule: .x-pwa-banner{ display:flex !important; ... }
  assert.ok(!/\.x-pwa-banner\s*\{[^}]*display\s*:\s*flex[^}]*\}/s.test(CHECKOUT_CSS),
    'checkout.css must not force banner display:flex');
});

test('AC-E2: checkout.css no longer forces .x-pwa-banner-left flex:1', () => {
  assert.ok(!/\.x-pwa-banner-left\s*\{[^}]*flex\s*:\s*1/.test(CHECKOUT_CSS),
    'checkout.css must not force banner-left flex:1');
});
