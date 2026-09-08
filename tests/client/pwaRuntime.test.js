/**
 * PWA Runtime install-promotion contract tests — apps/.../core/pwa-runtime.js.
 *
 * Runs the REAL customer-pwa pwa-runtime module (not a copy or emulation) under
 * a minimal window/navigator/localStorage/document harness to prove the locked
 * install contract:
 *
 *   accepted != installed. install_requirement_satisfied is TRUE only after a
 *   VERIFIED install (appinstalled event, display-mode: standalone, or iOS
 *   navigator.standalone). Prompt acceptance alone never satisfies the
 *   requirement, and the old accepted-marker key is never read.
 *
 * Scenario mapping (A–L):
 *   A  fresh browser tab, nothing installed     -> none / not satisfied
 *   B  install prompt dismissed                 -> none / not satisfied
 *   C  install prompt ACCEPTED                  -> accepted / still NOT satisfied
 *   D  appinstalled event fires                 -> installed / satisfied + broadcast
 *   E  Android standalone (matchMedia)          -> installed / satisfied + marker
 *   F  iOS standalone (navigator.standalone)    -> installed / satisfied + marker
 *   G  legacy xentra_pwa_installed marker alone -> ignored (not satisfied)
 *   H  verified marker persists across reload   -> installed / satisfied
 *   (I/J/K idempotent claim + reward bridge are covered in
 *    tests/domains/promotionRewardCart.test.js against the real bridge;
 *    L promotion-API failure / server rejection is covered in
 *    tests/domains/promotion.test.js + tests/domains/commerce.test.js.)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const PWA_RUNTIME_PATH = path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/pwa-runtime.js');

function setupWorld(opts) {
  const backing = (opts && opts.storage) ? opts.storage : {};
  const handlers = { appinstalled: [] };
  const dispatchedEvents = [];
  const dispatchCalls = [];

  const fakeLocalStorage = {
    getItem: (k) => (k in backing ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: (k) => { delete backing[k]; }
  };

  const store = (opts && opts.xentra) || {};
  const fakeWindow = {
    __xentra_deferred_prompt: null,
    matchMedia: (opts && opts.standalone) ? () => ({ matches: true }) : () => ({ matches: false }),
    addEventListener: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    dispatchEvent: () => true,
    Xentra: store
  };

  if (store.Store && !store.Store.dispatch) {
    store.Store.dispatch = function () { dispatchCalls.push(Array.prototype.slice.call(arguments)); };
  }

  const fakeNavigator = {
    userAgent: '',
    standalone: Boolean(opts && opts.iosStandalone)
  };

  const fakeDocument = {
    addEventListener: () => {},
    dispatchEvent: (ev) => { dispatchedEvents.push(ev); }
  };

  function FakeCustomEvent(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  }

  return {
    backing,
    window: fakeWindow,
    navigator: fakeNavigator,
    localStorage: fakeLocalStorage,
    document: fakeDocument,
    CustomEvent: FakeCustomEvent,
    handlers,
    dispatchedEvents,
    dispatchCalls,
    getVerifiedMarker: () => backing['xentra_pwa_verified'] || null,
    getLegacyAcceptedMarker: () => backing['xentra_pwa_installed'] || null,
    fireAppInstalled: () => {
      (handlers.appinstalled || []).forEach((fn) => fn());
    },
    setDeferredPrompt: (outcome) => {
      fakeWindow.__xentra_deferred_prompt = {
        prompt: () => Promise.resolve({ outcome: outcome }),
        userChoice: null
      };
    }
  };
}

function installGlobals(world) {
  const prev = {};
  const names = ['window', 'navigator', 'localStorage', 'document', 'CustomEvent'];
  names.forEach((n) => {
    prev[n] = Object.getOwnPropertyDescriptor(globalThis, n);
    try {
      Object.defineProperty(globalThis, n, { value: world[n], configurable: true, writable: true, enumerable: false });
    } catch (_) {
      globalThis[n] = world[n];
    }
  });
  return {
    restore: () => {
      names.forEach((n) => {
        const d = prev[n];
        if (!d) delete globalThis[n];
        else Object.defineProperty(globalThis, n, d);
      });
    }
  };
}

function loadPwaRuntime(opts) {
  const world = setupWorld(opts);
  const globals = installGlobals(world);
  delete require.cache[require.resolve(PWA_RUNTIME_PATH)];
  const mod = require(PWA_RUNTIME_PATH);
  return {
    mod,
    world,
    reload() {
      // Same world (same shared localStorage), fresh module instance — simulates
      // a page reload in the same browser profile.
      delete require.cache[require.resolve(PWA_RUNTIME_PATH)];
      const fresh = require(PWA_RUNTIME_PATH);
      return { mod: fresh, world };
    },
    cleanup() {
      delete require.cache[require.resolve(PWA_RUNTIME_PATH)];
      globals.restore();
    }
  };
}

test('PWA Runtime A — fresh browser tab: no install, requirement not satisfied', (t) => {
  const h = loadPwaRuntime({});
  t.after(() => h.cleanup());

  const ctx = h.mod.getPwaRuntimeContext();
  assert.strictEqual(ctx.display_mode, 'browser');
  assert.strictEqual(ctx.install_state, 'none');
  assert.strictEqual(ctx.install_requirement_satisfied, false);
  assert.strictEqual(h.mod.getInstallState(), 'none');
  assert.strictEqual(h.world.getVerifiedMarker(), null);
});

test('PWA Runtime B — install prompt dismissed: rejected, still not satisfied', async (t) => {
  const h = loadPwaRuntime({});
  t.after(() => h.cleanup());
  h.world.setDeferredPrompt('dismissed');

  const res = await h.mod.promptInstall();
  assert.deepStrictEqual(res, { prompted: true, outcome: 'dismissed', accepted: false });

  const ctx = h.mod.getPwaRuntimeContext();
  assert.strictEqual(ctx.install_state, 'none');
  assert.strictEqual(ctx.install_requirement_satisfied, false);
  assert.strictEqual(h.world.getVerifiedMarker(), null);
});

test('PWA Runtime C — (CORE FIX) prompt ACCEPTED is not installed: requirement stays unsatisfied', async (t) => {
  const h = loadPwaRuntime({});
  t.after(() => h.cleanup());
  h.world.setDeferredPrompt('accepted');

  const res = await h.mod.promptInstall();
  assert.strictEqual(res.prompted, true);
  assert.strictEqual(res.accepted, true);

  const ctx = h.mod.getPwaRuntimeContext();
  assert.strictEqual(ctx.display_mode, 'browser');
  assert.strictEqual(ctx.install_state, 'accepted');
  assert.strictEqual(ctx.install_requirement_satisfied, false, 'accepting the prompt must NOT satisfy the install requirement');

  // No verified marker and no legacy accepted marker are written.
  assert.strictEqual(h.world.getVerifiedMarker(), null, 'prompt acceptance must never write the verified marker');
  assert.strictEqual(h.world.getLegacyAcceptedMarker(), null);
});

test('PWA Runtime D — appinstalled event: verified install, satisfied + broadcast', (t) => {
  const h = loadPwaRuntime({ xentra: { Store: {} } });
  t.after(() => h.cleanup());
  assert.strictEqual(h.mod.getPwaRuntimeContext().install_requirement_satisfied, false);

  h.world.fireAppInstalled();

  assert.strictEqual(h.world.getVerifiedMarker(), '1');
  const ctx = h.mod.getPwaRuntimeContext();
  assert.strictEqual(ctx.install_state, 'installed');
  assert.strictEqual(ctx.install_requirement_satisfied, true);
  assert.strictEqual(h.mod.getInstallState(), 'installed');

  // Broadcasts: store event + CustomEvent consumed by Home/Checkout.
  assert.strictEqual(h.world.dispatchCalls.length, 1);
  assert.strictEqual(h.world.dispatchCalls[0][0], 'PWA_INSTALLED');
  assert.strictEqual(h.world.dispatchCalls[0][1].install_requirement_satisfied, true);
  assert.strictEqual(h.world.dispatchedEvents.length, 1);
  assert.strictEqual(h.world.dispatchedEvents[0].type, 'xentra:pwa-installed');
  assert.strictEqual(h.world.dispatchedEvents[0].detail.install_requirement_satisfied, true);
});

test('PWA Runtime E — Android standalone (display-mode: standalone): satisfied + marker persisted', (t) => {
  const h = loadPwaRuntime({ standalone: true });
  t.after(() => h.cleanup());

  const ctx = h.mod.getPwaRuntimeContext();
  assert.strictEqual(ctx.display_mode, 'standalone');
  assert.strictEqual(ctx.install_state, 'installed');
  assert.strictEqual(ctx.install_requirement_satisfied, true);
  assert.strictEqual(h.world.getVerifiedMarker(), '1', 'standalone detection at load persists the verified marker');
});

test('PWA Runtime F — iOS Safari standalone (navigator.standalone): satisfied + marker persisted', (t) => {
  const h = loadPwaRuntime({ iosStandalone: true });
  t.after(() => h.cleanup());

  const ctx = h.mod.getPwaRuntimeContext();
  assert.strictEqual(ctx.display_mode, 'standalone');
  assert.strictEqual(ctx.install_requirement_satisfied, true);
  assert.strictEqual(h.world.getVerifiedMarker(), '1');
});

test('PWA Runtime G — legacy xentra_pwa_installed marker alone is IGNORED (migration)', (t) => {
  // Older builds wrote this key after prompt acceptance; it must never satisfy
  // under the new contract.
  const h = loadPwaRuntime({ storage: { xentra_pwa_installed: '1' } });
  t.after(() => h.cleanup());

  let ctx = h.mod.getPwaRuntimeContext();
  assert.strictEqual(ctx.install_state, 'none');
  assert.strictEqual(ctx.install_requirement_satisfied, false, 'legacy accepted marker must not satisfy the requirement');

  // A genuine appinstalled in the same profile still verifies cleanly.
  h.world.fireAppInstalled();
  ctx = h.mod.getPwaRuntimeContext();
  assert.strictEqual(ctx.install_state, 'installed');
  assert.strictEqual(ctx.install_requirement_satisfied, true);
});

test('PWA Runtime H — verified marker persists across reload into a plain browser tab', (t) => {
  const h = loadPwaRuntime({});
  t.after(() => h.cleanup());
  h.world.fireAppInstalled();

  // Reload the page (same profile/localStorage, not running standalone).
  const fresh = h.reload();
  const ctx = fresh.mod.getPwaRuntimeContext();
  assert.strictEqual(ctx.display_mode, 'browser');
  assert.strictEqual(ctx.install_state, 'installed');
  assert.strictEqual(ctx.install_requirement_satisfied, true, 'verified install must survive a reload into a non-standalone tab');
  assert.strictEqual(fresh.mod.getInstallState(), 'installed');
});