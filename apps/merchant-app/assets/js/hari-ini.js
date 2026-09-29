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
    if (!user || !user.branch_id) {
      console.warn("[BM Hari Ini]: User is not a branch manager or branch_id missing");
      return;
    }
    var branchId = user.branch_id;
    var headers = getAuthHeaders();

    // Parallelize all dashboard operational queries in one concurrent network burst
    var results = await Promise.allSettled([
      // 0: Branch Details
      adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId), { headers: headers }),
      // 1: Branch Orders
      adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/orders?status=all", { headers: headers }),
      // 2: Tables Layout
      adminFetch(API_BASE + "/dine-in/layout?branch_id=" + encodeURIComponent(branchId), { headers: headers }),
      // 3: Branch Inventory
      adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/inventory", { headers: headers }),
      // 4: Branch Products (availability)
      adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/products", { headers: headers }),
      // 5: Promotions
      adminFetch(API_BASE + "/admin/marketing/promotions", { headers: headers }),
      // 6: Operational Activity Logs
      adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/operation-logs?limit=5", { headers: headers })
    ]);

    // 1. Process Branch Details
    if (results[0].status === "fulfilled" && results[0].value && results[0].value.ok) {
      try {
        var bData = await results[0].value.json();
        if (bData.success && bData.branch) {
          _hariIniState.branch = bData.branch;
          var b = bData.branch;

          var nameEl = $("bm-home-branch-name");
          if (nameEl) nameEl.textContent = b.name || ("Cabang " + branchId);

          var topbarBMBranchEl = $("dash-bm-branch-name");
          if (topbarBMBranchEl) topbarBMBranchEl.textContent = b.name || ("Cabang " + branchId);

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
            badgeEl.textContent = isOpen ? "CABANG: BUKA" : "CABANG: TUTUP";
          }
          if (onlineBadgeEl) {
            onlineBadgeEl.className = "x-badge " + (isDeliveryActive ? "x-badge-info" : "x-badge-warning");
            onlineBadgeEl.textContent = isDeliveryActive ? "ONLINE: AKTIF" : "ONLINE: DIJEDA";
          }
          if (toggleBtn) {
            toggleBtn.innerHTML = isOpen ? "<span>Tutup Sementara</span>" : "<span>Buka Cabang</span>";
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
          var orders = oData.orders;
          _hariIniState.orders = orders;

          var pendingList = orders.filter(function (o) { return o.status === "pending"; });
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
          if ($("bm-stat-net-sales-today")) $("bm-stat-net-sales-today").textContent = formatMoney(completedSales);\n\n           var avgOrderEl = $("bm-stat-average-order");\n           if (avgOrderEl) avgOrderEl.textContent = completedToday.length ? formatMoney(Math.round(completedSales / completedToday.length)) : "Rp0";

          renderHariIniPendingOrders(pendingList);
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
            return item.stock <= (item.low_stock_threshold || 5);
          });
        }
      } catch (e) {
        console.warn("[BM Hari Ini Inventory Parse Error]:", e);
      }
    }
    if (results[4].status === "fulfilled" && results[4].value && results[4].value.ok) {
      try {
        var pData = await results[4].value.json();
        if (pData.success && Array.isArray(pData.assignments)) {
          unavailItems = pData.assignments.filter(function (p) {
            return p.is_available === 0 || p.is_available === false;
          });
        }
      } catch (e) {
        console.warn("[BM Hari Ini Products Parse Error]:", e);
      }
    }
    renderHariIniAttention(lowItems, unavailItems);

    // 5. Process Active Approved Promotions
    if (results[5].status === "fulfilled" && results[5].value && results[5].value.ok) {
      try {
        var promoData = await results[5].value.json();
        if (promoData.success && Array.isArray(promoData.promotions)) {
          var activePromos = promoData.promotions.filter(function (p) {
            var active = (p.is_active === 1 || p.is_active === true || p.status === "active");
            if (!active) return false;
            if (!p.branch_id || p.branch_id === branchId) return true;
            return false;
          });
          renderHariIniPromos(activePromos);
        }
      } catch (e) {
        console.warn("[BM Hari Ini Promos Parse Error]:", e);
      }
    }

    // 6. Process Authoritative Recent Branch Operational Activity Logs
    if (results[6].status === "fulfilled" && results[6].value && results[6].value.ok) {
      try {
        var logsData = await results[6].value.json();
        if (logsData.success && Array.isArray(logsData.logs)) {
          renderHariIniRecentActivity(logsData.logs);
        }
      } catch (e) {
        console.warn("[BM Hari Ini Logs Parse Error]:", e);
      }
    }

    try { window.dispatchEvent(new CustomEvent("merchant:home-ready")); } catch (_) {}
  }
  window.loadHariIni = loadHariIni;

  function renderHariIniPromos(promos) {
    var container = $("bm-active-promos-list");
    if (!container) return;

    if (!promos || !promos.length) {
      container.innerHTML = "<div class=\"x-home-empty\"><strong>Belum ada promo aktif</strong>Promosi aktif cabang akan tampil di sini.</div>";
      return;
    }

    container.innerHTML = promos.slice(0, 3).map(function (p) {
      var discountStr = p.discount_type === "percentage"
        ? (p.discount_value + "%")
        : formatMoney(p.discount_value);

      return "<div class=\"x-home-promo-item\">" +
        "<span class=\"x-home-promo-icon\" aria-hidden=\"true\">%" + "</span>" +
        "<span class=\"x-home-promo-copy\">" +
          "<strong>" + esc(p.name || p.title || "Promo") + "</strong>" +
          "<span>" + esc(p.description || "Promo aktif dapat digunakan pelanggan.") + "</span>" +
        "</span>" +
        "<span class=\"x-home-promo-badge\">" + esc(discountStr) + "</span>" +
      "</div>";
    }).join("");
  }

  function renderHariIniRecentActivity(logs) {
    var container = $("bm-recent-activity-list");
    if (!container) return;

    if (!logs || !logs.length) {
      container.innerHTML = "<div class=\"x-home-empty\"><strong>Belum ada aktivitas</strong>Perubahan operasional terbaru akan tampil di sini.</div>";
      return;
    }

    container.innerHTML = logs.slice(0, 4).map(function (l) {
      var timeStr = l.created_at ? l.created_at.substring(11, 16) : "—";
      var actionDesc = "";

      if (l.field === "is_open_override") {
        var isOpen = l.new_value === "1" || l.new_value === 1 || l.new_value === "true";
        actionDesc = isOpen ? "Membuka operasional cabang" : "Menutup operasional cabang sementara";
      } else if (l.field === "is_delivery_active") {
        var isDel = l.new_value === "1" || l.new_value === 1 || l.new_value === "true";
        actionDesc = isDel ? "Mengaktifkan pesanan online" : "Menjeda pesanan online";
      } else if (l.field === "is_available") {
        var isAvail = l.new_value === "1" || l.new_value === 1 || l.new_value === "true";
        actionDesc = isAvail
          ? "Mengaktifkan kembali menu"
          : "Menandai menu tidak tersedia";
      } else if (l.field) {
        actionDesc = "Memperbarui operasional cabang";
      } else {
        actionDesc = "Aktivitas operasional cabang";
      }

      var actor = l.actor_name || "Staf cabang";
      return "<div class=\"x-home-activity-item\">" +
        "<span class=\"x-home-activity-icon\" aria-hidden=\"true\">•</span>" +
        "<span class=\"x-home-activity-copy\">" +
          "<strong>" + actionDesc + "</strong>" +
          "<span>Oleh " + esc(actor) + "</span>" +
        "</span>" +
        "<span class=\"x-home-activity-time\">" + esc(timeStr) + "</span>" +
      "</div>";
    }).join("");
  }

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

  async function toggleBranchOpen() {
    var user = getStoredUser();
    if (!user || !user.branch_id) return;
    var branch = _hariIniState.branch;
    var curOpen = branch ? (branch.is_open_override === 1 || branch.is_open_override === true) : true;
    var newOpen = curOpen ? 0 : 1;
    var actionName = newOpen ? "Buka Cabang" : "Tutup Sementara";

    if (!confirm("Apakah Anda yakin ingin melakukan " + actionName + " untuk operasional cabang?")) {
      return;
    }

    try {
      var res = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(user.branch_id), {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_open_override: newOpen })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast("Status operasional cabang berhasil diubah menjadi " + (newOpen ? "BUKA" : "TUTUP"));
        loadHariIni();
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
    if (!user || !user.branch_id) return;
    var branch = _hariIniState.branch;
    var curDelivery = branch ? (branch.is_delivery_active !== 0 && branch.is_delivery_active !== false) : true;
    var newDelivery = curDelivery ? 0 : 1;
    var actionName = newDelivery ? "Resume Order Online" : "Pause Order Online";

    if (!confirm("Apakah Anda yakin ingin melakukan " + actionName + " untuk cabang ini?")) {
      return;
    }

    try {
      var res = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(user.branch_id), {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_delivery_active: newDelivery })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast("Layanan pesanan online cabang berhasil " + (newDelivery ? "DIAKTIFKAN" : "DIJEDA"));
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
