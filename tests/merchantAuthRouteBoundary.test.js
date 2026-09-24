const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const apiPath = require.resolve('../server/routes/api');
const authPath = require.resolve('../server/routes/merchant-auth');

const apiSource = fs.readFileSync(apiPath, 'utf8');
const authSource = fs.readFileSync(authPath, 'utf8');

const routes = [
  "router.post('/auth/register'",
  "router.post('/auth/register-identity'",
  "router.get('/verify-email'",
  "router.get('/auth/verify-email'",
  "router.post('/auth/verify-email'",
  "router.post('/auth/resend-verification'",
  "router.get('/auth/merchant/me'",
  "router.post('/auth/merchant/login'",
  "router.post('/auth/login'",
  "router.post('/auth/google'",
  "router.post('/auth/google-onboard'",
  "router.post('/auth/handoff/create'",
  "router.post('/auth/handoff/exchange'",
  "router.post('/auth/link-google'",
  "router.post('/auth/google/link-init'",
  "router.get('/auth/config'",
  "router.get('/auth/pos-pin'",
  "router.put('/auth/pos-pin'",
  "router.post('/auth/pos/pin'"
];

test('Merchant Auth Routes: implementation is isolated behind one route boundary', () => {
  assert.equal(
    (apiSource.match(/registerMerchantAuthRoutes\(router,/g) || []).length,
    1,
    'api.js must register merchant auth routes exactly once'
  );

  for (const route of routes) {
    assert.equal(
      apiSource.includes(route),
      false,
      route + ' must not remain inline in api.js'
    );
    assert.equal(
      authSource.includes(route),
      true,
      route + ' must live in merchant-auth.js'
    );
  }

  assert.match(
    authSource,
    /module\.exports = function registerMerchantAuthRoutes\(router, deps\)/,
    'merchant-auth.js must expose the canonical registration boundary'
  );

  assert.match(
    authSource,
    /const \{[\s\S]*db,[\s\S]*RateLimiter,[\s\S]*TokenSessionStore,[\s\S]*requireAuth,[\s\S]*serializePublicBrand/,
    'merchant-auth.js must consume shared auth infrastructure explicitly'
  );
});
