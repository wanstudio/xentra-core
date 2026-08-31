'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  ConfigurationModel,
  ConfigurationScope,
  ConfigurationValidator,
  ConfigurationAccess,
  FeatureControlFoundation
} = require('../../core/config');
const { IdentityModel } = require('../../core/identity');

// ==============================================================================
// C1 — Configuration Model Test (Level: Model & Source Boundary)
// Requirement: key, value, type, scope, source (dashboard/env/default), and secret representation
// ==============================================================================
test('C1 — Configuration Model: data structure, type casting, source boundary, and secret masking', () => {
  // String config with source: dashboard
  const cfgString = new ConfigurationModel({
    key: 'app.title',
    value: 'Bangjo Digital',
    type: 'string',
    source: 'dashboard'
  });
  assert.strictEqual(cfgString.value, 'Bangjo Digital');
  assert.strictEqual(cfgString.source, 'dashboard');

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

  // Secret masking with source: environment
  const cfgSecret = new ConfigurationModel({
    key: 'api.secret_key',
    value: 'super_secret_payload_123',
    type: 'string',
    source: 'environment',
    is_secret: true
  });
  assert.strictEqual(cfgSecret.source, 'environment');
  assert.strictEqual(cfgSecret.toSafeJSON(false).value, '********');
  assert.strictEqual(cfgSecret.toSafeJSON(true).value, 'super_secret_payload_123');

  // Validation of invalid scopes, types & sources
  assert.throws(() => new ConfigurationModel({ key: '', value: 'test' }), /"key" is required/);
  assert.throws(() => new ConfigurationModel({ key: 'test', value: 'v', type: 'unsupported_type' }), /Invalid type/);
  assert.throws(() => new ConfigurationModel({ key: 'test', value: 'v', source: 'invalid_source' }), /Invalid source/);
});

// ==============================================================================
// C2 — Configuration Scope Test (Level: Scope Hierarchy & Negative Fallback Check)
// Requirement: Branch WhatsApp mandatory; no Owner fallback; flexible warehouse topology (1->1, 1->N, N->N)
// ==============================================================================
test('C2 — Configuration Scope: Branch WhatsApp isolation, no Owner fallback & flexible warehouse topology', () => {
  const scope = new ConfigurationScope();

  // 1. Branch WhatsApp Configuration
  scope.set({
    key: 'branch.whatsapp_number',
    value: '6281111111111',
    type: 'string',
    scope_type: 'branch',
    scope_id: 'branch_surabaya',
    source: 'dashboard'
  });

  scope.set({
    key: 'branch.whatsapp_number',
    value: '6282222222222',
    type: 'string',
    scope_type: 'branch',
    scope_id: 'branch_jakarta',
    source: 'dashboard'
  });

  // Verify two branches resolve distinct WhatsApp numbers without fallback
  assert.strictEqual(scope.getValue('branch.whatsapp_number', { branch_id: 'branch_surabaya' }), '6281111111111');
  assert.strictEqual(scope.getValue('branch.whatsapp_number', { branch_id: 'branch_jakarta' }), '6282222222222');
  assert.strictEqual(scope.getValue('branch.whatsapp_number', { branch_id: 'branch_unconfigured' }), null, 'Must NOT fallback to Owner WhatsApp');

  // 2. Flexible Warehouse / Location Topology (1->1, 1->N, N->N)
  // 1 Branch -> 1 Warehouse
  scope.set({
    key: 'branch.assigned_warehouses',
    value: ['wh_surabaya_main'],
    type: 'json',
    scope_type: 'branch',
    scope_id: 'branch_surabaya'
  });
  // 1 Branch -> Multiple Warehouses (1->N)
  scope.set({
    key: 'branch.assigned_warehouses',
    value: ['wh_jakarta_central', 'wh_jakarta_hub_south'],
    type: 'json',
    scope_type: 'branch',
    scope_id: 'branch_jakarta'
  });

  const whSurabaya = scope.getValue('branch.assigned_warehouses', { branch_id: 'branch_surabaya' });
  const whJakarta = scope.getValue('branch.assigned_warehouses', { branch_id: 'branch_jakarta' });

  assert.deepStrictEqual(whSurabaya, ['wh_surabaya_main']);
  assert.deepStrictEqual(whJakarta, ['wh_jakarta_central', 'wh_jakarta_hub_south']);
});

// ==============================================================================
// C3 — Validation & Defaults Test (Level: Required Validation & Environment Secrets)
// Requirement: type/format validation, mandatory rejection, secure secret extraction without hardcoded fallback
// ==============================================================================
test('C3 — Validation & Defaults: mandatory Branch WhatsApp and secure environment secret enforcement', () => {
  const scope = new ConfigurationScope();

  // Validations
  assert.strictEqual(ConfigurationValidator.validate('delivery.max_radius_km', 15, 'number').valid, true);
  assert.strictEqual(ConfigurationValidator.validate('delivery.max_radius_km', -5, 'number').valid, false);
  assert.strictEqual(ConfigurationValidator.validate('branch.whatsapp_number', '62812345', 'string').valid, true);
  assert.strictEqual(ConfigurationValidator.validate('branch.whatsapp_number', '', 'string').valid, false, 'Empty branch WhatsApp must be rejected');

  // Apply Defaults (Platform defaults only, no operational fallback)
  ConfigurationValidator.applyDefaults(scope);
  assert.strictEqual(scope.getValue('platform.default_currency'), 'IDR');
  assert.strictEqual(scope.getValue('branch.whatsapp_number'), null, 'No default allowed for branch WhatsApp');

  // Environment Secret Validation (Negative test: missing secret throws explicit error)
  const savedKey = process.env.TEST_INFRA_SECRET;
  delete process.env.TEST_INFRA_SECRET;

  assert.throws(() => {
    ConfigurationValidator.requireSecureEnvSecret('TEST_INFRA_SECRET');
  }, /Missing required infrastructure secret "TEST_INFRA_SECRET". No hardcoded fallback allowed/);

  // Configured secret succeeds
  process.env.TEST_INFRA_SECRET = 'wablas_sec_live_999';
  const resolvedSecret = ConfigurationValidator.requireSecureEnvSecret('TEST_INFRA_SECRET');
  assert.strictEqual(resolvedSecret, 'wablas_sec_live_999');

  // Restore env
  if (savedKey) process.env.TEST_INFRA_SECRET = savedKey;
  else delete process.env.TEST_INFRA_SECRET;
});

// ==============================================================================
// C4 — Configuration Access Test (Level: Mutation Boundary & Authorization Integration)
// Requirement: mutation allowed only within actor authority scope (Branch manager cannot modify platform scope)
// ==============================================================================
test('C4 — Configuration Access: RBAC-aware mutation boundaries and secret masking', () => {
  const scope = new ConfigurationScope();

  const ownerUser = new IdentityModel({ username: 'owner_user', status: 'active' });
  const branchMgrUser = new IdentityModel({ username: 'branch_mgr_user', status: 'active' });

  const ownerAssignments = [{ user_id: ownerUser.id, role: 'owner', scope_type: 'global' }];
  const branchMgrAssignments = [{ user_id: branchMgrUser.id, role: 'branch_manager', scope_type: 'branch', scope_id: 'branch_surabaya' }];

  // 1. Branch Manager updates Branch Configuration: Allowed
  const branchUpdate = ConfigurationAccess.write({
    scopeManager: scope,
    configPayload: {
      key: 'branch.pickup_instructions',
      value: 'Ambil di kasir samping',
      type: 'string',
      scope_type: 'branch',
      scope_id: 'branch_surabaya'
    },
    identity: branchMgrUser,
    assignments: branchMgrAssignments
  });
  assert.strictEqual(branchUpdate.key, 'branch.pickup_instructions');

  // 2. Branch Manager attempts to update Global / Platform Configuration: Denied (Throws 403)
  assert.throws(() => {
    ConfigurationAccess.write({
      scopeManager: scope,
      configPayload: {
        key: 'platform.maintenance_mode',
        value: true,
        type: 'boolean',
        scope_type: 'system',
        scope_id: null
      },
      identity: branchMgrUser,
      assignments: branchMgrAssignments
    });
  }, (err) => err.code === 'FORBIDDEN' && err.status === 403);

  // 3. Secret Read Masking (Unprivileged user reads masked value)
  scope.set({
    key: 'wablas.infrastructure_token',
    value: 'secret_wablas_prod_token',
    type: 'string',
    scope_type: 'system',
    is_secret: true
  });

  const maskedRead = ConfigurationAccess.read({
    scopeManager: scope,
    key: 'wablas.infrastructure_token',
    identity: branchMgrUser,
    assignments: branchMgrAssignments,
    reveal_secrets: true // Branch manager asks reveal, but lacks org:manage
  });
  assert.strictEqual(maskedRead.value, '********');

  // 4. Secret Read Revealed for Owner
  const ownerRead = ConfigurationAccess.read({
    scopeManager: scope,
    key: 'wablas.infrastructure_token',
    identity: ownerUser,
    assignments: ownerAssignments,
    reveal_secrets: true
  });
  assert.strictEqual(ownerRead.value, 'secret_wablas_prod_token');
});

// ==============================================================================
// C5 — Feature Control Foundation Test (Level: Feature Toggle & No Business Logic Leakage)
// Requirement: toggles platform features per scope without executing business workflows
// ==============================================================================
test('C5 — Feature Control Foundation: granular feature flag toggles per scope without business logic leakage', () => {
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
