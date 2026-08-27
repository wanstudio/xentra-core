(function (window) {
  'use strict';

  window.Xentra = window.Xentra || {};

  const CART_STORAGE_KEY = 'xentra_core_v2_cart';
  const LOC_STORAGE_KEY = 'xentra_core_v2_location';
  const listeners = [];

  let state = {
    brand: null,
    location: null,
    matchedBranch: null,
    cart: { items: [] },
    notes: {}
  };

  function loadStorage() {
    try {
      const c = localStorage.getItem(CART_STORAGE_KEY);
      if (c) state.cart = JSON.parse(c);
      if (!Array.isArray(state.cart.items)) state.cart.items = [];

      const l = localStorage.getItem(LOC_STORAGE_KEY);
      if (l) state.location = JSON.parse(l);
    } catch (_) {
      state.cart = { items: [] };
    }
  }

  function saveStorage() {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
      if (state.location) {
        localStorage.setItem(LOC_STORAGE_KEY, JSON.stringify(state.location));
      }
    } catch (_) {}
  }

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (err) {
        console.error('[Store] Listener error:', err);
      }
    });
  }

  loadStorage();

  window.Xentra.Store = {
    getState() {
      return state;
    },

    setBrand(brand) {
      state.brand = brand;
      notify();
    },

    setLocation(location) {
      state.location = location;
      saveStorage();
      notify();
    },

    setMatchedBranch(match) {
      state.matchedBranch = match;
      notify();
    },

    addItem(product, qty = 1, note = '') {
      if (!product || !product.id) return;
      const numId = String(product.id);
      const existing = state.cart.items.find((i) => String(i.id) === numId);

      if (existing) {
        existing.quantity += qty;
        if (note) existing.note = note;
      } else {
        state.cart.items.push({
          id: numId,
          name: product.name,
          price: Number(product.price || 0),
          regular_price: Number(product.regular_price || product.price || 0),
          image: product.image_url || product.image || '',
          description: product.description || '',
          quantity: qty,
          note: note || ''
        });
      }

      saveStorage();
      notify();
    },

    setQty(productId, qty) {
      const numId = String(productId);
      const idx = state.cart.items.findIndex((i) => String(i.id) === numId);

      if (idx !== -1) {
        if (qty <= 0) {
          state.cart.items.splice(idx, 1);
          delete state.notes[numId];
        } else {
          state.cart.items[idx].quantity = qty;
        }
      }

      saveStorage();
      notify();
    },

    setNote(productId, noteText) {
      const numId = String(productId);
      const item = state.cart.items.find((i) => String(i.id) === numId);
      if (item) {
        item.note = noteText;
        state.notes[numId] = noteText;
      }
      saveStorage();
      notify();
    },

    getCartCount() {
      return state.cart.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
    },

    getCartSubtotal() {
      return state.cart.items.reduce(
        (sum, i) => sum + Number(i.price || 0) * (Number(i.quantity) || 0),
        0
      );
    },

    clearCart() {
      state.cart.items = [];
      state.notes = {};
      saveStorage();
      notify();
    },

    subscribe(fn) {
      if (typeof fn === 'function' && !listeners.includes(fn)) {
        listeners.push(fn);
      }
    }
  };

  window.Xentra.UI = {
    money(amount) {
      const num = Number(amount) || 0;
      return 'Rp ' + num.toLocaleString('id-ID');
    },

    escape(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  };
})(window);
