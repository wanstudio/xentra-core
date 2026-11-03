/**
 * XENTRA OPERATIONAL MESSAGING PAGE ENGINE (OPS-CHAT v3)
 *
 * Full-Screen "One Task, One Layer" Architecture (GoBiz UX) + WhatsApp Message Lifecycle:
 *   - Screen 1 (Inbox Page):
 *       * Explicit Branch Selector for Owner (`📍 MyBangjo Pringsewu`)
 *       * Dedicated Division Channels per Branch (`Kepala Cabang`, `Kasir & Dapur`, `Tim Belanja Pasar`, `Koordinasi Kurir`)
 *       * 1-Way Branch Announcement Bulletin (`Papan Pengumuman Cabang` + Read Receipts)
 *       * Active Contextual Task Threads (`Order #`, `Pengantaran #`, `Mandat Belanja #`)
 *   - Screen 2 (Room Chat Page):
 *       * Dedicated 100dvh Chat View with Back Navigation (`←`), Branch Badge (`📍`), and Per-User Clear Chat (`🧹 Bersihkan Chat Saya`)
 *       * WhatsApp-style Per-User Clear Chat (`ops_thread_clears`): clearing a chat NEVER deletes messages on the other person's phone!
 *       * WhatsApp-style Sender-Only Unsend (`↩️ Tarik Pesan`): only the original sender can retract their own message (`🚫 Pesan ini telah ditarik`)
 *       * WhatsApp-style Delivery/Read ticks (`✓` Terkirim vs `✓✓` Dibaca) on outgoing bubbles
 */
(function () {
  'use strict';

  var QUICK_REPLIES = {
    driver: [
      { code: 'DRIVER_OTW', label: '🛵 Saya sedang menuju titik' },
      { code: 'DRIVER_ARRIVED', label: '📍 Saya sudah sampai di lokasi' },
      { code: 'ADDR_HARD', label: '🗺️ Alamat sulit ditemukan, mohon patokan' },
      { code: 'CUST_NO_ANSWER', label: '📵 Pelanggan ditelepon belum diangkat' },
      { code: 'TRAFFIC_RAIN', label: '🌧️ Hujan / macet, mohon tunggu sebentar' }
    ],
    cashier: [
      { code: 'ORDER_READY', label: '📦 Pesanan sudah siap diambil di kasir' },
      { code: 'WAIT_5M', label: '⏳ Dapur sedang kemas (±5 menit lagi)' },
      { code: 'CHECK_ITEMS', label: '✅ Pastikan sambal & minuman sudah lengkap' },
      { code: 'COD_REMIND', label: '💵 Jangan lupa tagih uang COD sesuai nota' }
    ],
    branch_manager: [
      { code: 'ORDER_READY', label: '📦 Pesanan siap diambil sekarang' },
      { code: 'PRICE_APPROVED', label: '✅ Perubahan harga disetujui, silakan beli' },
      { code: 'SEND_RECEIPT', label: '🧾 Tolong kirimkan foto struk/nota belanja' },
      { code: 'HOLD_ITEM', label: '✋ Tunda dulu item yang harganya naik' }
    ],
    purchasing: [
      { code: 'PRICE_UP', label: '📈 Harga bahan di pasar naik, tetap beli?' },
      { code: 'STOCK_EMPTY', label: '⚠️ Bahan habis di langganan, cari alternatif?' },
      { code: 'BOUGHT_DONE', label: '✅ Barang sudah dibeli & segera dikirim ke cabang' },
      { code: 'RECEIPT_ATTACHED', label: '🧾 Berikut foto nota/struk belanja' }
    ],
    owner: [
      { code: 'PRICE_APPROVED', label: '✅ Disetujui, lanjutkan operasional' },
      { code: 'SEND_RECEIPT', label: '🧾 Mohon lampirkan bukti foto struk' },
      { code: 'CHECK_SOP', label: '📌 Pastikan kualitas & SOP cabang terjaga' },
      { code: 'REPORT_STATUS', label: '📊 Mohon update kondisi cabang hari ini' }
    ]
  };

  var ROLE_LABELS = {
    owner: 'Owner',
    brand_manager: 'Brand Mgr',
    branch_manager: 'Kepala Cabang',
    cashier: 'Kasir',
    kitchen: 'Dapur',
    driver: 'Kurir',
    purchasing: 'Belanja'
  };

  var _state = {
    isOpen: false,
    mode: 'inbox', // 'inbox' | 'thread'
    entryOrigin: 'inbox', // 'inbox' | 'direct'
    selectedBranchId: '',
    selectedBranchName: '',
    branches: [],
    canSelectBranch: false,
    threadType: null,
    refId: null,
    branchName: '',
    title: '',
    subtitle: '',
    readOnly: false,
    readOnlyReason: null,
    canClearCurrentThread: false,
    messages: [],
    broadcastReceipts: [],
    pendingImageBase64: null,
    pendingImagePreview: null,
    isSending: false,
    pollTimer: null,
    bgPollTimer: null,
    lastKnownUnread: null,
    historyDepth: 0
  };

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getAuthToken() {
    var path = window.location.pathname || '';
    var keys = path.indexOf('/driver') === 0
      ? ['xentra_driver_token', 'xentra_merchant_token', 'token', 'xentra_token']
      : ['xentra_merchant_token', 'xentra_driver_token', 'token', 'xentra_token'];
    for (var i = 0; i < keys.length; i++) {
      var val = localStorage.getItem(keys[i]) || sessionStorage.getItem(keys[i]);
      if (val) return val;
    }
    return '';
  }

  function getCurrentUser() {
    var path = window.location.pathname || '';
    var keys = path.indexOf('/driver') === 0
      ? ['xentra_driver_user', 'xentra_merchant_user', 'user']
      : ['xentra_merchant_user', 'xentra_driver_user', 'user'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = localStorage.getItem(keys[i]) || sessionStorage.getItem(keys[i]);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && (parsed.id || parsed.userId || parsed.role)) return parsed;
        }
      } catch (_) {}
    }
    return {
      id: '',
      role: path.indexOf('/driver') === 0 ? 'driver' : (path.indexOf('/belanja') === 0 ? 'purchasing' : 'cashier')
    };
  }

  function apiRequest(path, options) {
    options = options || {};
    var token = getAuthToken();
    var user = getCurrentUser();
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (user && (user.brand_id || user.brandId)) {
      headers['X-Brand-Id'] = user.brand_id || user.brandId;
    }
    return fetch('/api/v1' + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      credentials: 'same-origin'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.success === false) {
          throw new Error(data.error || data.message || 'Permintaan gagal diproses');
        }
        return data;
      });
    });
  }

  function injectStyles() {
    if (document.getElementById('x-ops-chat-styles')) return;
    var style = document.createElement('style');
    style.id = 'x-ops-chat-styles';
    style.textContent =
      /* Full-screen Dedicated Page Container (GoBiz / Asphalt One Task One Layer) */
      '.x-ops-page-root{position:fixed;inset:0;z-index:12500;background:rgba(15,23,42,0.45);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);display:none;flex-direction:column;width:100%;height:100dvh;max-height:100dvh;overflow:hidden;font-family:"Plus Jakarta Sans",system-ui,-apple-system,sans-serif;color:#0f172a;touch-action:pan-y;transition:background-color .2s ease;}' +
      '.x-ops-page-root.is-open{display:flex;}' +
      '.x-ops-page-shell{width:100%;max-width:720px;margin:0 auto;height:100%;display:flex;flex-direction:column;background:#f8fafc;overflow:hidden;box-shadow:0 0 40px rgba(15,23,42,0.12);will-change:transform;}' +
      /* Suppress underlying app bottom navigation & floating bars when ops chat is active */
      'body.x-ops-chat-active .x-owner-bottom-nav,body.x-ops-chat-active .x-merchant-mobile-nav,body.x-ops-chat-active .pos-bottom-nav,body.x-ops-chat-active .bottom-nav,body.x-ops-chat-active .purchasing-bottom-nav,body.x-ops-chat-active .pos-mobile-cart-bar{pointer-events:none !important;visibility:hidden !important;display:none !important;}' +
      /* Top App Bar */
      '.x-ops-topbar{background:#ffffff;padding:max(12px,env(safe-area-inset-top)) 16px 12px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0;min-height:60px;box-sizing:border-box;}' +
      '.x-ops-topbar-left{display:flex;align-items:center;gap:12px;min-width:0;flex:1;}' +
      '.x-ops-nav-btn{width:38px;height:38px;border-radius:12px;border:1px solid #e2e8f0;background:#ffffff;color:#0f172a;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background .15s;}' +
      '.x-ops-nav-btn:active{background:#f1f5f9;transform:scale(0.96);}' +
      '.x-ops-clear-pill{height:34px;padding:0 11px;border-radius:10px;border:1px solid #e2e8f0;background:#f8fafc;color:#475569;font-size:11.5px;font-weight:800;display:inline-flex;align-items:center;gap:5px;cursor:pointer;flex-shrink:0;}' +
      '.x-ops-clear-pill:active{background:#f1f5f9;}' +
      '.x-ops-topbar-titles{min-width:0;flex:1;}' +
      '.x-ops-topbar-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
      '.x-ops-topbar-title{font-size:16px;font-weight:800;color:#0f172a;margin:0;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.x-ops-branch-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;white-space:nowrap;flex-shrink:0;}' +
      '.x-ops-topbar-sub{font-size:12px;color:#64748b;margin-top:2px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      /* Owner Branch Switcher Bar */
      '.x-ops-branch-bar{background:#ffffff;padding:10px 16px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;}' +
      '.x-ops-branch-label{font-size:12px;font-weight:800;color:#475569;display:flex;align-items:center;gap:6px;flex-shrink:0;}' +
      '.x-ops-branch-pills{display:flex;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:2px 0;}' +
      '.x-ops-branch-pill{border:1px solid #cbd5e1;background:#f8fafc;color:#334155;font-size:12.5px;font-weight:800;padding:6px 13px;border-radius:999px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;transition:all .15s;}' +
      '.x-ops-branch-pill.active{background:#0f172a;color:#ffffff;border-color:#0f172a;}' +
      /* Inbox Page Content */
      '.x-ops-inbox-scroll{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:20px;-webkit-overflow-scrolling:touch;}' +
      '.x-ops-section{display:flex;flex-direction:column;gap:10px;}' +
      '.x-ops-section-head{display:flex;align-items:center;justify-content:space-between;padding:0 2px;}' +
      '.x-ops-section-title{font-size:12px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.04em;margin:0;}' +
      '.x-ops-section-hint{font-size:11.5px;font-weight:600;color:#64748b;}' +
      '.x-ops-card-list{display:flex;flex-direction:column;gap:10px;}' +
      '.x-ops-room-card{background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;transition:border-color .15s,background .15s;box-shadow:0 1px 3px rgba(15,23,42,0.03);}' +
      '.x-ops-room-card:active{background:#f8fafc;border-color:#94a3b8;}' +
      '.x-ops-room-card.is-bulletin{background:linear-gradient(135deg,#fffbeb 0%,#ffffff 100%);border-color:#fde68a;}' +
      '.x-ops-room-icon{width:44px;height:44px;border-radius:13px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:21px;flex-shrink:0;}' +
      '.x-ops-room-card.is-bulletin .x-ops-room-icon{background:#fef3c7;}' +
      '.x-ops-room-main{min-width:0;flex:1;}' +
      '.x-ops-room-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}' +
      '.x-ops-room-title{font-size:14.5px;font-weight:800;color:#0f172a;line-height:1.25;}' +
      '.x-ops-room-desc{font-size:12px;color:#64748b;margin-top:2px;font-weight:600;}' +
      '.x-ops-room-preview{font-size:12.5px;color:#334155;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#f8fafc;padding:4px 8px;border-radius:8px;border:1px solid #f1f5f9;}' +
      '.x-ops-room-right{display:flex;align-items:center;gap:8px;flex-shrink:0;}' +
      '.x-ops-room-meta{display:flex;flex-direction:column;align-items:flex-end;gap:5px;}' +
      '.x-ops-room-time{font-size:11px;font-weight:700;color:#64748b;}' +
      '.x-ops-unread-badge{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#ef4444;color:#ffffff;font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;}' +
      /* Thread Messages Area */
      '.x-ops-chat-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch;}' +
      '.x-ops-msg-row{display:flex;flex-direction:column;max-width:85%;}' +
      '.x-ops-msg-row.mine{align-self:flex-end;align-items:flex-end;}' +
      '.x-ops-msg-row.theirs{align-self:flex-start;align-items:flex-start;}' +
      '.x-ops-msg-meta{font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px;display:flex;align-items:center;gap:6px;}' +
      '.x-ops-role-pill{font-size:9.5px;font-weight:800;padding:2px 7px;border-radius:99px;background:#e2e8f0;color:#334155;text-transform:uppercase;}' +
      '.x-ops-msg-bubble{padding:10px 13px 8px;border-radius:16px;font-size:14px;line-height:1.45;word-break:break-word;box-shadow:0 1px 2px rgba(15,23,42,0.06);position:relative;}' +
      '.x-ops-msg-row.mine .x-ops-msg-bubble{background:#2563eb;color:#ffffff;border-bottom-right-radius:4px;}' +
      '.x-ops-msg-row.theirs .x-ops-msg-bubble{background:#ffffff;color:#0f172a;border:1px solid #e2e8f0;border-bottom-left-radius:4px;}' +
      '.x-ops-msg-bubble.is-retracted{background:#f1f5f9 !important;color:#64748b !important;border:1px dashed #cbd5e1 !important;font-style:italic;font-size:13px;}' +
      '.x-ops-msg-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:4px;font-size:10.5px;opacity:0.88;}' +
      '.x-ops-tick{font-weight:800;letter-spacing:-1px;}' +
      '.x-ops-tick.read{color:#93c5fd;}' +
      '.x-ops-unsend-btn{border:none;background:rgba(255,255,255,0.18);color:#ffffff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;cursor:pointer;}' +
      '.x-ops-unsend-btn:active{background:rgba(255,255,255,0.3);}' +
      '.x-ops-msg-img{display:block;max-width:240px;max-height:240px;border-radius:12px;margin-bottom:6px;cursor:pointer;object-fit:cover;border:1px solid rgba(0,0,0,0.08);}' +
      '.x-ops-receipt-tag{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:6px;background:#fef3c7;color:#92400e;margin-bottom:6px;}' +
      /* Quick Replies & Composer */
      '.x-ops-quick-bar{display:flex;gap:8px;overflow-x:auto;padding:9px 14px;background:#ffffff;border-top:1px solid #f1f5f9;flex-shrink:0;-webkit-overflow-scrolling:touch;}' +
      '.x-ops-quick-chip{white-space:nowrap;border:1px solid #cbd5e1;background:#f8fafc;color:#1e293b;font-size:12.5px;font-weight:700;padding:7px 12px;border-radius:99px;cursor:pointer;flex-shrink:0;}' +
      '.x-ops-quick-chip:active{transform:scale(0.97);background:#eff6ff;border-color:#3b82f6;color:#1d4ed8;}' +
      '.x-ops-composer{background:#ffffff;padding:10px 14px max(14px,env(safe-area-inset-bottom));border-top:1px solid #e2e8f0;display:flex;flex-direction:column;gap:8px;flex-shrink:0;}' +
      '.x-ops-composer-row{display:flex;align-items:center;gap:8px;}' +
      '.x-ops-cam-btn{width:44px;height:44px;border-radius:12px;border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;font-size:19px;cursor:pointer;display:grid;place-items:center;flex-shrink:0;}' +
      '.x-ops-input{flex:1;height:44px;border-radius:12px;border:1px solid #cbd5e1;padding:0 14px;font-size:14px;font-family:inherit;outline:none;background:#ffffff;color:#0f172a;}' +
      '.x-ops-input:focus{border-color:#2563eb;}' +
      '.x-ops-send-btn{height:44px;padding:0 18px;border-radius:12px;border:none;background:#2563eb;color:#ffffff;font-weight:800;font-size:14px;cursor:pointer;flex-shrink:0;}' +
      '.x-ops-send-btn:disabled{opacity:0.5;cursor:not-allowed;}' +
      '.x-ops-preview-bar{display:flex;align-items:center;justify-content:space-between;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:8px 12px;font-size:12.5px;color:#1e3a8a;font-weight:700;}' +
      /* Lightweight Single-Action Confirm Dialog (Layer 2 Max) */
      '.x-ops-confirm-backdrop{position:fixed;inset:0;z-index:13600;background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Plus Jakarta Sans",system-ui,sans-serif;}' +
      '.x-ops-confirm-card{background:#ffffff;border-radius:20px;max-width:360px;width:100%;padding:22px 20px;box-shadow:0 20px 40px rgba(15,23,42,0.25);text-align:center;}';
    document.head.appendChild(style);
  }

  /**
   * Layer 1 Client-Side Canvas Image Compression (Max 1600px, JPEG q0.80, strips EXIF/GPS)
   */
  function compressImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !file.type || !file.type.startsWith('image/')) {
        return reject(new Error('File harus berupa gambar (JPG/PNG/WebP).'));
      }
      if (file.size > 10 * 1024 * 1024) {
        return reject(new Error('Ukuran foto maksimal 10 MB.'));
      }

      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Gagal membaca file gambar.')); };
      reader.onload = function (e) {
        var img = new Image();
        img.onerror = function () { reject(new Error('Gambar rusak atau tidak didukung.')); };
        img.onload = function () {
          var maxDim = 1600;
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (w > maxDim || h > maxDim) {
            if (w >= h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.80);
          resolve(dataUrl);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function formatTimeShort(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr.indexOf('T') === -1 ? isoStr.replace(' ', 'T') + 'Z' : isoStr);
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function openImageLightbox(url) {
    if (!url) return;
    var existing = document.getElementById('x-ops-lightbox');
    if (existing) existing.remove();
    var lb = document.createElement('div');
    lb.id = 'x-ops-lightbox';
    lb.style.cssText = 'position:fixed;inset:0;z-index:14000;background:rgba(0,0,0,0.9);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;';
    lb.innerHTML =
      '<img src="' + esc(url) + '" style="max-width:96%;max-height:82vh;border-radius:12px;object-fit:contain;box-shadow:0 10px 40px rgba(0,0,0,0.5);">' +
      '<button type="button" style="margin-top:16px;padding:10px 22px;border-radius:99px;border:none;background:#ffffff;color:#0f172a;font-weight:800;font-size:13.5px;cursor:pointer;">✕ Tutup Foto</button>';
    lb.onclick = function () { lb.remove(); };
    document.body.appendChild(lb);
  }

  /**
   * WhatsApp-style "Clear Chat for Me" Confirmation Modal
   */
  function confirmClearChatForMeModal(roomTitle, onConfirm) {
    var existing = document.getElementById('x-ops-confirm-modal');
    if (existing) existing.remove();

    var backdrop = document.createElement('div');
    backdrop.id = 'x-ops-confirm-modal';
    backdrop.className = 'x-ops-confirm-backdrop';
    backdrop.innerHTML =
      '<div class="x-ops-confirm-card" role="alertdialog" aria-modal="true">' +
        '<div style="width:52px;height:52px;border-radius:50%;background:#f1f5f9;color:#0f172a;display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 auto 12px;">🧹</div>' +
        '<h3 style="margin:0 0 6px;font-size:16.5px;font-weight:800;color:#0f172a;">Bersihkan Chat di Layar Anda?</h3>' +
        '<p style="margin:0 0 18px;font-size:12.5px;color:#475569;line-height:1.5;">' +
          'Riwayat di <strong>' + esc(roomTitle) + '</strong> akan dibersihkan dari tampilan perangkat Anda.<br>' +
          '<span style="color:#64748b;">Pesan di perangkat lawan bicara &amp; catatan audit tetap utuh (seperti WhatsApp).</span>' +
        '</p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
          '<button type="button" id="x-ops-cancel-del" style="height:42px;border-radius:12px;border:1px solid #cbd5e1;background:#ffffff;color:#334155;font-weight:800;font-size:13.5px;cursor:pointer;">Batal</button>' +
          '<button type="button" id="x-ops-confirm-del" style="height:42px;border-radius:12px;border:none;background:#0f172a;color:#ffffff;font-weight:800;font-size:13.5px;cursor:pointer;">Bersihkan</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(backdrop);

    backdrop.querySelector('#x-ops-cancel-del').onclick = function () {
      backdrop.remove();
    };
    backdrop.onclick = function (e) {
      if (e.target === backdrop) backdrop.remove();
    };
    backdrop.querySelector('#x-ops-confirm-del').onclick = function () {
      var btn = backdrop.querySelector('#x-ops-confirm-del');
      btn.disabled = true;
      btn.textContent = 'Membersihkan…';
      onConfirm(function () {
        backdrop.remove();
      });
    };
  }

  function executeClearRoomForMe(threadType, refId, roomTitle, afterSuccess) {
    confirmClearChatForMeModal(roomTitle, function (doneModal) {
      apiRequest('/messages/thread', {
        method: 'DELETE',
        body: {
          thread_type: threadType,
          ref_id: refId,
          branch_id: _state.selectedBranchId || undefined
        }
      })
        .then(function () {
          doneModal();
          if (typeof afterSuccess === 'function') afterSuccess();
        })
        .catch(function (err) {
          doneModal();
          alert(err.message || 'Gagal membersihkan percakapan.');
        });
    });
  }

  /**
   * WhatsApp-style Sender-Only "Unsend / Tarik Pesan" Confirmation Modal
   */
  function executeRetractOwnMessage(msgId) {
    var existing = document.getElementById('x-ops-confirm-modal');
    if (existing) existing.remove();

    var backdrop = document.createElement('div');
    backdrop.id = 'x-ops-confirm-modal';
    backdrop.className = 'x-ops-confirm-backdrop';
    backdrop.innerHTML =
      '<div class="x-ops-confirm-card" role="alertdialog" aria-modal="true">' +
        '<div style="width:52px;height:52px;border-radius:50%;background:#fff1f2;color:#dc2626;display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 auto 12px;">↩️</div>' +
        '<h3 style="margin:0 0 6px;font-size:16.5px;font-weight:800;color:#0f172a;">Tarik Pesan Ini untuk Semua?</h3>' +
        '<p style="margin:0 0 18px;font-size:12.5px;color:#475569;line-height:1.5;">' +
          'Pesan yang baru Anda kirim ini akan ditarik dan diganti dengan keterangan <em>"🚫 Pesan ini telah ditarik"</em>.' +
        '</p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
          '<button type="button" id="x-ops-cancel-unsend" style="height:42px;border-radius:12px;border:1px solid #cbd5e1;background:#ffffff;color:#334155;font-weight:800;font-size:13.5px;cursor:pointer;">Batal</button>' +
          '<button type="button" id="x-ops-confirm-unsend" style="height:42px;border-radius:12px;border:none;background:#dc2626;color:#ffffff;font-weight:800;font-size:13.5px;cursor:pointer;">Tarik Pesan</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(backdrop);

    backdrop.querySelector('#x-ops-cancel-unsend').onclick = function () {
      backdrop.remove();
    };
    backdrop.onclick = function (e) {
      if (e.target === backdrop) backdrop.remove();
    };
    backdrop.querySelector('#x-ops-confirm-unsend').onclick = function () {
      var btn = backdrop.querySelector('#x-ops-confirm-unsend');
      btn.disabled = true;
      btn.textContent = 'Menarik…';
      apiRequest('/messages/' + encodeURIComponent(msgId), { method: 'DELETE' })
        .then(function (res) {
          backdrop.remove();
          if (res && res.message) {
            for (var i = 0; i < _state.messages.length; i++) {
              if (_state.messages[i].id === msgId) {
                _state.messages[i] = res.message;
                break;
              }
            }
            updateThreadMessagesOnly(false);
          } else {
            fetchThreadMessages(false);
          }
        })
        .catch(function (err) {
          backdrop.remove();
          alert(err.message || 'Gagal menarik pesan.');
        });
    };
  }

  var _touchState = {
    startX: 0,
    startY: 0,
    currentX: 0,
    startTime: 0,
    isSwiping: false,
    activeShell: null
  };

  /**
   * Mobile Edge-Swipe Gesture Hand (Swipe Right from Left Edge to Go Back)
   * Standard iOS Safari & Android 14+ Predictive Back Mechanics
   */
  function bindSwipeGestures(root) {
    var shell = root.querySelector('.x-ops-page-shell');
    if (!shell || shell._hasSwipe) return;
    shell._hasSwipe = true;

    root.addEventListener('touchstart', function (e) {
      if (!_state.isOpen || !e.touches || e.touches.length !== 1) return;
      var touch = e.touches[0];
      // Only initiate swipe if starting within the left edge zone (left 48px or 15% of screen width)
      var maxEdge = Math.max(48, window.innerWidth * 0.15);
      if (touch.clientX > maxEdge) return;

      _touchState.startX = touch.clientX;
      _touchState.startY = touch.clientY;
      _touchState.currentX = touch.clientX;
      _touchState.startTime = Date.now();
      _touchState.isSwiping = false;
      _touchState.activeShell = shell;
      shell.style.transition = 'none';
    }, { passive: true });

    root.addEventListener('touchmove', function (e) {
      if (!_touchState.activeShell || !e.touches || e.touches.length !== 1) return;
      var touch = e.touches[0];
      var deltaX = touch.clientX - _touchState.startX;
      var deltaY = touch.clientY - _touchState.startY;

      // Only engage if moving rightward and distinctly more horizontal than vertical
      if (deltaX > 8 && deltaX > Math.abs(deltaY) * 1.2) {
        _touchState.isSwiping = true;
        _touchState.currentX = touch.clientX;
        var translateX = Math.max(0, deltaX);
        _touchState.activeShell.style.transform = 'translateX(' + translateX + 'px)';
        var opacity = Math.max(0.15, 1 - (translateX / (window.innerWidth * 1.2)));
        root.style.backgroundColor = 'rgba(15, 23, 42, ' + (0.45 * opacity) + ')';
      }
    }, { passive: true });

    root.addEventListener('touchend', function () {
      if (!_touchState.activeShell) return;
      var shell = _touchState.activeShell;
      _touchState.activeShell = null;

      if (!_touchState.isSwiping) {
        shell.style.transform = '';
        shell.style.transition = '';
        root.style.backgroundColor = '';
        return;
      }

      var deltaX = _touchState.currentX - _touchState.startX;
      var elapsed = Date.now() - _touchState.startTime;
      var velocity = elapsed > 0 ? (deltaX / elapsed) : 0;
      var threshold = Math.min(window.innerWidth * 0.35, 110);

      // Successfully triggered swipe back if dragged past threshold or quick flick
      if (deltaX > threshold || (deltaX > 40 && velocity > 0.35)) {
        shell.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
        shell.style.transform = 'translateX(' + window.innerWidth + 'px)';
        root.style.backgroundColor = 'rgba(15, 23, 42, 0)';
        setTimeout(function () {
          shell.style.transform = '';
          shell.style.transition = '';
          root.style.backgroundColor = '';
          navigateBack();
        }, 220);
      } else {
        // Snap back to position
        shell.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
        shell.style.transform = 'translateX(0)';
        root.style.backgroundColor = '';
        setTimeout(function () {
          shell.style.transform = '';
          shell.style.transition = '';
        }, 200);
      }
      _touchState.isSwiping = false;
    }, { passive: true });
  }

  function ensurePageShell() {
    injectStyles();
    var root = document.getElementById('x-ops-chat-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'x-ops-chat-root';
      root.className = 'x-ops-page-root';
      root.setAttribute('role', 'region');
      root.setAttribute('aria-label', 'Halaman Pesan Operasional');
      var shell = document.createElement('div');
      shell.className = 'x-ops-page-shell';
      root.appendChild(shell);
      document.body.appendChild(root);
      bindSwipeGestures(root);
    }
    root.classList.add('is-open');
    if (window.visualViewport) {
      root.style.height = window.visualViewport.height + 'px';
    }
    document.body.style.overflow = 'hidden';
    document.body.classList.add('x-ops-chat-active');

    var notifSheet = document.getElementById('sheet-notifications');
    if (notifSheet && notifSheet.style.display !== 'none') {
      notifSheet.style.display = 'none';
    }

    return root.querySelector('.x-ops-page-shell');
  }

  function buildMessagesHtml() {
    var user = getCurrentUser();
    var myId = String(user.id || user.userId || '');
    if (!_state.messages.length) {
      var isBulletin = _state.threadType === 'broadcast';
      return (
        '<div style="margin:auto;text-align:center;padding:40px 20px;color:#64748b;font-size:13.5px;max-width:320px;">' +
          '<div style="font-size:38px;margin-bottom:10px;">' + (isBulletin ? '📢' : '💬') + '</div>' +
          '<div style="font-weight:800;color:#0f172a;font-size:15px;margin-bottom:6px;">' +
            (isBulletin ? 'Belum Ada Pengumuman Cabang' : 'Ruang Percakapan Bersih') +
          '</div>' +
          '<div style="line-height:1.5;">' +
            (isBulletin
              ? 'Tulis pengumuman atau instruksi resmi di bawah untuk seluruh staf di cabang ini.'
              : 'Kirim pesan teks, pilih balasan cepat 1-ketuk, atau unggah foto bukti/struk di bawah.') +
          '</div>' +
        '</div>'
      );
    }

    var latestBroadcastReceipt = (_state.broadcastReceipts && _state.broadcastReceipts.length)
      ? _state.broadcastReceipts[0]
      : null;

    return _state.messages.map(function (m, idx) {
      var isMine = myId && String(m.sender_user_id) === myId;
      var roleLabel = ROLE_LABELS[m.sender_role] || m.sender_role;
      var imgHtml = '';
      if (!m.retracted) {
        if (m.media_purged) {
          imgHtml = '<div style="font-size:11px;font-style:italic;opacity:0.75;margin-bottom:4px;">[Foto otomatis dihapus setelah 90 hari]</div>';
        } else if (m.thumb_url || m.image_url) {
          imgHtml =
            (m.is_receipt ? '<div class="x-ops-receipt-tag">🧾 Bukti Struk Belanja (Permanen)</div>' : '') +
            '<img src="' + esc(m.thumb_url || m.image_url) + '" data-full-url="' + esc(m.image_url || m.thumb_url) + '" class="x-ops-msg-img" alt="Lampiran Foto">';
        }
      }

      var readReceiptHtml = '';
      if (_state.threadType === 'broadcast' && latestBroadcastReceipt && idx === _state.messages.length - 1 && !m.retracted) {
        readReceiptHtml =
          '<div style="font-size:11px;margin-top:6px;opacity:0.92;font-weight:800;border-top:1px solid rgba(255,255,255,0.2);padding-top:4px;">' +
            '✓ Diterima & dibaca ' + Number(latestBroadcastReceipt.read_count || 0) + ' dari ' + Number(latestBroadcastReceipt.total_recipients || 0) + ' staf cabang' +
          '</div>';
      }

      // WhatsApp-style footer inside outgoing bubble: time + delivery/read ticks + optional Unsend button
      var footerHtml = '';
      if (isMine && !m.retracted) {
        var isRead = m.delivery_status === 'read';
        var tickHtml = isRead
          ? '<span class="x-ops-tick read" title="Sudah dibaca">✓✓ Dibaca</span>'
          : '<span class="x-ops-tick" title="Terkirim">✓ Terkirim</span>';
        var unsendBtn = m.can_retract
          ? '<button type="button" class="x-ops-unsend-btn" data-unsend-id="' + esc(m.id) + '" title="Tarik pesan ini untuk semua orang">↩️ Tarik</button>'
          : '';
        footerHtml =
          '<div class="x-ops-msg-footer">' +
            unsendBtn +
            '<span>' + esc(formatTimeShort(m.created_at)) + '</span>' +
            tickHtml +
          '</div>';
      }

      return (
        '<div class="x-ops-msg-row ' + (isMine ? 'mine' : 'theirs') + '">' +
          '<div class="x-ops-msg-meta">' +
            '<span>' + esc(m.sender_name) + '</span>' +
            '<span class="x-ops-role-pill">' + esc(roleLabel) + '</span>' +
            (!isMine || m.retracted ? '<span>' + esc(formatTimeShort(m.created_at)) + '</span>' : '') +
          '</div>' +
          '<div class="x-ops-msg-bubble' + (m.retracted ? ' is-retracted' : '') + '">' +
            imgHtml +
            '<div>' + esc(m.body) + '</div>' +
            readReceiptHtml +
            footerHtml +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function bindMessageBubbleEvents(scrollEl) {
    if (!scrollEl) return;
    scrollEl.querySelectorAll('.x-ops-msg-img').forEach(function (img) {
      img.onclick = function () {
        openImageLightbox(img.getAttribute('data-full-url') || img.src);
      };
    });
    scrollEl.querySelectorAll('[data-unsend-id]').forEach(function (btn) {
      btn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        var msgId = btn.getAttribute('data-unsend-id');
        if (msgId) executeRetractOwnMessage(msgId);
      };
    });
  }

  function updateThreadMessagesOnly(forceScrollBottom) {
    var titleEl = document.getElementById('x-ops-header-title');
    var subEl = document.getElementById('x-ops-header-sub');
    var branchEl = document.getElementById('x-ops-header-branch');
    if (titleEl) titleEl.textContent = _state.title || 'Pesan Operasional';
    if (subEl) subEl.textContent = _state.subtitle || '';
    if (branchEl) {
      if (_state.branchName) {
        branchEl.textContent = '📍 ' + _state.branchName;
        branchEl.style.display = 'inline-flex';
      } else {
        branchEl.style.display = 'none';
      }
    }

    var scrollEl = document.getElementById('x-ops-chat-scroll');
    if (!scrollEl) {
      renderThreadPage();
      return;
    }
    var wasNearBottom = (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight) < 90;
    scrollEl.innerHTML = buildMessagesHtml();
    bindMessageBubbleEvents(scrollEl);
    if (forceScrollBottom || wasNearBottom) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }

  /**
   * SCREEN 2: FULL-SCREEN ROOM CHAT PAGE (100dvh)
   */
  function renderThreadPage() {
    var shell = ensurePageShell();
    var user = getCurrentUser();
    var myRole = String(user.role || 'cashier');
    var quickList = QUICK_REPLIES[myRole] || QUICK_REPLIES.cashier;
    var messagesHtml = buildMessagesHtml();

    var isPurchasingContext = _state.threadType === 'purchasing' ||
      (_state.threadType === 'channel' && String(_state.refId || '').slice(-10) === 'purchasing');

    var composerHtml = '';
    if (_state.readOnly) {
      composerHtml =
        '<div style="padding:14px 16px max(16px,env(safe-area-inset-bottom));background:#f1f5f9;border-top:1px solid #e2e8f0;text-align:center;font-size:13px;font-weight:700;color:#475569;">' +
          '🔒 ' + esc(_state.readOnlyReason || 'Percakapan ini hanya baca.') +
        '</div>';
    } else {
      var previewBar = _state.pendingImagePreview
        ? '<div class="x-ops-preview-bar">' +
            '<div style="display:flex;align-items:center;gap:10px;">' +
              '<img src="' + esc(_state.pendingImagePreview) + '" style="width:40px;height:40px;border-radius:8px;object-fit:cover;">' +
              '<span>' + (isPurchasingContext ? '🧾 Foto Struk siap dikirim (Terkompresi)' : '📷 Foto siap dikirim (Terkompresi)') + '</span>' +
            '</div>' +
            '<button type="button" id="x-ops-clear-img" style="border:none;background:transparent;color:#dc2626;font-weight:800;cursor:pointer;">Hapus</button>' +
          '</div>'
        : '';

      composerHtml =
        '<div class="x-ops-quick-bar">' +
          quickList.map(function (q) {
            return '<button type="button" class="x-ops-quick-chip" data-quick-code="' + esc(q.code) + '" data-quick-text="' + esc(q.label) + '">' + esc(q.label) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="x-ops-composer">' +
          previewBar +
          '<div class="x-ops-composer-row">' +
            '<button type="button" class="x-ops-cam-btn" id="x-ops-btn-camera" title="Lampirkan Foto / Struk">📷</button>' +
            '<input type="file" id="x-ops-file-input" accept="image/*" style="display:none;">' +
            '<input type="text" class="x-ops-input" id="x-ops-text-input" maxlength="500" placeholder="' +
              (isPurchasingContext
                ? 'Ketik pesan belanja atau lampirkan foto struk…'
                : (_state.threadType === 'broadcast' ? 'Tulis pengumuman resmi untuk cabang ini…' : 'Ketik pesan operasional…')) + '">' +
            '<button type="button" class="x-ops-send-btn" id="x-ops-btn-send"' + (_state.isSending ? ' disabled' : '') + '>' + (_state.isSending ? '…' : 'Kirim') + '</button>' +
          '</div>' +
        '</div>';
    }

    var clearForMeBtnHtml = _state.canClearCurrentThread
      ? '<button type="button" class="x-ops-clear-pill" id="x-ops-btn-clear-room" title="Bersihkan chat di layar saya (tidak menghapus di HP lawan bicara)">' +
          '<span>🧹 Bersihkan</span>' +
        '</button>'
      : '';

    shell.innerHTML =
      '<header class="x-ops-topbar">' +
        '<div class="x-ops-topbar-left">' +
          '<button type="button" class="x-ops-nav-btn" id="x-ops-btn-back" aria-label="Kembali">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>' +
          '</button>' +
          '<div class="x-ops-topbar-titles">' +
            '<div class="x-ops-topbar-title-row">' +
              '<h2 class="x-ops-topbar-title" id="x-ops-header-title">' + esc(_state.title || 'Pesan Operasional') + '</h2>' +
              '<span class="x-ops-branch-badge" id="x-ops-header-branch" style="' + (_state.branchName ? '' : 'display:none;') + '">📍 ' + esc(_state.branchName || '') + '</span>' +
            '</div>' +
            '<div class="x-ops-topbar-sub" id="x-ops-header-sub">' + esc(_state.subtitle || '') + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">' +
          clearForMeBtnHtml +
        '</div>' +
      '</header>' +
      '<div class="x-ops-chat-body" id="x-ops-chat-scroll">' + messagesHtml + '</div>' +
      composerHtml;

    var scrollEl = document.getElementById('x-ops-chat-scroll');
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;

    bindThreadEvents();
  }

  function bindThreadEvents() {
    var backBtn = document.getElementById('x-ops-btn-back');
    if (backBtn) {
      backBtn.onclick = function () {
        navigateBack();
      };
    }

    var clearRoomBtn = document.getElementById('x-ops-btn-clear-room');
    if (clearRoomBtn) {
      clearRoomBtn.onclick = function () {
        executeClearRoomForMe(_state.threadType, _state.refId, _state.title || 'Ruang Percakapan', function () {
          _state.messages = [];
          _state.canClearCurrentThread = false;
          if (_state.threadType === 'channel' || _state.threadType === 'broadcast') {
            renderThreadPage();
          } else {
            openInbox({ branchId: _state.selectedBranchId });
          }
        });
      };
    }

    var scrollEl = document.getElementById('x-ops-chat-scroll');
    bindMessageBubbleEvents(scrollEl);

    document.querySelectorAll('.x-ops-quick-chip').forEach(function (chip) {
      chip.onclick = function () {
        var text = chip.getAttribute('data-quick-text') || '';
        var code = chip.getAttribute('data-quick-code') || '';
        sendMessage(text, code);
      };
    });

    var camBtn = document.getElementById('x-ops-btn-camera');
    var fileInput = document.getElementById('x-ops-file-input');
    if (camBtn && fileInput) {
      camBtn.onclick = function () { fileInput.click(); };
      fileInput.onchange = function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        compressImageFile(file)
          .then(function (dataUrl) {
            _state.pendingImageBase64 = dataUrl;
            _state.pendingImagePreview = dataUrl;
            renderThreadPage();
          })
          .catch(function (err) {
            alert(err.message || 'Gagal memproses gambar');
          })
          .finally(function () {
            fileInput.value = '';
          });
      };
    }

    var clearImgBtn = document.getElementById('x-ops-clear-img');
    if (clearImgBtn) {
      clearImgBtn.onclick = function () {
        _state.pendingImageBase64 = null;
        _state.pendingImagePreview = null;
        renderThreadPage();
      };
    }

    var sendBtn = document.getElementById('x-ops-btn-send');
    var textInput = document.getElementById('x-ops-text-input');
    if (sendBtn && textInput) {
      sendBtn.onclick = function () {
        sendMessage(textInput.value.trim(), null);
      };
      textInput.onkeydown = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(textInput.value.trim(), null);
        }
      };
    }
  }

  function sendMessage(text, quickCode) {
    if (_state.isSending) return;
    if (!text && !_state.pendingImageBase64) return;

    var hadPendingImage = Boolean(_state.pendingImageBase64);
    var isPurchasingContext = _state.threadType === 'purchasing' ||
      (_state.threadType === 'channel' && String(_state.refId || '').slice(-10) === 'purchasing');

    _state.isSending = true;
    var sendBtn = document.getElementById('x-ops-btn-send');
    var textInput = document.getElementById('x-ops-text-input');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = '…';
    }

    apiRequest('/messages', {
      method: 'POST',
      body: {
        thread_type: _state.threadType,
        ref_id: _state.refId,
        branch_id: _state.selectedBranchId || undefined,
        body: text,
        quick_code: quickCode || null,
        image_base64: _state.pendingImageBase64 || null,
        is_receipt: isPurchasingContext && Boolean(_state.pendingImageBase64)
      }
    })
      .then(function (res) {
        _state.isSending = false;
        _state.pendingImageBase64 = null;
        _state.pendingImagePreview = null;
        if (res && res.message) {
          _state.messages.push(res.message);
          _state.canClearCurrentThread = true;
        }
        if (hadPendingImage) {
          renderThreadPage();
        } else {
          if (textInput) textInput.value = '';
          if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Kirim';
          }
          updateThreadMessagesOnly(true);
        }
      })
      .catch(function (err) {
        _state.isSending = false;
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Kirim';
        }
        alert(err.message || 'Gagal mengirim pesan');
      });
  }

  function fetchThreadMessages(isInitial) {
    if (!_state.isOpen || _state.mode !== 'thread' || !_state.threadType) return;
    var q = '?thread_type=' + encodeURIComponent(_state.threadType) +
            '&ref_id=' + encodeURIComponent(_state.refId || 'all') +
            (_state.selectedBranchId ? '&branch_id=' + encodeURIComponent(_state.selectedBranchId) : '');
    apiRequest('/messages' + q)
      .then(function (data) {
        if (!_state.isOpen || _state.mode !== 'thread') return;
        var prevSnapshot = JSON.stringify(_state.messages.map(function (m) {
          return m.id + ':' + (m.retracted ? '1' : '0') + ':' + (m.delivery_status || '');
        }));
        var prevReadOnly = _state.readOnly;
        var prevCanClear = _state.canClearCurrentThread;

        if (data.thread) {
          _state.refId = data.thread.ref_id || _state.refId;
          _state.title = data.thread.title || _state.title;
          _state.subtitle = data.thread.subtitle || _state.subtitle;
          _state.branchName = data.thread.branch_name || _state.branchName;
          _state.readOnly = Boolean(data.thread.read_only);
          _state.readOnlyReason = data.thread.read_only_reason || null;
          _state.canClearCurrentThread = Boolean(data.thread.can_clear);
        }
        _state.messages = Array.isArray(data.messages) ? data.messages : [];
        _state.broadcastReceipts = Array.isArray(data.broadcast_receipts) ? data.broadcast_receipts : [];

        var nextSnapshot = JSON.stringify(_state.messages.map(function (m) {
          return m.id + ':' + (m.retracted ? '1' : '0') + ':' + (m.delivery_status || '');
        }));

        if (prevReadOnly !== _state.readOnly || prevCanClear !== _state.canClearCurrentThread) {
          var inputEl = document.getElementById('x-ops-text-input');
          var draftVal = inputEl ? inputEl.value : '';
          renderThreadPage();
          var newInputEl = document.getElementById('x-ops-text-input');
          if (newInputEl && draftVal) newInputEl.value = draftVal;
        } else if (isInitial || prevSnapshot !== nextSnapshot) {
          updateThreadMessagesOnly(isInitial);
        }

        apiRequest('/messages/read', {
          method: 'POST',
          body: { thread_type: _state.threadType, ref_id: _state.refId }
        }).catch(function () {});
      })
      .catch(function () {});
  }

  function openThread(opts) {
    opts = opts || {};
    _state.isOpen = true;
    _state.mode = 'thread';
    _state.entryOrigin = opts.fromInbox ? 'inbox' : 'direct';
    _state.threadType = opts.threadType || 'order';
    _state.refId = opts.refId || 'all';
    _state.branchName = opts.branchName || _state.selectedBranchName || '';
    _state.title = opts.title || 'Pesan Operasional';
    _state.subtitle = opts.subtitle || '';
    _state.readOnly = Boolean(opts.readOnly);
    _state.readOnlyReason = null;
    _state.canClearCurrentThread = Boolean(opts.canClear);
    _state.messages = [];
    _state.pendingImageBase64 = null;
    _state.pendingImagePreview = null;

    ensurePageShell();

    if (!opts.fromPopState) {
      if (window.XentraNav && typeof window.XentraNav.push === 'function') {
        var threadCloseFn = (opts.fromInbox)
          ? function () { openInbox({ branchId: _state.selectedBranchId, fromPopState: true }); }
          : function () { close(true); };
        window.XentraNav.push(threadCloseFn, 'ops-chat-thread');
      } else if (window.history && typeof window.history.pushState === 'function') {
        try {
          window.history.pushState({
            xentraOpsChat: 'thread',
            fromInbox: Boolean(opts.fromInbox),
            threadType: _state.threadType,
            refId: _state.refId,
            branchName: _state.branchName,
            title: _state.title,
            subtitle: _state.subtitle
          }, '');
          _state.historyDepth++;
        } catch (_) {}
      }
    }

    renderThreadPage();
    fetchThreadMessages(true);

    if (_state.pollTimer) clearInterval(_state.pollTimer);
    _state.pollTimer = setInterval(function () {
      fetchThreadMessages(false);
    }, 5000);
  }

  /**
   * SCREEN 1: FULL-SCREEN INBOX & BRANCH CHANNELS PAGE (100dvh)
   */
  function openInbox(opts) {
    opts = opts || {};
    _state.isOpen = true;
    _state.mode = 'inbox';
    if (opts.branchId) {
      _state.selectedBranchId = opts.branchId;
    }
    if (_state.pollTimer) {
      clearInterval(_state.pollTimer);
      _state.pollTimer = null;
    }

    var shell = ensurePageShell();

    if (!opts.fromPopState) {
      if (window.XentraNav && typeof window.XentraNav.push === 'function') {
        window.XentraNav.push(function () {
          close(true);
        }, 'ops-chat-inbox');
      } else if (window.history && typeof window.history.pushState === 'function') {
        try {
          window.history.pushState({
            xentraOpsChat: 'inbox',
            branchId: _state.selectedBranchId
          }, '');
          _state.historyDepth++;
        } catch (_) {}
      }
    }

    shell.innerHTML =
      '<header class="x-ops-topbar">' +
        '<div class="x-ops-topbar-left">' +
          '<button type="button" class="x-ops-nav-btn" id="x-ops-inbox-close" aria-label="Kembali ke Aplikasi">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>' +
          '</button>' +
          '<div class="x-ops-topbar-titles">' +
            '<div class="x-ops-topbar-title-row">' +
              '<h2 class="x-ops-topbar-title">Komunikasi Operasional</h2>' +
              '<span class="x-ops-branch-badge" id="x-ops-inbox-branch-pill" style="display:none;"></span>' +
            '</div>' +
            '<div class="x-ops-topbar-sub">Saluran Divisi Cabang, Pengumuman & Tugas Aktif</div>' +
          '</div>' +
        '</div>' +
      '</header>' +
      '<div id="x-ops-branch-switcher-mount"></div>' +
      '<div class="x-ops-inbox-scroll" id="x-ops-inbox-content">' +
        '<div style="text-align:center;padding:48px 20px;color:#64748b;font-size:13.5px;">Memuat ruang komunikasi cabang…</div>' +
      '</div>';

    var closeBtn = document.getElementById('x-ops-inbox-close');
    if (closeBtn) closeBtn.onclick = function () {
      navigateBack();
    };

    var query = _state.selectedBranchId ? ('?branch_id=' + encodeURIComponent(_state.selectedBranchId)) : '';
    apiRequest('/messages/inbox' + query)
      .then(function (data) {
        if (!_state.isOpen || _state.mode !== 'inbox') return;

        updateGlobalBadges(data.total_unread || 0);
        _state.canSelectBranch = Boolean(data.can_select_branch);
        _state.branches = Array.isArray(data.branches) ? data.branches : [];
        if (data.active_branch && data.active_branch.id) {
          _state.selectedBranchId = data.active_branch.id;
          _state.selectedBranchName = data.active_branch.name || 'Cabang';
        }

        var topBranchBadge = document.getElementById('x-ops-inbox-branch-pill');
        if (topBranchBadge && _state.selectedBranchName) {
          topBranchBadge.textContent = '📍 ' + _state.selectedBranchName;
          topBranchBadge.style.display = 'inline-flex';
        }

        var branchMount = document.getElementById('x-ops-branch-switcher-mount');
        if (branchMount) {
          if (_state.canSelectBranch && _state.branches.length > 0) {
            branchMount.innerHTML =
              '<div class="x-ops-branch-bar">' +
                '<div class="x-ops-branch-label"><span>📍 Cabang Aktif:</span></div>' +
                '<div class="x-ops-branch-pills">' +
                  _state.branches.map(function (b) {
                    var isAct = String(b.id) === String(_state.selectedBranchId);
                    return (
                      '<button type="button" class="x-ops-branch-pill' + (isAct ? ' active' : '') + '" data-branch-id="' + esc(b.id) + '">' +
                        '<span>🏪 ' + esc(b.name) + '</span>' +
                        (isAct ? '<span>✓</span>' : '') +
                      '</button>'
                    );
                  }).join('') +
                '</div>' +
              '</div>';

            branchMount.querySelectorAll('.x-ops-branch-pill').forEach(function (btn) {
              btn.onclick = function () {
                var bid = btn.getAttribute('data-branch-id');
                if (bid && bid !== _state.selectedBranchId) {
                  openInbox({ branchId: bid });
                }
              };
            });
          } else {
            branchMount.innerHTML = '';
          }
        }

        renderInboxSections(data);
      })
      .catch(function (err) {
        var contentEl = document.getElementById('x-ops-inbox-content');
        if (contentEl) {
          contentEl.innerHTML =
            '<div style="padding:32px 20px;text-align:center;color:#dc2626;font-size:13.5px;">' +
              esc(err.message || 'Gagal memuat kotak masuk.') +
            '</div>';
        }
      });
  }

  function buildRoomCardHtml(item, isBulletin) {
    var last = item.last_message || null;
    var previewHtml = last
      ? '<div class="x-ops-room-preview"><strong>' + esc(last.sender_name || 'Staf') + ':</strong> ' + esc(last.body || '') + '</div>'
      : '<div class="x-ops-room-desc">' + esc(item.subtitle || '') + '</div>';

    return (
      '<div class="x-ops-room-card' + (isBulletin ? ' is-bulletin' : '') + '" ' +
           'data-room-type="' + esc(item.thread_type) + '" ' +
           'data-room-ref="' + esc(item.ref_id) + '" ' +
           'data-room-branch="' + esc(item.branch_name || _state.selectedBranchName || '') + '" ' +
           'data-room-title="' + esc(item.title) + '" ' +
           'data-room-sub="' + esc(item.subtitle || '') + '" ' +
           'data-room-clear="' + (item.can_clear ? '1' : '0') + '">' +
        '<div class="x-ops-room-icon">' + esc(item.icon || '💬') + '</div>' +
        '<div class="x-ops-room-main">' +
          '<div class="x-ops-room-top">' +
            '<span class="x-ops-room-title">' + esc(item.title.replace(/^[^\s]+\s/, '')) + '</span>' +
            (item.branch_name ? '<span class="x-ops-branch-badge">📍 ' + esc(item.branch_name) + '</span>' : '') +
          '</div>' +
          previewHtml +
        '</div>' +
        '<div class="x-ops-room-right">' +
          '<div class="x-ops-room-meta">' +
            (last && last.created_at ? '<span class="x-ops-room-time">' + esc(formatTimeShort(last.created_at)) + '</span>' : '') +
            (item.unread_count > 0 ? '<span class="x-ops-unread-badge">' + item.unread_count + '</span>' : '<span style="color:#94a3b8;font-size:18px;font-weight:700;">›</span>') +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderInboxSections(data) {
    var contentEl = document.getElementById('x-ops-inbox-content');
    if (!contentEl) return;

    var divisionChannels = Array.isArray(data.division_channels) ? data.division_channels : [];
    var bulletin = data.bulletin || null;
    var taskThreads = Array.isArray(data.threads) ? data.threads : [];

    var html = '';

    // SECTION 1: DEDICATED DIVISION CHANNELS PER BRANCH
    if (divisionChannels.length > 0) {
      html +=
        '<section class="x-ops-section">' +
          '<div class="x-ops-section-head">' +
            '<h3 class="x-ops-section-title">💬 Saluran Divisi Cabang</h3>' +
            '<span class="x-ops-section-hint">Ruang terpisah per peran</span>' +
          '</div>' +
          '<div class="x-ops-card-list">' +
            divisionChannels.map(function (ch) { return buildRoomCardHtml(ch, false); }).join('') +
          '</div>' +
        '</section>';
    }

    // SECTION 2: 1-WAY ANNOUNCEMENT BULLETIN
    if (bulletin) {
      html +=
        '<section class="x-ops-section">' +
          '<div class="x-ops-section-head">' +
            '<h3 class="x-ops-section-title">📢 Papan Pengumuman Resmi</h3>' +
            '<span class="x-ops-section-hint">1 arah ke seluruh staf cabang</span>' +
          '</div>' +
          '<div class="x-ops-card-list">' +
            buildRoomCardHtml(bulletin, true) +
          '</div>' +
        '</section>';
    }

    // SECTION 3: ACTIVE TASK THREADS (Order / Delivery / Mandate)
    html +=
      '<section class="x-ops-section">' +
        '<div class="x-ops-section-head">' +
          '<h3 class="x-ops-section-title">📦 Percakapan Tugas (Order / Kurir / PO)</h3>' +
          '<span class="x-ops-section-hint">' + taskThreads.length + ' ruang aktif</span>' +
        '</div>';

    if (!taskThreads.length) {
      html +=
        '<div style="background:#ffffff;border:1px dashed #cbd5e1;border-radius:16px;padding:22px 16px;text-align:center;color:#64748b;font-size:12.5px;">' +
          'Belum ada percakapan spesifik per nomor pesanan/pengantaran. Anda dapat langsung menggunakan <strong>Saluran Divisi Cabang</strong> di atas kapan saja.' +
        '</div>';
    } else {
      html +=
        '<div class="x-ops-card-list">' +
          taskThreads.map(function (t) { return buildRoomCardHtml(t, false); }).join('') +
        '</div>';
    }
    html += '</section>';

    contentEl.innerHTML = html;

    // Bind room card click to navigate to Full-Screen Thread Page
    contentEl.querySelectorAll('.x-ops-room-card').forEach(function (card) {
      card.onclick = function () {
        openThread({
          fromInbox: true,
          threadType: card.getAttribute('data-room-type'),
          refId: card.getAttribute('data-room-ref'),
          branchName: card.getAttribute('data-room-branch'),
          title: card.getAttribute('data-room-title'),
          subtitle: card.getAttribute('data-room-sub'),
          canClear: card.getAttribute('data-room-clear') === '1'
        });
      };
    });
  }

  function navigateBack() {
    if (!_state.isOpen) return;

    if (window.XentraNav && typeof window.XentraNav.pop === 'function') {
      if (_state.mode === 'thread' && window.XentraNav.hasOpen('ops-chat-thread')) {
        window.XentraNav.pop('ops-chat-thread');
        return;
      }
      if (_state.mode === 'inbox' && window.XentraNav.hasOpen('ops-chat-inbox')) {
        window.XentraNav.pop('ops-chat-inbox');
        return;
      }
    }

    if (_state.historyDepth > 0 && window.history && typeof window.history.back === 'function') {
      window.history.back();
      return;
    }
    if (_state.mode === 'thread' && _state.entryOrigin === 'inbox') {
      openInbox({ branchId: _state.selectedBranchId, fromPopState: true });
    } else {
      close(true);
    }
  }

  function close(fromPopState) {
    if (!fromPopState) {
      if (window.XentraNav && typeof window.XentraNav.pop === 'function') {
        if (window.XentraNav.hasOpen('ops-chat-thread')) {
          window.XentraNav.pop('ops-chat-thread');
        }
        if (window.XentraNav.hasOpen('ops-chat-inbox')) {
          window.XentraNav.pop('ops-chat-inbox');
        }
      } else if (_state.historyDepth > 0 && window.history && typeof window.history.back === 'function') {
        window.history.back();
        return;
      }
    }

    _state.isOpen = false;
    _state.historyDepth = 0;
    if (_state.pollTimer) {
      clearInterval(_state.pollTimer);
      _state.pollTimer = null;
    }
    var root = document.getElementById('x-ops-chat-root');
    if (root) {
      root.classList.remove('is-open');
      root.style.backgroundColor = '';
      var shell = root.querySelector('.x-ops-page-shell');
      if (shell) {
        shell.style.transform = '';
        shell.style.transition = '';
      }
    }
    document.body.style.overflow = '';
    document.body.classList.remove('x-ops-chat-active');
    pollUnreadSummary();
  }

  function updateGlobalBadges(totalUnread) {
    document.querySelectorAll('[data-ops-chat-badge]').forEach(function (el) {
      if (totalUnread > 0) {
        el.textContent = totalUnread > 99 ? '99+' : String(totalUnread);
        el.style.display = 'inline-grid';
      } else {
        el.style.display = 'none';
      }
    });
  }

  function pollUnreadSummary() {
    if (!getAuthToken()) return;
    apiRequest('/messages/inbox')
      .then(function (data) {
        var count = Number(data.total_unread || 0);
        if (_state.lastKnownUnread !== null && count > _state.lastKnownUnread) {
          if (window.XentraAudio && typeof window.XentraAudio.statusUpdate === 'function') {
            window.XentraAudio.statusUpdate({ text: 'Ada pesan operasional baru' });
          }
        }
        _state.lastKnownUnread = count;
        updateGlobalBadges(count);
      })
      .catch(function () {});
  }

  function startBackgroundPolling() {
    if (_state.bgPollTimer) return;
    setTimeout(pollUnreadSummary, 1500);
    _state.bgPollTimer = setInterval(pollUnreadSummary, 7000);
  }

  // Support Hardware Android Back Button, Edge Swipe, & Browser History
  window.addEventListener('popstate', function (e) {
    if (!_state.isOpen) return;

    if (window.XentraNav && typeof window.XentraNav.hasOpen === 'function') {
      if (window.XentraNav.hasOpen('ops-chat-thread') || window.XentraNav.hasOpen('ops-chat-inbox')) {
        return;
      }
    }

    if (_state.historyDepth > 0) {
      _state.historyDepth--;
    }

    var st = (e && e.state) || {};
    if (st.xentraOpsChat === 'inbox') {
      openInbox({ branchId: st.branchId || _state.selectedBranchId, fromPopState: true });
      return;
    }
    if (st.xentraOpsChat === 'thread') {
      openThread({
        fromInbox: Boolean(st.fromInbox),
        threadType: st.threadType,
        refId: st.refId,
        branchName: st.branchName,
        title: st.title,
        subtitle: st.subtitle,
        fromPopState: true
      });
      return;
    }

    close(true);
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      var root = document.getElementById('x-ops-chat-root');
      if (root && _state.isOpen) {
        root.style.height = window.visualViewport.height + 'px';
        var scrollEl = document.getElementById('x-ops-chat-scroll');
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
      }
    });
  }

  // Global click delegation for `[data-ops-chat-thread]` and `[data-ops-chat-inbox]` across all 4 apps
  document.addEventListener('click', function (e) {
    var threadBtn = e.target && e.target.closest('[data-ops-chat-thread]');
    if (threadBtn) {
      e.preventDefault();
      e.stopPropagation();
      var reqType = threadBtn.getAttribute('data-ops-chat-thread') || 'order';
      var reqRef = threadBtn.getAttribute('data-ops-chat-ref') || 'all';
      if (reqType === 'purchasing' && reqRef === 'daily') {
        openThread({
          fromInbox: false,
          threadType: 'channel',
          refId: 'purchasing',
          title: '🛒 Tim Belanja Pasar',
          subtitle: 'Koordinasi belanja bahan baku & foto struk harian'
        });
        return;
      }
      openThread({
        fromInbox: false,
        threadType: reqType,
        refId: reqRef,
        title: threadBtn.getAttribute('data-ops-chat-title') || 'Pesan Operasional',
        subtitle: threadBtn.getAttribute('data-ops-chat-sub') || ''
      });
      return;
    }
    var inboxBtn = e.target && e.target.closest('[data-ops-chat-inbox]');
    if (inboxBtn) {
      e.preventDefault();
      e.stopPropagation();
      openInbox();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startBackgroundPolling);
  } else {
    startBackgroundPolling();
  }

  window.XentraOpsChat = {
    openThread: openThread,
    openInbox: openInbox,
    close: close,
    refreshUnread: pollUnreadSummary
  };
})();
