'use strict';

/**
 * P0 #3 — Service Worker cache lifecycle tests.
 *
 * Loads the REAL service-worker.js inside a sandbox with a mocked Cache Storage
 * and drives the whole release lifecycle, proving:
 *
 *  - first install creates ONE versioned app-shell cache and precaches the shell
 *  - a repeat visit never purges anything
 *  - a new release creates a NEW app-shell cache and purges ONLY the old
 *    app-shell cache (never media, never unrelated origin caches)
 *  - the media cache survives releases
 *  - an unresolved (offline) cache name never triggers a purge
 *  - offline fallback keeps serving the cached shell
 *  - no HTML entry point performs a destructive global cache purge
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const SW_PATH = path.join(ROOT, 'apps/customer-pwa/assets/pwa/service-worker.js');
const SW_URL = 'https://example.test/sw.js';
const APP_PREFIX = 'xentra-pwa-';
// Cache Storage keys/requests are absolute URLs resolved against the SW scope.
const abs = (u) => new URL(String(u), SW_URL).href;

const HTML_ENTRIES = [
  'apps/customer-pwa/index.html',
  'apps/customer-pwa/checkout.html',
  'apps/customer-pwa/checkout/index.html',
  'apps/customer-pwa/order-received.html',
  'apps/customer-pwa/order-received/index.html'
];

function hashName(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash = hash & hash;
  }
  return APP_PREFIX + Math.abs(hash).toString(36);
}

// ── mocked Cache Storage ────────────────────────────────────────────────────
function makeCaches(seed) {
  const store = new Map();
  const events = { deleted: [] };
  for (const [name, entries] of Object.entries(seed || {})) {
    store.set(name, new Map((entries || []).map((u) => [abs(u), { url: abs(u) }])));
  }
  const keyOf = (req) => abs(typeof req === 'string' ? req : req.url);
  return {
    events,
    names: () => [...store.keys()],
    has: (name) => store.has(name),
    entries: (name) => [...(store.get(name) || new Map()).keys()],
    keys: () => Promise.resolve([...store.keys()]),
    open: (name) => {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name);
      return Promise.resolve({
        addAll: (urls) => { urls.forEach((u) => m.set(abs(u), { url: abs(u) })); return Promise.resolve(); },
        put: (req, res) => { const k = keyOf(req); m.set(k, res || { url: k }); return Promise.resolve(); },
        match: (req) => Promise.resolve(m.get(keyOf(req)))
      });
    },
    delete: (name) => {
      const had = store.delete(name);
      if (had) events.deleted.push(name);
      return Promise.resolve(had);
    },
    match: (req) => {
      const k = keyOf(req);
      for (const m of store.values()) if (m.has(k)) return Promise.resolve(m.get(k));
      return Promise.resolve(undefined);
    }
  };
}

// ── load the REAL service-worker.js in a sandbox ────────────────────────────
function boot(swText, seed) {
  const caches = makeCaches(seed);
  const network = {
    offline: false,
    selfFetchFails: false, // makes the content-hash self-fetch fail (unresolved name)
    requested: [],
    fetch: (input) => {
      const u = typeof input === 'string' ? input : input.url;
      network.requested.push(u);
      return network.offline
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ status: 200, url: u, clone() { return this; } });
    }
  };
  const holder = { text: swText }; // mutable → simulates a new release
  const listeners = {};
  const sandbox = {
    console: { log() {}, warn() {} },
    URL, Promise, Math, caches,
    fetch: (url, opts) => {
      if (String(url) === SW_URL) {
        return network.selfFetchFails
          ? Promise.reject(new Error('self-fetch failed'))
          : Promise.resolve({ text: () => Promise.resolve(holder.text) });
      }
      return network.fetch(url, opts);
    },
    skipWaitingCalls: 0,
    claimCalls: 0
  };
  sandbox.self = sandbox;
  sandbox.location = { href: SW_URL };
  sandbox.addEventListener = (type, fn) => { listeners[type] = fn; };
  sandbox.skipWaiting = () => { sandbox.skipWaitingCalls++; };
  sandbox.clients = { claim: () => { sandbox.claimCalls++; return Promise.resolve(); } };

  vm.createContext(sandbox);
  vm.runInContext(swText, sandbox, { filename: 'service-worker.js' });
  return { sandbox, listeners, caches, network, holder };
}

function install(ctx) {
  let waited = null;
  ctx.listeners.install({ waitUntil: (p) => { waited = p; } });
  return Promise.resolve(waited);
}
function activate(ctx) {
  let waited = null;
  ctx.listeners.activate({ waitUntil: (p) => { waited = p; } });
  return Promise.resolve(waited);
}
function fetchEvent(ctx, request) {
  let responded = null;
  ctx.listeners.fetch({ request, respondWith: (p) => { responded = p; } });
  return Promise.resolve(responded);
}

const SW = fs.readFileSync(SW_PATH, 'utf8');

// ── Scenario A: first install ───────────────────────────────────────────────
test('SW cache lifecycle — A: first install precaches the shell into one versioned cache', async () => {
  const ctx = boot(SW, {});
  await install(ctx);
  const appCaches = ctx.caches.names().filter((n) => n.indexOf(APP_PREFIX) === 0);
  assert.strictEqual(appCaches.length, 1, 'exactly one app-shell cache must be created');
  assert.ok(ctx.caches.entries(appCaches[0]).includes(abs('/')), 'app shell must precache "/"');
  assert.ok(ctx.caches.entries(appCaches[0]).includes(abs('/assets/js/pages/home.js')), 'app shell must precache home.js');
  await activate(ctx);
  assert.deepStrictEqual(ctx.caches.events.deleted, [], 'first install must not purge anything');
  assert.ok(ctx.sandbox.claimCalls >= 1, 'activate must claim clients');
});

// ── Scenario B: repeat visit ────────────────────────────────────────────────
test('SW cache lifecycle — B: repeat visit performs no destructive purge', async () => {
  const ctx = boot(SW, {
    [hashName(SW)]: ['/'],
    'xentra-media': ['https://example.test/assets/uploads/derivatives/x.webp'],
    'other-app-cache': ['https://example.test/o']
  });
  await install(ctx);
  const before = ctx.caches.names().slice().sort();
  await activate(ctx);
  assert.deepStrictEqual(ctx.caches.names().slice().sort(), before, 'repeat visit must keep every cache');
  assert.deepStrictEqual(ctx.caches.events.deleted, [], 'repeat visit must delete nothing');
});

// ── Scenario C + D: new release ─────────────────────────────────────────────
test('SW cache lifecycle — C/D: new release purges ONLY the old app shell, keeps media + unrelated', async () => {
  const oldName = 'xentra-pwa-oldrelease';
  const ctx = boot(SW, {
    [oldName]: ['/'],
    'xentra-media': ['https://example.test/assets/uploads/derivatives/x.webp'],
    'other-app-cache': ['https://example.test/o']
  });
  // simulate a NEW release: different SW bytes → different content-hash name
  ctx.holder.text = SW + '\n// new release\n';
  const newName = hashName(ctx.holder.text);
  assert.notStrictEqual(newName, oldName);

  await install(ctx);
  assert.ok(ctx.caches.has(newName), 'new release must create its own app-shell cache');

  await activate(ctx);
  assert.ok(!ctx.caches.has(oldName), 'old app-shell cache must be purged once the new one exists');
  assert.ok(ctx.caches.has(newName), 'new app-shell cache must be retained');
  assert.ok(ctx.caches.has('xentra-media'), 'media cache must be RETAINED across releases');
  assert.ok(ctx.caches.has('other-app-cache'), 'unrelated caches must never be touched');
  assert.deepStrictEqual(ctx.caches.events.deleted, [oldName], 'only the old app-shell cache may be deleted');
});

// ── Scenario C failure path: unresolved cache name must not purge ───────────
test('SW cache lifecycle — C/failure: unresolved (offline) cache name never wipes existing caches', async () => {
  const ctx = boot(SW, { 'xentra-pwa-oldrelease': ['/'], 'xentra-media': ['m'] });
  ctx.network.selfFetchFails = true; // content hash cannot be computed
  await install(ctx);
  await activate(ctx);
  assert.ok(ctx.caches.has('xentra-pwa-oldrelease'), 'offline activate must NOT purge the existing app shell');
  assert.ok(ctx.caches.has('xentra-media'), 'offline activate must NOT purge media');
  assert.deepStrictEqual(ctx.caches.events.deleted, [], 'unresolved cache name must skip purge entirely');
});

// ── Scenario E: offline fallback ────────────────────────────────────────────
test('SW cache lifecycle — E: offline fallback still serves the cached shell', async () => {
  const ctx = boot(SW, {});
  await install(ctx);
  await activate(ctx);
  ctx.network.offline = true;

  const cachedRes = await fetchEvent(ctx, { method: 'GET', url: 'https://example.test/assets/js/pages/home.js', mode: 'no-cors' });
  assert.ok(cachedRes, 'offline request for a cached asset must resolve from cache');

  const navRes = await fetchEvent(ctx, { method: 'GET', url: 'https://example.test/some/deep/link', mode: 'navigate' });
  assert.ok(navRes && navRes.url === abs('/'), 'offline navigation must fall back to the cached app shell');
});

// ── P0 #3 core: no page-side destructive global purge ───────────────────────
test('P0 #3: no Customer PWA entry point performs a global Cache Storage purge', () => {
  for (const rel of HTML_ENTRIES) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!html.includes('caches.keys('), `${rel} must not enumerate caches.keys() (no global purge)`);
    assert.ok(!html.includes('caches.delete('), `${rel} must not call caches.delete() (no global purge)`);
    assert.ok(!html.includes('PWA_VERSION'), `${rel} must not carry a PWA_VERSION sentinel`);
    assert.ok(!html.includes('__xentra_rel'), `${rel} must not carry a __xentra_rel sentinel`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// P0 #4 — per-category fetch strategy
// ════════════════════════════════════════════════════════════════════════════

function req(p, mode) {
  return { method: 'GET', url: p, mode: mode || 'no-cors' };
}
const U = (p) => 'https://example.test' + p;

test('P0 #4 — HTML / JS / CSS are Network-First (fresh while online)', async () => {
  const ctx = boot(SW, {});
  await install(ctx);
  await activate(ctx);

  for (const p of ['/assets/js/pages/home.js', '/assets/css/home.css', '/']) {
    ctx.network.requested.length = 0;
    const res = await fetchEvent(ctx, req(U(p), p === '/' ? 'navigate' : 'no-cors'));
    assert.ok(res, `network-first must resolve for ${p}`);
    assert.deepStrictEqual(ctx.network.requested, [U(p)], `network must be consulted for ${p}`);
    assert.strictEqual(res.url, U(p), `network response must be returned for ${p}`);
  }
});

test('P0 #4 — HTML / JS / CSS fall back to the cached shell when offline', async () => {
  const ctx = boot(SW, {});
  await install(ctx);
  await activate(ctx);
  ctx.network.offline = true;

  const js = await fetchEvent(ctx, req(U('/assets/js/pages/home.js')));
  assert.ok(js, 'offline JS must be served from cache');

  const nav = await fetchEvent(ctx, req(U('/deep/link'), 'navigate'));
  assert.ok(nav && nav.url === abs('/'), 'offline navigation must fall back to the cached shell');
});

test('P0 #4 — manifest.json is Network-First', async () => {
  const ctx = boot(SW, {});
  await install(ctx);
  ctx.network.requested.length = 0;
  const res = await fetchEvent(ctx, req(U('/manifest.json')));
  assert.ok(res, 'manifest must be handled by the SW');
  assert.deepStrictEqual(ctx.network.requested, [U('/manifest.json')], 'manifest must come from the network when online');
});

test('P0 #4 — app icons are Cache-First (no network when already cached)', async () => {
  const ctx = boot(SW, {});
  await install(ctx); // precaches /assets/pwa/icon-192.png
  await activate(ctx);
  ctx.network.offline = true;
  ctx.network.requested.length = 0;

  const res = await fetchEvent(ctx, req(U('/assets/pwa/icon-192.png')));
  assert.ok(res, 'cached icon must resolve while offline');
  assert.deepStrictEqual(ctx.network.requested, [], 'cache-first icon must NOT hit the network when cached');
});

test('P0 #4 — app icons are fetched + cached on first miss', async () => {
  const ctx = boot(SW, {});
  await install(ctx);
  await activate(ctx);
  ctx.network.requested.length = 0;

  const first = await fetchEvent(ctx, req(U('/assets/icons/cart.svg')));
  assert.ok(first, 'icon must be fetched from the network on miss');
  assert.deepStrictEqual(ctx.network.requested, [U('/assets/icons/cart.svg')]);

  ctx.network.offline = true;
  ctx.network.requested.length = 0;
  const second = await fetchEvent(ctx, req(U('/assets/icons/cart.svg')));
  assert.ok(second, 'cached icon must be served offline on the second request');
  assert.deepStrictEqual(ctx.network.requested, [], 'second icon request must not hit the network');
});

test('P0 #4 — media derivatives are Cache-First', async () => {
  const mediaUrl = U('/assets/uploads/derivatives/brand_bangjo/m1/thumb.webp');
  const ctx = boot(SW, { 'xentra-media': [mediaUrl] });
  await install(ctx);
  await activate(ctx);
  ctx.network.offline = true;
  ctx.network.requested.length = 0;

  const res = await fetchEvent(ctx, req(mediaUrl));
  assert.ok(res, 'cached media must resolve offline');
  assert.deepStrictEqual(ctx.network.requested, [], 'cached media must not hit the network');
});

test('P0 #4 — API and dashboard are never intercepted', async () => {
  const ctx = boot(SW, {});
  await install(ctx);
  for (const p of ['/api/v1/orders', '/api/v1/customers/session', '/dashboard/index.html']) {
    ctx.network.requested.length = 0;
    const res = await fetchEvent(ctx, req(U(p)));
    assert.strictEqual(res, null, `${p} must not be handled by the SW (bypass)`);
    assert.deepStrictEqual(ctx.network.requested, [], `${p} must go straight to the network`);
  }
});

test('P0 #4 — SW declares an explicit per-category strategy', () => {
  assert.ok(SW.includes('/assets/uploads/derivatives/'), 'media Cache-First branch must exist');
  assert.ok(SW.includes('/assets/icons/'), 'icons Cache-First branch must exist');
  assert.ok(SW.includes('function networkFirst('), 'Network-First helper must exist');
  assert.ok(SW.includes('function cacheFirst('), 'Cache-First helper must exist');
  assert.ok(SW.includes('/api/'), 'API bypass must exist');
});
