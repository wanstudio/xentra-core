/* XENTRA POS — Transaction Composer state boundary */
(function (global) {
  'use strict';

  var MODES = Object.freeze({
    NEW: 'new',
    EXISTING: 'existing',
    ADDITION: 'addition'
  });

  var LOCKED_ORDER_STATUSES = Object.freeze(['confirmed', 'preparing', 'ready']);

  function cloneItem(item) {
    if (!item || typeof item !== 'object') return null;
    var copy = {};
    Object.keys(item).forEach(function (key) {
      var value = item[key];
      if (Array.isArray(value)) copy[key] = value.map(function (x) {
        return x && typeof x === 'object' ? Object.assign({}, x) : x;
      });
      else if (value && typeof value === 'object') copy[key] = Object.assign({}, value);
      else copy[key] = value;
    });
    return copy;
  }

  function cloneItems(items) {
    return (Array.isArray(items) ? items : []).map(cloneItem).filter(Boolean);
  }

  function sumItems(items) {
    return (Array.isArray(items) ? items : []).reduce(function (sum, item) {
      return sum + (Number(item && item.unit_price) || 0) * (Number(item && item.quantity) || 0);
    }, 0);
  }

  function createClientTransactionId(prefix) {
    return String(prefix || 'posadd') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function TransactionComposer(defaults) {
    defaults = defaults || {};
    this._defaultOrderType = defaults.orderType || 'dine_in';
    this.reset();
  }

  TransactionComposer.MODES = MODES;
  TransactionComposer.LOCKED_ORDER_STATUSES = LOCKED_ORDER_STATUSES;

  TransactionComposer.prototype.reset = function () {
    this._mode = MODES.NEW;
    this._orderId = null;
    this._heldBillId = null;
    this._orderType = this._defaultOrderType;
    this._table = null;
    this._order = null;
    this._items = [];
    this._additionItems = [];
    this._pendingAdditions = [];
    this._clientTransactionId = null;
    return this.snapshot();
  };

  TransactionComposer.prototype.startNew = function (context) {
    context = context || {};
    this.reset();
    this._orderType = context.orderType || this._defaultOrderType;
    this._table = context.table || null;
    return this.snapshot();
  };

  TransactionComposer.prototype.openExisting = function (context) {
    context = context || {};
    this._orderId = context.orderId || null;
    this._heldBillId = context.heldBillId || null;
    this._orderType = context.orderType || this._defaultOrderType;
    this._table = context.table || null;
    this._order = context.order || null;
    this._items = cloneItems(context.items);
    this._pendingAdditions = cloneItems(context.pendingAdditions);
    this._additionItems = [];
    this._clientTransactionId = null;
    this._mode = this.isLocked() && this._items.length ? MODES.EXISTING : MODES.NEW;
    return this.snapshot();
  };

  TransactionComposer.prototype.refreshExisting = function (context) {
    context = context || {};
    if (context.orderId) this._orderId = context.orderId;
    if (context.order) this._order = context.order;
    if (context.items) this._items = cloneItems(context.items);
    if (context.pendingAdditions) this._pendingAdditions = cloneItems(context.pendingAdditions);
    if (context.heldBillId) this._heldBillId = context.heldBillId;
    if (context.orderType) this._orderType = context.orderType;
    if (context.table) this._table = context.table;

    this._mode = this.isLocked() && this._items.length ? MODES.EXISTING : MODES.NEW;
    if (this._mode !== MODES.EXISTING) {
      this._additionItems = [];
      this._clientTransactionId = null;
    }
    return this.snapshot();
  };

  TransactionComposer.prototype.beginAddition = function () {
    if (!this.canAdd()) {
      throw new Error('Additional Order hanya dapat dibuat dari Order Dine-in yang sudah diproses Merchant.');
    }
    this._mode = MODES.ADDITION;
    this._additionItems = [];
    this._clientTransactionId = createClientTransactionId('posadd');
    return this.snapshot();
  };

  TransactionComposer.prototype.cancelAddition = function () {
    if (this._mode !== MODES.ADDITION) return this.snapshot();
    this._additionItems = [];
    this._clientTransactionId = null;
    this._mode = this.canBecomeExisting() ? MODES.EXISTING : MODES.NEW;
    return this.snapshot();
  };

  TransactionComposer.prototype.completeAdditionSubmission = function () {
    if (this._mode !== MODES.ADDITION) return this.snapshot();
    this._additionItems = [];
    this._clientTransactionId = null;
    this._mode = this.canBecomeExisting() ? MODES.EXISTING : MODES.NEW;
    return this.snapshot();
  };

  TransactionComposer.prototype.canBecomeExisting = function () {
    return !!this._orderId && this.isLocked() && this._items.length > 0;
  };

  TransactionComposer.prototype.canAdd = function () {
    return this.canBecomeExisting() && this._orderType === 'dine_in';
  };

  TransactionComposer.prototype.isNew = function () {
    return this._mode === MODES.NEW;
  };

  TransactionComposer.prototype.isExisting = function () {
    return this._mode === MODES.EXISTING;
  };

  TransactionComposer.prototype.isAddition = function () {
    return this._mode === MODES.ADDITION;
  };

  TransactionComposer.prototype.isLocked = function () {
    return !!(this._order && LOCKED_ORDER_STATUSES.indexOf(String(this._order.status)) !== -1);
  };

  TransactionComposer.prototype.hasItems = function () {
    return this.getDisplayItems().length > 0;
  };

  TransactionComposer.prototype.getDisplayItems = function () {
    return this.isAddition() ? this._additionItems : this._items;
  };

  TransactionComposer.prototype.getExistingItems = function () {
    return this._items;
  };

  TransactionComposer.prototype.getAdditionItems = function () {
    return this._additionItems;
  };

  TransactionComposer.prototype.total = function () {
    return sumItems(this.getDisplayItems());
  };

  TransactionComposer.prototype.orderTotal = function () {
    return sumItems(this._items);
  };

  TransactionComposer.prototype.getMode = function () {
    return this._mode;
  };

  TransactionComposer.prototype.getOrderId = function () {
    return this._orderId;
  };

  TransactionComposer.prototype.getHeldBillId = function () {
    return this._heldBillId;
  };

  TransactionComposer.prototype.getOrderType = function () {
    return this._orderType;
  };

  TransactionComposer.prototype.getTable = function () {
    return this._table;
  };

  TransactionComposer.prototype.getOrder = function () {
    return this._order;
  };

  TransactionComposer.prototype.getPendingAdditions = function () {
    return this._pendingAdditions.slice();
  };

  TransactionComposer.prototype.getClientTransactionId = function () {
    return this._clientTransactionId;
  };

  TransactionComposer.prototype.setOrderType = function (orderType) {
    if (this.isExisting() || this.isAddition()) {
      throw new Error('Jenis transaksi tidak dapat diubah saat Order sedang dibuka.');
    }
    this._orderType = orderType || this._defaultOrderType;
    if (this._orderType !== 'dine_in') this._table = null;
    return this.snapshot();
  };

  TransactionComposer.prototype.setTable = function (table) {
    if (this.isExisting() || this.isAddition()) {
      throw new Error('Meja pada Order yang sedang dibuka tidak dapat diubah.');
    }
    this._table = table || null;
    this._orderType = 'dine_in';
    return this.snapshot();
  };

  TransactionComposer.prototype.addItem = function (item) {
    if (this.isExisting()) {
      throw new Error('Pesanan sudah diproses Merchant. Gunakan Tambah Pesanan.');
    }
    if (!item || !item.product_id) return this.snapshot();

    var target = this.isAddition() ? this._additionItems : this._items;
    var clean = cloneItem(item);
    var same = target.find(function (current) {
      return String(current.product_id) === String(clean.product_id) &&
        String(current.note || '') === String(clean.note || '') &&
        JSON.stringify(current.options || []) === JSON.stringify(clean.options || []);
    });

    if (same) same.quantity = (Number(same.quantity) || 0) + (Number(clean.quantity) || 1);
    else target.push(Object.assign({ quantity: 1 }, clean));

    return this.snapshot();
  };

  TransactionComposer.prototype.changeQty = function (index, delta) {
    if (this.isExisting()) {
      throw new Error('Pesanan sudah diproses Merchant. Gunakan Tambah Pesanan.');
    }

    var target = this.isAddition() ? this._additionItems : this._items;
    var item = target[index];
    if (!item) return this.snapshot();

    item.quantity = (Number(item.quantity) || 0) + Number(delta || 0);
    if (item.quantity <= 0) target.splice(index, 1);
    return this.snapshot();
  };

  TransactionComposer.prototype.snapshot = function () {
    return {
      mode: this._mode,
      order_id: this._orderId,
      held_bill_id: this._heldBillId,
      order_type: this._orderType,
      table: this._table,
      order: this._order,
      items: cloneItems(this._items),
      addition_items: cloneItems(this._additionItems),
      pending_additions: this._pendingAdditions.slice(),
      client_transaction_id: this._clientTransactionId
    };
  };

  global.XentraPos = global.XentraPos || {};
  global.XentraPos.TransactionComposer = TransactionComposer;
  global.XentraPos.TransactionComposerModes = MODES;
})(window);
