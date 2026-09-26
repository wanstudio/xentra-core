'use strict';

const test = require('node:test');
const assert = require('node:assert');
const FulfillmentEnvironmentService = require('../../domains/commerce/services/FulfillmentEnvironmentService');

test('FENV-01: delivery accepts delivery transitions and rejects pickup completion shape', () => {
  assert.strictEqual(FulfillmentEnvironmentService.canTransition('delivery', 'ready', 'out_for_delivery'), true);
  assert.strictEqual(FulfillmentEnvironmentService.canTransition('delivery', 'out_for_delivery', 'completed'), true);
  assert.strictEqual(FulfillmentEnvironmentService.canTransition('delivery', 'ready', 'completed'), false);
});

test('FENV-02: pickup completes from ready and does not enter delivery lifecycle', () => {
  assert.strictEqual(FulfillmentEnvironmentService.canTransition('pickup', 'ready', 'completed'), true);
  assert.strictEqual(FulfillmentEnvironmentService.canTransition('pickup', 'ready', 'out_for_delivery'), false);
});

test('FENV-03: reservation cannot enter kitchen fulfillment before check-in handoff', () => {
  assert.strictEqual(FulfillmentEnvironmentService.canTransition('reservation', 'confirmed', 'preparing'), false);
  assert.strictEqual(FulfillmentEnvironmentService.canTransition('reservation', 'confirmed', 'cancelled'), true);
});

test('FENV-04: dine-in retains its own completion path', () => {
  assert.strictEqual(FulfillmentEnvironmentService.canTransition('dine_in', 'ready', 'completed'), true);
  assert.strictEqual(FulfillmentEnvironmentService.canTransition('dine_in', 'ready', 'out_for_delivery'), false);
});

test('FENV-05: invalid environment transition throws explicit contract error', () => {
  assert.throws(
    () => FulfillmentEnvironmentService.assertTransition('pickup', 'ready', 'out_for_delivery'),
    /FULFILLMENT_ENVIRONMENT_TRANSITION_REJECTED/
  );
});

test('FENV-06: unknown purchase type is rejected rather than defaulted', () => {
  assert.strictEqual(FulfillmentEnvironmentService.getEnvironment('unknown'), null);
  assert.strictEqual(FulfillmentEnvironmentService.canTransition('unknown', 'ready', 'completed'), false);
});
