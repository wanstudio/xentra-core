'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  ConfigurationModel,
  ConfigurationScope,
  ConfigurationValidator,
  ConfigurationAccess,
  FeatureControlFoundation,
  createConfigScope,
  createFeatureControl
} = require('../../core/config');
const { IdentityModel } = require('../../core/identity');

// ==============================================================================
// C1 — Configuration Model Test (Level: Model & Type Casting)
// Requirement: key-value data structure, type casting, and secret representation
// ==============================================================================
test('C1 — Configuration Model: data structure, type casting, and secret masking', () => {
  // String config
  const cfgString = new ConfigurationModel({ key: 'app.title', value: 'Bangjo Digital', type: 'string' });
  assert.strictEqual(cfgString.value, 'Bangjo Digital');

  // Number config
  const cfgNum = new ConfigurationModel({ key: 'delivery.fee_base', value: '10000', type: 'number' });
  assert.strictEqual(cfgNum.value, 10000);
  assert.throws(() => new ConfigurationModel({ key: 'invalid.num', value: 'not_a_number', type: 'number' }), /Cannot cast/);

  // Boolean config
  const cfgBool = new ConfigurationModel({ key: 'pos.auto_print', value: 'true', type: 'boolean' });
  assert.strictEqual(cfgBool.value, true);

  // JSON config
  const cfgJson = new ConfigurationModel({ key: 'promo.rule', value: '{"discount": 5000}', type: 'json' });
  assert.strictEqual(cfgJson.value.discount, 5000);

  // Secret masking
  const cfgSecret = new ConfigurationModel({
    key: 'api.secret_key',
    value: 'super_secret_payload_123',
    type: 'string',
    is_secret: true
  });
  assert.strictEqual(cfgSecret.toSafeJSON(false).value, '********');
  assert.strictEqual(cfgSecret.toSafeJSON(true).value, 'super_secret_payload_123');

  // Validation of invalid scopes & keys
  assert.throws(() => new ConfigurationModel({ key: '', value: 'test' }), /"key" is required/);
  assert.throws(() => new ConfigurationModel({ key: 'test', value: 'v', type: 'unsupported_type' }), /Invalid type/);
});

// ==============================================================================
// C2 — Configuration Scope Test (Level: Cascading Resolution Hierarchy)
// Requirement: Branch Override -> Brand Override -> Organization -> System Default
// ==============================================================================
test('C2 — Configuration Scope: cascading hierarchy resolution (Branch -> Brand -> Org -> System)', () => {
  const scope = new ConfigurationScope();

  // 1. System Default
  scope.set({ key: 'delivery.max_distance_km', value: 10, type: 'number', scope_type: 'system' });

  // 2. Organization Level Override
  scope.set({ key: 'delivery.max_distance_km', value: 15, type: 'number', scope_type: 'organization', scope_id: 'org_bangjo' });

  // 3. Brand Level Override
  scope.set({ key: 'delivery.max_distance_km', value: 20, type: 'number', scope_type: 'brand', scope_id: 'brand_bangjo' });

  // 4. Branch Level Override
  scope.set({ key: 'delivery.max_distance_km', value: 25, type: 'number', scope_type: 'branch', scope_id: 'branch_surabaya' });

  // Resolution 1: Query with branch context -> Gets branch value (25)
  const valBranch = scope.getValue('delivery.max_distance_km', {
    organization_id: 'org_bangjo',
    brand_id: 'brand_bangjo',
    branch_id: 'branch_surabaya'
  });
  assert.strictEqual(valBranch, 25);

  // Resolution 2: Query for another branch without override -> Falls back to Brand value (20)
  const valBrand = scope.getValue('delivery.max_distance_km', {
    organization_id: 'org_bangjo',
    brand_id: 'brand_bangjo',
    branch_id: 'branch_jakarta'
  });
  assert.strictEqual(valBrand, 20);

  // Resolution 3: Query for another brand without override -> Falls back to Org value (15)
  const valOrg = scope.getValue('delivery.max_distance_km', {
    organization_id: 'org_bangjo',
    brand_id: 'brand_other'
  });
  assert.strictEqual(valOrg, 15);

  // Resolution 4: Query with no matching org -> Falls back to System default (10)
  const valSystem = scope.getValue('delivery.max_distance_km', { organization_id: 'org_stranger' });
  assert.strictEqual(valSystem, 10);
});

// ==============================================================================
// C3 — Validation & Defaults Test (Level: Schema & Platform Defaults)
// Requirement: validates constraints and provides safe system defaults
// ==============================================================================
test('C3 — Validation & Defaults: schema validation and safe system defaults application', () => {
  const scope = new ConfigurationScope();

  // Validations
  assert.strictEqual(ConfigurationValidator.validate('delivery.max_radius_km', 15, 'number').valid, true);
  assert.strictEqual(ConfigurationValidator.validate('delivery.max_radius_km', -5, 'number').valid, false);
  assert.strictEqual(ConfigurationValidator.validate('', 10, 'number').valid, false);

  // Apply Defaults
  ConfigurationValidator.applyDefaults(scope);

  // Verify safe defaults are populated in scope
  assert.strictEqual(scope.getValue('platform.default_currency'), 'IDR');
  assert.strictEqual(scope.getValue('delivery.max_radius_km'), 15);
  assert.strictEqual(scope.getValue('pos.auto_accept_order'), false);
});

// ==============================================================================
// C4 — Configuration Access Test (Level: Access Control & Secret Protection)
// Requirement: RBAC protected writes and secret reveal authorization
// ==============================================================================
test('C4 — Configuration Access: RBAC write authorization and secret masking', () => {
  const scope = new ConfigurationScope();

  const ownerUser = new IdentityModel({ username: 'owner_user', status: 'active' });
  const cashierUser = new IdentityModel({ username: 'cashier_user', status: 'active' });

  const ownerAssignments = [{ user_id: ownerUser.id, role: 'owner', scope_type: 'global' }];
  const cashierAssignments = [{ user_id: cashierUser.id, role: 'cashier', scope_type: 'branch', scope_id: 'branch_01' }];

  // 1. Owner writes organization configuration: Allowed
  const writeResult = ConfigurationAccess.write({
    scopeManager: scope,
    configPayload: {
      key: 'payment.gateway_secret',
      value: 'sk_live_123456789',
      type: 'string',
      scope_type: 'organization',
      scope_id: 'org_main',
      is_secret: true
    },
    identity: ownerUser,
    assignments: ownerAssignments
  });
  assert.strictEqual(writeResult.key, 'payment.gateway_secret');

  // 2. Cashier tries to write organization configuration: Denied (Throws 403)
  assert.throws(() => {
    ConfigurationAccess.write({
      scopeManager: scope,
      configPayload: {
        key: 'payment.gateway_secret',
        value: 'hacked',
        type: 'string',
        scope_type: 'organization',
        scope_id: 'org_main'
      },
      identity: cashierUser,
      assignments: cashierAssignments
    });
  }, (err) => err.code === 'FORBIDDEN' && err.status === 403);

  // 3. Read secret with unprivileged request -> Value is masked
  const maskedRead = ConfigurationAccess.read({
    scopeManager: scope,
    key: 'payment.gateway_secret',
    identity: cashierUser,
    assignments: cashierAssignments,
    target_context: { organization_id: 'org_main' },
    reveal_secrets: true // Cashier requests reveal, but RBAC should keep it masked
  });
  assert.strictEqual(maskedRead.value, '********');

  // 4. Read secret with owner request -> Value is revealed
  const ownerRead = ConfigurationAccess.read({
    scopeManager: scope,
    key: 'payment.gateway_secret',
    identity: ownerUser,
    assignments: ownerAssignments,
    target_context: { organization_id: 'org_main' },
    reveal_secrets: true
  });
  assert.strictEqual(ownerRead.value, 'sk_live_123456789');
});

// ==============================================================================
// C5 — Feature Control Foundation Test (Level: Feature Toggle & Granular Rollout)
// Requirement: platform feature flag toggling and hierarchical evaluation
// ==============================================================================
test('C5 — Feature Control Foundation: granular feature flag toggles per scope', () => {
  const scope = new ConfigurationScope();
  const featureControl = new FeatureControlFoundation(scope);

  // Global flag is disabled by default
  assert.strictEqual(featureControl.isEnabled(FeatureControlFoundation.FLAGS.DYNAMIC_DELIVERY_FEE), false);

  // Enable globally
  featureControl.setFlag(FeatureControlFoundation.FLAGS.DYNAMIC_DELIVERY_FEE, true);
  assert.strictEqual(featureControl.isEnabled(FeatureControlFoundation.FLAGS.DYNAMIC_DELIVERY_FEE), true);

  // Enable experimental feature ONLY for Brand 'brand_pilot'
  featureControl.setFlag(FeatureControlFoundation.FLAGS.KDS_ALERT_AUDIO, true, {
    scope_type: 'brand',
    scope_id: 'brand_pilot'
  });

  // Query for brand_pilot branch: Enabled
  const isPilotEnabled = featureControl.isEnabled(FeatureControlFoundation.FLAGS.KDS_ALERT_AUDIO, {
    brand_id: 'brand_pilot',
    branch_id: 'branch_pilot_01'
  });
  assert.strictEqual(isPilotEnabled, true);

  // Query for standard branch: Disabled
  const isStandardEnabled = featureControl.isEnabled(FeatureControlFoundation.FLAGS.KDS_ALERT_AUDIO, {
    brand_id: 'brand_regular',
    branch_id: 'branch_regular_01'
  });
  assert.strictEqual(isStandardEnabled, false);
});
