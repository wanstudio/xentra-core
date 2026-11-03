import re

# 1. Update apps/merchant-app/assets/css/home.css
css_file = '/home/ubuntu/xentra-core/apps/merchant-app/assets/css/home.css'
with open(css_file, 'r', encoding='utf-8') as f:
    css_content = f.read()

pos = css_content.find('.bm-pesanan-card {')
end_pos = css_content.find('/* Closed Restaurant Empty State', pos)

if pos != -1 and end_pos != -1:
    new_css = """/* ========================================================
   ORDER CARDS REDESIGN - FIGMA FRAME 208 / 312 SPECIFICATION
   ======================================================== */
.bm-pesanan-card {
  background: #ffffff !important;
  border-radius: 20px !important;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.04) !important;
  padding: 16px !important;
  margin: 0 !important;
  width: 100% !important;
  border: 1px solid #f1f5f9 !important;
  cursor: pointer !important;
  box-sizing: border-box !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 12px !important;
  position: relative !important;
  transition: transform 0.12s ease, box-shadow 0.12s ease !important;
  -webkit-tap-highlight-color: transparent !important;
}

.bm-pesanan-card:active {
  transform: scale(0.992) !important;
}

/* 1. Urgent Countdown Banner for Incoming / Pending Orders */
.urgent-timer-bar {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  background: #FF8736 !important;
  border-radius: 9.5px !important;
  height: 38px !important;
  padding: 0 14px !important;
  font-size: 12.5px !important;
  font-weight: 700 !important;
  color: #ffffff !important;
  box-sizing: border-box !important;
  margin: 0 !important;
}

.urgent-timer-bar .pulse-dot {
  width: 7px !important;
  height: 7px !important;
  border-radius: 50% !important;
  background: #ffffff !important;
  display: inline-block !important;
  animation: bmPulse 1.2s infinite !important;
}

@keyframes bmPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.5; }
}

/* 2. Card Header (Channel Icon 40x40, Order Code #ORD-XXX, Channel Pill Badge, Time) */
.bm-pesanan-card .card-head {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 10px !important;
  width: 100% !important;
}

.bm-pesanan-card .card-meta-left {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
}

.bm-pesanan-card .channel-avatar-icon {
  width: 40px !important;
  height: 40px !important;
  border-radius: 12px !important;
  object-fit: contain !important;
  background: #f8fafc !important;
  flex-shrink: 0 !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06) !important;
}

.bm-pesanan-card .order-meta-info {
  display: flex !important;
  flex-direction: column !important;
  gap: 3px !important;
}

.bm-pesanan-card .order-code {
  font-size: 14.5px !important;
  font-weight: 800 !important;
  color: #111827 !important;
  letter-spacing: -0.2px !important;
  line-height: 1.2 !important;
}

.bm-pesanan-card .channel-pill-badge {
  display: inline-flex !important;
  align-items: center !important;
  padding: 1px 8px !important;
  border-radius: 9999px !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  width: fit-content !important;
  line-height: 1.4 !important;
  white-space: nowrap !important;
}

.bm-pesanan-card .channel-pill-badge.delivery {
  background: #DBEAFF !important;
  color: #1E5EB2 !important;
  border: 1px solid rgba(30, 94, 178, 0.2) !important;
}

.bm-pesanan-card .channel-pill-badge.dine_in,
.bm-pesanan-card .channel-pill-badge.dinein {
  background: #F1F5F9 !important;
  color: #334155 !important;
  border: 1px solid #CBD5E1 !important;
}

.bm-pesanan-card .channel-pill-badge.takeaway,
.bm-pesanan-card .channel-pill-badge.pickup {
  background: #FEF3C7 !important;
  color: #B45309 !important;
  border: 1px solid #FCD34D !important;
}

.bm-pesanan-card .channel-pill-badge.reservation {
  background: #EDE9FE !important;
  color: #6D28D9 !important;
  border: 1px solid #DDD6FE !important;
}

.bm-pesanan-card .card-time {
  font-size: 11.5px !important;
  font-weight: 600 !important;
  color: #9ca3af !important;
  white-space: nowrap !important;
}

/* 3. Inline Kitchen Menu Items Preview (Figma Gray Box 15.5px Radius) */
.bm-pesanan-card .card-items-box {
  background: #F6F7F7 !important;
  border-radius: 15.5px !important;
  padding: 12px 14px !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  border: 1px solid #E5E7EB !important;
  box-sizing: border-box !important;
  width: 100% !important;
}

.bm-pesanan-card .item-row {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  font-size: 13px !important;
  color: #111827 !important;
  line-height: 1.35 !important;
}

.bm-pesanan-card .item-qty {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 22px !important;
  height: 22px !important;
  border-radius: 4px !important;
  background: #E6E6E6 !important;
  font-weight: 800 !important;
  color: #111827 !important;
  font-size: 11px !important;
  flex-shrink: 0 !important;
}

.bm-pesanan-card .item-name {
  font-weight: 600 !important;
  color: #111827 !important;
}

.bm-pesanan-card .item-notes-box {
  font-size: 11.5px !important;
  color: #64748B !important;
  font-weight: 500 !important;
  margin-left: 30px !important;
  margin-top: 2px !important;
}

/* 4. Action Buttons (Canonical Chromatic CTA System, 39px Capsule) */
.bm-pesanan-card .card-actions-dual {
  display: grid !important;
  grid-template-columns: 1fr 1fr !important;
  gap: 10px !important;
  width: 100% !important;
}

.bm-pesanan-card .card-actions-single {
  display: flex !important;
  width: 100% !important;
}

.bm-pesanan-card .card-actions-single .btn-act,
.bm-pesanan-card .card-actions-single .bm-pesanan-action-btn {
  width: 100% !important;
}

.bm-pesanan-card .btn-act,
.bm-pesanan-card .bm-pesanan-action-btn {
  border: none !important;
  border-radius: 19.5px !important;
  height: 39px !important;
  padding: 0 16px !important;
  font-size: 13px !important;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif !important;
  font-weight: 700 !important;
  letter-spacing: -0.01em !important;
  cursor: pointer !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  transition: all 0.15s ease !important;
  white-space: nowrap !important;
  user-select: none !important;
  box-sizing: border-box !important;
  margin: 0 !important;
}

.bm-pesanan-card .btn-act:active,
.bm-pesanan-card .bm-pesanan-action-btn:active {
  transform: scale(0.98) !important;
}

.bm-pesanan-card .btn-act-reject,
.bm-pesanan-card .btn-act-secondary {
  background: #ffffff !important;
  color: #374151 !important;
  border: 1.5px solid #E5E7EB !important;
  font-weight: 600 !important;
}

.bm-pesanan-card .btn-act-accept,
.bm-pesanan-card .btn-act-finish,
.bm-pesanan-card .bm-pesanan-action-btn.btn-green {
  background: #00A637 !important;
  color: #ffffff !important;
  border: none !important;
}

.bm-pesanan-card .btn-act-cook,
.bm-pesanan-card .bm-pesanan-action-btn.btn-blue {
  background: #1E5EB2 !important;
  color: #ffffff !important;
  border: none !important;
}

.bm-pesanan-card .btn-act-alert,
.bm-pesanan-card .bm-pesanan-action-btn.btn-coral {
  background: #FA3E3E !important;
  color: #ffffff !important;
  border: none !important;
}

.bm-pesanan-card .btn-act-floor,
.bm-pesanan-card .bm-pesanan-action-btn.btn-charcoal {
  background: #303030 !important;
  color: #ffffff !important;
  border: none !important;
}

.bm-pesanan-card .btn-act-transit {
  background: #EA580C !important;
  color: #ffffff !important;
  border: none !important;
}

"""
    css_content = css_content[:pos] + new_css + css_content[end_pos:]
    with open(css_file, 'w', encoding='utf-8') as f:
        f.write(css_content)
    print("Successfully replaced card CSS in home.css!")
else:
    print("Could not locate card css block in home.css")


# 2. Update apps/merchant-app/assets/js/orders.js
js_file = '/home/ubuntu/xentra-core/apps/merchant-app/assets/js/orders.js'
with open(js_file, 'r', encoding='utf-8') as f:
    js_content = f.read()

# Add formatBMCardTime helper if not present
if 'function formatBMCardTime(' not in js_content:
    target_fn = '  function renderBMOrdersFeed() {'
    replacement_fn = """  function formatBMCardTime(dateVal) {
    if (!dateVal) return '';
    var d = new Date(dateVal);
    if (isNaN(d.getTime())) d = new Date(String(dateVal).replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return '';
    var diffMs = Date.now() - d.getTime();
    if (diffMs < 60000 && diffMs >= 0) return 'Baru saja';
    if (diffMs < 3600000 && diffMs >= 0) return Math.floor(diffMs / 60000) + ' mnt lalu';
    try {
      return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(d) + ' WIB';
    } catch (e) {
      var h = d.getHours();
      var m = d.getMinutes();
      return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m) + ' WIB';
    }
  }

  function renderBMOrdersFeed() {"""
    js_content = js_content.replace(target_fn, replacement_fn, 1)
    print("Added formatBMCardTime helper to orders.js")

# Replace card mapping in renderBMOrdersFeed
old_card_map_pattern = re.compile(
    r'(\s*// 8\. Render cards matching Xentra Merchant - Pesanan Buka\s*container\.innerHTML = tabOrders\.map\(function \(ord\) \{)(.*?)(\s*\}\)\.join\(\'\'\);)',
    re.DOTALL
)

new_card_map_code = r"""\1
      var p = getBMOrderProjection(ord);
      var type = getBMOrderType(ord);
      var iconSrc = '/merchant-app/assets/icons/delivery.png';
      var badgeCls = 'delivery';
      var badgeLabel = 'Delivery';
      if (type === 'dine_in' || type === 'dinein') {
        iconSrc = '/merchant-app/assets/icons/dine-in.png';
        badgeCls = 'dine_in';
        badgeLabel = 'Dine-in';
      } else if (type === 'pickup' || type === 'takeaway') {
        iconSrc = '/merchant-app/assets/icons/takeaway.png';
        badgeCls = 'takeaway';
        badgeLabel = 'Takeaway';
      } else if (type === 'reservation') {
        iconSrc = '/merchant-app/assets/icons/reservasi 1.png';
        badgeCls = 'reservation';
        badgeLabel = 'Reservasi';
      }

      var orderCode = formatBMOrderCode(ord);
      var customerName = esc(ord.customer_name || 'Pelanggan');

      // Urgent countdown banner (Batas terima pesanan) for pending orders
      var urgentBarHtml = '';
      if (ord.status === 'pending') {
        var deadlineMs = ord.acceptance_deadline_at ? new Date(ord.acceptance_deadline_at).getTime() : (getOrderCreationMs(ord) + 180000);
        var msRemaining = deadlineMs - Date.now();
        if (msRemaining > 0) {
          var m = Math.floor(msRemaining / 60000);
          var s = Math.floor((msRemaining % 60000) / 1000);
          var timeStr = m + ':' + (s < 10 ? '0' : '') + s;
          urgentBarHtml =
            '<div class="urgent-timer-bar">' +
              '<span style="display:flex; align-items:center; gap:6px;">' +
                '<span class="pulse-dot"></span>' +
                'Batas terima pesanan:' +
              '</span>' +
              '<strong data-deadline="' + deadlineMs + '">' + timeStr + '</strong>' +
            '</div>';
        }
      }

      // Card Header Time
      var cardTime = formatBMCardTime(ord.created_at);

      // Table / Guest badge info
      var channelPillLabel = badgeLabel;
      if (type === 'dine_in' || type === 'dinein') {
        var tbl = ord.table_number || ord.table_name;
        if (tbl) channelPillLabel += ' • Meja ' + esc(tbl);
      } else if (type === 'reservation') {
        var guests = ord.guest_count || (ord.reservation && ord.reservation.guest_count);
        if (guests) channelPillLabel += ' • ' + guests + ' Tamu';
      }

      // Driver info (if delivery with assigned driver)
      var driverHtml = '';
      var dlv = ord.delivery;
      var driverName = ord.driver_name || (dlv && dlv.driver_name);
      if (driverName && type === 'delivery') {
        driverHtml =
          '<div style="font-size:11.5px; font-weight:700; color:#166534; background:#f0fdf4; border-radius:8px; padding:6px 10px; display:flex; align-items:center; gap:6px;">' +
            '🛵 Kurir: <strong>' + esc(driverName) + '</strong>' +
          '</div>';
      }

      // Cancel / Reject reason (if cancelled or rejected)
      var cancelReasonHtml = '';
      var cancelReason = ord.cancellation_reason || ord.cancel_reason;
      if (cancelReason && ['cancelled', 'rejected', 'timeout', 'fulfillment_exception'].indexOf(ord.status) !== -1) {
        cancelReasonHtml =
          '<div style="background:#fff1f2; border-radius:10px; padding:8px 12px; font-size:12px; color:#9f1239; font-weight:700;">' +
            'Alasan: ' + esc(cancelReason) +
          '</div>';
      }

      // Inline Kitchen Menu Preview (Gray Container with Quantity Badges & Notes)
      var items = ord.items || [];
      var itemsHtml = '';
      if (items.length) {
        itemsHtml = '<div class="card-items-box">' + items.map(function (it) {
          var q = Number(it.quantity || it.qty || 1);
          var name = esc(getBMOrderItemTitle(it));
          var notes = it.notes || it.kitchen_notes || '';
          var mods = formatBMItemModifiers(it);
          var noteParts = [];
          if (mods) noteParts.push(mods);
          if (notes) noteParts.push(notes);
          var noteStr = noteParts.join(' • ');

          return '<div>' +
            '<div class="item-row">' +
              '<span class="item-qty">' + q + 'x</span>' +
              '<strong class="item-name">' + name + '</strong>' +
            '</div>' +
            (noteStr ? '<div class="item-notes-box">Catatan: ' + esc(noteStr) + '</div>' : '') +
          '</div>';
        }).join('') + '</div>';
      } else {
        itemsHtml = '<div class="card-items-box"><div class="item-row"><span class="item-qty">1x</span><strong class="item-name">Pesanan Restoran</strong></div></div>';
      }

      // Pending Additions Alert
      var pendingAdditions = Number(ord.pending_additions_count || 0);
      var addonHtml = '';
      if (pendingAdditions > 0) {
        addonHtml =
          '<div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:12px; padding:10px 12px;">' +
            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
              '<strong style="font-size:12px; color:#1d4ed8;">Tambahan Menu Tamu (+' + pendingAdditions + ' item)</strong>' +
              '<span style="font-size:11.5px; font-weight:800; color:#2563eb;">Lihat Detail</span>' +
            '</div>' +
          '</div>';
      }

      // Action Button(s)
      var actionBtnsHtml = '';
      if (ord.status === 'pending') {
        actionBtnsHtml =
          '<div class="card-actions-dual" onclick="event.stopPropagation()">' +
            '<button type="button" class="btn-act btn-act-reject" onclick="openBMRejectModal(\'' + esc(ord.id) + '\', this)">Tolak</button>' +
            '<button type="button" class="btn-act btn-act-accept" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'pending\', \'' + esc(type) + '\', this)">Terima</button>' +
          '</div>';
      } else if (ord.status === 'confirmed' || ord.status === 'preparing') {
        actionBtnsHtml =
          '<div class="card-actions-single" onclick="event.stopPropagation()">' +
            '<button type="button" class="btn-act btn-act-cook" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'' + esc(String(ord.status)) + '\', \'' + esc(type) + '\', this)">Pesanan Siap</button>' +
          '</div>';
      } else if (ord.status === 'ready') {
        if (type === 'delivery') {
          var hasDriver = driverName || (dlv && dlv.driver_id);
          if (!hasDriver) {
            actionBtnsHtml =
              '<div class="card-actions-single" onclick="event.stopPropagation()">' +
                '<button type="button" class="btn-act btn-act-alert" onclick="openBMAssignDriverModal(\'' + esc(ord.id) + '\')">Tugaskan Kurir</button>' +
              '</div>';
          } else if (dlv && dlv.driver_assignment_status === 'accepted') {
            actionBtnsHtml =
              '<div class="card-actions-single" onclick="event.stopPropagation()">' +
                '<button type="button" class="btn-act btn-act-finish" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'ready\', \'' + esc(type) + '\', this)">Pesanan Terkirim</button>' +
              '</div>';
          } else {
            actionBtnsHtml =
              '<div class="card-actions-dual" onclick="event.stopPropagation()">' +
                '<button type="button" class="btn-act btn-act-secondary" onclick="openBMAssignDriverModal(\'' + esc(ord.id) + '\')">Ganti Kurir</button>' +
                '<button type="button" class="btn-act btn-act-transit" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'ready\', \'' + esc(type) + '\', this)">Serahkan ke Kurir</button>' +
              '</div>';
          }
        } else if (type === 'dine_in' || type === 'dinein') {
          actionBtnsHtml =
            '<div class="card-actions-single" onclick="event.stopPropagation()">' +
              '<button type="button" class="btn-act btn-act-finish" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'ready\', \'' + esc(type) + '\', this)">Tutup Meja / Selesai</button>' +
            '</div>';
        } else if (type === 'pickup' || type === 'takeaway') {
          actionBtnsHtml =
            '<div class="card-actions-single" onclick="event.stopPropagation()">' +
              '<button type="button" class="btn-act btn-act-finish" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'ready\', \'' + esc(type) + '\', this)">Serahkan</button>' +
            '</div>';
        } else {
          actionBtnsHtml =
            '<div class="card-actions-single" onclick="event.stopPropagation()">' +
              '<button type="button" class="btn-act btn-act-finish" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'ready\', \'' + esc(type) + '\', this)">Selesaikan</button>' +
            '</div>';
        }
      } else if (activeTabKey === 'scheduled') {
        if (type === 'reservation') {
          actionBtnsHtml =
            '<div class="card-actions-dual" onclick="event.stopPropagation()">' +
              '<button type="button" class="btn-act btn-act-secondary" onclick="noShowBMReservation(\'' + esc(ord.id) + '\')">Batal (No-Show)</button>' +
              '<button type="button" class="btn-act btn-act-floor" onclick="checkInBMReservation(\'' + esc(ord.id) + '\')">Check-in Tamu</button>' +
            '</div>';
        } else {
          actionBtnsHtml =
            '<div class="card-actions-single" onclick="event.stopPropagation()">' +
              '<button type="button" class="btn-act btn-act-cook" onclick="advanceBMOrderStatus(\'' + esc(ord.id) + '\', \'' + esc(String(ord.status)) + '\', \'' + esc(type) + '\', this)">Mulai Masak</button>' +
            '</div>';
        }
      } else if (activeTabKey === 'completed') {
        actionBtnsHtml =
          '<div class="card-actions-single" onclick="event.stopPropagation()">' +
            '<button type="button" class="btn-act btn-act-secondary" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">Lihat Detail / Cetak</button>' +
          '</div>';
      } else if (activeTabKey === 'cancelled') {
        actionBtnsHtml =
          '<div class="card-actions-single" onclick="event.stopPropagation()">' +
            '<button type="button" class="btn-act btn-act-secondary" onclick="openBMRejectedInfoModal(\'' + esc(ord.id) + '\')">Lihat Info Ditolak</button>' +
          '</div>';
      }

      return '<article class="bm-pesanan-card" data-order-id="' + esc(ord.id) + '" onclick="viewBMOrderDetail(\'' + esc(ord.id) + '\')">' +
        urgentBarHtml +
        '<div class="card-head">' +
          '<div class="card-meta-left">' +
            '<img src="' + iconSrc + '" class="channel-avatar-icon" alt="' + esc(badgeLabel) + '">' +
            '<div class="order-meta-info">' +
              '<span class="order-code">' + esc(orderCode) + '</span>' +
              '<span class="channel-pill-badge ' + badgeCls + '">' + channelPillLabel + '</span>' +
            '</div>' +
          '</div>' +
          '<span class="card-time">' + esc(cardTime) + '</span>' +
        '</div>' +
        driverHtml +
        cancelReasonHtml +
        itemsHtml +
        addonHtml +
        actionBtnsHtml +
      '</article>';\3"""

if old_card_map_pattern.search(js_content):
    js_content = old_card_map_pattern.sub(new_card_map_code, js_content)
    with open(js_file, 'w', encoding='utf-8') as f:
        f.write(js_content)
    print("Successfully replaced card mapping in orders.js!")
else:
    print("old_card_map_pattern NOT found in orders.js")
