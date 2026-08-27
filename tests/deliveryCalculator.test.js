const test = require('node:test');
const assert = require('node:assert');
const DeliveryCalculator = require('../server/services/DeliveryCalculator');

test('DeliveryCalculator: within free distance should have 0 fee', () => {
  const result = DeliveryCalculator.calculate({
    distance_meters: 1500, // 1.5 km
    free_km: 2.0,
    price_per_km: 2500,
    max_radius_km: 10
  });

  assert.strictEqual(result.eligible, true);
  assert.strictEqual(result.distance_km, 1.5);
  assert.strictEqual(result.chargeable_distance_km, 0);
  assert.strictEqual(result.final_delivery_fee, 0);
});

test('DeliveryCalculator: beyond free distance calculates exact formula', () => {
  const result = DeliveryCalculator.calculate({
    distance_meters: 5200, // 5.2 km
    free_km: 2.0,
    price_per_km: 2500,
    max_radius_km: 10
  });

  assert.strictEqual(result.eligible, true);
  assert.strictEqual(result.distance_km, 5.2);
  assert.strictEqual(result.chargeable_distance_km, 3.2); // 5.2 - 2.0 = 3.2 km
  assert.strictEqual(result.final_delivery_fee, 8000); // 3.2 * 2500 = 8000
});

test('DeliveryCalculator: beyond max radius should be ineligible', () => {
  const result = DeliveryCalculator.calculate({
    distance_meters: 12500, // 12.5 km
    free_km: 2.0,
    price_per_km: 2500,
    max_radius_km: 10.0
  });

  assert.strictEqual(result.eligible, false);
  assert.strictEqual(result.distance_km, 12.5);
  assert.match(result.reason, /di luar jangkauan maksimal/i);
});

test('DeliveryCalculator: applies promo discount if subtotal threshold met', () => {
  const result = DeliveryCalculator.calculate({
    distance_meters: 6000, // 6.0 km
    free_km: 2.0,
    price_per_km: 2500,
    max_radius_km: 10,
    subtotal: 60000,
    promo_config: {
      enabled: true,
      target: 50000,
      discount: 5000,
      label: 'Promo Ongkir Hemat'
    }
  });

  assert.strictEqual(result.eligible, true);
  assert.strictEqual(result.base_delivery_fee, 10000); // (6 - 2) * 2500 = 10000
  assert.strictEqual(result.discount_amount, 5000);
  assert.strictEqual(result.final_delivery_fee, 5000); // 10000 - 5000 = 5000
});
