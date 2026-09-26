/* XENTRA POS — durable browser operational store (offline foundation) */
(function (window) {
  'use strict';

  var DB_NAME = 'xentra_pos_operational_v1';
  var DB_VERSION = 1;
  var STORES = {
    OPERATIONS: 'operations',
    EFFECTS: 'effects',
    SNAPSHOTS: 'snapshots',
    META: 'meta'
  };
  var SYNC_STATES = {
    LOCAL_ONLY: 'LOCAL_ONLY',
    PENDING_SYNC: 'PENDING_SYNC',
    SYNCING: 'SYNCING',
    SYNCED: 'SYNCED',
    CONFLICT: 'CONFLICT',
    FAILED: 'FAILED',
    MANAGER_REVIEW: 'MANAGER_REVIEW'
  };
  var dbPromise = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function generateId(prefix) {
    var cryptoObj = window.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
      return (prefix ? prefix + '_' : '') + cryptoObj.randomUUID();
    }
    var rand = Math.random().toString(36).slice(2);
    return (prefix ? prefix + '_' : '') + Date.now().toString(36) + '_' + rand;
  }

  function assertScope(scope) {
    scope = scope || {};
    if (!scope.branch_id) throw new Error('[PosOfflineStore] branch_id is required.');
    if (!scope.terminal_id) throw new Error('[PosOfflineStore] terminal_id is required.');
    return scope;
  }

  function requestPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB request failed.')); };
    });
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    if (!window.indexedDB) {
      return Promise.reject(new Error('OFFLINE_STORAGE_UNSUPPORTED'));
    }

    dbPromise = new Promise(function (resolve, reject) {
      var request;
      try {
        request = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }

      request.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(STORES.OPERATIONS)) {
          var operations = db.createObjectStore(STORES.OPERATIONS, { keyPath: 'operation_id' });
          operations.createIndex('branch_terminal', ['branch_id', 'terminal_id'], { unique: false });
          operations.createIndex('sync_state', 'sync_state', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.EFFECTS)) {
          var effects = db.createObjectStore(STORES.EFFECTS, { keyPath: 'effect_id' });
          effects.createIndex('operation_id', 'operation_id', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.SNAPSHOTS)) {
          var snapshots = db.createObjectStore(STORES.SNAPSHOTS, { keyPath: 'snapshot_id' });
          snapshots.createIndex('branch_terminal_kind', ['branch_id', 'terminal_id', 'kind'], { unique: true });
        }
        if (!db.objectStoreNames.contains(STORES.META)) {
          db.createObjectStore(STORES.META, { keyPath: 'key' });
        }
      };

      request.onsuccess = function () {
        var db = request.result;
        db.onversionchange = function () {
          db.close();
        };
        resolve(db);
      };
      request.onerror = function () {
        dbPromise = null;
        reject(request.error || new Error('IndexedDB open failed.'));
      };
      request.onblocked = function () {
        // A later app build can recover the connection after the previous tab closes.
      };
    });

    return dbPromise;
  }

  function transactionPromise(storeNames, mode, worker) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        var result;
        try {
          tx = db.transaction(storeNames, mode);
        } catch (err) {
          reject(err);
          return;
        }

        tx.oncomplete = function () {
          resolve(result);
        };
        tx.onerror = function () {
          reject(tx.error || new Error('IndexedDB transaction failed.'));
        };
        tx.onabort = function () {
          reject(tx.error || new Error('IndexedDB transaction aborted.'));
        };

        try {
          result = worker(tx);
        } catch (err) {
          try { tx.abort(); } catch (_) {}
          reject(err);
        }
      });
    });
  }

  function getOperationInternal(store, operationId) {
    return requestPromise(store.get(operationId));
  }

  function scopeMatches(record, scope) {
    return record &&
      String(record.branch_id) === String(scope.branch_id) &&
      String(record.terminal_id) === String(scope.terminal_id);
  }

  function buildSaleOperation(input) {
    input = input || {};
    assertScope(input);

    if (!input.shift_id) throw new Error('[PosOfflineStore] shift_id is required.');
    if (input.payment_method && input.payment_method !== 'cash') {
      throw new Error('OFFLINE_PAYMENT_METHOD_UNSUPPORTED');
    }
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new Error('OFFLINE_SALE_REQUIRES_ITEMS');
    }

    var operationId = String(input.client_transaction_id || generateId('pos'));
    var createdAt = input.offline_created_at || nowIso();
    var payload = {
      terminal_id: String(input.terminal_id),
      branch_id: String(input.branch_id),
      shift_id: String(input.shift_id),
      order_type: input.order_type || 'dine_in',
      payment_method: 'cash',
      amount_tendered: input.amount_tendered == null ? null : Number(input.amount_tendered),
      customer: input.customer || {},
      items: input.items,
      client_transaction_id: operationId,
      config_version: input.config_version || 1,
      offline_created_at: createdAt
    };

    return {
      schema_version: 1,
      operation_id: operationId,
      client_transaction_id: operationId,
      operation_type: 'sale',
      branch_id: String(input.branch_id),
      terminal_id: String(input.terminal_id),
      shift_id: String(input.shift_id),
      cashier_id: input.cashier_id == null ? null : String(input.cashier_id),
      order_type: payload.order_type,
      payment_method: 'cash',

      // Operational lifecycle is deliberately separate from synchronization.
      operational_state: 'LOCAL_RECORDED',
      sync_state: SYNC_STATES.PENDING_SYNC,

      created_at: createdAt,
      updated_at: createdAt,
      sync_attempts: 0,
      last_sync_attempt_at: null,
      synced_at: null,
      server_order_id: null,
      conflict_id: null,
      last_error: null,
      recovery_reason: null,

      payload: payload
    };
  }

  function createEffectRecords(operation) {
    return operation.payload.items.map(function (item, index) {
      var qty = Number(item.quantity || 0);
      return {
        effect_id: operation.operation_id + ':inventory:' + index,
        operation_id: operation.operation_id,
        branch_id: operation.branch_id,
        terminal_id: operation.terminal_id,
        effect_type: 'inventory_delta_intent',
        effect_state: 'RECORDED_NOT_APPLIED',
        product_id: item.product_id,
        quantity_delta: qty > 0 ? -qty : 0,
        recorded_at: operation.created_at,
        base_snapshot_revision: null
      };
    });
  }

  function initialize() {
    return openDb().then(function () {
      return transactionPromise([STORES.META], 'readwrite', function (tx) {
        var store = tx.objectStore(STORES.META);
        store.put({
          key: 'schema',
          value: 'pos-operational-v1',
          updated_at: nowIso()
        });
      });
    });
  }

  function recover(scope) {
    assertScope(scope);
    return transactionPromise([STORES.OPERATIONS], 'readwrite', function (tx) {
      var store = tx.objectStore(STORES.OPERATIONS);
      var output = [];

      store.getAll().onsuccess = function (event) {
        var rows = event.target.result || [];
        rows.forEach(function (row) {
          if (!scopeMatches(row, scope)) return;

          // Crash/reload safety:
          // SYNCING means a send may have happened immediately before the process died.
          // Requeue safely because the same operation_id/client_transaction_id makes server replay idempotent.
          if (row.sync_state === SYNC_STATES.SYNCING) {
            row.sync_state = SYNC_STATES.PENDING_SYNC;
            row.recovery_reason = 'PROCESS_RESTART_DURING_SYNC';
            row.updated_at = nowIso();
            store.put(row);
          }

          output.push(row.sync_state === SYNC_STATES.SYNCING
            ? Object.assign({}, row, { sync_state: SYNC_STATES.PENDING_SYNC })
            : row);
        });
      };
      return output;
    });
  }

  function createOfflineSale(input) {
    var operation = buildSaleOperation(input);
    var effects = createEffectRecords(operation);

    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORES.OPERATIONS, STORES.EFFECTS], 'readwrite');
        var operationStore = tx.objectStore(STORES.OPERATIONS);
        var effectStore = tx.objectStore(STORES.EFFECTS);
        var resolvedOperation = operation;

        tx.oncomplete = function () { resolve(resolvedOperation); };
        tx.onerror = function () { reject(tx.error || new Error('IndexedDB transaction failed.')); };
        tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction aborted.')); };

        var getReq = operationStore.get(operation.operation_id);
        getReq.onsuccess = function (event) {
          var existing = event.target.result;
          if (existing) {
            resolvedOperation = existing;
            return;
          }
          operationStore.put(operation);
          effects.forEach(function (effect) {
            effectStore.put(effect);
          });
        };
        getReq.onerror = function () {
          try { tx.abort(); } catch (_) {}
        };
      });
    });
  }

  function listPending(scope) {
    assertScope(scope);
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORES.OPERATIONS], 'readonly');
        var store = tx.objectStore(STORES.OPERATIONS);
        var output = [];

        tx.onerror = function () { reject(tx.error || new Error('IndexedDB read failed.')); };
        tx.oncomplete = function () {
          output.sort(function (a, b) {
            return String(a.created_at).localeCompare(String(b.created_at));
          });
          resolve(output);
        };

        store.getAll().onsuccess = function (event) {
          (event.target.result || []).forEach(function (row) {
            if (!scopeMatches(row, scope)) return;
            if ([SYNC_STATES.PENDING_SYNC, SYNC_STATES.SYNCING].indexOf(row.sync_state) === -1) return;
            output.push(row);
          });
        };
      });
    });
  }

  function updateOperation(operationId, updater) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORES.OPERATIONS], 'readwrite');
        var store = tx.objectStore(STORES.OPERATIONS);
        tx.oncomplete = function () { resolve(operationId); };
        tx.onerror = function () { reject(tx.error || new Error('IndexedDB transaction failed.')); };
        tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction aborted.')); };

        var getReq = store.get(operationId);
        getReq.onsuccess = function (event) {
          var row = event.target.result;
          if (!row) {
            try { tx.abort(); } catch (_) {}
            return;
          }
          try {
            var updated = updater(Object.assign({}, row));
            updated.updated_at = nowIso();
            store.put(updated);
          } catch (err) {
            try { tx.abort(); } catch (_) {}
          }
        };
        getReq.onerror = function () {
          try { tx.abort(); } catch (_) {}
        };
      });
    });
  }

  function markSyncing(operationId) {
    return updateOperation(operationId, function (row) {
      if (row.sync_state === SYNC_STATES.SYNCED) return row;
      row.sync_state = SYNC_STATES.SYNCING;
      row.sync_attempts = Number(row.sync_attempts || 0) + 1;
      row.last_sync_attempt_at = nowIso();
      row.last_error = null;
      row.recovery_reason = null;
      return row;
    });
  }

  function markSynced(operationId, info) {
    info = info || {};
    return updateOperation(operationId, function (row) {
      row.sync_state = SYNC_STATES.SYNCED;
      row.synced_at = info.synced_at || nowIso();
      row.server_order_id = info.server_order_id || null;
      row.conflict_id = null;
      row.last_error = null;
      return row;
    });
  }

  function markConflict(operationId, info) {
    info = info || {};
    return updateOperation(operationId, function (row) {
      row.sync_state = SYNC_STATES.CONFLICT;
      row.conflict_id = info.conflict_id || null;
      row.last_error = info.message || 'Offline operation membutuhkan rekonsiliasi.';
      return row;
    });
  }

  function markFailed(operationId, info) {
    info = info || {};
    return updateOperation(operationId, function (row) {
      row.sync_state = SYNC_STATES.FAILED;
      row.last_error = info.message || 'Sinkronisasi gagal.';
      return row;
    });
  }

  function requeue(operationId, reason) {
    return updateOperation(operationId, function (row) {
      row.sync_state = SYNC_STATES.PENDING_SYNC;
      row.last_error = reason || null;
      return row;
    });
  }

  function getOperation(operationId) {
    return openDb().then(function (db) {
      var tx = db.transaction([STORES.OPERATIONS], 'readonly');
      return requestPromise(tx.objectStore(STORES.OPERATIONS).get(operationId));
    });
  }

  function saveSnapshot(scope, kind, snapshot, revision) {
    assertScope(scope);
    if (!kind) throw new Error('[PosOfflineStore] snapshot kind is required.');
    var snapshotId = String(scope.branch_id) + '|' + String(scope.terminal_id) + '|' + String(kind);
    return transactionPromise([STORES.SNAPSHOTS], 'readwrite', function (tx) {
      tx.objectStore(STORES.SNAPSHOTS).put({
        snapshot_id: snapshotId,
        branch_id: String(scope.branch_id),
        terminal_id: String(scope.terminal_id),
        kind: kind,
        revision: revision || null,
        saved_at: nowIso(),
        data: snapshot
      });
      return snapshotId;
    });
  }

  function getSnapshot(scope, kind) {
    assertScope(scope);
    var snapshotId = String(scope.branch_id) + '|' + String(scope.terminal_id) + '|' + String(kind);
    return openDb().then(function (db) {
      var tx = db.transaction([STORES.SNAPSHOTS], 'readonly');
      return requestPromise(tx.objectStore(STORES.SNAPSHOTS).get(snapshotId));
    });
  }

  function getStats(scope) {
    assertScope(scope);
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORES.OPERATIONS], 'readonly');
        var output = {
          total: 0,
          pending_sync: 0,
          syncing: 0,
          synced: 0,
          conflict: 0,
          failed: 0,
          manager_review: 0
        };

        tx.onerror = function () { reject(tx.error || new Error('IndexedDB stats failed.')); };
        tx.oncomplete = function () { resolve(output); };
        tx.objectStore(STORES.OPERATIONS).getAll().onsuccess = function (event) {
          (event.target.result || []).forEach(function (row) {
            if (!scopeMatches(row, scope)) return;
            output.total += 1;
            if (row.sync_state === SYNC_STATES.PENDING_SYNC) output.pending_sync += 1;
            if (row.sync_state === SYNC_STATES.SYNCING) output.syncing += 1;
            if (row.sync_state === SYNC_STATES.SYNCED) output.synced += 1;
            if (row.sync_state === SYNC_STATES.CONFLICT) output.conflict += 1;
            if (row.sync_state === SYNC_STATES.FAILED) output.failed += 1;
            if (row.sync_state === SYNC_STATES.MANAGER_REVIEW) output.manager_review += 1;
          });
        };
      });
    });
  }

  window.XentraPos = window.XentraPos || {};
  window.XentraPos.PosOfflineStore = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    SYNC_STATES: SYNC_STATES,
    isSupported: function () { return !!window.indexedDB; },
    initialize: initialize,
    recover: recover,
    createOfflineSale: createOfflineSale,
    listPending: listPending,
    markSyncing: markSyncing,
    markSynced: markSynced,
    markConflict: markConflict,
    markFailed: markFailed,
    requeue: requeue,
    getOperation: getOperation,
    saveSnapshot: saveSnapshot,
    getSnapshot: getSnapshot,
    getStats: getStats
  };
})(window);
