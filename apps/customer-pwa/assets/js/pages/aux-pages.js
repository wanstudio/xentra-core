/**
 * Xentra Customer PWA — Additional View Controllers:
 * 1. Affiliate View (#affiliate) — Program Kemitraan ("Yuk, join!")
 * 2. Order History View (#history) — Riwayat Pesanan Selesai (library.svg)
 * 3. Profile View (#profile) — Profil Pengguna & Alamat Tersimpan
 */
(function () {
  'use strict';

  var API = window.Xentra && window.Xentra.API;
  var Store = window.Xentra && window.Xentra.Store;
  var UI = window.Xentra && window.Xentra.UI;
  var Router = window.Xentra && window.Xentra.Router;

  // ══════════════════════════════════════════════════════════════
  //  1. AFFILIATE VIEW (YUK, JOIN!)
  // ══════════════════════════════════════════════════════════════
  function mountAffiliate(container) {
    if (!container) return;
    container.innerHTML =
      '<div class="x-aux-page">' +
      '  <div class="x-aux-header">' +
      '    <button type="button" class="x-aux-back-btn" id="x-affiliate-back" aria-label="Kembali">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
      '    </button>' +
      '    <h1 class="x-aux-title">Program Kemitraan & Affiliate</h1>' +
      '  </div>' +
      '  <div class="x-aux-body">' +
      '    <div class="x-aux-hero-card">' +
      '      <div class="x-aux-badge">Yuk, Join Bangjo!</div>' +
      '      <h2 style="font-size:20px;font-weight:800;color:#111;margin:10px 0 6px;">Raih Penghasilan Tambahan Bersama Kami</h2>' +
      '      <p style="font-size:13.5px;color:#64748b;line-height:1.5;margin:0 0 16px;">Bagikan link rekomendasi menu Bangjo ke teman dan keluarga. Dapatkan komisi menarik untuk setiap transaksi yang berhasil.</p>' +
      '      <div class="x-aux-stats-grid">' +
      '        <div class="x-aux-stat-box"><span class="num">10%</span><span class="lbl">Komisi Tiap Order</span></div>' +
      '        <div class="x-aux-stat-box"><span class="num">Instan</span><span class="lbl">Pencairan Dana</span></div>' +
      '        <div class="x-aux-stat-box"><span class="num">Bonus</span><span class="lbl">Voucher Eksklusif</span></div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="x-aux-card" style="margin-top:16px;">' +
      '      <h3 style="font-size:15px;font-weight:700;color:#111;margin:0 0 10px;">Cara Kerja Program</h3>' +
      '      <ol style="padding-left:18px;margin:0;font-size:13.5px;color:#475569;line-height:1.6;">' +
      '        <li>Daftarkan nomor WhatsApp aktif Anda.</li>' +
      '        <li>Dapatkan kode referral & link unik khusus Anda.</li>' +
      '        <li>Sebarkan ke media sosial atau grup WhatsApp.</li>' +
      '        <li>Nikmati komisi yang langsung masuk ke saldo akun Anda.</li>' +
      '      </ol>' +
      '    </div>' +
      '    <button type="button" class="x-aux-action-btn" id="x-affiliate-cta" style="margin-top:20px;">Daftar Sekarang</button>' +
      '  </div>' +
      '</div>';

    var backBtn = container.querySelector('#x-affiliate-back');
    if (backBtn) backBtn.onclick = function () { Router.navigate('home'); };

    var ctaBtn = container.querySelector('#x-affiliate-cta');
    if (ctaBtn) {
      ctaBtn.onclick = function () {
        var session = Store ? Store.getState().customerSession : null;
        if (!session || !session.token) {
          if (typeof window.openCustomerAuthSheet === 'function') {
            window.openCustomerAuthSheet(function () {
              if (UI && UI.toast) UI.toast('Pendaftaran program kemitraan berhasil dicatat!');
            });
          } else {
            if (UI && UI.toast) UI.toast('Silakan login terlebih dahulu.');
          }
        } else {
          if (UI && UI.toast) UI.toast('Akun Anda sudah terdaftar sebagai mitra Bangjo!');
        }
      };
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  2. ORDER HISTORY VIEW (LIBRARY.SVG)
  // ══════════════════════════════════════════════════════════════
  function mountHistory(container) {
    if (!container) return;
    container.innerHTML =
      '<div class="x-aux-page">' +
      '  <div class="x-aux-header">' +
      '    <button type="button" class="x-aux-back-btn" id="x-history-back" aria-label="Kembali">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
      '    </button>' +
      '    <h1 class="x-aux-title">Riwayat Pesanan</h1>' +
      '  </div>' +
      '  <div class="x-aux-body" id="x-history-list-wrap">' +
      '    <div style="padding:40px 20px;text-align:center;color:#64748b;font-size:13.5px;"><span class="x-loc-spinner"></span> Memuat riwayat pesanan…</div>' +
      '  </div>' +
      '</div>';

    var backBtn = container.querySelector('#x-history-back');
    if (backBtn) backBtn.onclick = function () { Router.navigate('home'); };

    var listWrap = container.querySelector('#x-history-list-wrap');
    var session = Store ? Store.getState().customerSession : null;

    if (!session || !session.token) {
      if (listWrap) {
        listWrap.innerHTML =
          '<div style="padding:48px 20px;text-align:center;">' +
          '  <div style="font-size:44px;margin-bottom:12px;">📑</div>' +
          '  <h3 style="font-size:16px;font-weight:700;color:#111;margin-bottom:6px;">Masuk untuk Melihat Riwayat</h3>' +
          '  <p style="font-size:13px;color:#64748b;margin-bottom:20px;">Verifikasi nomor WhatsApp Anda untuk melacak dan melihat semua riwayat pesanan.</p>' +
          '  <button type="button" class="x-aux-action-btn" id="x-history-login-btn" style="max-width:240px;margin:0 auto;">Verifikasi Nomor WhatsApp</button>' +
          '</div>';

        var loginBtn = listWrap.querySelector('#x-history-login-btn');
        if (loginBtn) {
          loginBtn.onclick = function () {
            if (typeof window.openCustomerAuthSheet === 'function') {
              window.openCustomerAuthSheet(function () {
                mountHistory(container);
              });
            }
          };
        }
      }
      return;
    }

    // Fetch customer order history from API
    API.get('/customer/orders')
      .then(function (res) {
        if (!listWrap) return;
        var orders = (res && res.orders) || [];
        if (!orders.length) {
          listWrap.innerHTML =
            '<div style="padding:48px 20px;text-align:center;">' +
            '  <div style="font-size:44px;margin-bottom:12px;">🛍️</div>' +
            '  <h3 style="font-size:16px;font-weight:700;color:#111;margin-bottom:6px;">Belum Ada Riwayat Pesanan</h3>' +
            '  <p style="font-size:13px;color:#64748b;margin-bottom:20px;">Pesanan Anda yang sudah selesai akan muncul di sini.</p>' +
            '  <button type="button" class="x-aux-action-btn" id="x-history-browse-btn" style="max-width:200px;margin:0 auto;">Pesan Sekarang</button>' +
            '</div>';

          var browseBtn = listWrap.querySelector('#x-history-browse-btn');
          if (browseBtn) browseBtn.onclick = function () { Router.navigate('home'); };
          return;
        }

        var html = '';
        orders.forEach(function (ord) {
          var statusColor = ord.status === 'completed' ? '#00A637' : (ord.status === 'cancelled' || ord.status === 'rejected' ? '#ef4444' : '#0284c7');
          var statusLabel = ord.status === 'completed' ? 'Selesai' : (ord.status === 'cancelled' ? 'Dibatalkan' : (ord.status === 'rejected' ? 'Ditolak' : 'Diproses'));
          var itemsText = (ord.items || []).map(function (it) { return it.quantity + 'x ' + it.product_name; }).join(', ') || 'Item pesanan';
          var dateStr = ord.created_at ? new Date(ord.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

          html +=
            '<div class="x-history-card" data-order-id="' + UI.escape(ord.id) + '">' +
            '  <div class="x-history-card-head">' +
            '    <div>' +
            '      <span class="x-history-branch">' + UI.escape(ord.branch_name || 'Bangjo') + '</span>' +
            '      <span class="x-history-date">' + UI.escape(dateStr) + '</span>' +
            '    </div>' +
            '    <span class="x-history-status" style="color:' + statusColor + ';background:' + statusColor + '15;">' + UI.escape(statusLabel) + '</span>' +
            '  </div>' +
            '  <div class="x-history-items">' + UI.escape(itemsText) + '</div>' +
            '  <div class="x-history-card-foot">' +
            '    <div>' +
            '      <span class="lbl">Total Pembayaran</span>' +
            '      <span class="price">' + UI.money(ord.grand_total || 0) + '</span>' +
            '    </div>' +
            '    <button type="button" class="x-history-view-btn" data-id="' + UI.escape(ord.id) + '">Lihat Status</button>' +
            '  </div>' +
            '</div>';
        });

        listWrap.innerHTML = html;

        listWrap.querySelectorAll('.x-history-view-btn').forEach(function (btn) {
          btn.onclick = function (e) {
            e.stopPropagation();
            var id = btn.getAttribute('data-id');
            if (id) Router.navigate('order-received', { orderId: id });
          };
        });
      })
      .catch(function () {
        if (listWrap) {
          listWrap.innerHTML =
            '<div style="padding:32px 20px;text-align:center;color:#ef4444;font-size:13px;">Gagal memuat riwayat pesanan. Periksa koneksi internet Anda.</div>';
        }
      });
  }

  // ══════════════════════════════════════════════════════════════
  //  3. PROFILE VIEW (FLOWBITE_USER-SOLID.SVG)
  // ══════════════════════════════════════════════════════════════
  function mountProfile(container) {
    if (!container) return;
    var session = Store ? Store.getState().customerSession : null;
    var phone = (session && session.phone) || '';
    var name = (session && session.name) || (phone ? 'Pelanggan Bangjo' : 'Tamu');

    container.innerHTML =
      '<div class="x-aux-page">' +
      '  <div class="x-aux-header">' +
      '    <button type="button" class="x-aux-back-btn" id="x-profile-back" aria-label="Kembali">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
      '    </button>' +
      '    <h1 class="x-aux-title">Profil Saya</h1>' +
      '  </div>' +
      '  <div class="x-aux-body">' +
      '    <div class="x-profile-card">' +
      '      <div class="x-profile-avatar">' +
      '        <img src="/assets/icons/black_flowbite_user-solid.svg" alt="Avatar" width="32" height="32">' +
      '      </div>' +
      '      <div class="x-profile-info">' +
      '        <div class="x-profile-name">' + UI.escape(name) + '</div>' +
      '        <div class="x-profile-phone">' + UI.escape(phone || 'Belum terverifikasi') + '</div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="x-profile-menu-list">' +
      '      <button type="button" class="x-profile-menu-item" id="x-profile-btn-addresses">' +
      '        <div class="left"><span class="icon">📍</span><span>Alamat Favorit Saya</span></div>' +
      '        <img src="/assets/icons/arrowback.svg" alt="" style="transform:rotate(180deg);width:14px;opacity:0.4;">' +
      '      </button>' +
      '      <button type="button" class="x-profile-menu-item" id="x-profile-btn-history">' +
      '        <div class="left"><span class="icon">📑</span><span>Riwayat Pesanan</span></div>' +
      '        <img src="/assets/icons/arrowback.svg" alt="" style="transform:rotate(180deg);width:14px;opacity:0.4;">' +
      '      </button>' +
      '      <button type="button" class="x-profile-menu-item" id="x-profile-btn-affiliate">' +
      '        <div class="left"><span class="icon">🎁</span><span>Program Kemitraan (Yuk, join!)</span></div>' +
      '        <img src="/assets/icons/arrowback.svg" alt="" style="transform:rotate(180deg);width:14px;opacity:0.4;">' +
      '      </button>' +
      '    </div>' +
      (session && session.token
        ? '    <button type="button" class="x-profile-logout-btn" id="x-profile-logout">Keluar dari Akun</button>'
        : '    <button type="button" class="x-aux-action-btn" id="x-profile-login" style="margin-top:24px;">Masuk / Verifikasi WhatsApp</button>') +
      '  </div>' +
      '</div>';

    var backBtn = container.querySelector('#x-profile-back');
    if (backBtn) backBtn.onclick = function () { Router.navigate('home'); };

    var addrBtn = container.querySelector('#x-profile-btn-addresses');
    if (addrBtn) {
      addrBtn.onclick = function () {
        if (window.XentraLocationPicker && typeof window.XentraLocationPicker.open === 'function') {
          window.XentraLocationPicker.open();
        }
      };
    }

    var histBtn = container.querySelector('#x-profile-btn-history');
    if (histBtn) {
      histBtn.onclick = function () {
        Router.navigate('history');
      };
    }

    var affBtn = container.querySelector('#x-profile-btn-affiliate');
    if (affBtn) {
      affBtn.onclick = function () {
        Router.navigate('affiliate');
      };
    }

    var loginBtn = container.querySelector('#x-profile-login');
    if (loginBtn) {
      loginBtn.onclick = function () {
        if (typeof window.openCustomerAuthSheet === 'function') {
          window.openCustomerAuthSheet(function () {
            mountProfile(container);
          });
        }
      };
    }

    var logoutBtn = container.querySelector('#x-profile-logout');
    if (logoutBtn) {
      logoutBtn.onclick = function () {
        if (confirm('Apakah Anda yakin ingin keluar?')) {
          if (Store && typeof Store.clearCustomerSession === 'function') {
            Store.clearCustomerSession();
          }
          if (UI && UI.toast) UI.toast('Anda telah keluar.');
          mountProfile(container);
        }
      };
    }
  }

  // Expose
  window.XentraAuxPages = {
    mountAffiliate: mountAffiliate,
    mountHistory: mountHistory,
    mountProfile: mountProfile
  };
})();
