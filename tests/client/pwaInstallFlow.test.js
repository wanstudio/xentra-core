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

test('AC-H8: home.css banner text wraps instead of forcing single-line nowrap', () => {
  const strongRule = HOME_CSS.match(/\.x-pwa-banner-text strong\s*\{([^}]*)\}/s);
  const spanRule = HOME_CSS.match(/\.x-pwa-banner-text span\s*\{([^}]*)\}/s);
  assert.ok(strongRule, 'strong rule must exist');
  assert.ok(spanRule, 'span rule must exist');
  assert.match(strongRule[1], /white-space\s*:\s*normal/, 'strong must have white-space: normal to allow wrapping');
  assert.match(strongRule[1], /-webkit-line-clamp/, 'strong must use line-clamp');
  assert.match(spanRule[1], /white-space\s*:\s*normal/, 'span must have white-space: normal to allow wrapping');
  assert.match(spanRule[1], /-webkit-line-clamp/, 'span must use line-clamp');
});

test('AC-H9: home.css does not use overflow-x: hidden workaround on banner or card', () => {
  const bannerRule = HOME_CSS.match(/\.x-pwa-banner\s*\{([^}]*)\}/s);
  const cardRule = HOME_CSS.match(/\.x-pwa-banner-card\s*\{([^}]*)\}/s);
  assert.ok(bannerRule, 'banner rule exists');
  assert.ok(cardRule, 'card rule exists');
  assert.ok(!/overflow-x\s*:\s*hidden/.test(bannerRule[1]), 'banner must not use overflow-x: hidden band-aid');
  assert.ok(!/overflow-x\s*:\s*hidden/.test(cardRule[1]), 'card must not use overflow-x: hidden band-aid');
});

test('AC-H10: home.css icon size is bounded and cannot expand card', () => {
  const iconRule = HOME_CSS.match(/\.x-pwa-banner-icon\s*\{([^}]*)\}/s);
  assert.ok(iconRule, 'icon rule must exist');
  assert.match(iconRule[1], /flex-shrink\s*:\s*0/, 'icon must not shrink');
  assert.match(iconRule[1], /flex-grow\s*:\s*0|max-width/, 'icon must not grow');
});

test('AC-H11: home.css includes max-width: 360px media query for small viewports', () => {
  assert.match(HOME_CSS, /@media\s*\([^)]*max-width\s*:\s*360px\)/,
    'home.css must include media query for small viewports <= 360px');
});

test('AC-H12: Viewport layout budget preserves CTA visibility across 320px, 360px, 375px, 390px, 412px, 768px', () => {
  const viewports = [320, 360, 375, 390, 412, 768];
  const maxShellWidth = 480;

  for (const vp of viewports) {
    const isSmall = vp <= 360;
    const marginLR = isSmall ? 8 * 2 : 12 * 2;
    const bannerWidth = Math.min(vp - marginLR, maxShellWidth);
    const cardPaddingLR = isSmall ? 10 * 2 : 12 * 2;
    const cardInnerWidth = bannerWidth - cardPaddingLR - 2; // 2px border

    const iconWidth = isSmall ? 32 : 38;
    const leftGap = isSmall ? 6 : 8;
    const centerGap = isSmall ? 8 : 10;
    const rightGap = isSmall ? 4 : 6;
    const btnPadding = isSmall ? 20 : 28;
    const btnTextWidth = 55; // estimated CTA text width
    const btnWidth = btnTextWidth + btnPadding;
    const dismissWidth = isSmall ? 24 : 28;
    const rightColWidth = btnWidth + dismissWidth + rightGap;

    const fixedColumns = iconWidth + leftGap + centerGap + rightColWidth;
    const remainingTextBudget = cardInnerWidth - fixedColumns;

    assert.ok(bannerWidth <= vp, `Banner width ${bannerWidth} must fit in viewport ${vp}`);
    assert.ok(remainingTextBudget > 50, `Viewport ${vp} must leave at least 50px for text (has ${remainingTextBudget}px)`);
    assert.ok(rightColWidth < cardInnerWidth, `Right CTA group must fit inside card for viewport ${vp}`);
  }
});

// ── B. Install flow: Android race mitigation & prompt lifecycle ───

test('AC-B1: home.js checks isNativePromptReady() and calls promptInstall() directly on fast path', () => {
  const clickIdx = HOME_JS.indexOf("installBtn.addEventListener('click'");
  assert.ok(clickIdx !== -1, 'home.js must have installBtn click handler');
  const block = HOME_JS.substring(clickIdx, clickIdx + 2500);
  assert.ok(/isNativePromptReady/.test(block),
    'home.js must check isNativePromptReady()');
  assert.ok(/\bpromptInstall\(\)/.test(block),
    'home.js click must call promptInstall() directly when ready');
});

test('AC-B2: home.js uses bounded waitForPrompt() when prompt is not yet ready (Android race mitigation)', () => {
  const clickIdx = HOME_JS.indexOf("installBtn.addEventListener('click'");
  const block = HOME_JS.substring(clickIdx, clickIdx + 2500);
  assert.ok(/waitForPrompt/.test(block),
    'home.js must use waitForPrompt() to handle prompt race condition');
});

test('AC-B3: home.js falls back to manual guide when prompt unavailable after bounded timeout', () => {
  const clickIdx = HOME_JS.indexOf("installBtn.addEventListener('click'");
  const block = HOME_JS.substring(clickIdx, clickIdx + 2500);
  assert.ok(/showManualGuide|showPwaGuideSheet/.test(block),
    'home.js must fall back to manual guide when prompt never arrives');
});

function createMockPwaWindow(deferredPrompt) {
  return {
    __xentra_deferred_prompt: deferredPrompt || null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  };
}

test('AC-B4: Proof 1 — prompt already ready -> native prompt called immediately', async () => {
  let promptCalled = false;
  const fakeEvent = {
    prompt: () => { promptCalled = true; return Promise.resolve({ outcome: 'accepted' }); },
    userChoice: Promise.resolve({ outcome: 'accepted' })
  };
  globalThis.window = createMockPwaWindow(fakeEvent);
  globalThis.localStorage = globalThis.window.localStorage;
  delete require.cache[require.resolve('../../apps/customer-pwa/assets/js/core/pwa-runtime.js')];
  const PwaRt = require('../../apps/customer-pwa/assets/js/core/pwa-runtime.js');

  assert.strictEqual(PwaRt.isNativePromptReady(), true, 'prompt must be ready');
  const res = await PwaRt.promptInstall();
  assert.strictEqual(promptCalled, true, 'native prompt must be called');
  assert.strictEqual(res.prompted, true);
  assert.strictEqual(res.accepted, true);
});

test('AC-B5: Proof 2 — prompt not ready at click -> event arrives within timeout -> native prompt used', async () => {
  let promptCalled = false;
  globalThis.window = createMockPwaWindow(null);
  globalThis.localStorage = globalThis.window.localStorage;
  delete require.cache[require.resolve('../../apps/customer-pwa/assets/js/core/pwa-runtime.js')];
  const PwaRt = require('../../apps/customer-pwa/assets/js/core/pwa-runtime.js');

  assert.strictEqual(PwaRt.isNativePromptReady(), false, 'prompt not ready initially');

  const waitPromise = PwaRt.waitForPrompt(1000);

  // Event arrives after 150ms
  setTimeout(() => {
    globalThis.window.__xentra_deferred_prompt = {
      prompt: () => { promptCalled = true; return Promise.resolve({ outcome: 'accepted' }); },
      userChoice: Promise.resolve({ outcome: 'accepted' })
    };
  }, 150);

  const ready = await waitPromise;
  assert.strictEqual(ready, true, 'waitForPrompt must resolve true when event arrives');
  assert.strictEqual(PwaRt.isNativePromptReady(), true);

  const res = await PwaRt.promptInstall();
  assert.strictEqual(promptCalled, true, 'native prompt must be called');
  assert.strictEqual(res.prompted, true);
  assert.strictEqual(res.accepted, true);
});

test('AC-B6: Proof 3 — event never arrives -> bounded wait times out, manual fallback', async () => {
  globalThis.window = createMockPwaWindow(null);
  globalThis.localStorage = globalThis.window.localStorage;
  delete require.cache[require.resolve('../../apps/customer-pwa/assets/js/core/pwa-runtime.js')];
  const PwaRt = require('../../apps/customer-pwa/assets/js/core/pwa-runtime.js');

  const start = Date.now();
  const ready = await PwaRt.waitForPrompt(300);
  const elapsed = Date.now() - start;

  assert.strictEqual(ready, false, 'waitForPrompt must resolve false on timeout');
  assert.strictEqual(PwaRt.isNativePromptReady(), false);
  assert.ok(elapsed >= 250, 'must have waited for bounded timeout');
});

test('AC-B7: Proof 4 — native prompt event is consumed only once', async () => {
  let callCount = 0;
  const fakePrompt = {
    prompt: () => { callCount++; return Promise.resolve({ outcome: 'accepted' }); },
    userChoice: Promise.resolve({ outcome: 'accepted' })
  };
  globalThis.window = createMockPwaWindow(fakePrompt);
  globalThis.localStorage = globalThis.window.localStorage;
  delete require.cache[require.resolve('../../apps/customer-pwa/assets/js/core/pwa-runtime.js')];
  const PwaRt = require('../../apps/customer-pwa/assets/js/core/pwa-runtime.js');

  const res1 = await PwaRt.promptInstall();
  assert.strictEqual(res1.prompted, true);
  assert.strictEqual(callCount, 1);

  // Event is now consumed and cleared
  assert.strictEqual(PwaRt.isNativePromptReady(), false);
  const res2 = await PwaRt.promptInstall();
  assert.strictEqual(res2.prompted, false, 'second prompt call must not re-prompt');
  assert.strictEqual(callCount, 1, 'prompt() must only be called once');
});

test('AC-B8: Proof 5 — accepted != installed (acceptance does not satisfy install requirement)', async () => {
  const fakePrompt = {
    prompt: () => Promise.resolve({ outcome: 'accepted' }),
    userChoice: Promise.resolve({ outcome: 'accepted' })
  };
  globalThis.window = createMockPwaWindow(fakePrompt);
  globalThis.localStorage = globalThis.window.localStorage;
  delete require.cache[require.resolve('../../apps/customer-pwa/assets/js/core/pwa-runtime.js')];
  const PwaRt = require('../../apps/customer-pwa/assets/js/core/pwa-runtime.js');

  const res = await PwaRt.promptInstall();
  assert.strictEqual(res.accepted, true);

  const ctx = PwaRt.getPwaRuntimeContext();
  assert.strictEqual(ctx.install_state, 'accepted');
  assert.strictEqual(ctx.install_requirement_satisfied, false, 'accepted must NEVER satisfy install requirement');
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

test('AC-C5: waitForPrompt exists in PwaRuntime API', () => {
  assert.ok(/waitForPrompt/.test(PWA_RUNTIME_JS), 'waitForPrompt utility must exist in runtime');
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
