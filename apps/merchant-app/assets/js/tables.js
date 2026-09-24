/**
 * XENTRA CORE — MERCHANT APP TABLES
 *
 * Branch Manager dine-in table operations.
 */
(function () {
  'use strict';

  var S = window.XentraShared;
  var API_BASE = S.API_BASE;
  var $ = S.$;
  var esc = S.esc;
  var adminFetch = S.adminFetch;
  var getAuthHeaders = S.getAuthHeaders;
  var getStoredUser = S.getStoredUser;
  var getBMTargetBranchId = window.getBMTargetBranchId;
  var showToast = S.showToast;

  var _bmTablesState = {
    tables: [],
    filterStatus: 'all',
    fetchSeq: 0
  };

  async function loadBMTables() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var grid = $('bm-tables-grid');
    if (grid && (!_bmTablesState.tables || !_bmTablesState.tables.length)) {
      grid.innerHTML = '<div class="text-center py-6 text-muted" style="grid-column:1/-1;">Memuat data meja cabang...</div>';
    }

    var currentSeq = ++_bmTablesState.fetchSeq;

    try {
      var res = await adminFetch(API_BASE + '/dine-in/layout?branch_id=' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmTablesState.fetchSeq) return;

      if (res.ok && data.success && data.layout && Array.isArray(data.layout.tables)) {
        _bmTablesState.tables = data.layout.tables;
        updateBMTableStats(data.layout.tables);
        renderBMTablesGrid();
      } else {
        if (grid) {
          grid.innerHTML = '<div class="text-center py-6 text-danger" style="grid-column:1/-1;">Gagal memuat meja: ' + esc(data.error || 'Terjadi kesalahan') + '</div>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmTablesState.fetchSeq) return;
      console.warn('[BM Tables Load Error]:', err);
      if (grid) {
        grid.innerHTML = '<div class="text-center py-6 text-danger" style="grid-column:1/-1;">Kesalahan jaringan saat memuat meja.</div>';
      }
    }
  }
  window.loadBMTables = loadBMTables;

  function updateBMTableStats(tables) {
    var avail = 0, occupied = 0, held = 0, blocked = 0;
    var occupiedPwa = 0, occupiedPos = 0;
    (tables || []).forEach(function (t) {
      var st = t.operational_state || 'available';
      if (st === 'available') {
        avail++;
      } else if (st === 'occupied') {
        occupied++;
        if (t.session_channel === 'pos_cashier') {
          occupiedPos++;
        } else {
          occupiedPwa++;
        }
      } else if (st === 'held') {
        held++;
      } else if (st === 'blocked' || st === 'out_of_service') {
        blocked++;
      }
    });

    if ($('bm-tables-stat-available')) $('bm-tables-stat-available').textContent = avail;
    if ($('bm-tables-stat-occupied')) $('bm-tables-stat-occupied').textContent = occupied;
    if ($('bm-tables-stat-occupied-breakdown')) {
      $('bm-tables-stat-occupied-breakdown').textContent = 'PWA: ' + occupiedPwa + ' | Kasir: ' + occupiedPos;
    }
    if ($('bm-tables-stat-held')) $('bm-tables-stat-held').textContent = held;
    if ($('bm-tables-stat-blocked')) $('bm-tables-stat-blocked').textContent = blocked;
  }

  function onBMTablesFilterChange() {
    var filterEl = $('bm-tables-filter-status');
    if (filterEl) _bmTablesState.filterStatus = filterEl.value;
    renderBMTablesGrid();
  }
  window.onBMTablesFilterChange = onBMTablesFilterChange;

  function renderBMTablesGrid() {
    var grid = $('bm-tables-grid');
    if (!grid) return;

    var filtered = (_bmTablesState.tables || []).filter(function (t) {
      var st = t.operational_state || 'available';
      if (_bmTablesState.filterStatus === 'available') return st === 'available';
      if (_bmTablesState.filterStatus === 'occupied') return st === 'occupied';
      if (_bmTablesState.filterStatus === 'occupied_pwa') return st === 'occupied' && t.session_channel !== 'pos_cashier';
      if (_bmTablesState.filterStatus === 'occupied_pos') return st === 'occupied' && t.session_channel === 'pos_cashier';
      if (_bmTablesState.filterStatus === 'held') return st === 'held';
      if (_bmTablesState.filterStatus === 'blocked') return (st === 'blocked' || st === 'out_of_service');
      return true;
    });

    if (!filtered.length) {
      grid.innerHTML = '<div class="text-center py-6 text-muted" style="grid-column:1/-1;">Tidak ada meja yang sesuai filter status saat ini.</div>';
      return;
    }

    var stateCardConfigs = {
      available: { bg: '#ffffff', border: '#bbf7d0', badge: '<span class="x-badge x-badge-success">TERSEDIA</span>' },
      occupied: { bg: '#ffffff', border: '#bfdbfe', badge: '<span class="x-badge x-badge-info">TERISI</span>' },
      held: { bg: '#ffffff', border: '#fde68a', badge: '<span class="x-badge x-badge-warning">DITAHAN</span>' },
      blocked: { bg: '#fef2f2', border: '#fecaca', badge: '<span class="x-badge x-badge-danger">DIBLOKIR</span>' },
      out_of_service: { bg: '#fef2f2', border: '#fecaca', badge: '<span class="x-badge x-badge-danger">RUSAK</span>' }
    };

    grid.innerHTML = filtered.map(function (t) {
      var st = t.operational_state || 'available';
      var cfg = stateCardConfigs[st] || stateCardConfigs.available;
      var isBlocked = (st === 'blocked' || st === 'out_of_service');

      var actionsHtml = '';
      if (isBlocked) {
        actionsHtml = '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%; color:#166534; border-color:#bbf7d0;" onclick="toggleBMTableBlocked(\'' + esc(t.id) + '\', false)">Buka Blokir (Tersedia)</button>';
      } else if (st === 'available') {
        actionsHtml = '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%; color:#dc2626; border-color:#fecaca;" onclick="toggleBMTableBlocked(\'' + esc(t.id) + '\', true)">Blokir Meja</button>';
      } else if (st === 'occupied' && t.current_session_id) {
        actionsHtml = '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%;" onclick="completeBMTableSession(\'' + esc(t.current_session_id) + '\')">Selesaikan Sesi Makan</button>';
      } else {
        actionsHtml = '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%;" disabled>Sedang Digunakan</button>';
      }

      var channelBadge = '';
      if (st === 'occupied') {
        if (t.session_channel === 'pos_cashier') {
          channelBadge = '<div style="margin-top:6px; display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:600; padding:2px 8px; border-radius:12px; background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;"><span>🖥️ Diisi oleh Kasir (POS)</span></div>';
        } else {
          channelBadge = '<div style="margin-top:6px; display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:600; padding:2px 8px; border-radius:12px; background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;"><span>📱 Dipesan via PWA Customer</span></div>';
        }
        if (t.session_customer_name) {
          channelBadge += '<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Pelanggan: <strong>' + esc(t.session_customer_name) + '</strong></div>';
        }
      }

      return '<div class="x-card" style="padding:16px; border:1px solid ' + cfg.border + '; border-radius:10px; background:' + cfg.bg + '; display:flex; flex-direction:column; justify-content:space-between; min-height:160px;">' +
        '<div>' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">' +
            '<h4 style="font-size:16px; font-weight:800; margin:0; color:var(--text-main);">' + esc(t.label || ('Meja ' + t.table_number)) + '</h4>' +
            cfg.badge +
          '</div>' +
          '<div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">Kapasitas: <strong>' + (t.capacity || 4) + ' Kursi</strong></div>' +
          channelBadge +
          (t.notes ? ('<div style="font-size:11px; color:#b91c1c; margin-top:4px; margin-bottom:8px; font-style:italic;">Catatan: ' + esc(t.notes) + '</div>') : '') +
        '</div>' +
        '<div style="margin-top:12px;">' + actionsHtml +
          '<button type="button" class="x-btn-secondary" style="font-size:12px; padding:6px 12px; width:100%; margin-top:8px;" onclick="openBMTableQr(\'' + esc(t.id) + '\', \'' + esc(t.label || ('Meja ' + t.table_number)) + '\')">QR Meja</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── QR meja: lihat, cetak, bagikan ──
  // QR berisi URL gabung (lihat endpoint /dine-in/tables/:id/qr), jadi kamera
  // bawaan HP mana pun bisa membukanya tanpa aplikasi kita.
  async function openBMTableQr(tableId, label) {
    if (!tableId) return;
    try {
      var res = await adminFetch(API_BASE + '/dine-in/tables/' + encodeURIComponent(tableId) + '/qr', {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (!res.ok || !data.success || !data.svg) {
        var msg = (data && data.error) || 'Gagal memuat QR meja.';
        if (typeof showToast === 'function') showToast(msg); else console.warn(msg);
        return;
      }
      showBMTableQrOverlay(data);
    } catch (err) {
      console.warn('[BM Table QR Error]:', err);
      if (typeof showToast === 'function') showToast(msg); else console.warn(msg);2
    }
  }
  window.openBMTableQr = openBMTableQr;

  function showBMTableQrOverlay(data) {
    var previous = document.getElementById('bm-qr-overlay');
    if (previous) previous.remove();

    var title = (data.table && (data.table.label || data.table.table_number)) || 'Meja';
    var overlay = document.createElement('div');
    overlay.id = 'bm-qr-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:3000;padding:16px;';
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:16px;padding:20px;max-width:340px;width:100%;text-align:center;">' +
        '<h3 style="margin:0 0 4px;font-size:16px;font-weight:800;">QR ' + esc(title) + '</h3>' +
        '<p style="margin:0 0 12px;font-size:12px;color:#64748b;">Tempel di meja. Tamu bisa scan dengan kamera HP untuk melihat pesanan meja ini.</p>' +
        '<div id="bm-qr-svg" style="display:flex;justify-content:center;margin-bottom:12px;">' + data.svg + '</div>' +
        '<button type="button" id="bm-qr-print" class="x-btn-secondary" style="width:100%;margin-bottom:8px;">Cetak QR</button>' +
        '<button type="button" id="bm-qr-share" class="x-btn-secondary" style="width:100%;margin-bottom:8px;">Kirim lewat WhatsApp</button>' +
        '<button type="button" id="bm-qr-close" class="x-btn-secondary" style="width:100%;">Tutup</button>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('#bm-qr-close').onclick = function () { overlay.remove(); };
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    overlay.querySelector('#bm-qr-print').onclick = function () { printBMTableQr(data); };
    overlay.querySelector('#bm-qr-share').onclick = function () {
      if (!data.join_url) return;
      window.open('https://wa.me/?text=' + encodeURIComponent('QR ' + title + ': ' + data.join_url), '_blank');
    };
  }
  window.showBMTableQrOverlay = showBMTableQrOverlay;

  // Cetak lewat jendela sendiri supaya hasilnya bersih: hanya QR + nama meja.
  // Nanti bisa disambungkan ke printer bluetooth tanpa mengubah endpoint-nya.
  function printBMTableQr(data) {
    var title = (data.table && (data.table.label || data.table.table_number)) || 'Meja';
    // Kode di bawah QR: jalan terakhir kalau kamera tamu tidak bisa membaca QR.
    // Sengaja kode yang gampang ditulis tangan, mis. "meja7" — bukan token acak.
    var kode = (data.table && data.table.table_number) ? ('meja' + data.table.table_number) : '';
    var w = window.open('', '_blank');
    if (!w) return;
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>QR ' + esc(title) + '</title>' +
      '<style>body{font-family:sans-serif;text-align:center;padding:32px;}h1{font-size:20px;margin:0 0 4px;}p{font-size:12px;color:#555;margin:0 0 20px;}svg{width:280px;height:280px;}</style>' +
      '</head><body><h1>' + esc(title) + '</h1><p>Scan untuk melihat pesanan meja ini</p>' + (data.svg || '') + (kode ? '<p style="font-size:11px;color:#777;margin-top:16px;">Kode meja: ' + esc(kode) + '</p>' : '') + '</body></html>');
    w.document.close();
    w.focus();
    w.print();
  }
  window.printBMTableQr = printBMTableQr;

  async function toggleBMTableBlocked(tableId, isBlocked) {
    var reason = '';
    if (isBlocked) {
      reason = prompt('Masukkan alasan pemblokiran meja (misal: Rusak, Renovasi, Khusus VIP):');
      if (reason === null) return;
    }

    try {
      var res = await adminFetch(API_BASE + '/dine-in/tables/' + encodeURIComponent(tableId) + '/block', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_blocked: isBlocked, reason: reason.trim() })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast(isBlocked ? 'Meja telah diblokir.' : 'Meja dibuka kembali (Tersedia).');
        loadBMTables();
      } else {
        showToast('Gagal mengubah status meja: ' + (data.error || 'Terjadi kesalahan'));
        loadBMTables();
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.toggleBMTableBlocked = toggleBMTableBlocked;

  async function completeBMTableSession(sessionId) {
    if (!confirm('Selesaikan sesi makan ini dan kosongkan meja untuk tamu berikutnya?')) return;
    try {
      var res = await adminFetch(API_BASE + '/dine-in/sessions/' + encodeURIComponent(sessionId) + '/complete', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Sesi makan selesai, meja kembali tersedia.');
        loadBMTables();
      } else {
        showToast('Gagal menyelesaikan sesi: ' + (data.error || 'Terjadi kesalahan'));
        loadBMTables();
      }
    } catch (e) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.completeBMTableSession = completeBMTableSession;


})();
