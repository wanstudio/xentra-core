/**
 * Xentra Core Store — Centralized state management
 * Vanilla JS reactive store with localStorage persistence.
 */
(function () {
  'use strict';

  var PREFIX = 'xentra_v2_';
  var CART_KEY = PREFIX + 'cart';
  var NOTES_KEY = PREFIX + 'notes';
  var LOCATION_KEY = PREFIX + 'location';
  var BRANCH_KEY = PREFIX + 'branch';

  var listeners = [];

  var state = {
    brand: null,
    location: load(LOCATION_KEY, null),
    matchedBranch: load(BRANCH_KEY, null),
    cart: load(CART_KEY, { items: [] }),
    notes: load(NOTES_KEY, {}),
    promo: { enabled: false, target: 0, discount: 0 }
  };

  // ── Persistence helpers ──
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function notify() {
    var snap = getState();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](snap); } catch (e) { console.error('[Store]', e); }
    }
  }

  // ── Public API ──
  function getState() {
    return JSON.parse(JSON.stringify(state));
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function unsubscribe() {
      listeners = listeners.filter(function (l) { return l !== fn; });
    };
  }

  function setBrand(brand) {
    state.brand = brand;
    notify();
  }

  function setLocation(loc) {
    state.location = loc;
    save(LOCATION_KEY, loc);
    notify();
  }

  function setMatchedBranch(data) {
    state.matchedBranch = data;
    save(BRANCH_KEY, data);
    notify();
  }

  function setPromo(promo) {
    state.promo = promo;
    notify();
  }

  // ── Cart Operations ──
  function addItem(product, qty) {
    qty = qty || 1;
    var items = state.cart.items;
    var existing = null;
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].id) === String(product.id)) {
        existing = items[i];
        break;
      }
    }

    if (existing) {
      existing.quantity += qty;
    } else {
      items.push({
        id: product.id,
        name: product.name,
        price: Number(product.price),
        regular_price: product.regular_price ? Number(product.regular_price) : null,
        image_url: product.image_url || '',
        description: product.description || '',
        quantity: qty,
        note: ''
      });
    }

    save(CART_KEY, state.cart);
    notify();
  }

  function setQty(productId, qty) {
    var items = state.cart.items;
    if (qty <= 0) {
      state.cart.items = items.filter(function (i) {
        return String(i.id) !== String(productId);
      });
    } else {
      for (var i = 0; i < items.length; i++) {
        if (String(items[i].id) === String(productId)) {
          items[i].quantity = qty;
          break;
        }
      }
    }

    save(CART_KEY, state.cart);
    notify();
  }

  function removeItem(productId) {
    setQty(productId, 0);
  }

  function setNote(productId, noteText) {
    var items = state.cart.items;
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].id) === String(productId)) {
        items[i].note = noteText;
        break;
      }
    }

    state.notes[productId] = noteText;
    save(CART_KEY, state.cart);
    save(NOTES_KEY, state.notes);
    notify();
  }

  function clearCart() {
    state.cart = { items: [] };
    state.notes = {};
    save(CART_KEY, state.cart);
    save(NOTES_KEY, state.notes);
    notify();
  }

  function getCartCount() {
    var total = 0;
    var items = state.cart.items;
    for (var i = 0; i < items.length; i++) {
      total += items[i].quantity;
    }
    return total;
  }

  function getCartSubtotal() {
    var total = 0;
    var items = state.cart.items;
    for (var i = 0; i < items.length; i++) {
      total += items[i].price * items[i].quantity;
    }
    return total;
  }

  function findCartItem(productId) {
    var items = state.cart.items;
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].id) === String(productId)) return items[i];
    }
    return null;
  }

  // ── Export ──
  window.Xentra = window.Xentra || {};
  window.Xentra.Store = {
    getState: getState,
    subscribe: subscribe,
    setBrand: setBrand,
    setLocation: setLocation,
    setMatchedBranch: setMatchedBranch,
    setPromo: setPromo,
    addItem: addItem,
    setQty: setQty,
    removeItem: removeItem,
    setNote: setNote,
    clearCart: clearCart,
    getCartCount: getCartCount,
    getCartSubtotal: getCartSubtotal,
    findCartItem: findCartItem
  };
})();
