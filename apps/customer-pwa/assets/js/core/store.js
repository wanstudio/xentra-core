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
  var ACTIVE_DESTINATION_KEY = PREFIX + 'active_destination';
  var BRANCH_KEY = PREFIX + 'branch';
  var SESSION_KEY = PREFIX + 'customer_session';
  var ORDER_TYPE_KEY = PREFIX + 'order_type';
  var ORDER_CTX_KEY = PREFIX + 'order_context';
  var BRANCH_CTX_KEY = PREFIX + 'branch_context';

  var listeners = [];

  // Initialize initial activeDestination, falling back to legacy location if present
  var initialActiveDest = load(ACTIVE_DESTINATION_KEY, null);
  var initialLoc = load(LOCATION_KEY, null);
  if (!initialActiveDest && initialLoc) {
    initialActiveDest = {
      latitude: initialLoc.latitude != null ? Number(initialLoc.latitude) : null,
      longitude: initialLoc.longitude != null ? Number(initialLoc.longitude) : null,
      address: initialLoc.formatted_address || initialLoc.address || '',
      label: initialLoc.label || 'Lokasi Terpilih',
      detail: initialLoc.detail || '',
      source: initialLoc.source || 'manual',
      is_explicit: initialLoc.is_explicit !== undefined ? Boolean(initialLoc.is_explicit) : true,
      updated_at: initialLoc.updated_at || new Date().toISOString()
    };
  }

  var state = {
    brand: null,
    customerSession: load(SESSION_KEY, null),
    orderType: load(ORDER_TYPE_KEY, 'delivery'),
    orderContext: load(ORDER_CTX_KEY, {
      delivery: { scheduled: false, date: 'Hari Ini', timeSlot: '12.00 - 12.30', note: '' },
      pickup: { branchId: null, branchName: null, pickupTime: 'Sekarang' },
      dine_in: { tableNumber: '', note: '' },
      reservation: { reservationDate: '', reservationTime: '12:00', guestCount: 2, note: '' }
    }),
    location: initialLoc || (initialActiveDest ? {
      formatted_address: initialActiveDest.address,
      latitude: initialActiveDest.latitude,
      longitude: initialActiveDest.longitude,
      label: initialActiveDest.label,
      detail: initialActiveDest.detail
    } : null),
    // CANONICAL ACTIVE DESTINATION
    // Current customer destination context. Can exist for guest or authenticated customer.
    // Can originate from 'gps', 'search', 'map', 'favorite', or 'manual'.
    activeDestination: initialActiveDest,
    matchedBranch: load(BRANCH_KEY, null),
    // P2 HOME DISCOVERY CONTEXT: the branch context the customer is currently
    // browsing/selecting from Home. It is a DISCOVERY/CUSTOMER-SELECTION
    // context only — never an authoritative fulfillment branch. Checkout uses
    // it as a branch PREFILL (selection_mode=CUSTOMER_SELECTED) and Core still
    // validates the final branch authoritatively. Kept separate from
    // `matchedBranch` (the transaction-level Core match result) on purpose so
    // Home discovery ordering is never conflated with AUTO resolution.
    branchContext: load(BRANCH_CTX_KEY, null),
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

  // Reactivity boundary: notify() broadcasts a LIGHTWEIGHT mutation descriptor
  // (e.g. { type: 'cart' }), NOT a deep-cloned snapshot. Subscribers must read
  // `getState()` (or the specific getters) when they actually need data — today
  // every subscriber re-reads state itself, so the previous per-mutation
  // JSON-clone of the entire app state was 100% wasted work on every operation,
  // synchronous to every qty click on the PWA.
  function notify(mutation) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](mutation || null); } catch (e) { console.error('[Store]', e); }
    }
  }

  // ── Public API ──
  // Snapshot getter: still a detached deep clone when a caller genuinely needs
  // a point-in-time snapshot (kept for callers that rely on immutability).
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

  function setCustomerSession(session) {
    state.customerSession = session;
    save(SESSION_KEY, session);
    notify();
  }

  function clearCustomerSession() {
    state.customerSession = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
    notify();
  }

  function setOrderType(type) {
    state.orderType = type;
    notify({ type: 'orderType' });
    save(ORDER_TYPE_KEY, type);
  }

  function setOrderContext(type, ctx) {
    state.orderContext = state.orderContext || {};
    state.orderContext[type] = Object.assign({}, state.orderContext[type] || {}, ctx);
    save(ORDER_CTX_KEY, state.orderContext);
    notify();
  }

  function setLocation(loc) {
    state.location = loc;
    if (loc && loc.latitude != null && loc.longitude != null) {
      state.activeDestination = {
        latitude: Number(loc.latitude),
        longitude: Number(loc.longitude),
        address: loc.formatted_address || loc.address || '',
        label: loc.label || 'Lokasi Terpilih',
        detail: loc.detail || '',
        source: loc.source || 'manual',
        is_explicit: loc.is_explicit !== undefined ? Boolean(loc.is_explicit) : true,
        updated_at: loc.updated_at || new Date().toISOString()
      };
      save(ACTIVE_DESTINATION_KEY, state.activeDestination);
    } else if (loc === null) {
      state.activeDestination = null;
      try { localStorage.removeItem(ACTIVE_DESTINATION_KEY); } catch (_) {}
    }
    notify({ type: 'location' });
    save(LOCATION_KEY, loc);
  }

  // CANONICAL ACTIVE DESTINATION SETTER
  // Accepts canonical destination shape:
  // { latitude, longitude, address, label, detail, source, is_explicit }
  function setActiveDestination(dest) {
    if (!dest) {
      state.activeDestination = null;
      state.location = null;
      try { localStorage.removeItem(ACTIVE_DESTINATION_KEY); } catch (_) {}
      try { localStorage.removeItem(LOCATION_KEY); } catch (_) {}
      notify({ type: 'activeDestination' });
      return;
    }

    var lat = dest.latitude != null ? Number(dest.latitude) : null;
    var lng = dest.longitude != null ? Number(dest.longitude) : null;
    var addr = dest.address || dest.formatted_address || '';
    var label = dest.label || 'Lokasi Terpilih';
    var detail = dest.detail || '';
    var source = dest.source || 'manual'; // 'gps' | 'search' | 'map' | 'favorite' | 'manual'
    var isExplicit = dest.is_explicit !== undefined ? Boolean(dest.is_explicit) : (source !== 'gps');

    var canonical = {
      latitude: lat,
      longitude: lng,
      address: addr,
      label: label,
      detail: detail,
      source: source,
      is_explicit: isExplicit,
      favorite_id: dest.favorite_id || null,
      updated_at: new Date().toISOString()
    };

    state.activeDestination = canonical;
    save(ACTIVE_DESTINATION_KEY, canonical);

    // Keep legacy location state synchronized for backward compatibility with existing callers
    state.location = {
      formatted_address: addr,
      latitude: lat,
      longitude: lng,
      label: label,
      detail: detail,
      source: source,
      is_explicit: isExplicit
    };
    save(LOCATION_KEY, state.location);

    notify({ type: 'activeDestination' });
  }

  function getActiveDestination() {
    return state.activeDestination ? Object.assign({}, state.activeDestination) : null;
  }


  function setMatchedBranch(data) {
    state.matchedBranch = data;
    notify({ type: 'branch' });
    save(BRANCH_KEY, data);
  }

  // P2 HOME DISCOVERY CONTEXT — sets the branch context a customer selected on
  // Home (discovery/selection context, never fulfillment authority). Shape:
  // { branch_id, branch_name } matching cart-line provenance.
  function setBranchContext(ctx) {
    state.branchContext = ctx;
    save(BRANCH_CTX_KEY, ctx);
    notify();
  }

  function setPromo(promo) {
    state.promo = promo;
    notify();
  }

  // ── Cart Operations ──
  // R1 CART/CHECKOUT BOUNDARY: a cart MAY carry items from different branches
  // (multi-branch cart), while each CHECKOUT/ORDER stays single-branch. Every
  // cart line therefore records optional branch provenance (branch_id +
  // branch_name) captured at add time. Cart line identity = id within a branch
  // scope: the same catalog product added under two different branches stays
  // two lines, so a multi-branch cart never silently merges scopes.
  function addItem(product, qty, branchCtx) {
    qty = qty || 1;

    var rawBranchId = (branchCtx && (branchCtx.branch_id || branchCtx.branchId)) ||
      (product && (product.branch_id || product.branchId)) || null;
    var branchId = rawBranchId != null ? String(rawBranchId) : null;
    var branchName = (branchCtx && branchCtx.branch_name) || (product && product.branch_name) || null;
    var branchKey = branchId || '';

    var items = state.cart.items;
    var existing = null;
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].id) === String(product.id) && String(items[i].branch_id || '') === branchKey) {
        existing = items[i];
        break;
      }
    }

    if (existing) {
      existing.quantity += qty;
    } else {
      // Promo-line identity is canonical only (flag / promotion_id / synthetic
      // reward_ id). Price-0 or name "Gratis" heuristics are NOT used, so a
      // legitimately discounted or free catalog product is never misflagged.
      var isPromo = Boolean(
        product.is_promo_reward ||
        product.promotion_id ||
        product.promo_id ||
        String(product.id).indexOf('reward_') === 0
      );

      var newItem = {
        // Keep the cart row id separate from the authoritative catalog product id.
        // Promo rewards use id=reward_<promo>, while product_id points to the real product.
        id: product.id,
        product_id: product.product_id || product.id,
        name: product.name,
        price: Number(product.price),
        regular_price: product.regular_price ? Number(product.regular_price) : null,
        image_url: product.image_url || '',
        description: product.description || '',
        quantity: qty,
        note: '',
        is_promo_reward: isPromo,
        promotion_id: product.promotion_id || product.promo_id || null,
        reward_type: product.reward_type || null,
        // R1: optional branch provenance — which branch scope produced this line.
        // null = legacy/unassigned group (existing single-branch flows unchanged).
        branch_id: branchId,
        branch_name: branchName
      };

      if (isPromo) {
        items.unshift(newItem);
      } else {
        items.push(newItem);
      }
    }

    notify({ type: 'cart' });
    save(CART_KEY, state.cart);
  }

  // R1 branch scope for mutation ops: `branchId === undefined` keeps the legacy
  // global first-match behavior; any other value (including null/'' →
  // '__unassigned__') restricts the op to ONE cart scope using the same
  // identity rule as cartGroupKey (product id within a branch scope).
  function mutationScopeKey(branchId) {
    if (branchId === undefined) return undefined;
    return (branchId == null || String(branchId) === '') ? '__unassigned__' : String(branchId);
  }

  function setQty(productId, qty, branchId) {
    var key = mutationScopeKey(branchId);
    var items = state.cart.items;
    if (qty <= 0) {
      state.cart.items = items.filter(function (i) {
        return !(String(i.id) === String(productId) && (key === undefined || cartGroupKey(i) === key));
      });
    } else {
      for (var i = 0; i < items.length; i++) {
        if (String(items[i].id) === String(productId) && (key === undefined || cartGroupKey(items[i]) === key)) {
          items[i].quantity = qty;
          break;
        }
      }
    }

    notify({ type: 'cart' });
    save(CART_KEY, state.cart);
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
    notify({ type: 'cart' });
    save(CART_KEY, state.cart);
    save(NOTES_KEY, state.notes);
  }

  function clearCart() {
    state.cart = { items: [] };
    state.notes = {};
    notify({ type: 'cart' });
    save(CART_KEY, state.cart);
    save(NOTES_KEY, state.notes);
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

  function findCartItem(productId, branchId) {
    var key = mutationScopeKey(branchId);
    var items = state.cart.items;
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].id) === String(productId) && (key === undefined || cartGroupKey(items[i]) === key)) return items[i];
    }
    return null;
  }

  // ── R1 Branch-scope helpers (multi-branch cart representation) ──
  function cartGroupKey(item) {
    return (item && item.branch_id) ? String(item.branch_id) : '__unassigned__';
  }

  // Groups cart lines by their branch provenance, preserving first-seen order.
  // Legacy lines without provenance form the '__unassigned__' (branch_id: null)
  // group so existing single-branch flows behave exactly as before.
  function getCartBranchGroups() {
    var groups = [];
    var byKey = {};
    (state.cart.items || []).forEach(function (item) {
      var key = cartGroupKey(item);
      if (!byKey[key]) {
        byKey[key] = {
          branch_id: (item && item.branch_id) || null,
          branch_name: (item && item.branch_name) || null,
          items: []
        };
        groups.push(byKey[key]);
      }
      byKey[key].items.push(item);
    });
    return groups;
  }

  // Items belonging to ONE branch scope (branch_id === null => legacy/unassigned).
  // This is the read boundary a single-branch CHECKOUT consumes from the cart.
  function getCartItemsForBranch(branchId) {
    var key = (branchId == null || String(branchId) === '') ? '__unassigned__' : String(branchId);
    return (state.cart.items || []).filter(function (item) {
      return cartGroupKey(item) === key;
    });
  }

  // Remove ONLY one branch scope (null => legacy/unassigned group), leaving all
  // other scopes intact. Used by R1.5: completing one branch's checkout must not
  // invalidate/clear the other branch's independent checkout.
  function removeBranchItems(branchId) {
    var key = (branchId == null || String(branchId) === '') ? '__unassigned__' : String(branchId);
    state.cart.items = (state.cart.items || []).filter(function (item) {
      return cartGroupKey(item) !== key;
    });
    notify({ type: 'cart' });
    save(CART_KEY, state.cart);
  }

  // R1 branch-scoped line removal: removes ONLY the line matching productId
  // inside the given branch scope (null => legacy/unassigned). The same product
  // added under other branches stays untouched, so deleting a row in one cart
  // sheet section can never delete another branch's line.
  function removeCartItem(productId, branchId) {
    var key = (branchId == null || String(branchId) === '') ? '__unassigned__' : String(branchId);
    state.cart.items = (state.cart.items || []).filter(function (item) {
      return !(String(item.id) === String(productId) && cartGroupKey(item) === key);
    });
    notify({ type: 'cart' });
    save(CART_KEY, state.cart);
  }

  // ── Export ──
  window.Xentra = window.Xentra || {};
  window.Xentra.Store = {
    getState: getState,
    subscribe: subscribe,
    setBrand: setBrand,
    setCustomerSession: setCustomerSession,
    clearCustomerSession: clearCustomerSession,
    setOrderType: setOrderType,
    setOrderContext: setOrderContext,
    setLocation: setLocation,
    setActiveDestination: setActiveDestination,
    getActiveDestination: getActiveDestination,
    setMatchedBranch: setMatchedBranch,
    setBranchContext: setBranchContext,
    setPromo: setPromo,
    addItem: addItem,
    setQty: setQty,
    removeItem: removeItem,
    setNote: setNote,
    clearCart: clearCart,
    getCartCount: getCartCount,
    getCartSubtotal: getCartSubtotal,
    findCartItem: findCartItem,
    getCartBranchGroups: getCartBranchGroups,
    getCartItemsForBranch: getCartItemsForBranch,
    removeBranchItems: removeBranchItems,
    removeCartItem: removeCartItem
  };
})();
