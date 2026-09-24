const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const apiSource = fs.readFileSync(require.resolve('../server/routes/api'), 'utf8');
const promotionSource = fs.readFileSync(
  require.resolve('../server/routes/admin-marketing-promotions'),
  'utf8'
);

test('API route aggregator: no inline route declarations remain', () => {
  const inlineRoutes = apiSource.match(/^\s*router\.(get|post|put|patch|delete)\s*\(/gm) || [];
  assert.equal(
    inlineRoutes.length,
    0,
    'api.js must remain an orchestration/registration layer, not a route implementation container'
  );
});

test('Marketing Promotion Routes: list route is isolated in promotion module', () => {
  assert.equal(
    apiSource.includes("router.get('/admin/marketing/promotions'"),
    false,
    'promotion list route must not remain inline in api.js'
  );
  assert.equal(
    promotionSource.includes("router.get('/admin/marketing/promotions'"),
    true,
    'promotion list route must live in admin-marketing-promotions.js'
  );
  assert.match(
    promotionSource,
    /mediaService,\s*bannerMediaDelivery/,
    'promotion module must receive media dependencies explicitly'
  );
  assert.match(
    apiSource,
    /registerAdminMarketingPromotionRoutes\(router,\s*\{[\s\S]*mediaService,[\s\S]*bannerMediaDelivery/,
    'api.js must pass the promotion module its explicit media dependencies'
  );
});
