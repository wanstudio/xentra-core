const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const storePath = path.join(ROOT, 'apps/pos-app/assets/js/PosOfflineStore.js');
const storeSource = fs.readFileSync(storePath, 'utf8');
const posSource = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/js/pos-app.js'), 'utf8');
const posHtml = fs.readFileSync(path.join(ROOT, 'apps/pos-app/index.html'), 'utf8');

function makeFakeIndexedDB() {
  const databases = {};

  function clone(v) {
    return v == null ? v : JSON.parse(JSON.stringify(v));
  }

  function open(name, version) {
    const req = {
      result: null,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      onblocked: null
    };

    queueMicrotask(() => {
      let db = databases[name];
      const first = !db;
      if (!db) {
        db = { name, version, stores: {}, storeNames: [] };
        databases[name] = db;
      }
      req.result = makeDb(db);
      if (first && req.onupgradeneeded) {
        req.onupgradeneeded({ target: { result: req.result } });
      }
      if (req.onsuccess) req.onsuccess({ target: req });
    });

    return req;
  }

  function makeDb(db) {
    return {
      objectStoreNames: {
        contains: name => db.storeNames.includes(name)
      },
      createObjectStore: (name, options) => {
        if (!db.stores[name]) {
          db.stores[name] = { keyPath: options.keyPath, rows: {} };
          db.storeNames.push(name);
        }
        return { createIndex() {} };
      },
      transaction: (names, mode) => {
        let finished = false;
        let pending = 0;
        let completionScheduled = false;
        const tx = {
          error: null,
          oncomplete: null,
          onerror: null,
          onabort: null,
          abort() {
            if (finished) return;
            finished = true;
            queueMicrotask(() => tx.onabort && tx.onabort());
          },
          objectStore(name) {
            const backing = db.stores[name];
            if (!backing) throw new Error('STORE_NOT_FOUND:' + name);

            function schedule(value) {
              pending += 1;
              const req = {
                result: undefined,
                error: null,
                onsuccess: null,
                onerror: null
              };
              queueMicrotask(() => {
                req.result = clone(value);
                pending -= 1;
                if (req.onsuccess) req.onsuccess({ target: req });
                scheduleComplete();
              });
              return req;
            }

            return {
              put(value) {
                backing.rows[value[backing.keyPath]] = clone(value);
                return schedule(value);
              },
              get(key) {
                return schedule(backing.rows[key] || undefined);
              },
              getAll() {
                return schedule(Object.values(backing.rows));
              }
            };
          }
        };

        function scheduleComplete() {
          if (completionScheduled || finished) return;
          completionScheduled = true;
          queueMicrotask(() => {
            completionScheduled = false;
            if (finished || pending !== 0) return;
            finished = true;
            if (tx.oncomplete) tx.oncomplete();
          });
        }

        scheduleComplete();
        return tx;
      },
      close() {}
    };
  }

  return { open };
}

function loadStoreIntoContext() {
  const context = {
    window: { crypto: { randomUUID: () => 'uuid-test-1' }, indexedDB: makeFakeIndexedDB() },
    Promise,
    JSON,
    Date,
    Math,
    String,
    Number,
    Object,
    Error,
    queueMicrotask
  };
  vm.runInNewContext(storeSource, context, { filename: storePath });
  return context.window.XentraPos.PosOfflineStore;
}

test('POS HTML loads the durable browser operational store before pos-app', () => {
  const storeIndex = posHtml.indexOf('<script src="/pos/assets/js/PosOfflineStore.js');
  const appIndex = posHtml.indexOf('<script src="/pos/assets/js/pos-app.js');
  assert.ok(storeIndex >= 0);
  assert.ok(appIndex > storeIndex);
});

test('POS app uses durable offline store for true offline save path', () => {
  assert.ok(posSource.includes('PosOfflineStore'));
  assert.ok(posSource.includes('createOfflineSale'));
  assert.ok(!posSource.includes("await request('/pos/local/sale',{method:'POST',headers:headers(),body:JSON.stringify({terminal_id:state.terminalId"));
});

test('durable store records sale and recovers an interrupted SYNCING operation', async () => {
  const store = loadStoreIntoContext();
  await store.initialize();

  const operation = await store.createOfflineSale({
    branch_id: 'branch-test',
    terminal_id: 'terminal-test',
    shift_id: 'shift-test',
    cashier_id: 'cashier-test',
    order_type: 'dine_in',
    payment_method: 'cash',
    amount_tendered: 50000,
    customer: { name: 'Offline Customer', table_number: '05' },
    items: [
      { product_id: 'p1', quantity: 2, unit_price: 10000, name: 'Nasi' }
    ],
    client_transaction_id: 'pos_offline_test_001',
    offline_created_at: '2026-09-26T14:00:00.000Z'
  });

  assert.strictEqual(operation.sync_state, 'PENDING_SYNC');
  assert.strictEqual(operation.operational_state, 'LOCAL_RECORDED');

  await store.markSyncing(operation.operation_id);
  const beforeRecovery = await store.getOperation(operation.operation_id);
  assert.strictEqual(beforeRecovery.sync_state, 'SYNCING');

  const recovered = await store.recover({
    branch_id: 'branch-test',
    terminal_id: 'terminal-test'
  });
  assert.ok(Array.isArray(recovered));

  const afterRecovery = await store.getOperation(operation.operation_id);
  assert.strictEqual(afterRecovery.sync_state, 'PENDING_SYNC');
  assert.strictEqual(afterRecovery.recovery_reason, 'PROCESS_RESTART_DURING_SYNC');

  const pending = await store.listPending({
    branch_id: 'branch-test',
    terminal_id: 'terminal-test'
  });
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].client_transaction_id, 'pos_offline_test_001');

  const stats = await store.getStats({
    branch_id: 'branch-test',
    terminal_id: 'terminal-test'
  });
  assert.strictEqual(stats.pending_sync, 1);
});
