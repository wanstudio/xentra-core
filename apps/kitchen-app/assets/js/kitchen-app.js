/**
 * XENTRA KITCHEN APP — dedicated Kitchen Staff surface.
 *
 * Scope: the kitchen leg of the order lifecycle only — confirmed → preparing →
 * ready. Acceptance (pending → confirmed/rejected) belongs to the Branch
 * Manager, and dispatch/pickup→on_delivery→delivered to Branch Manager /
 * Driver; this surface never offers those transitions, and the server enforces
 * the same boundary (PATCH /kitchen/orders/:id/status allows the kitchen role
 * only 'preparing' and 'ready').
 *
 * No business logic here: the queue and every mutation go through the existing
 * Core endpoints. Auth/session/DOM/ toast come from merchant-shared.
 */
(function () {
  'use strict';

  var S = window.XentraShared;
  var API_BASE = S.API_BASE;
  var $ = S.$;
  var esc = S.esc;
  var showToast = S.showToast;
  var adminFetch = S.adminFetch;
  var getAuthHeaders = S.getAuthHeaders;
  var getStoredUser = S.getStoredUser;
  var checkAuth = S.checkAuth;
  var handleHandoffExchange = S.handleHandoffExchange;
  var validateServerSession = S.validateServerSession;
  var clearStoredSession = S.clearStoredSession;

  var POLL_MS = 5000;

  var state = {
    branch: null,
    queue: [],
    pollTimer: null,
    elapsedTimer: null,
    fetchSeq: 0,
    inFlight: {},
    loadedOnce: false
  };

  /* ── routing by role ──────────────────────────────────────────────────── */
  function homeFor(role) {
    if (role === 'kitchen') return null;              // stays here
    if (role === 'branch_manager') return '/merchant-app/';
    return '/dashboard/';                             // owner, brand_manager, cashier
  }

  /* ── queue ────────────────────────────────────────────────────────────── */
  function loadQueue(opts) {
    opts = opts || {};
    var seq = ++state.fetchSeq;
    return adminFetch(API_BASE + '/kitchen/queue', { headers: getAuthHeaders() })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (seq !== state.fetchSeq) return;           // stale response — discard
        if (!data || !data.success) {
          setConn(false, (data && data.error) || 'Gagal memuat antrean.');
          return;
        }
        state.queue = Array.isArray(data.orders) ? data.orders : [];
        state.loadedOnce = true;
        setConn(true, 'Terhubung · diperbarui ' + clockTime());
        render();
      })
      .catch(function (err) {
        if (seq !== state.fetchSeq) return;
        setConn(false, err && err.message === 'SESSION_EXPIRED' ? 'Sesi berakhir.' : 'Tidak dapat menghubungi server.');
      });
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(function () {
      if (document.visibilityState === 'hidden') return;
      loadQueue();
    }, POLL_MS);
  }
  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  /* ── transitions (kitchen authority only) ─────────────────────────────── */
  function advance(order, target) {
    if (state.inFlight[order.id]) return;
    state.inFlight[order.id] = true;
    setCardBusy(order.id, true);

    adminFetch(API_BASE + '/kitchen/orders/' + encodeURIComponent(order.id) + '/status', {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status: target })
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok || !r.d || !r.d.success) {
          showToast((r.d && (r.d.error || r.d.message)) || 'Gagal memperbarui status.');
          return;
        }
        showToast(target === 'preparing' ? 'Mulai dimasak: ' + orderLabel(order) : 'Siap: ' + orderLabel(order));
      })
      .catch(function () { showToast('Kesalahan jaringan saat memperbarui status.'); })
      .then(function () {
        state.inFlight[order.id] = false;
        return loadQueue();
      });
  }

  /* ── render ───────────────────────────────────────────────────────────── */
  function orderLabel(o) {
    return o.order_number || ('#' + o.id);
  }
  var TYPE_LABEL = { delivery: 'Delivery', pickup: 'Pickup', 'dine_in': 'Dine-in', 'dine-in': 'Dine-in' };
  var COLUMNS = [
    { key: 'confirmed', action: 'preparing', actionLabel: 'Mulai masak' },
    { key: 'preparing', action: 'ready',     actionLabel: 'Tandai siap' },
    { key: 'ready',     action: null,        actionLabel: null }
  ];

  function render() {
    var counts = { confirmed: 0, preparing: 0, ready: 0 };
    COLUMNS.forEach(function (col) {
      var list = state.queue.filter(function (o) { return o.status === col.key; });
      counts[col.key] = list.length;
      var host = $('list-' + col.key);
      if (!host) return;
      if (!list.length) {
        host.innerHTML = '<p class="kds-empty">' +
          (col.key === 'confirmed' ? (state.loadedOnce ? 'Tidak ada pesanan menunggu dimasak.' : 'Memuat…')
            : col.key === 'preparing' ? 'Belum ada yang sedang dimasak.'
            : 'Belum ada yang siap diambil.') + '</p>';
        return;
      }
      host.innerHTML = list.map(function (o) { return card(o, col); }).join('');
    });

    ['confirmed', 'preparing', 'ready'].forEach(function (k) {
      var n = $('n-' + k); if (n) n.textContent = counts[k];
    });
    var total = counts.confirmed + counts.preparing + counts.ready;
    var host = $('kds-counts');
    if (host) {
      host.innerHTML = '<span class="kds-pill">' + total + ' pesanan aktif</span>' +
        (counts.confirmed ? '<span class="kds-pill hot">' + counts.confirmed + ' baru</span>' : '');
    }
    var b = $('kds-branch');
    if (b) b.textContent = state.branch ? state.branch : 'Cabang';
  }

  function card(o, col) {
    var items = Array.isArray(o.items) ? o.items : [];
    var type = TYPE_LABEL[o.order_type] || (o.order_type || 'Pesanan');
    var table = o.table_number ? ' · Meja ' + esc(o.table_number) : '';
    var elapsed = elapsedLabel(o.created_at);

    return '<article class="kds-card" data-id="' + esc(o.id) + '">' +
      '<div class="kds-card-head">' +
        '<div class="kds-card-num">' + esc(orderLabel(o)) + '</div>' +
        '<div class="kds-card-meta"><span class="kds-type">' + esc(type) + table + '</span>' +
          '<span class="kds-elapsed" data-since="' + esc(o.created_at || '') + '">' + esc(elapsed) + '</span></div>' +
      '</div>' +
      '<ul class="kds-items">' + items.map(function (it) {
        var name = it.product_name || it.name || 'Item';
        var qty = it.quantity != null ? it.quantity : (it.qty != null ? it.qty : 1);
        var note = it.note ? '<em class="kds-note">' + esc(it.note) + '</em>' : '';
        return '<li><span class="kds-qty">' + esc(qty) + '×</span>' +
          '<span class="kds-name">' + esc(name) + note + '</span></li>';
      }).join('') + '</ul>' +
      (o.note ? '<div class="kds-order-note">' + esc(o.note) + '</div>' : '') +
      '<div class="kds-card-foot">' +
        (col.action
          ? '<button type="button" class="kds-action" data-act="' + col.action + '" data-id="' + esc(o.id) + '">' + col.actionLabel + '</button>'
          : '<span class="kds-wait">Menunggu diambil kurir / kasir</span>') +
      '</div>' +
    '</article>';
  }

  function setCardBusy(id, busy) {
    var el = document.querySelector('.kds-card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"] .kds-action');
    if (el) { el.disabled = busy; el.textContent = busy ? 'Menyimpan…' : el.dataset.act === 'preparing' ? 'Mulai masak' : 'Tandai siap'; }
  }

  function setConn(ok, text) {
    var d = $('kds-conn'); if (d) d.className = 'kds-dot' + (ok ? ' ok' : ' bad');
    var t = $('kds-conn-text'); if (t) t.textContent = text;
  }

  /* ── time helpers (display only — never derive order state from a clock) ─ */
  function clockTime() {
    var d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function elapsedLabel(iso) {
    if (!iso) return '';
    var ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms) || ms < 0) return '';
    var m = Math.floor(ms / 60000);
    return m < 1 ? 'baru saja' : m < 60 ? m + ' mnt' : Math.floor(m / 60) + ' jam ' + (m % 60) + ' mnt';
  }
  function tickTimers() {
    document.querySelectorAll('.kds-elapsed').forEach(function (el) {
      el.textContent = elapsedLabel(el.dataset.since);
    });
    var c = $('kds-clock'); if (c) c.textContent = clockTime();
  }

  /* ── events ───────────────────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.kds-action') : null;
    if (!btn) return;
    var order = state.queue.filter(function (o) { return String(o.id) === String(btn.dataset.id); })[0];
    if (order) advance(order, btn.dataset.act);
  });

  var refreshBtn = $('kds-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', function () { loadQueue(); });

  var logoutBtn = $('kds-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', function () {
    if (!confirm('Keluar dari layar dapur?')) return;
    clearStoredSession();
    window.location.href = '/dashboard/login';
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') loadQueue();
  });

  /* ── boot ─────────────────────────────────────────────────────────────── */
  async function boot() {
    await handleHandoffExchange();

    if (!checkAuth()) return;

    var valid = await validateServerSession();
    if (!valid) return;

    var user = getStoredUser();
    var home = homeFor(user && user.role);
    if (home) { window.location.replace(home); return; }

    state.branch = (user && (user.branch_name || user.brand_name)) || 'Cabang';

    loadQueue();
    startPolling();
    tickTimers();
    state.elapsedTimer = setInterval(tickTimers, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
