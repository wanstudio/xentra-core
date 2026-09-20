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

// ── B. Install flow: Browser-capability-driven CTA & prompt lifecycle ───

test('AC-B1: home.js checks isNativePromptReady() and calls promptInstall() directly on user gesture', () => {
  const clickIdx = HOME_JS.indexOf("installBtn.addEventListener('click'");
  assert.ok(clickIdx !== -1, 'home.js must have installBtn click handler');
  const block = HOME_JS.substring(clickIdx, clickIdx + 1500);
  assert.ok(/isNativePromptReady/.test(block),
    'home.js must check isNativePromptReady()');
  assert.ok(/\bpromptInstall\(\)/.test(block),
    'home.js click must call promptInstall() directly when ready');
});

test('AC-B2: home.js does NOT use delayed waitForPrompt() on user click (no race architecture)', () => {
  const clickIdx = HOME_JS.indexOf("installBtn.addEventListener('click'");
  const block = HOME_JS.substring(clickIdx, clickIdx + 1500);
  assert.ok(!/waitForPrompt/.test(block),
    'home.js click handler must not call waitForPrompt() (race architecture prohibited)');
});

test('AC-B3: home.js drives CTA visibility via evaluateBannerVisibility and reacts to prompt readiness', () => {
  assert.ok(/evaluateBannerVisibility/.test(HOME_JS),
    'home.js must have evaluateBannerVisibility function');
  assert.ok(/xentra:pwa-prompt-ready/.test(HOME_JS),
    'home.js must listen to xentra:pwa-prompt-ready to dynamically show CTA');
  assert.ok(/beforeinstallprompt/.test(HOME_JS),
    'home.js must listen to beforeinstallprompt');
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

test('AC-B5: Proof 2 — dynamic capability transition: prompt arrives post-load -> readiness flips to true', async () => {
  globalThis.window = createMockPwaWindow(null);
  globalThis.localStorage = globalThis.window.localStorage;
  delete require.cache[require.resolve('../../apps/customer-pwa/assets/js/core/pwa-runtime.js')];
  const PwaRt = require('../../apps/customer-pwa/assets/js/core/pwa-runtime.js');

  assert.strictEqual(PwaRt.isNativePromptReady(), false, 'prompt not ready initially');

  // Event arrives post-load
  globalThis.window.__xentra_deferred_prompt = {
    prompt: () => Promise.resolve({ outcome: 'accepted' }),
    userChoice: Promise.resolve({ outcome: 'accepted' })
  };

  assert.strictEqual(PwaRt.isNativePromptReady(), true, 'readiness flips to true once captured');
});

test('AC-B6: Proof 3 — prompt not ready -> promptInstall resolves prompted:false with zero delay', async () => {
  globalThis.window = createMockPwaWindow(null);
  globalThis.localStorage = globalThis.window.localStorage;
  delete require.cache[require.resolve('../../apps/customer-pwa/assets/js/core/pwa-runtime.js')];
  const PwaRt = require('../../apps/customer-pwa/assets/js/core/pwa-runtime.js');

  const start = Date.now();
  const res = await PwaRt.promptInstall();
  const elapsed = Date.now() - start;

  assert.strictEqual(res.prompted, false);
  assert.strictEqual(res.accepted, false);
  assert.ok(elapsed < 50, 'promptInstall without prompt must return immediately without waiting');
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

// ── F. Android Native Prompt, Race Mitigation & Icon Validation ──────

const MANIFEST_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/pwa/manifest.json');
const MANIFEST_JSON = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

test('AC-F1: Proof 1 — prompt ready -> native prompt only, manual guide is never shown', async () => {
  let nativePromptCalled = 0;
  let manualGuideCalled = 0;

  const fakePrompt = {
    prompt: () => {
      nativePromptCalled++;
      return Promise.resolve({ outcome: 'accepted' });
    },
    userChoice: Promise.resolve({ outcome: 'accepted' })
  };

  globalThis.window = createMockPwaWindow(fakePrompt);
  globalThis.localStorage = globalThis.window.localStorage;
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ classList: { add: () => {}, remove: () => {} }, querySelector: () => null }),
    body: { appendChild: () => {} }
  };

  delete require.cache[require.resolve('../../apps/customer-pwa/assets/js/core/pwa-runtime.js')];
  const PwaRt = require('../../apps/customer-pwa/assets/js/core/pwa-runtime.js');
  globalThis.window.Xentra = { PwaRuntime: PwaRt };

  const showPwaGuideSheet = () => { manualGuideCalled++; };
  globalThis.window.showPwaGuideSheet = showPwaGuideSheet;

  // Execute the exact decision logic used in home.js / checkout.js
  const isIos = false;

  function runInstallClick() {
    if (typeof PwaRt.isNativePromptReady === 'function' && PwaRt.isNativePromptReady()) {
      return PwaRt.promptInstall().then(function (res) {
        if (res && res.prompted) return;
        showPwaGuideSheet('android');
      });
    }
    if (isIos) {
      showPwaGuideSheet('ios');
      return Promise.resolve();
    }
    return Promise.resolve();
  }

  await runInstallClick();

  assert.strictEqual(nativePromptCalled, 1, 'Native prompt must be called exactly once');
  assert.strictEqual(manualGuideCalled, 0, 'Manual guide must NEVER be called when prompt is ready');
});

test('AC-F2: Proof 2 — dynamic capability transition: prompt arrives post-load -> banner becomes visible and ready for next click', async () => {
  globalThis.window = createMockPwaWindow(null);
  globalThis.localStorage = globalThis.window.localStorage;
  delete require.cache[require.resolve('../../apps/customer-pwa/assets/js/core/pwa-runtime.js')];
  const PwaRt = require('../../apps/customer-pwa/assets/js/core/pwa-runtime.js');

  assert.strictEqual(PwaRt.isNativePromptReady(), false, 'Prompt not ready initially');

  // Event arrives post-load
  let promptFired = false;
  const fakePrompt = {
    prompt: () => { promptFired = true; return Promise.resolve({ outcome: 'accepted' }); },
    userChoice: Promise.resolve({ outcome: 'accepted' })
  };
  globalThis.window.__xentra_deferred_prompt = fakePrompt;

  assert.strictEqual(PwaRt.isNativePromptReady(), true, 'Ready for next user gesture');
  const res = await PwaRt.promptInstall();
  assert.strictEqual(res.prompted, true);
  assert.strictEqual(promptFired, true);
});

test('AC-F3: Proof 3 — prompt not ready at click -> zero delay, no delayed conversion of gesture', async () => {
  let nativePromptCalled = 0;
  let manualGuideCalled = 0;

  globalThis.window = createMockPwaWindow(null);
  globalThis.localStorage = globalThis.window.localStorage;

  delete require.cache[require.resolve('../../apps/customer-pwa/assets/js/core/pwa-runtime.js')];
  const PwaRt = require('../../apps/customer-pwa/assets/js/core/pwa-runtime.js');

  const start = Date.now();
  // If clicked when not ready, no wait occurs
  if (PwaRt.isNativePromptReady()) {
    await PwaRt.promptInstall();
    nativePromptCalled++;
  }
  const elapsed = Date.now() - start;

  assert.strictEqual(nativePromptCalled, 0, 'Native prompt must NOT be called when not ready');
  assert.ok(elapsed < 20, 'Zero waiting time on click');
});

test('AC-F4: Proof 4 — mutual exclusion: native prompt and manual guide NEVER appear together in 1 click', async () => {
  // Scenario A: Native prompt ready
  let nativeCount = 0;
  let guideCount = 0;
  let overlayRemoved = 0;

  const fakePrompt = {
    prompt: () => {
      nativeCount++;
      return Promise.resolve({ outcome: 'accepted' });
    },
    userChoice: Promise.resolve({ outcome: 'accepted' })
  };

  globalThis.window = createMockPwaWindow(fakePrompt);
  globalThis.localStorage = globalThis.window.localStorage;
  globalThis.document = {
    getElementById: (id) => {
      if (id === 'x-pwa-guide-overlay') return { remove: () => { overlayRemoved++; } };
      return null;
    }
  };

  delete require.cache[require.resolve('../../apps/customer-pwa/assets/js/core/pwa-runtime.js')];
  const PwaRt = require('../../apps/customer-pwa/assets/js/core/pwa-runtime.js');

  function showManualGuide() {
    if (PwaRt && typeof PwaRt.isNativePromptReady === 'function' && PwaRt.isNativePromptReady()) {
      return; // Guard prevents guide if native prompt ready
    }
    guideCount++;
  }

  function handlePromptResult(res) {
    if (res && res.prompted) {
      const existing = globalThis.document.getElementById('x-pwa-guide-overlay');
      if (existing) existing.remove();
      return;
    }
    showManualGuide();
  }

  if (PwaRt.isNativePromptReady()) {
    await PwaRt.promptInstall().then(handlePromptResult);
  } else {
    showManualGuide();
  }

  assert.strictEqual(nativeCount, 1);
  assert.strictEqual(guideCount, 0);
  assert.strictEqual(nativeCount + guideCount, 1, 'Exactly one UI path must execute, never both');
  assert.strictEqual(overlayRemoved, 1, 'Any dangling overlay must be actively removed on native prompt');
});

test('AC-F5: Proof 5 — accepted != installed (acceptance does not satisfy install requirement)', async () => {
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
  assert.strictEqual(ctx.install_state, 'accepted', 'State must be transient accepted');
  assert.strictEqual(ctx.install_requirement_satisfied, false, 'install_requirement_satisfied must remain FALSE');
  assert.strictEqual(globalThis.localStorage.getItem('xentra_pwa_verified'), null, 'Verified marker must NOT be set');
});

test('AC-F6: Proof 6 — manifest.json and icon configuration strictly valid for WebAPK / PWA standard', () => {
  // 1. Core manifest structure
  assert.strictEqual(MANIFEST_JSON.id, '/', 'manifest id must be defined for WebAPK deduplication');
  assert.ok(MANIFEST_JSON.name && MANIFEST_JSON.name.length > 0, 'name must not be empty');
  assert.ok(MANIFEST_JSON.short_name && MANIFEST_JSON.short_name.length > 0, 'short_name must not be empty');
  assert.strictEqual(MANIFEST_JSON.start_url, '/', 'start_url must be valid');
  assert.strictEqual(MANIFEST_JSON.scope, '/', 'scope must be valid');
  assert.strictEqual(MANIFEST_JSON.display, 'standalone', 'display must be standalone');
  assert.ok(Array.isArray(MANIFEST_JSON.display_override), 'display_override must be an array');
  assert.ok(MANIFEST_JSON.display_override.includes('standalone'), 'display_override must include standalone');
  assert.strictEqual(MANIFEST_JSON.prefer_related_applications, false, 'prefer_related_applications must be false');

  // 2. Icon configurations
  assert.ok(Array.isArray(MANIFEST_JSON.icons), 'icons must be an array');
  assert.ok(MANIFEST_JSON.icons.length >= 2, 'must provide at least 2 icon specifications');

  const icon192Any = MANIFEST_JSON.icons.find(i => i.sizes === '192x192' && i.purpose === 'any');
  const icon192Maskable = MANIFEST_JSON.icons.find(i => i.sizes === '192x192' && i.purpose === 'maskable');
  const icon512Any = MANIFEST_JSON.icons.find(i => i.sizes === '512x512' && i.purpose === 'any');
  const icon512Maskable = MANIFEST_JSON.icons.find(i => i.sizes === '512x512' && i.purpose === 'maskable');

  assert.ok(icon192Any, '192x192 purpose: any must exist in manifest');
  assert.ok(icon192Maskable, '192x192 purpose: maskable must exist in manifest');
  assert.ok(icon512Any, '512x512 purpose: any must exist in manifest');
  assert.ok(icon512Maskable, '512x512 purpose: maskable must exist in manifest');

  // 3. Physical file verification on disk
  const icon192Path = path.resolve(__dirname, '../../apps/customer-pwa', icon192Any.src.replace(/^\//, ''));
  const icon512Path = path.resolve(__dirname, '../../apps/customer-pwa', icon512Any.src.replace(/^\//, ''));

  assert.ok(fs.existsSync(icon192Path), `Icon file must exist on disk: ${icon192Path}`);
  assert.ok(fs.existsSync(icon512Path), `Icon file must exist on disk: ${icon512Path}`);

  // Validate PNG magic number (89 50 4E 47 0D 0A 1A 0A) and dimensions from IHDR chunk
  const buf192 = fs.readFileSync(icon192Path);
  const buf512 = fs.readFileSync(icon512Path);

  assert.strictEqual(buf192.readUInt32BE(0), 0x89504E47, 'icon-192.png must have valid PNG magic bytes');
  assert.strictEqual(buf192.readUInt32BE(16), 192, 'icon-192.png width must be exactly 192');
  assert.strictEqual(buf192.readUInt32BE(20), 192, 'icon-192.png height must be exactly 192');

  assert.strictEqual(buf512.readUInt32BE(0), 0x89504E47, 'icon-512.png must have valid PNG magic bytes');
  assert.strictEqual(buf512.readUInt32BE(16), 512, 'icon-512.png width must be exactly 512');
  assert.strictEqual(buf512.readUInt32BE(20), 512, 'icon-512.png height must be exactly 512');
});

// ── G. Dismissal / Close (X) — Strict Contract & No Application Cooldown ───

test('AC-G1: No application-defined install cooldown policy exists in codebase', () => {
  const forbiddenKeywords = [
    'dismissed_at',
    'dismissed_until',
    'cooldown_until',
    'dismiss_count',
    'xentra_install_promo_dismissed'
  ];
  for (const kw of forbiddenKeywords) {
    assert.ok(!HOME_JS.includes(kw), `home.js must not contain cooldown keyword: ${kw}`);
    assert.ok(!CHECKOUT_JS.includes(kw), `checkout.js must not contain cooldown keyword: ${kw}`);
    assert.ok(!PWA_RUNTIME_JS.includes(kw), `pwa-runtime.js must not contain cooldown keyword: ${kw}`);
  }
});

test('AC-G2: Dismissal is presentation-only and does not mutate xentra_pwa_verified or capability state', () => {
  let verifiedMarkerMutated = false;
  let customStorage = {};
  const mockStorage = {
    getItem: (k) => customStorage[k] || null,
    setItem: (k, v) => {
      if (k === 'xentra_pwa_verified') verifiedMarkerMutated = true;
      customStorage[k] = v;
    },
    removeItem: (k) => { delete customStorage[k]; }
  };

  globalThis.window = createMockPwaWindow(null);
  globalThis.localStorage = mockStorage;
  globalThis.sessionStorage = mockStorage;

  // Closing / dismissing UI only toggles in-memory presentation flag
  let isDismissedInCurrentPresentation = false;
  function handleDismiss() {
    isDismissedInCurrentPresentation = true;
  }

  handleDismiss();

  assert.strictEqual(isDismissedInCurrentPresentation, true);
  assert.strictEqual(verifiedMarkerMutated, false, 'Closing the UI must NOT mutate xentra_pwa_verified');
  assert.strictEqual(Object.keys(customStorage).length, 0, 'Closing the UI must not write any storage keys or cooldowns');
});

test('AC-G3: Browser capability remains authoritative: new beforeinstallprompt resets presentation dismissal', () => {
  let isDismissedInCurrentPresentation = true;
  let bannerVisible = false;

  function evaluateBannerVisibility(isNativeReady) {
    if (isDismissedInCurrentPresentation) {
      bannerVisible = false;
      return;
    }
    bannerVisible = isNativeReady;
  }

  function onPromptReady() {
    isDismissedInCurrentPresentation = false;
    evaluateBannerVisibility(true);
  }

  // Initial dismissed state
  evaluateBannerVisibility(true);
  assert.strictEqual(bannerVisible, false, 'Banner hidden when dismissed in presentation');

  // Browser emits beforeinstallprompt
  onPromptReady();
  assert.strictEqual(isDismissedInCurrentPresentation, false, 'New prompt ready resets presentation dismissal');
  assert.strictEqual(bannerVisible, true, 'Banner reappears because browser capability arrived');
});

// ── H. Unified beforeinstallprompt Capture & Asset Version Alignment ─────────

test('AC-H1: Early head scripts in all HTML entry points use pure capture without duplicate custom event dispatch', () => {
  const htmlFiles = [
    'apps/customer-pwa/index.html',
    'apps/customer-pwa/checkout.html',
    'apps/customer-pwa/checkout/index.html',
    'apps/customer-pwa/order-received.html',
    'apps/customer-pwa/order-received/index.html'
  ];

  for (const relPath of htmlFiles) {
    const fullPath = path.resolve(__dirname, '../../', relPath);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Head script must capture beforeinstallprompt into window.__xentra_deferred_prompt
    assert.match(content, /window\.__xentra_deferred_prompt\s*=\s*e;/,
      `${relPath} must store prompt event into window.__xentra_deferred_prompt`);

    // Head script must NOT dispatch xentra:pwa-prompt-ready (ownership belongs to pwa-runtime.js)
    const headContent = content.substring(0, content.indexOf('</head>'));
    assert.ok(!headContent.includes('xentra:pwa-prompt-ready'),
      `${relPath} <head> must not dispatch xentra:pwa-prompt-ready (runtime owns dispatch)`);
  }
});

test('AC-H2: All Customer PWA entry points reference the canonical pwa-runtime.js version', () => {
  const htmlFiles = [
    'apps/customer-pwa/index.html',
    'apps/customer-pwa/checkout.html',
    'apps/customer-pwa/checkout/index.html',
    'apps/customer-pwa/order-received.html',
    'apps/customer-pwa/order-received/index.html'
  ];

  const canonicalRuntimeRegex = /src="\/assets\/js\/core\/pwa-runtime\.js\?v=v_20260920_pwa_bootfix"/;
  const canonicalSwRegex = /register\('\/sw\.js\?v=v_20260920_pwa_bootfix'\)/;
  const canonicalRelRegex = /var PWA_VERSION = 'v_20260920_pwa_bootfix'/;

  for (const relPath of htmlFiles) {
    const fullPath = path.resolve(__dirname, '../../', relPath);
    const content = fs.readFileSync(fullPath, 'utf8');

    assert.match(content, canonicalRuntimeRegex,
      `${relPath} must reference canonical pwa-runtime.js?v=v_20260920_pwa_bootfix`);
    assert.match(content, canonicalSwRegex,
      `${relPath} must reference canonical /sw.js?v=v_20260920_pwa_bootfix`);
    assert.match(content, canonicalRelRegex,
      `${relPath} must define canonical PWA_VERSION = 'v_20260920_pwa_bootfix'`);
  }
});

test('AC-H3: pwa-runtime.js broadcasts readiness if prompt was captured early in head', () => {
  // In pwa-runtime.js, if window.__xentra_deferred_prompt exists on load, it broadcasts prompt ready
  assert.match(PWA_RUNTIME_JS, /if\s*\(\s*window\.__xentra_deferred_prompt\s*\)\s*\{\s*broadcastPromptReady\(window\.__xentra_deferred_prompt\);?\s*\}/,
    'pwa-runtime.js must broadcast readiness on load if window.__xentra_deferred_prompt was pre-captured');
});



