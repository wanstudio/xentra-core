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
// A1 — Event Contract Test (Level: Component/Contract)
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
      tenant_id: 'brand_bangjo'
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
// Requirement: event handoff/routing at the bus boundary without direct domain calling
// ==============================================================================
test('A3 — Event Bus: central asynchronous routing & wildcard delivery', async () => {
  const bus = new (require('../../core/events/EventBus').EventBus)();
  const receivedExact = [];
  const receivedWildcard = [];

  bus.subscribe('inventory.stock.depleted', (event) => {
    receivedExact.push(event);
  });

  bus.subscribe('*', (event) => {
    receivedWildcard.push(event);
  });

  const event = new EventContract({
    type: 'inventory.stock.depleted',
    producer: 'inventory',
    payload: { sku: 'SKU_AYAM_GORENG', remaining: 0 }
  });

  await bus.publish(event);

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
// Requirement: deterministic execution and subscriber failure isolation
// ==============================================================================
test('A5 — Event Dispatcher: failure isolation prevents one error from blocking other subscribers', async () => {
  const dummyEvent = new EventContract({
    type: 'payment.webhook.received',
    producer: 'payment',
    payload: { transaction_status: 'settlement' }
  });

  let healthyExecuted1 = false;
  let healthyExecuted2 = false;

  const subscribers = [
    {
      id: 'sub_1',
      domain: 'pos',
      handler: () => { healthyExecuted1 = true; }
    },
    {
      id: 'sub_faulty',
      domain: 'external_webhook',
      handler: () => { throw new Error('Simulated network timeout in webhook handler'); }
    },
    {
      id: 'sub_2',
      domain: 'reporting',
      handler: () => { healthyExecuted2 = true; }
    }
  ];

  const result = await EventDispatcher.dispatch(dummyEvent, subscribers);

  assert.strictEqual(healthyExecuted1, true, 'Subscriber 1 must execute');
  assert.strictEqual(healthyExecuted2, true, 'Subscriber 2 must execute despite faulty subscriber');
  assert.strictEqual(result.delivered, 2);
  assert.strictEqual(result.failed, 1);
  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(result.errors[0].domain, 'external_webhook');
});

// ==============================================================================
// A6 — Event Registry Test (Level: Catalog & Schema Lookup)
// Requirement: registration, lookup, duplicate/invalid cases
// ==============================================================================
test('A6 — Event Registry: registration, inspection, and invalid schema detection', () => {
  const registry = new (require('../../core/events/EventRegistry').EventRegistry)();

  // Valid Registration
  registry.register({
    type: 'commerce.cart.item_added',
    version: '1.0.0',
    producer: 'commerce',
    description: 'Triggered when a customer adds an item to cart'
  });

  assert.strictEqual(registry.isRegistered('commerce.cart.item_added', '1.0.0'), true);
  assert.strictEqual(registry.isRegistered('commerce.cart.item_added', '2.0.0'), false);
  assert.strictEqual(registry.isRegistered('unregistered.event'), false);

  const def = registry.get('commerce.cart.item_added', '1.0.0');
  assert.strictEqual(def.type, 'commerce.cart.item_added');
  assert.strictEqual(def.producer, 'commerce');

  // Invalid Registration Cases
  assert.throws(() => registry.register({ type: '', producer: 'commerce' }), /"type" must be a non-empty string/);
  assert.throws(() => registry.register({ type: 'test', producer: '' }), /"producer" must be a non-empty string/);
});

// ==============================================================================
// A7 — Event Context & Metadata Test (Level: Tracing & Causality)
// Requirement: identity, correlation/causation propagation, child relationships
// ==============================================================================
test('A7 — Event Context & Metadata: correlation & causation chaining across lineage', () => {
  const rootContext = new EventContext({
    actor_id: 'usr_customer_88',
    actor_type: 'customer',
    tenant_id: 'brand_bangjo',
    branch_id: 'branch_surabaya'
  });

  assert.ok(rootContext.correlation_id.startsWith('corr_'));
  assert.strictEqual(rootContext.causation_id, null);
  assert.strictEqual(rootContext.actor_id, 'usr_customer_88');
  assert.strictEqual(rootContext.tenant_id, 'brand_bangjo');

  const rootEvent = new EventContract({
    type: 'commerce.order.created',
    producer: 'commerce',
    payload: { order_id: 'ord_abc_1' },
    context: rootContext
  });

  // Derive child context (Preserves correlation_id, sets causation_id to parent event ID)
  const childContext = EventContext.deriveChild(rootEvent.context, rootEvent.id, {
    actor_id: 'system_router'
  });

  assert.strictEqual(childContext.correlation_id, rootContext.correlation_id, 'Correlation ID must be preserved');
  assert.strictEqual(childContext.causation_id, rootEvent.id, 'Causation ID must be parent event ID');
  assert.strictEqual(childContext.actor_id, 'system_router', 'Actor ID can be overridden in child context');
  assert.strictEqual(childContext.tenant_id, 'brand_bangjo');
});

// ==============================================================================
// A8 — Event Logging / Audit Foundation Test (Level: Observability)
// Requirement: observable lifecycle/audit records retain event identity & metadata
// ==============================================================================
test('A8 — Event Logging: records lifecycle stages (published, dispatched, error) without business coupling', () => {
  const logger = new (require('../../core/events/EventLogger').EventLogger)();

  const event = new EventContract({
    type: 'core.audit.test',
    producer: 'core',
    payload: { action: 'ping' },
    context: { actor_id: 'auditor', tenant_id: 'tenant_main' }
  });

  logger.log('published', event);
  logger.log('dispatched', event, { subscriber_id: 'sub_xyz', domain: 'pos' });
  logger.log('error', event, { subscriber_id: 'sub_err', domain: 'crm', error: new Error('CRM Down') });

  const logs = logger.getLogs(event.id);
  assert.strictEqual(logs.length, 3);
  assert.strictEqual(logs[0].stage, 'published');
  assert.strictEqual(logs[1].stage, 'dispatched');
  assert.strictEqual(logs[2].stage, 'error');
  assert.strictEqual(logs[0].event_id, event.id);
  assert.strictEqual(logs[0].producer, 'core');
  assert.ok(logs[2].details.error.includes('CRM Down'));
});

// ==============================================================================
// A9 — Unit Test & Reference Event Test (Level: End-to-End Coherence)
// Requirement: input -> EventContract -> EventPublisher -> EventBus -> EventDispatcher -> EventSubscriber -> observable output
// ==============================================================================
test('A9 — Unit Test & Reference Event: full end-to-end coherent pipeline verification', async () => {
  EventBus.clear();
  EventLogger.clear();

  const publisher = createPublisher('core');
  const subscriber = createSubscriber('reporting');

  let pipelineCompleted = false;
  let receivedEvent = null;

  subscriber.on('core.reference.ping', async (event) => {
    receivedEvent = event;
    pipelineCompleted = true;
  });

  const rootContext = createContext({
    actor_id: 'agent_runner_1',
    actor_type: 'system',
    tenant_id: 'org_xentra'
  });

  // Execute full pipeline: Publisher -> Bus -> Dispatcher -> Subscriber
  const publishResult = await publisher.emit('core.reference.ping', {
    ping_token: 'XENTRA_E2E_TOKEN_999',
    timestamp: Date.now()
  }, rootContext);

  // Assertions for end-to-end coherence
  assert.strictEqual(publishResult.success, true);
  assert.strictEqual(publishResult.delivered, 1);
  assert.strictEqual(publishResult.failed, 0);

  assert.strictEqual(pipelineCompleted, true, 'Reference subscriber must have executed');
  assert.ok(receivedEvent, 'Event must reach subscriber intact');
  assert.strictEqual(receivedEvent.type, 'core.reference.ping');
  assert.strictEqual(receivedEvent.producer, 'core');
  assert.strictEqual(receivedEvent.payload.ping_token, 'XENTRA_E2E_TOKEN_999');
  assert.strictEqual(receivedEvent.context.actor_id, 'agent_runner_1');
  assert.strictEqual(receivedEvent.context.tenant_id, 'org_xentra');

  // Verify Audit Log trail captured through entire lifecycle
  const eventLogs = EventLogger.getLogs(publishResult.event_id);
  assert.ok(eventLogs.length >= 2);
  assert.strictEqual(eventLogs[0].stage, 'published');
  assert.strictEqual(eventLogs[1].stage, 'dispatched');
});
