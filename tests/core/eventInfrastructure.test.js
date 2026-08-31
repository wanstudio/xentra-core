const test = require('node:test');
const assert = require('node:assert');
const {
  EventContract,
  EventContext,
  EventBus,
  EventPublisher,
  EventSubscriber,
  EventRegistry,
  EventLogger,
  createPublisher,
  createSubscriber,
  createContext
} = require('../../core/events');

test('A1 & A7: EventContract & EventContext initialization and validation', () => {
  const context = new EventContext({
    actor_id: 'usr_owner_01',
    actor_type: 'merchant',
    tenant_id: 'brand_bangjo',
    branch_id: 'branch_surabaya_barat'
  });

  const event = new EventContract({
    type: 'core.reference.ping',
    producer: 'core',
    payload: { message: 'hello world', timestamp: Date.now() },
    context
  });

  assert.ok(event.id);
  assert.strictEqual(event.type, 'core.reference.ping');
  assert.strictEqual(event.producer, 'core');
  assert.strictEqual(event.version, '1.0.0');
  assert.strictEqual(event.context.actor_id, 'usr_owner_01');
  assert.strictEqual(event.context.branch_id, 'branch_surabaya_barat');
  assert.ok(event.context.correlation_id.startsWith('corr_'));
  assert.strictEqual(event.payload.message, 'hello world');

  // Validate method
  const validation = EventContract.validate(event);
  assert.strictEqual(validation.valid, true);
  assert.strictEqual(validation.errors.length, 0);

  // Invalid event validation
  const invalidVal = EventContract.validate({ type: 'test' });
  assert.strictEqual(invalidVal.valid, false);
  assert.ok(invalidVal.errors.length > 0);

  // Serialization & Deserialization
  const json = JSON.stringify(event);
  const rehydrated = EventContract.from(json);
  assert.strictEqual(rehydrated.id, event.id);
  assert.strictEqual(rehydrated.type, event.type);
});

test('A6: EventRegistry registration and lookup', () => {
  EventRegistry.register({
    type: 'reference.test.event',
    version: '1.0.0',
    producer: 'test_domain',
    description: 'Unit test event'
  });

  assert.strictEqual(EventRegistry.isRegistered('reference.test.event', '1.0.0'), true);
  assert.strictEqual(EventRegistry.isRegistered('unknown.event'), false);

  const def = EventRegistry.get('reference.test.event', '1.0.0');
  assert.strictEqual(def.producer, 'test_domain');
  assert.strictEqual(def.description, 'Unit test event');
});

test('A2, A3, A4, A5, A8, A9: End-to-End Reference Event (Publish -> Bus -> Dispatch -> Subscriber)', async () => {
  EventBus.clear();
  EventLogger.clear();

  const publisher = createPublisher('core');
  const subscriber = createSubscriber('reporting');

  let receivedEvent = null;
  let callCount = 0;

  subscriber.on('core.reference.ping', (event) => {
    receivedEvent = event;
    callCount++;
  });

  // Publish reference ping event
  const result = await publisher.emit('core.reference.ping', {
    ping_seq: 1,
    status: 'ok'
  }, {
    actor_id: 'agent_runner',
    tenant_id: 'tenant_demo'
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.delivered, 1);
  assert.strictEqual(result.failed, 0);

  // Verify subscriber received event exactly as contracted
  assert.strictEqual(callCount, 1);
  assert.ok(receivedEvent);
  assert.strictEqual(receivedEvent.type, 'core.reference.ping');
  assert.strictEqual(receivedEvent.producer, 'core');
  assert.strictEqual(receivedEvent.payload.ping_seq, 1);
  assert.strictEqual(receivedEvent.context.actor_id, 'agent_runner');

  // Verify Logger audit trail (A8)
  const logs = EventLogger.getLogs(result.event_id);
  assert.ok(logs.length >= 2); // published + dispatched
  assert.strictEqual(logs[0].stage, 'published');
  assert.strictEqual(logs[1].stage, 'dispatched');
});

test('A5: Error Boundary & Multiple Subscribers Isolation', async () => {
  EventBus.clear();

  const publisher = createPublisher('payment');
  const posSubscriber = createSubscriber('pos');
  const faultySubscriber = createSubscriber('faulty_domain');
  const auditSubscriber = createSubscriber('audit');

  let posProcessed = false;
  let auditProcessed = false;

  posSubscriber.on('payment.settled.test', () => {
    posProcessed = true;
  });

  faultySubscriber.on('payment.settled.test', () => {
    throw new Error('Simulated external service timeout / failure');
  });

  auditSubscriber.on('payment.settled.test', () => {
    auditProcessed = true;
  });

  // Emit event: one handler throws error, but others must still execute safely
  const result = await publisher.emit('payment.settled.test', { amount: 50000 });

  assert.strictEqual(posProcessed, true);
  assert.strictEqual(auditProcessed, true);
  assert.strictEqual(result.delivered, 2);
  assert.strictEqual(result.failed, 1);
  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(result.errors[0].domain, 'faulty_domain');
  assert.ok(result.errors[0].error.includes('Simulated external service timeout'));
});

test('A4 & A7: Causation Chaining & once() subscriber lifecycle', async () => {
  EventBus.clear();

  const publisher = createPublisher('commerce');
  const subscriber = createSubscriber('delivery');

  let triggerCount = 0;
  let childEventReceived = null;

  // Subscribe once
  subscriber.once('commerce.order.placed', async (parentEvent) => {
    triggerCount++;

    // Derive child context preserving correlation_id and setting causation_id
    const childContext = EventContext.deriveChild(parentEvent.context, parentEvent.id);
    const childPublisher = createPublisher('delivery');

    await childPublisher.emit('delivery.route.calculated', {
      distance_km: 3.5
    }, childContext);
  });

  subscriber.on('delivery.route.calculated', (childEvent) => {
    childEventReceived = childEvent;
  });

  // 1st Publish
  const parent1 = await publisher.emit('commerce.order.placed', { order_id: 'ord_123' });
  assert.strictEqual(triggerCount, 1);
  assert.ok(childEventReceived);
  assert.strictEqual(childEventReceived.context.causation_id, parent1.event_id);

  // 2nd Publish: once() should NOT trigger again
  await publisher.emit('commerce.order.placed', { order_id: 'ord_456' });
  assert.strictEqual(triggerCount, 1);
});
