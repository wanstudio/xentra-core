/**
 * XENTRA CORE — MERCHANT APP "HARI INI"
 *
 * Branch Manager daily operating summary: branch status, pending orders,
 * tables, inventory/menu alerts, promotions and recent activity.
 */
(function () {
  'use strict';

  var S = window.XentraShared;
  var API_BASE = S.API_BASE;
  var $ = S.$;
  var esc = S.esc;
  var formatMoney = S.formatMoney;
  var showToast = S.showToast;
  var adminFetch = S.adminFetch;
  var getAuthHeaders = S.getAuthHeaders;
  var getStoredUser = S.getStoredUser;

  /* =========================================================================
     BRANCH MANAGER OPERATIONAL CENTER — HARI INI (BM-1)
     ========================================================================= */
  var _hariIniState = {
    branch: null,
    orders: [],
    layout: null,
    inventory: []
  };

  async function loadHariIni() {
    var user = getStoredUser();
    var branchId = (typeof window.getBMTargetBranchId === 'function' ? window.getBMTargetBranchId() : null) || (user ? (user.branch_id || user.branchId) : null);
    if (!branchId) {
      console.warn("[BM Hari Ini]: branch_id missing");
      try { window.dispatchEvent(new CustomEvent("merchant:home-ready")); } catch (_) {}
      return;
    }
    var headers = getAuthHeaders();

    try {
      // Parallelize dashboard operational queries in one concurrent network burst
      var results = await Promise.allSettled([
        // 0: Branch Details
        adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId), { headers: headers }),
        // 1: Branch Orders
        adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/orders?status=all", { headers: headers }),
        // 2: Tables Layout
        adminFetch(API_BASE + "/dine-in/layout?branch_id=" + encodeURIComponent(branchId), { headers: headers }),
        // 3: Branch Inventory
        adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/inventory", { headers: headers }),
        // 4: Branch Menus (availability)
        adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/menu", { headers: headers }),
        // 5: Promotions
        adminFetch(API_BASE + "/admin/marketing/promotions", { headers: headers })
      ]);

    // 1. Process Branch Details
    if (results[0].status === "fulfilled" && results[0].value && results[0].value.ok) {
      try {
        var bData = await results[0].value.json();
        if (bData.success && bData.branch) {
          _hariIniState.branch = bData.branch;
          var b = bData.branch;

          var nameEl = $("bm-home-branch-name");
          if (nameEl) nameEl.textContent = b.name || user.brand_name || 'Resto';

          var topbarBMBranchEl = $("dash-bm-branch-name");
          if (topbarBMBranchEl) topbarBMBranchEl.textContent = b.name || user.brand_name || 'Resto';
          var mobileTopbarBrandEl = $("topbar-brand-name");
          if (mobileTopbarBrandEl) mobileTopbarBrandEl.textContent = b.name || user.brand_name || 'Resto';

          var dotEl = $("bm-home-status-dot");
          var badgeEl = $("bm-home-status-badge");
          var onlineBadgeEl = $("bm-home-online-badge");
          var toggleBtn = $("btn-bm-toggle-open");

          var isOpen = b.is_open_override === 1 || b.is_open_override === true;
          var isDeliveryActive = b.is_delivery_active !== 0 && b.is_delivery_active !== false;

          if (dotEl) {
            dotEl.className = "x-status-dot " + (isOpen ? "x-status-dot-open" : "x-status-dot-closed");
          }
          if (badgeEl) {
            badgeEl.className = "x-badge " + (isOpen ? "x-badge-success" : "x-badge-danger");
            badgeEl.textContent = isOpen ? "RESTO BUKA" : "RESTO TUTUP";
          }
          if (onlineBadgeEl) {
            onlineBadgeEl.className = "x-badge " + (isDeliveryActive ? "x-badge-info" : "x-badge-warning");
            onlineBadgeEl.textContent = isDeliveryActive ? "ONLINE: AKTIF" : "ONLINE: JEDA";
          }
          if (toggleBtn) {
            toggleBtn.innerHTML = isOpen ? "<span>Tutup Sementara</span>" : "<span>Buka Resto</span>";
            toggleBtn.className = isOpen ? "x-btn-secondary" : "x-btn-primary";
          }

          var onlineBtn = $("btn-bm-toggle-online-orders");
          if (onlineBtn) {
            onlineBtn.innerHTML = isDeliveryActive
              ? "<span>Pause Order Online</span>"
              : "<span>Resume Order Online</span>";
            onlineBtn.className = isDeliveryActive ? "x-btn-secondary" : "x-btn-primary";
            onlineBtn.style.color = isDeliveryActive ? "var(--text-main)" : "#ffffff";
          }

          // Mobile Home visual reference — mirror the same branch state.
          var mobileOpenSwitch = $("mobile-open-switch");
          var mobileOpenLabel = $("mobile-open-label");
          var mobileOnlineSwitch = $("mobile-online-switch");
          if (mobileOpenSwitch) mobileOpenSwitch.classList.toggle("is-on", isOpen);
          if (mobileOpenSwitch) mobileOpenSwitch.classList.toggle("is-off", !isOpen);
          if (mobileOpenLabel) mobileOpenLabel.textContent = isOpen ? "Buka" : "Tutup";
          if (mobileOnlineSwitch) mobileOnlineSwitch.classList.toggle("is-on", isDeliveryActive);
          if (mobileOnlineSwitch) mobileOnlineSwitch.classList.toggle("is-off", !isDeliveryActive);
          // Live WIB date context
          var dateEl = $("bm-home-date");
          if (dateEl) {
            try {
              var now = new Date();
              var days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
              var months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
              dateEl.textContent = days[now.getDay()] + ", " + now.getDate() + " " + months[now.getMonth()] + " " + now.getFullYear() + " • WIB";
            } catch (_) {
              dateEl.textContent = new Date().toISOString().substring(0, 10);
            }
          }
        }
      } catch (e) {
        console.warn("[BM Hari Ini Branch Parse Error]:", e);
      }
    }

    // 2. Process Branch Orders
    if (results[1].status === "fulfilled" && results[1].value && results[1].value.ok) {
      try {
        var oData = await results[1].value.json();
        if (oData.success && Array.isArray(oData.orders)) {
          applyHariIniOrders(oData.orders);
        }
      } catch (e) {
        console.warn("[BM Hari Ini Orders Parse Error]:", e);
      }
    }

    // 3. Process Dine-in Tables Layout
    if (results[2].status === "fulfilled" && results[2].value && results[2].value.ok) {
      try {
        var tData = await results[2].value.json();
        if (tData.success && Array.isArray(tData.tables)) {
          var tables = tData.tables;
          var avail = tables.filter(function (t) { return (t.operational_status || t.status) === "available"; }).length;
          var occupied = tables.filter(function (t) { return (t.operational_status || t.status) === "occupied"; }).length;
          var held = tables.filter(function (t) { return (t.operational_status || t.status) === "held"; }).length;
          var blocked = tables.filter(function (t) { return ["blocked", "out_of_service"].indexOf(t.operational_status || t.status) !== -1; }).length;

          if ($("bm-stat-tables-available")) $("bm-stat-tables-available").textContent = avail;
          if ($("bm-stat-tables-occupied")) $("bm-stat-tables-occupied").textContent = occupied;
          if ($("bm-stat-tables-held")) $("bm-stat-tables-held").textContent = held;
          if ($("bm-stat-tables-blocked")) $("bm-stat-tables-blocked").textContent = blocked;
        }
      } catch (e) {
        console.warn("[BM Hari Ini Layout Parse Error]:", e);
      }
    }

    // 4. Process Inventory Alerts & Product Availability
    var lowItems = [];
    var unavailItems = [];
    if (results[3].status === "fulfilled" && results[3].value && results[3].value.ok) {
      try {
        var iData = await results[3].value.json();
        if (iData.success && Array.isArray(iData.inventory)) {
          lowItems = iData.inventory.filter(function (item) {
            if (item.stock === null || item.stock === undefined || item.stock === "") return false;
            return Number(item.stock) <= (Number(item.low_stock_threshold) || 5);
          });
        }
      } catch (e) {
        console.warn("[BM Hari Ini Inventory Parse Error]:", e);
      }
    }
    if (results[4].status === "fulfilled" && results[4].value && results[4].value.ok) {
      try {
        var pData = await results[4].value.json();
        var menuAssignments = pData.success && Array.isArray(pData.adopted_menus)
          ? pData.adopted_menus
          : [];
        unavailItems = menuAssignments.filter(function (menu) {
          return menu.is_available === 0 || menu.is_available === false;
        });
      } catch (e) {
        console.warn("[BM Hari Ini Menu Parse Error]:", e);
      }
    }
    renderHariIniAttention(lowItems, unavailItems);

    // 5. Process Active Approved Promotions
    if (results[5].status === "fulfilled" && results[5].value && results[5].value.ok) {
      try {
        var promoData = await results[5].value.json();
        if (promoData.success && Array.isArray(promoData.promotions)) {
          var activePromos = promoData.promotions.filter(function (p) {
            var isBrandActive = (p.is_active === 1 || p.is_active === true || p.status === "active");
            var isBranchActive = p.branch_is_active !== undefined
              ? (p.branch_is_active === 1 || p.branch_is_active === true)
              : isBrandActive;
            return isBrandActive && isBranchActive;
          });
          renderHariIniPromos(activePromos);
        }
      } catch (e) {
        console.warn("[BM Hari Ini Promos Parse Error]:", e);
      }
    }
    } finally {
      try { window.dispatchEvent(new CustomEvent("merchant:home-ready")); } catch (_) {}
    }
  }
  window.loadHariIni = loadHariIni;

  function renderHariIniPromos(promos) {
    var container = $("bm-active-promos-list");
    if (!container) return;

    if (!promos || !promos.length) {
      container.innerHTML = "<div class=\"x-home-empty\"><strong>Belum ada promo aktif</strong>Promosi aktif di restoran ini akan tampil di sini.</div>";
      return;
    }

    container.innerHTML = promos.slice(0, 3).map(function (p) {
      var hasFreebie = Array.isArray(p.rewards) && p.rewards.some(function (r) {
        return r.reward_type === 'freebie_product' || r.target_menu_title || r.target_product_name;
      });
      var firstReward = Array.isArray(p.rewards) && p.rewards[0];
      var rewardMenuName = firstReward ? (firstReward.target_menu_title || firstReward.target_product_name || '') : '';

      var badgeText = '';
      var iconSvg = '';

      if (hasFreebie) {
        badgeText = 'Menu Hadiah';
        // Solid Gift icon
        iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-2.18c.11-.31.18-.65.18-1 0-1.66-1.34-3-3-3-1.62 0-2.95 1.19-3 2.8L12 5.08 11.99 4.8C11.95 3.19 10.62 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1h-2.22l.14-.54C13.13 4.67 13.98 4 15 4zM9 4c1.02 0 1.87.67 2.08 1.46l.14.54H9c-.55 0-1-.45-1-1s.45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h16v6z"/></svg>';
      } else if (p.discount_type === 'percentage' && p.discount_value) {
        badgeText = 'Diskon ' + p.discount_value + '%';
        // Solid Percent icon
        iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 4C5.57 4 4 5.57 4 7.5S5.57 11 7.5 11 11 9.43 11 7.5 9.43 4 7.5 4zm0 5A2.5 2.5 0 0 1 5 7.5 2.5 2.5 0 0 1 7.5 5 2.5 2.5 0 0 1 10 7.5 2.5 2.5 0 0 1 7.5 9zm9 6c-1.93 0-3.5 1.57-3.5 3.5s1.57 3.5 3.5 3.5 3.5-1.57 3.5-3.5-1.57-3.5-3.5-3.5zm0 5a2.5 2.5 0 0 1-2.5-2.5 2.5 2.5 0 0 1 2.5-2.5 2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 1-2.5 2.5zM19.07 4.93a1 1 0 0 0-1.41 0L4.93 17.66a1 1 0 1 0 1.41 1.41L19.07 6.34a1 1 0 0 0 0-1.41z"/></svg>';
      } else if (p.discount_type === 'fixed' && p.discount_value) {
        badgeText = 'Potongan ' + formatMoney(p.discount_value);
        // Solid Tag icon
        iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>';
      } else if (p.code || p.promo_code) {
        badgeText = 'Kode Promo';
        iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>';
      } else {
        badgeText = 'Promo Aktif';
        iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>';
      }

      var promoCopy = '';
      if (rewardMenuName) {
        promoCopy = 'Gratis 1x ' + esc(rewardMenuName);
        if (p.capability_type === 'install_incentive') {
          promoCopy += ' • Khusus order via aplikasi';
        }
      } else if (p.description) {
        promoCopy = esc(p.description);
      } else if (p.code || p.promo_code) {
        promoCopy = 'Gunakan kode: ' + esc(p.code || p.promo_code);
      } else {
        promoCopy = 'Otomatis berlaku di keranjang pesanan';
      }

      return '<div class="x-home-promo-item" onclick="navigateTo(\'promo\')" style="cursor:pointer;" title="Klik untuk kelola promo">' +
        '<span class="x-home-promo-icon" aria-hidden="true">' + iconSvg + '</span>' +
        '<span class="x-home-promo-copy">' +
          '<strong>' + esc(p.name || p.title || 'Promo') + '</strong>' +
          '<span>' + promoCopy + '</span>' +
        '</span>' +
        '<span class="x-home-promo-badge">' + esc(badgeText) + '</span>' +
      '</div>';
    }).join("");
  }

  function renderHariIniRecentActivity(orders) {
    var container = $("bm-recent-activity-list");
    if (!container) return;
    if (!orders || !orders.length) {
      container.innerHTML = "<div class=\"x-home-empty\"><strong>Belum ada aktivitas</strong>Aktivitas terbaru akan muncul di sini.</div>";
      return;
    }
  }

  function applyHariIniOrders(orders) {
    if (!Array.isArray(orders)) return;
    _hariIniState.orders = orders;

    var pendingList = orders.filter(function (o) { return o.status === "pending"; });
    var actionableList = orders.filter(function (o) {
      return o.status === "pending" || Number(o.pending_additions_count || 0) > 0;
    });
    if (typeof updateMobileOrdersBadge === "function") {
      updateMobileOrdersBadge(actionableList.length);
    }
    if (typeof checkAndNotifyNewPendingOrders === "function") {
      checkAndNotifyNewPendingOrders(orders);
    }
    var activeList = orders.filter(function (o) { return ["confirmed", "preparing"].indexOf(o.status) !== -1; });
    var readyList = orders.filter(function (o) { return o.status === "ready"; });

    var todayStr = new Date().toISOString().substring(0, 10);
    var completedToday = orders.filter(function (o) {
      return o.status === "completed" && (o.created_at || "").substring(0, 10) === todayStr;
    });

    var completedSales = completedToday.reduce(function (acc, o) {
      return acc + (Number(o.grand_total) || 0);
    }, 0);

    if ($("bm-stat-pending-orders")) $("bm-stat-pending-orders").textContent = pendingList.length;
    if ($("bm-stat-active-orders")) $("bm-stat-active-orders").textContent = activeList.length;
    if ($("bm-stat-ready-orders")) $("bm-stat-ready-orders").textContent = readyList.length;
    if ($("bm-stat-completed-orders")) $("bm-stat-completed-orders").textContent = completedToday.length;
    if ($("bm-stat-completed-orders-snapshot")) $("bm-stat-completed-orders-snapshot").textContent = completedToday.length;
    if ($("bm-stat-net-sales-today")) $("bm-stat-net-sales-today").textContent = formatMoney(completedSales);

    var avgOrderEl = $("bm-stat-average-order");
    if (avgOrderEl) avgOrderEl.textContent = completedToday.length ? formatMoney(Math.round(completedSales / completedToday.length)) : "Rp0";

    renderHariIniPendingOrders(pendingList);
  }

  async function loadHariIniOrders(opts) {
    opts = opts || {};
    var user = getStoredUser();
    var branchId = (typeof window.getBMTargetBranchId === 'function' ? window.getBMTargetBranchId() : null) || (user ? (user.branch_id || user.branchId) : null);
    if (!branchId) return;
    try {
      var res = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/orders?status=all", {
        headers: getAuthHeaders()
      });
      if (res && res.ok) {
        var oData = await res.json();
        if (oData && oData.success && Array.isArray(oData.orders)) {
          applyHariIniOrders(oData.orders);
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Orders Refresh Error]:", e);
    }
  }

  var _hariIniPollTimer = null;
  function startHariIniPolling() {
    stopHariIniPolling();
    _hariIniPollTimer = setInterval(function () {
      if (document.visibilityState === 'hidden' && !window.IS_NATIVE_APP) return;
      var activeTab = document.querySelector('.x-tab-content.active');
      if (activeTab && activeTab.id === 'tab-hari-ini') {
        loadHariIniOrders({ background: true });
      } else {
        stopHariIniPolling();
      }
    }, 5000);
  }

  function stopHariIniPolling() {
    if (_hariIniPollTimer) {
      clearInterval(_hariIniPollTimer);
      _hariIniPollTimer = null;
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      var activeTab = document.querySelector('.x-tab-content.active');
      if (activeTab && activeTab.id === 'tab-hari-ini') {
        loadHariIniOrders({ background: true });
        startHariIniPolling();
      }
    }
  });

  function renderHariIniPendingOrders(orders) {
    var list = $("bm-pending-orders-list");
    var countBadge = $("bm-badge-pending-count");

    if (countBadge) {
      countBadge.textContent = String(orders ? orders.length : 0);
      countBadge.style.display = "inline-flex";
    }

    if (!list) return;

    if (!orders || orders.length === 0) {
      list.innerHTML = "<div class=\"x-home-empty\"><strong>Tidak ada pesanan baru</strong>Tidak ada antrean pesanan yang memerlukan tindakan saat ini.</div>";
      return;
    }

    list.innerHTML = orders.slice(0, 3).map(function (o) {
      var orderNum = esc(o.order_number || o.id || "Pesanan");
      var typeMap = {
        delivery: "Delivery",
        pickup: "Pickup",
        dine_in: "Dine-in",
        reservation: "Reservasi"
      };
      var type = typeMap[o.order_type] || "Pesanan";
      var table = o.table_name || o.table_number;
      var context = type + (table ? " • " + esc(table) : "");
      var time = (o.created_at || "").substring(11, 16) || "—";
      var total = formatMoney(o.grand_total);

      return "<article class=\"x-home-order-card\" data-order-id=\"" + orderNum + "\">" +
        "<div class=\"x-home-order-main\">" +
          "<div>" +
            "<p class=\"x-home-order-id\">" + orderNum + "</p>" +
            "<p class=\"x-home-order-type\">" + context + "</p>" +
          "</div>" +
          "<span class=\"x-home-order-time\">" + esc(time) + "</span>" +
        "</div>" +
        "<div class=\"x-home-order-bottom\">" +
          "<strong class=\"x-home-order-total\">" + total + "</strong>" +
          "<div class=\"x-home-order-actions\">" +
            "<button type=\"button\" class=\"x-home-order-action\" onclick=\"quickRejectBMOrder('" + esc(o.id) + "')\">Tolak</button>" +
            "<button type=\"button\" class=\"x-home-order-action is-primary\" onclick=\"quickAcceptBMOrder('" + esc(o.id) + "', this)\">Terima</button>" +
          "</div>" +
        "</div>" +
      "</article>";
    }).join("");
  }
  window.renderHariIniPendingOrders = renderHariIniPendingOrders;
  window.applyHariIniOrders = applyHariIniOrders;
  window.loadHariIniOrders = loadHariIniOrders;
  window.startHariIniPolling = startHariIniPolling;
  window.stopHariIniPolling = stopHariIniPolling;

  function renderHariIniAttention(lowItems, unavailItems) {
    var hasLow = lowItems && lowItems.length > 0;
    var hasUnavail = unavailItems && unavailItems.length > 0;

    var menuSummary = $("bm-menu-attention-summary");
    var stockSummary = $("bm-stock-attention-summary");

    if (menuSummary) {
      menuSummary.textContent = hasUnavail
        ? (unavailItems.length + " menu tidak tersedia")
        : "Semua menu tersedia";
    }

    if (stockSummary) {
      stockSummary.textContent = hasLow
        ? (lowItems.length + " item perlu perhatian")
        : "Tidak ada stok yang perlu diperhatikan";
    }
  }

  function renderHariIniLowStock(items) {
    renderHariIniAttention(items, []);
  }

  var _branchConfirmResolver = null;

  function closeBranchStatusConfirmModal(confirmed) {
    var modal = $('modal-branch-status-confirm');
    if (modal) modal.style.display = 'none';
    if (_branchConfirmResolver) {
      var resolve = _branchConfirmResolver;
      _branchConfirmResolver = null;
      resolve(Boolean(confirmed));
    }
  }
  window.closeBranchStatusConfirmModal = closeBranchStatusConfirmModal;

  function showBranchStatusConfirm(options) {
    return new Promise(function (resolve) {
      _branchConfirmResolver = resolve;
      var modal = $('modal-branch-status-confirm');
      if (!modal) {
        resolve(confirm(options.title + '\n\n' + options.desc));
        return;
      }

      var iconWrap = $('branch-status-confirm-icon-wrap');
      var titleEl = $('branch-status-confirm-title');
      var descEl = $('branch-status-confirm-desc');
      var badgeEl = $('branch-status-confirm-badge');
      var submitBtn = $('btn-branch-status-confirm-submit');
      var cancelBtn = $('btn-branch-status-confirm-cancel');

      if (titleEl) titleEl.textContent = options.title || 'Konfirmasi';
      if (descEl) descEl.textContent = options.desc || '';

      if (iconWrap) {
        iconWrap.style.background = options.iconBg || '#f1f5f9';
        iconWrap.innerHTML = options.iconHtml || '⚠️';
      }

      if (badgeEl) {
        if (options.badgeText) {
          badgeEl.style.display = 'inline-flex';
          badgeEl.style.background = options.badgeBg || '#f8fafc';
          badgeEl.style.color = options.badgeColor || '#475569';
          badgeEl.textContent = options.badgeText;
        } else {
          badgeEl.style.display = 'none';
        }
      }

      if (submitBtn) {
        submitBtn.textContent = options.submitText || 'Ya, Lanjutkan';
        submitBtn.style.background = options.submitBg || '#0f172a';
        submitBtn.style.color = '#ffffff';
      }

      if (cancelBtn) {
        cancelBtn.textContent = options.cancelText || 'Batal';
      }

      modal.style.display = 'flex';
    });
  }
  window.showBranchStatusConfirm = showBranchStatusConfirm;

  async function toggleBranchOpen() {
    var user = getStoredUser();
    var branchId = (typeof window.getBMTargetBranchId === 'function' ? window.getBMTargetBranchId() : null) || (user ? (user.branch_id || user.branchId) : null);
    if (!branchId) return;
    var branch = _hariIniState.branch;
    var curOpen = branch ? (branch.is_open_override === 1 || branch.is_open_override === true) : true;
    var newOpen = curOpen ? 0 : 1;

    var confirmed = false;
    if (!newOpen) {
      confirmed = await showBranchStatusConfirm({
        title: 'Tutup Resto Sementara?',
        desc: 'Resto akan ditandai tutup sementara. Pelanggan di Customer PWA dan kasir POS tidak dapat membuat pesanan baru sampai resto dibuka kembali.',
        iconBg: '#ffe4e6',
        iconHtml: '<svg width="30" height="30" viewBox="0 0 24 24" fill="#e11d48"><path d="M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z"/></svg>',
        badgeText: '🛑 Semua pesanan via Online & POS akan distop',
        badgeBg: '#fff1f2',
        badgeColor: '#be123c',
        submitText: 'Ya, Tutup Resto',
        submitBg: '#e11d48',
        cancelText: 'Batal'
      });
    } else {
      confirmed = await showBranchStatusConfirm({
        title: 'Buka Operasional Resto?',
        desc: 'Resto akan dibuka kembali untuk menerima pesanan dine-in, takeaway, dan pesanan online sesuai jadwal operasional.',
        iconBg: '#dcfce7',
        iconHtml: '<svg width="30" height="30" viewBox="0 0 24 24" fill="#16a34a"><path d="M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z"/></svg>',
        badgeText: '🟢 Resto aktif melayani pesanan kembali',
        badgeBg: '#f0fdf4',
        badgeColor: '#15803d',
        submitText: 'Ya, Buka Resto',
        submitBg: '#16a34a',
        cancelText: 'Batal'
      });
    }

    if (!confirmed) return;

    try {
      var res = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId), {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_open_override: newOpen })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast("Status operasional berhasil diubah menjadi " + (newOpen ? "BUKA" : "TUTUP"));
        loadHariIni();
        if (typeof loadBMJamOperasional === 'function') loadBMJamOperasional();
      } else {
        showToast("Gagal mengubah status: " + (data.error || "Terjadi kesalahan"));
      }
    } catch (e) {
      showToast("Kesalahan jaringan.");
    }
  }
  window.toggleBranchOpen = toggleBranchOpen;

  async function toggleBranchOnlineOrders() {
    var user = getStoredUser();
    var branchId = (typeof window.getBMTargetBranchId === 'function' ? window.getBMTargetBranchId() : null) || (user ? (user.branch_id || user.branchId) : null);
    if (!branchId) return;
    var branch = _hariIniState.branch;
    var curDelivery = branch ? (branch.is_delivery_active !== 0 && branch.is_delivery_active !== false) : true;
    var newDelivery = curDelivery ? 0 : 1;

    var confirmed = false;
    if (!newDelivery) {
      confirmed = await showBranchStatusConfirm({
        title: 'Jeda Pesanan Online?',
        desc: 'Layanan order online / delivery akan dijeda sementara. Pelanggan di Customer PWA tidak bisa checkout, namun pesanan langsung di resto tetap berjalan.',
        iconBg: '#ffedd5',
        iconHtml: '<svg width="30" height="30" viewBox="0 0 24 24" fill="#ea580c"><path d="M19 7c0-1.1-.9-2-2-2h-3v2h3v2.65L13.52 14H10V9H6c-2.21 0-4 1.79-4 4v3h2c0 1.66 1.34 3 3 3s3-1.34 3-3h4c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-4-4zm-12 8c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm11 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/></svg>',
        badgeText: '⏸️ Order online dijeda, pesanan resto tetap jalan',
        badgeBg: '#fff7ed',
        badgeColor: '#c2410c',
        submitText: 'Ya, Jeda Online',
        submitBg: '#ea580c',
        cancelText: 'Batal'
      });
    } else {
      confirmed = await showBranchStatusConfirm({
        title: 'Aktifkan Pesanan Online?',
        desc: 'Layanan order online / delivery akan kembali aktif menerima pesanan dari pelanggan.',
        iconBg: '#e0f2fe',
        iconHtml: '<svg width="30" height="30" viewBox="0 0 24 24" fill="#0284c7"><path d="M19 7c0-1.1-.9-2-2-2h-3v2h3v2.65L13.52 14H10V9H6c-2.21 0-4 1.79-4 4v3h2c0 1.66 1.34 3 3 3s3-1.34 3-3h4c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-4-4zm-12 8c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm11 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/></svg>',
        badgeText: '🛵 Order online aktif melayani pelanggan',
        badgeBg: '#f0f9ff',
        badgeColor: '#0369a1',
        submitText: 'Ya, Aktifkan Online',
        submitBg: '#0284c7',
        cancelText: 'Batal'
      });
    }

    if (!confirmed) return;

    try {
      var res = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId), {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_delivery_active: newDelivery })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast("Layanan pesanan online berhasil " + (newDelivery ? "DIAKTIFKAN" : "DIJEDA"));
        loadHariIni();
        if (typeof loadBMJamOperasional === 'function') loadBMJamOperasional();
      } else {
        showToast("Gagal mengubah status: " + (data.error || "Terjadi kesalahan"));
      }
    } catch (e) {
      showToast("Kesalahan jaringan.");
    }
  }
  window.toggleBranchOnlineOrders = toggleBranchOnlineOrders;


})();
