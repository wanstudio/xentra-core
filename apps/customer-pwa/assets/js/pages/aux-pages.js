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
          '  <p style="font-size:13px;color:#64748b;margin-bottom:20px;">Masuk ke akun Anda untuk melacak dan melihat semua riwayat pesanan.</p>' +
          '  <button type="button" class="x-aux-action-btn" id="x-history-login-btn" style="max-width:240px;margin:0 auto;">Masuk dengan Google</button>' +
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
    var isAuthenticated = Boolean(session && session.token);
    var name = (session && session.name) || 'Pelanggan Bangjo';

    var cardHtml = '';
    if (isAuthenticated) {
      cardHtml =
        '    <div class="x-profile-card">' +
        '      <div class="x-profile-avatar">' +
        '        <img src="/assets/icons/black_flowbite_user-solid.svg" alt="Avatar" width="32" height="32">' +
        '      </div>' +
        '      <div class="x-profile-info">' +
        '        <div class="x-profile-name">' + UI.escape(name) + '</div>' +
        '        <div class="x-profile-phone">Akun Google</div>' +
        '      </div>' +
        '    </div>';
    } else {
      cardHtml =
        '    <div class="x-profile-card" style="flex-direction:column;align-items:center;text-align:center;padding:24px 20px;">' +
        '      <div class="x-profile-avatar" style="margin-bottom:12px;width:60px;height:60px;">' +
        '        <img src="/assets/icons/black_flowbite_user-solid.svg" alt="Avatar" width="36" height="36">' +
        '      </div>' +
        '      <div class="x-profile-name" style="font-size:17px;margin-bottom:4px;">Masuk ke akunmu</div>' +
        '      <div class="x-profile-subtitle" style="font-size:13px;color:#64748b;line-height:1.5;">Simpan alamat, lihat riwayat pesanan, dan kelola akun.</div>' +
        '    </div>';
    }

    var actionHtml = '';
    var phoneHtml = '';
    if (isAuthenticated) {
      var sessPhone = session && session.phone ? String(session.phone) : '';
      var sessDigits = sessPhone.replace(/[^0-9]/g, '');
      var hasPhone = Boolean(sessDigits &&
        (sessDigits.indexOf('08') === 0 || sessDigits.indexOf('628') === 0 || sessDigits.indexOf('8') === 0) &&
        sessDigits.length >= 9 && sessDigits.length <= 15);
      phoneHtml =
        '    <button type="button" class="x-profile-menu-item" id="x-profile-btn-phone">' +
        '      <div class="left"><span class="icon" style="display:inline-flex;align-items:center;">' +
        '<svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true"><path fill="#25D366" d="M16 3C9.4 3 4 8.4 4 15c0 2.4.7 4.6 1.9 6.5L4 29l7.7-1.8c1.8 1 3.9 1.6 6.1 1.6h.2c6.6 0 12-5.4 12-12S22.6 3 16 3zm0 21.8h-.2c-1.9 0-3.7-.5-5.3-1.5l-.4-.2-4.6 1.1 1.1-4.4-.2-.4c-1.1-1.7-1.7-3.7-1.7-5.7C4.9 9.4 9.7 4.7 16 4.7S27.1 9.4 27.1 15 22.4 24.8 16 24.8zm6-8.1c-.3-.2-1.9-1-2.2-1.1-.3-.1-.5-.2-.7.2-.2.3-.8 1.1-1 1.3-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.6-1.6-.9-.9-1.6-1.9-1.8-2.2-.2-.3 0-.5.1-.6l.5-.6c.2-.2.2-.4.3-.6.1-.2 0-.4 0-.6L14.5 9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.6.2-.9.5-.3.3-1.1 1.1-1.1 2.7s1.2 3.1 1.3 3.4c.2.2 2.3 3.6 5.7 5 .8.3 1.4.5 1.9.7.8.2 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.4.2-1.5-.1-.2-.3-.2-.6-.4z"/></svg>' +
        '</span><span><span style="display:block;font-size:13px;color:#64748b;">Nomor WhatsApp</span>' +
        '      <span id="x-profile-phone-value" style="display:block;font-size:14px;color:#111;font-weight:600;">' +
        (hasPhone ? UI.escape(sessPhone) : 'Belum ditambahkan') + '</span></span></div>' +
        '      <span id="x-profile-phone-action" style="font-size:12.5px;font-weight:600;color:#16a34a;">' +
        (hasPhone ? 'Ubah' : 'Tambahkan nomor') + '</span>' +
        '    </button>';
    }
    if (isAuthenticated) {
      actionHtml = '    <button type="button" class="x-profile-logout-btn" id="x-profile-logout">Keluar dari Akun</button>';
    } else {
      actionHtml =
        '    <button type="button" class="x-profile-google-btn" id="x-profile-login">' +
        '      <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">' +
        '        <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-21.5 0-1.4-.1-2.7-.5-4.5z"/>' +
        '      </svg>' +
        '      Masuk dengan Google' +
        '    </button>';
    }

    container.innerHTML =
      '<div class="x-aux-page">' +
      '  <div class="x-aux-header">' +
      '    <button type="button" class="x-aux-back-btn" id="x-profile-back" aria-label="Kembali">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
      '    </button>' +
      '    <h1 class="x-aux-title">Profil Saya</h1>' +
      '  </div>' +
      '  <div class="x-aux-body">' +
      cardHtml +
      phoneHtml +
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
      actionHtml +
      '  </div>' +
      '</div>';

    var backBtn = container.querySelector('#x-profile-back');
    if (backBtn) backBtn.onclick = function () { Router.navigate('home'); };

    // WhatsApp number row: authoritative phone from Customer Profile.
    var phoneBtn = container.querySelector('#x-profile-btn-phone');
    function paintProfilePhone(phone) {
      var valEl = container.querySelector('#x-profile-phone-value');
      var actEl = container.querySelector('#x-profile-phone-action');
      var d = String(phone || '').replace(/[^0-9]/g, '');
      var ok = d.indexOf('08') === 0 || d.indexOf('628') === 0 || d.indexOf('8') === 0;
      var valid = Boolean(d && ok && d.length >= 9 && d.length <= 15);
      if (valEl) valEl.textContent = valid ? String(phone) : 'Belum ditambahkan';
      if (actEl) actEl.textContent = valid ? 'Ubah' : 'Tambahkan nomor';
    }
    if (isAuthenticated && API) {
      API.get('/customer/profile').then(function (res) {
        var phone = res && res.customer && res.customer.phone;
        if (phone) {
          try {
            var sess = Store.getState().customerSession;
            if (sess && !sess.phone) { sess.phone = phone; Store.setCustomerSession(sess); }
          } catch (_) {}
        }
        paintProfilePhone(phone || (session && session.phone) || '');
      }).catch(function () {});
    }
    if (phoneBtn) {
      phoneBtn.onclick = function () {
        var checkout = window.Xentra && window.Xentra.Checkout;
        if (checkout && typeof checkout.openPhoneCompletionSheet === 'function') {
          checkout.openPhoneCompletionSheet({ mode: 'profile', onSaved: function (savedPhone) {
            paintProfilePhone(savedPhone);
          } });
        } else if (UI && UI.toast) {
          UI.toast('Fitur nomor WhatsApp tidak tersedia saat ini.');
        }
      };
    }

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
        // Redirect to centralized Xentra Auth Broker — no GSI on tenant origin.
        // The broker (xentra.cloud) handles Google GSI, then returns with ?customer_code.
        loginBtn.disabled = true;
        var originalHtml = loginBtn.innerHTML;
        loginBtn.innerHTML = 'Membuka...';
        API.post('/customer/auth/broker/init', {})
          .then(function (res) {
            if (res && res.success && res.broker_url) {
              // Save current hash so we can restore it after auth
              try { sessionStorage.setItem('xnt_auth_return_hash', '#profile'); } catch (_) {}
              window.location.href = res.broker_url;
            } else {
              loginBtn.disabled = false;
              loginBtn.innerHTML = originalHtml;
              var errMsg = (res && (res.error || res.message)) || 'Gagal menginisialisasi Google Sign-In. Silakan coba lagi.';
              if (UI && UI.toast) UI.toast(errMsg);
            }
          })
          .catch(function (err) {
            loginBtn.disabled = false;
            loginBtn.innerHTML = originalHtml;
            var msg = (err && err.data && (err.data.error || err.data.message)) ||
                      (err && err.message) ||
                      'Gagal menghubungi server. Periksa koneksi internet lalu coba lagi.';
            if (UI && UI.toast) UI.toast(msg);
          });
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
