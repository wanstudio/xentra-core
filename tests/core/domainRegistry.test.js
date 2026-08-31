'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  DomainIdentity,
  DomainCapability,
  DomainLifecycle,
  DomainRegistrationModel,
  DomainRegistry,
  createDomainRegistry
} = require('../../core/domain');

// ==============================================================================
// F1 — Domain Identity Test (Level: Identity & Semantic Naming)
// Requirement: identifier name, semver version, display name, and immutability
// ==============================================================================
test('F1 — Domain Identity: validates domain name format and immutable identity', () => {
  const commerceIdentity = new DomainIdentity({
    name: 'commerce',
    version: '1.2.0',
    display_name: 'Xentra Commerce',
    description: 'Digital ordering & menu catalog domain'
  });

  assert.strictEqual(commerceIdentity.name, 'commerce');
  assert.strictEqual(commerceIdentity.version, '1.2.0');
  assert.strictEqual(commerceIdentity.display_name, 'Xentra Commerce');
  assert.ok(Object.isFrozen(commerceIdentity));

  // Invalid names
  assert.throws(() => new DomainIdentity({ name: '' }), /"name" is required/);
  assert.throws(() => new DomainIdentity({ name: 'Invalid Space Name' }), /Invalid domain name/);
});

// ==============================================================================
// F2 — Domain Registration Model Test (Level: Self-Registration Structure)
// Requirement: self-registration payload with identity, capabilities, and lifecycle
// ==============================================================================
test('F2 — Domain Registration Model: self-registration contract structure', () => {
  const reg = new DomainRegistrationModel({
    identity: { name: 'pos', version: '2.0.0' },
    capabilities: {
      events_produced: ['pos.order_placed', 'pos.payment_collected'],
      events_consumed: ['inventory.stock_updated']
    },
    metadata: { author: 'Xentra Team' }
  });

  assert.strictEqual(reg.identity.name, 'pos');
  assert.strictEqual(reg.capabilities.events_produced.length, 2);
  assert.strictEqual(reg.lifecycle.state, 'registered');
});

// ==============================================================================
// F3 — Domain Capability Test (Level: Capability Declaration)
// Requirement: declared events produced, consumed, required permissions, and features
// ==============================================================================
test('F3 — Domain Capability: declares produced/consumed events and permissions', () => {
  const capabilities = new DomainCapability({
    events_produced: ['inventory.stock_deducted'],
    events_consumed: ['commerce.order_placed'],
    permissions_required: ['inventory:manage'],
    features_provided: ['stock_tracking', 'low_stock_alert']
  });

  assert.strictEqual(capabilities.events_produced[0], 'inventory.stock_deducted');
  assert.strictEqual(capabilities.permissions_required[0], 'inventory:manage');
  assert.ok(Object.isFrozen(capabilities));
});

// ==============================================================================
// F4 — Domain Lifecycle Test (Level: State Transitions)
// Requirement: transitions from registered -> active -> disabled/error with history
// ==============================================================================
test('F4 — Domain Lifecycle: manages state transitions and records history', () => {
  const lifecycle = new DomainLifecycle();
  assert.strictEqual(lifecycle.state, 'registered');
  assert.strictEqual(lifecycle.isActive(), false);

  lifecycle.activate();
  assert.strictEqual(lifecycle.state, 'active');
  assert.strictEqual(lifecycle.isActive(), true);

  lifecycle.disable('Maintenance period');
  assert.strictEqual(lifecycle.state, 'disabled');
  assert.strictEqual(lifecycle.isActive(), false);

  lifecycle.markError('Crash on startup');
  assert.strictEqual(lifecycle.state, 'error');

  const history = lifecycle.getHistory();
  assert.strictEqual(history.length, 4);
});

// ==============================================================================
// F5 — Registry Validation & Management Test (Level: Central Catalog & Self-Registration)
// Requirement: records self-registered domains, validates duplicates and version mismatch
// ==============================================================================
test('F5 — Domain Registry: records self-registration and enforces validation rules', () => {
  const registry = createDomainRegistry();

  // 1. Self-register Commerce domain on initialization
  const commerceReg = registry.register({
    identity: { name: 'commerce', version: '1.0.0', display_name: 'Commerce Engine' },
    capabilities: { events_produced: ['commerce.order_placed'] }
  });

  assert.strictEqual(commerceReg.identity.name, 'commerce');
  assert.strictEqual(registry.isDomainActive('commerce'), true);

  // 2. Self-register POS domain
  registry.register({
    identity: { name: 'pos', version: '1.0.0', display_name: 'Cashier POS' }
  });

  assert.strictEqual(registry.listDomains().length, 2);

  // 3. Duplicate registration with version mismatch throws error
  assert.throws(() => {
    registry.register({
      identity: { name: 'commerce', version: '2.0.0' }
    });
  }, /Version mismatch/);

  // 4. Update state to disabled
  registry.setDomainState('pos', 'disabled', 'Temporary offline');
  assert.strictEqual(registry.isDomainActive('pos'), false);
  assert.strictEqual(registry.listDomains({ active_only: true }).length, 1);
});
