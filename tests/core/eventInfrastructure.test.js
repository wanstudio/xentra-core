'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  EventContract,
  EventContext,
  EventBus,
  EventPublisher,
  EventSubscriber,
  EventDispatcher,
  EventRegistry,
  EventLogger,
  createPublisher,
  createSubscriber,
  createContext
} = require('../../core/events');

// ==============================================================================
// A1 — Event Contract Test (Level: Component / Contract)
// Requirement: input -> validation/transformation -> expected event output
// ==============================================================================
test('A1 — Event Contract: validates schema, immutability, serialization & invalid inputs', () => {
  const rawInput = {
    type: 'core.reference.ping',
    producer: 'core',
    version: '1.0.0',
    payload: { ping: true, counter: 42 },
    context: {
      actor_id: 'usr_test_01',
      actor_type: 'merchant',
      tenant_id: 'brand_bangjo',
      branch_id: 'branch_surabaya'
    }
  };

  const event = new EventContract(rawInput);

  // Assert schema mapping & auto-generation
  assert.ok(event.id, 'Event must have auto-generated unique ID');
  assert.strictEqual(event.type, 'core.reference.ping');
  assert.strictEqual(event.producer, 'core');
  assert.strictEqual(event.version, '1.0.0');
  assert.strictEqual(event.payload.ping, true);
  assert.strictEqual(event.payload.counter, 42);
  assert.ok(event.timestamp, 'Event must have timestamp');
  assert.strictEqual(event.context.actor_id, 'usr_test_01');
  assert.strictEqual(event.context.actor_type, 'merchant');
  assert.strictEqual(event.context.tenant_id, 'brand_bangjo');
  assert.strictEqual(event.context.branch_id, 'branch_surabaya');

  // Assert Immutability
  assert.throws(() => {
    event.type = 'altered.type';
  }, /Cannot assign to read only property/);

  // Validate Contract helper
  const validation = EventContract.validate(event);
  assert.strictEqual(validation.valid, true);
  assert.strictEqual(validation.errors.length, 0);

  // Invalid Contract Cases
  assert.throws(() => new EventContract({ type: '', producer: 'core' }), /Event "type" is required/);
  assert.throws(() => new EventContract({ type: 'test', producer: '' }), /Event "producer" is required/);
  assert.throws(() => new EventContract({ type: 'test', producer: 'core', payload: 'not_an_object' }), /Event "payload" must be a valid object/);

  // Serialization round-trip
  const json = JSON.stringify(event);
  const rehydrated = EventContract.from(json);
  assert.strictEqual(rehydrated.id, event.id);
  assert.strictEqual(rehydrated.type, event.type);
  assert.deepStrictEqual(rehydrated.payload, event.payload);
  assert.deepStrictEqual(rehydrated.context, event.context);
});

// ==============================================================================
// A2 — Event Publisher Test (Level: Domain Publishing API)
// Requirement: publisher input produces a valid contract and invokes bus correctly
// ==============================================================================
test('A2 — Event Publisher: domain-scoped emit creates valid contract and publishes', async () => {
  const customBus = new (require('../../core/events/EventBus').EventBus)();
  const publisher = new EventPublisher('pos', customBus);

  let capturedEvent = null;
  customBus.subscribe('pos.order.created', (event) => {
    capturedEvent = event;
  });

  const result = await publisher.emit('pos.order.created', { order_id: 'ord_pos_100', total: 45000 });

  assert.strictEqual(result.success, true);
  assert.ok(capturedEvent, 'EventBus must receive published event');
  assert.strictEqual(capturedEvent.producer, 'pos', 'Producer must match publisher domain');
  assert.strictEqual(capturedEvent.payload.order_id, 'ord_pos_100');
  assert.strictEqual(capturedEvent.payload.total, 45000);
});

// ==============================================================================
// A3 — Event Bus Test (Level: Channel / Handoff)
// Requirement: proves boundary handoff, uncoupled delivery, and wildcard dispatch
// ==============================================================================
test('A3 — Event Bus: boundary handoff without direct domain coupling & wildcard distribution', async () => {
  const bus = new (require('../../core/events/EventBus').EventBus)();
  const receivedExact = [];
  const receivedWildcard = [];
  let uncoupledInvocation = false;

  // Domain A registers handler to Bus
  bus.subscribe('inventory.stock.depleted', (event) => {
    receivedExact.push(event);
    uncoupledInvocation = true;
  });

  // Domain B registers wildcard monitor
  bus.subscribe('*', (event) => {
    receivedWildcard.push(event);
  });

  const event = new EventContract({
    type: 'inventory.stock.depleted',
    producer: 'inventory',
    payload: { sku: 'SKU_AYAM_GORENG', remaining: 0 }
  });

  // Bus handoff verification: publishing into bus boundary executes registered subscribers
  const publishSummary = await bus.publish(event);

  assert.strictEqual(publishSummary.success, true);
  assert.strictEqual(publishSummary.delivered, 2, 'Must deliver to exact match + wildcard');
  assert.strictEqual(uncoupledInvocation, true, 'Handoff must happen through Bus boundary');
  assert.strictEqual(receivedExact.length, 1);
  assert.strictEqual(receivedExact[0].payload.sku, 'SKU_AYAM_GORENG');
  assert.strictEqual(receivedWildcard.length, 1);
  assert.strictEqual(receivedWildcard[0].id, event.id);
});

// ==============================================================================
// A4 — Subscriber / Listener Test (Level: Lifecycle & Handler Registration)
// Requirement: registration, delivery, once(), unsubscribe lifecycle
// ==============================================================================
test('A4 — Subscriber: lifecycle management (on, once, off, clear)', async () => {
  const bus = new (require('../../core/events/EventBus').EventBus)();
  const subscriber = new EventSubscriber('notification', bus);

  let countOn = 0;
  let countOnce = 0;

  const onSubId = subscriber.on('commerce.order.paid', () => { countOn++; });
  subscriber.once('commerce.order.paid', () => { countOnce++; });

  const dummyEvent = new EventContract({
    type: 'commerce.order.paid',
    producer: 'commerce',
    payload: { order_id: 'ord_99' }
  });

  // 1st Publication
  await bus.publish(dummyEvent);
  assert.strictEqual(countOn, 1);
  assert.strictEqual(countOnce, 1);

  // 2nd Publication: once() should not be invoked again
  await bus.publish(dummyEvent);
  assert.strictEqual(countOn, 2);
  assert.strictEqual(countOnce, 1);

  // Unsubscribe 'on'
  const unsubResult = subscriber.off(onSubId);
  assert.strictEqual(unsubResult, true);

  // 3rd Publication: on handler was removed
  await bus.publish(dummyEvent);
  assert.strictEqual(countOn, 2);
});

// ==============================================================================
// A5 — Event Dispatcher Test (Level: Deterministic Routing & Error Isolation)
// Requirement: proves deterministic order of execution & isolated error boundaries
// ==============================================================================
test('A5 — Event Dispatcher: deterministic execution order & failure isolation', async () => {
  const dummyEvent = new EventContract({
    type: 'payment.webhook.received',
    producer: 'payment',
    payload: { transaction_status: 'settlement' }
  });

  const executionSequence = [];

  const subscribers = [
    {
      id: 'sub_first',
      domain: 'pos',
      handler: () => { executionSequence.push('pos_handler'); }
    },
    {
      id: 'sub_faulty',
      domain: 'external_webhook',
      handler: () => {
        executionSequence.push('faulty_handler');
        throw new Error('Simulated network timeout in webhook handler');
      }
    },
    {
      id: 'sub_last',
      domain: 'reporting',
      handler: () => { executionSequence.push('reporting_handler'); }
    }
  ];

  const result = await EventDispatcher.dispatch(dummyEvent, subscribers);

  // 1. Assert deterministic sequence
  assert.deepStrictEqual(executionSequence, ['pos_handler', 'faulty_handler', 'reporting_handler'], 'Dispatch must execute in deterministic sequential order');

  // 2. Assert error isolation
  assert.strictEqual(result.delivered, 2);
  assert.strictEqual(result.failed, 1);
  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(result.errors[0].domain, 'external_webhook');
  assert.ok(result.errors[0].error.includes('Simulated network timeout'));
});

// ==============================================================================
// A6 — Event Registry Test (Level: Catalog & Schema Lookup)
// Requirement: registration, lookup, duplicate/overwrite behavior & invalid schemas
// ==============================================================================
test('A6 — Event Registry: registration, duplicate overwrite behavior, and invalid schema detection', () => {
  const registry = new (require('../../core/events/EventRegistry').EventRegistry)();

  // Valid Registration
  registry.register({
    type: 'commerce.cart.item_added',
    version: '1.0.0',
    producer: 'commerce',
    description: 'Initial schema description'
  });

  assert.strictEqual(registry.isRegistered('commerce.cart.item_added', '1.0.0'), true);
  assert.strictEqual(registry.isRegistered('commerce.cart.item_added', '2.0.0'), false);
  assert.strictEqual(registry.isRegistered('unregistered.event'), false);

  const initialDef = registry.get('commerce.cart.item_added', '1.0.0');
  assert.strictEqual(initialDef.description, 'Initial schema description');

  // Duplicate / Overwrite Behavior
  registry.register({
    type: 'commerce.cart.item_added',
    version: '1.0.0',
    producer: 'commerce',
    description: 'Updated schema description'
  });

  const updatedDef = registry.get('commerce.cart.item_added', '1.0.0');
  assert.strictEqual(updatedDef.description, 'Updated schema description', 'Duplicate registration should deterministically update definition');

  // Invalid Registration Cases
  assert.throws(() => registry.register({ type: '', producer: 'commerce' }), /"type" must be a non-empty string/);
  assert.throws(() => registry.register({ type: 'test', producer: '' }), /"producer" must be a non-empty string/);
});

// ==============================================================================
// A7 — Event Context & Metadata Test (Level: Tracing & Causality)
// Requirement: identity, correlation/causation propagation, full metadata consistency
// ==============================================================================
test('A7 — Event Context & Metadata: full metadata consistency & causation chaining across lineage', () => {
  const rootContext = new EventContext({
    actor_id: 'usr_customer_88',
    actor_type: 'customer',
    tenant_id: 'brand_bangjo',
    branch_id: 'branch_surabaya'
  });

  // Check full metadata attributes
  assert.ok(rootContext.correlation_id.startsWith('corr_'));
  assert.strictEqual(rootContext.causation_id, null);
  assert.strictEqual(rootContext.actor_id, 'usr_customer_88');
  assert.strictEqual(rootContext.actor_type, 'customer');
  assert.strictEqual(rootContext.tenant_id, 'brand_bangjo');
  assert.strictEqual(rootContext.branch_id, 'branch_surabaya');

  const rootEvent = new EventContract({
    type: 'commerce.order.created',
    producer: 'commerce',
    payload: { order_id: 'ord_abc_1' },
    context: rootContext
  });

  // Derive child context: preserves correlation_id, tenant_id, branch_id; sets causation_id; allows actor override
  const childContext = EventContext.deriveChild(rootEvent.context, rootEvent.id, {
    actor_id: 'system_router',
    actor_type: 'system'
  });

  assert.strictEqual(childContext.correlation_id, rootContext.correlation_id, 'Correlation ID must be preserved');
  assert.strictEqual(childContext.causation_id, rootEvent.id, 'Causation ID must be parent event ID');
  assert.strictEqual(childContext.actor_id, 'system_router');
  assert.strictEqual(childContext.actor_type, 'system');
  assert.strictEqual(childContext.tenant_id, 'brand_bangjo');
  assert.strictEqual(childContext.branch_id, 'branch_surabaya');
});

// ==============================================================================
// A8 — Event Logging / Audit Foundation Test (Level: Observability)
// Requirement: observable lifecycle/audit records retain event identity, correlation, & details
// ==============================================================================
test('A8 — Event Logging: records lifecycle stages and retains full tracing metadata', () => {
  const logger = new (require('../../core/events/EventLogger').EventLogger)();

  const context = new EventContext({
    correlation_id: 'corr_test_tracing_123',
    actor_id: 'auditor_service',
    tenant_id: 'tenant_audit_demo'
  });

  const event = new EventContract({
    type: 'core.audit.test',
    producer: 'core',
    payload: { action: 'ping' },
    context
  });

  logger.log('published', event);
  logger.log('dispatched', event, { subscriber_id: 'sub_xyz', domain: 'pos' });
  logger.log('error', event, { subscriber_id: 'sub_err', domain: 'crm', error: new Error('CRM Down') });

  const logs = logger.getLogs(event.id);
  assert.strictEqual(logs.length, 3);
  assert.strictEqual(logs[0].stage, 'published');
  assert.strictEqual(logs[1].stage, 'dispatched');
  assert.strictEqual(logs[2].stage, 'error');

  // Verify tracing coherence in audit logs
  assert.strictEqual(logs[0].event_id, event.id);
  assert.strictEqual(logs[0].event_type, 'core.audit.test');
  assert.strictEqual(logs[0].producer, 'core');
  assert.strictEqual(logs[0].correlation_id, 'corr_test_tracing_123');
  assert.ok(logs[2].details.error.includes('CRM Down'));
});

// ==============================================================================
// A9 — Unit Test & Reference Event Test (Level: End-to-End Coherence Policy)
// Requirement: input -> EventRegistry -> EventContract -> EventPublisher -> EventBus -> EventDispatcher -> EventSubscriber -> observable output
// ==============================================================================
test('A9 — Unit Test & Reference Event: full end-to-end coherent pipeline verification with registry and tracing audit', async () => {
  EventBus.clear();
  EventLogger.clear();

  // 1. Verify Event Schema is officially registered in EventRegistry
  assert.strictEqual(EventRegistry.isRegistered('core.reference.ping', '1.0.0'), true, 'Reference event must be registered in EventRegistry');
  const eventDef = EventRegistry.get('core.reference.ping', '1.0.0');
  assert.strictEqual(eventDef.producer, 'core');

  // 2. Setup domain subscriber
  const subscriber = createSubscriber('reporting');
  let pipelineCompleted = false;
  let receivedEvent = null;

  subscriber.on('core.reference.ping', async (event) => {
    receivedEvent = event;
    pipelineCompleted = true;
  });

  // 3. Prepare structured input & context metadata
  const rootContext = createContext({
    actor_id: 'agent_runner_1',
    actor_type: 'system',
    tenant_id: 'org_xentra',
    branch_id: 'branch_pusat'
  });

  const rawPayload = {
    sequence_number: 101,
    status: 'operational',
    timestamp: Date.now()
  };

  // 4. Create Contract & Publisher
  const publisher = createPublisher('core');

  // 5. Execute full pipeline: Publisher -> Bus -> Dispatcher -> Subscriber
  const publishResult = await publisher.emit('core.reference.ping', rawPayload, rootContext);

  // 6. Assertions for end-to-end coherence & observable output
  assert.strictEqual(publishResult.success, true);
  assert.strictEqual(publishResult.delivered, 1);
  assert.strictEqual(publishResult.failed, 0);

  assert.strictEqual(pipelineCompleted, true, 'Reference subscriber must have executed');
  assert.ok(receivedEvent, 'Event must reach subscriber intact');
  assert.strictEqual(receivedEvent.type, 'core.reference.ping');
  assert.strictEqual(receivedEvent.version, '1.0.0');
  assert.strictEqual(receivedEvent.producer, 'core');
  assert.strictEqual(receivedEvent.payload.sequence_number, 101);
  assert.strictEqual(receivedEvent.payload.status, 'operational');

  // 7. Verify full Context & Tracing metadata coherence across pipeline
  assert.strictEqual(receivedEvent.context.actor_id, 'agent_runner_1');
  assert.strictEqual(receivedEvent.context.actor_type, 'system');
  assert.strictEqual(receivedEvent.context.tenant_id, 'org_xentra');
  assert.strictEqual(receivedEvent.context.branch_id, 'branch_pusat');
  assert.strictEqual(receivedEvent.context.correlation_id, rootContext.correlation_id);

  // 8. Verify Audit Logging captures exact lifecycle stages with correlation ID
  const eventLogs = EventLogger.getLogs(publishResult.event_id);
  assert.ok(eventLogs.length >= 2, 'Audit logs must capture published and dispatched stages');
  assert.strictEqual(eventLogs[0].stage, 'published');
  assert.strictEqual(eventLogs[1].stage, 'dispatched');
  assert.strictEqual(eventLogs[0].correlation_id, rootContext.correlation_id);
  assert.strictEqual(eventLogs[1].correlation_id, rootContext.correlation_id);
});
