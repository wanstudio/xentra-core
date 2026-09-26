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

    // 1. Fetch assigned branch details
    try {
      var bRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId), { headers: getAuthHeaders() });
      if (bRes.ok) {
        var bData = await bRes.json();
        if (bData.success && bData.branch) {
          _hariIniState.branch = bData.branch;
          var b = bData.branch;

          var nameEl = $("bm-hero-branch-name");
          if (nameEl) nameEl.textContent = b.name || ("Cabang " + branchId);

          var topbarBMBranchEl = $("dash-bm-branch-name");
          if (topbarBMBranchEl) topbarBMBranchEl.textContent = b.name || ("Cabang " + branchId);

          var dotEl = $("bm-hero-status-dot");
          var badgeEl = $("bm-hero-status-badge");
          var onlineBadgeEl = $("bm-hero-online-badge");
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
          var dateEl = $("bm-hero-date");
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
      }
    } catch (e) {
      console.warn("[BM Hari Ini Branch Error]:", e);
    }

    // 2. Fetch assigned branch orders
    try {
      var oRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/orders?status=all", { headers: getAuthHeaders() });
      if (oRes.ok) {
        var oData = await oRes.json();
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
          if ($("bm-stat-net-sales-today")) $("bm-stat-net-sales-today").textContent = formatMoney(completedSales) + " total penjualan";

          renderHariIniPendingOrders(pendingList);
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Orders Error]:", e);
    }

    // 3. Fetch dine-in tables layout
    try {
      var tRes = await adminFetch(API_BASE + "/dine-in/layout?branch_id=" + encodeURIComponent(branchId), { headers: getAuthHeaders() });
      if (tRes.ok) {
        var tData = await tRes.json();
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
      }
    } catch (e) {
      console.warn("[BM Hari Ini Layout Error]:", e);
    }

    // 4. Fetch low stock inventory alerts & unavailable products
    try {
      var iRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/inventory", { headers: getAuthHeaders() });
      var pRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/products", { headers: getAuthHeaders() });
      
      var lowItems = [];
      var unavailItems = [];

      if (iRes.ok) {
        var iData = await iRes.json();
        if (iData.success && Array.isArray(iData.inventory)) {
          lowItems = iData.inventory.filter(function (item) {
            return item.stock <= (item.low_stock_threshold || 5);
          });
        }
      }

      if (pRes.ok) {
        var pData = await pRes.json();
        if (pData.success && Array.isArray(pData.assignments)) {
          unavailItems = pData.assignments.filter(function (p) {
            return p.is_available === 0 || p.is_available === false;
          });
        }
      }

      renderHariIniAttention(lowItems, unavailItems);
    } catch (e) {
      console.warn("[BM Hari Ini Inventory/Menu Error]:", e);
    }

    // 5. Fetch active approved branch marketing promotions
    try {
      var promoRes = await adminFetch(API_BASE + "/admin/marketing/promotions", { headers: getAuthHeaders() });
      if (promoRes.ok) {
        var promoData = await promoRes.json();
        if (promoData.success && Array.isArray(promoData.promotions)) {
          var activePromos = promoData.promotions.filter(function (p) {
            var active = (p.is_active === 1 || p.is_active === true || p.status === "active");
            if (!active) return false;
            // Branch scope check: null branch_id applies to all branches
            if (!p.branch_id || p.branch_id === branchId) return true;
            return false;
          });
          renderHariIniPromos(activePromos);
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Promos Error]:", e);
    }

    // 6. Fetch authoritative recent branch operational activity logs
    try {
      var logsRes = await adminFetch(API_BASE + "/admin/branches/" + encodeURIComponent(branchId) + "/operation-logs?limit=5", { headers: getAuthHeaders() });
      if (logsRes.ok) {
        var logsData = await logsRes.json();
        if (logsData.success && Array.isArray(logsData.logs)) {
          renderHariIniRecentActivity(logsData.logs);
        }
      }
    } catch (e) {
      console.warn("[BM Hari Ini Logs Error]:", e);
    }
  }
  window.loadHariIni = loadHariIni;

  function renderHariIniPromos(promos) {
    var container = $("bm-active-promos-list");
    if (!container) return;

    if (!promos || !promos.length) {
      container.innerHTML = "<div class=\"text-muted text-center py-4\" style=\"font-size:13px;\">Belum ada promosi aktif di cabang ini.</div>";
      return;
    }

    container.innerHTML = promos.slice(0, 4).map(function (p) {
      var discountStr = p.discount_type === "percentage" ? (p.discount_value + "%") : formatMoney(p.discount_value);
      return "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#f0fdf4;border-radius:6px;border:1px solid #dcfce7;\">" +
        "<div>" +
          "<div style=\"display:flex;align-items:center;gap:6px;\">" +
            "<strong style=\"font-size:13px;color:#166534;\">" + esc(p.name || p.title) + "</strong>" +
            (p.code ? ("<code style=\"font-size:11px;background:#bbf7d0;color:#14532d;padding:1px 5px;border-radius:3px;\">" + esc(p.code) + "</code>") : "") +
          "</div>" +
          "<div style=\"font-size:11px;color:#15803d;margin-top:2px;\">" + esc(p.description || "Promosi aktif dapat digunakan pelanggan.") + "</div>" +
        "</div>" +
        "<span class=\"x-badge x-badge-success\" style=\"font-size:11px;\">" + discountStr + "</span>" +
      "</div>";
    }).join("");
  }

  function renderHariIniRecentActivity(logs) {
    var container = $("bm-recent-activity-list");
    if (!container) return;

    if (!logs || !logs.length) {
      container.innerHTML = "<div class=\"text-muted text-center py-4\" style=\"font-size:13px;\">Belum ada aktivitas operasional tercatat hari ini.</div>";
      return;
    }

    container.innerHTML = logs.slice(0, 5).map(function (l) {
      var timeStr = l.created_at ? l.created_at.substring(11, 16) : "—";
      var actorDesc = esc(l.actor_id || "Staf") + " (" + esc(l.actor_role || "system") + ")";
      var actionDesc = "";

      if (l.field === "is_open_override") {
        var isOpen = l.new_value === "1" || l.new_value === 1 || l.new_value === "true";
        actionDesc = isOpen ? "Membuka operasional cabang" : "Menutup operasional cabang sementara";
      } else if (l.field === "is_delivery_active") {
        var isDel = l.new_value === "1" || l.new_value === 1 || l.new_value === "true";
        actionDesc = isDel ? "Mengaktifkan layanan pesanan online" : "Menjeda pesanan online cabang";
      } else if (l.field === "is_available") {
        var isAvail = l.new_value === "1" || l.new_value === 1 || l.new_value === "true";
        actionDesc = (isAvail ? "Mengaktifkan kembali menu" : "Menandai menu habis") + (l.product_id ? (" [ID: " + esc(l.product_id) + "]") : "");
      } else {
        actionDesc = "Perubahan " + esc(l.field) + " &rarr; " + esc(l.new_value || "null");
      }

      return "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;font-size:12px;\">" +
        "<div>" +
          "<span style=\"font-weight:700;color:var(--text-main);\">" + actionDesc + "</span>" +
          "<div style=\"font-size:11px;color:var(--text-muted);margin-top:2px;\">Oleh: " + actorDesc + "</div>" +
        "</div>" +
        "<span style=\"color:var(--text-muted);font-weight:600;font-size:11px;\">" + timeStr + "</span>" +
      "</div>";
    }).join("");
  }

  function renderHariIniPendingOrders(orders) {
    var tbody = $("bm-tbody-pending-orders");
    var countBadge = $("bm-badge-pending-count");
    if (countBadge) {
      if (orders && orders.length > 0) {
        countBadge.textContent = orders.length + " Menunggu";
        countBadge.style.display = "inline-block";
      } else {
        countBadge.style.display = "none";
      }
    }
    if (!tbody) return;

    if (!orders || orders.length === 0) {
      tbody.innerHTML = "<tr><td colspan=\"7\" class=\"text-center py-6 text-muted\"><span style=\"color:var(--accent-green);font-weight:700;\">✓</span> Tidak ada antrean pesanan yang memerlukan tindakan saat ini.</td></tr>";
      return;
    }

    tbody.innerHTML = orders.map(function (o) {
      var orderNum = esc(o.order_number || o.id);
      var cust = esc(o.customer_name || "Pelanggan");
      var typeBadge = (o.order_type === "delivery")
        ? "<span class=\"x-badge x-badge-info\">DELIVERY</span>"
        : (o.order_type === "dine_in" ? "<span class=\"x-badge\" style=\"background:#ede9fe;color:#6d28d9;\">DINE IN</span>" : "<span class=\"x-badge x-badge-warning\">PICKUP</span>");
      var time = (o.created_at || "").substring(11, 16) || "—";
      var total = formatMoney(o.grand_total);
      var statusBadge = "<span class=\"x-badge x-badge-warning\">MENUNGGU KONFIRMASI</span>";

      return "<tr>" +
        "<td><strong>" + orderNum + "</strong></td>" +
        "<td>" + cust + "</td>" +
        "<td>" + typeBadge + "</td>" +
        "<td>" + time + "</td>" +
        "<td><strong>" + total + "</strong></td>" +
        "<td>" + statusBadge + "</td>" +
        "<td>" +
          "<div style=\"display:flex;gap:6px;\">" +
            "<button type=\"button\" class=\"x-btn-primary\" style=\"font-size:11px;padding:4px 8px;\" onclick=\"quickAcceptBMOrder('" + esc(o.id) + "', this)\">Terima</button>" +
            "<button type=\"button\" class=\"x-btn-secondary\" style=\"font-size:11px;padding:4px 8px;color:#dc2626;border-color:#fecaca;\" onclick=\"quickRejectBMOrder('" + esc(o.id) + "')\">Tolak</button>" +
          "</div>" +
        "</td>" +
      "</tr>";
    }).join("");
  }

  function renderHariIniAttention(lowItems, unavailItems) {
    var hasLow = lowItems && lowItems.length > 0;
    var hasUnavail = unavailItems && unavailItems.length > 0;

    var menuContainer = $("bm-menu-unavail-list");
    var menuBadge = $("bm-badge-menu-unavail");
    if (menuBadge) {
      menuBadge.textContent = hasUnavail ? (unavailItems.length + " Habis") : "0 Habis";
      menuBadge.className = "x-badge " + (hasUnavail ? "x-badge-danger" : "");
      if (!hasUnavail) {
        menuBadge.style.background = "#e2e8f0";
        menuBadge.style.color = "var(--text-muted)";
      } else {
        menuBadge.style.background = "";
        menuBadge.style.color = "";
      }
    }
    if (menuContainer) {
      if (!hasUnavail) {
        menuContainer.innerHTML = "<div class=\"text-muted text-center py-3\" style=\"font-size:12px;\"><span style=\"color:var(--accent-green);font-weight:700;\">✓</span> Semua menu tersedia</div>";
      } else {
        menuContainer.innerHTML = unavailItems.slice(0, 4).map(function (p) {
          return "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#fef2f2;border-radius:6px;border:1px solid #fee2e2;\">" +
            "<div>" +
              "<strong style=\"font-size:12px;color:#991b1b;\">" + esc(p.product_name || p.name) + "</strong>" +
              "<div style=\"font-size:11px;color:#b91c1c;\">Status: Ditandai Habis di Cabang</div>" +
            "</div>" +
            "<span class=\"x-badge x-badge-danger\" style=\"font-size:10px;\">HABIS</span>" +
          "</div>";
        }).join("");
      }
    }

    var stockContainer = $("bm-stock-low-list");
    var stockBadge = $("bm-badge-stock-low");
    if (stockBadge) {
      stockBadge.textContent = hasLow ? (lowItems.length + " Menipis") : "0 Menipis";
      stockBadge.className = "x-badge " + (hasLow ? "x-badge-warning" : "");
      if (!hasLow) {
        stockBadge.style.background = "#e2e8f0";
        stockBadge.style.color = "var(--text-muted)";
      } else {
        stockBadge.style.background = "";
        stockBadge.style.color = "";
      }
    }
    if (stockContainer) {
      if (!hasLow) {
        stockContainer.innerHTML = "<div class=\"text-muted text-center py-3\" style=\"font-size:12px;\"><span style=\"color:var(--accent-green);font-weight:700;\">✓</span> Tidak ada stok yang perlu diperhatikan</div>";
      } else {
        stockContainer.innerHTML = lowItems.slice(0, 4).map(function (it) {
          return "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#fffbeb;border-radius:6px;border:1px solid #fef3c7;\">" +
            "<div>" +
              "<strong style=\"font-size:12px;color:#92400e;\">" + esc(it.product_name || it.name || it.product_id) + "</strong>" +
              "<div style=\"font-size:11px;color:#b45309;\">Tersisa " + esc(it.stock) + " (Batas: " + esc(it.low_stock_threshold || 5) + ")</div>" +
            "</div>" +
            "<span class=\"x-badge x-badge-warning\" style=\"font-size:10px;\">STOK TIPIS</span>" +
          "</div>";
        }).join("");
      }
    }

    // Backwards compatibility for legacy container
    var legacyContainer = $("bm-low-stock-list");
    if (legacyContainer) {
      if (!hasLow && !hasUnavail) {
        legacyContainer.innerHTML = "<div class=\"text-muted text-center py-4\" style=\"font-size:13px;\">✓ Semua menu tersedia &amp; stok dalam batas aman.</div>";
      } else {
        legacyContainer.innerHTML = (menuContainer ? menuContainer.innerHTML : '') + (stockContainer ? stockContainer.innerHTML : '');
      }
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
