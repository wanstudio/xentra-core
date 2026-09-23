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
        '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>' +
        '</span><span><span style="display:block;font-size:13px;color:#64748b;">Nomor WhatsApp</span>' +
        '      <span id="x-profile-phone-value" style="display:block;font-size:14px;color:#111;font-weight:600;">' +
        (hasPhone ? UI.escape(sessPhone) : 'Belum ditambahkan') + '</span></span></div>' +
        '      <span id="x-profile-phone-action" style="font-size:12.5px;font-weight:600;color:#16a34a;">' +
        (hasPhone ? 'Ubah' : 'Tambahkan nomor') + '</span>' +
        '    </button>';
    }
    if (isAuthenticated) {
      actionHtml = '    <button type="button" class="x-profile-logout-btn" id="x-profile-logout">Keluar dari Akun</button>' +
        '    <p class="x-profile-subtitle" style="font-size:11.5px;color:#94a3b8;margin:14px 0 6px;">Menghapus akun berarti Anda keluar dari akun ini, dan alamat serta sesi Anda hilang. Riwayat pesanan tetap tersimpan di resto, tanpa terhubung lagi ke Anda.</p>' +
        '    <button type="button" id="x-profile-delete" style="width:100%;height:44px;border-radius:999px;border:2px solid #fecaca;background:#fff;color:#dc2626;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;">Hapus Akun</button>';
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

    var deleteAccBtn = container.querySelector('#x-profile-delete');
    if (deleteAccBtn) {
      deleteAccBtn.onclick = function () {
        // Dua langkah: mengetik, bukan sekadar menekan "Ya" — supaya tidak terhapus
        // karena salah tekan.
        var typed = prompt('Menghapus akun tidak bisa dibatalkan. Ketik HAPUS AKUN untuk melanjutkan:');
        if (typed === null) return;
        if (String(typed).trim().toUpperCase() !== 'HAPUS AKUN') {
          if (UI && UI.toast) UI.toast('Penulisan tidak cocok. Akun tidak dihapus.');
          return;
        }
        // Konfirmasi lewat QUERY: permintaan DELETE yang membawa body dijawab 400
        // kosong oleh rantai middleware, jadi body tidak bisa diandalkan di sini.
        API.del('/customer/account?confirm=HAPUS').then(function (res) {
          if (!res || res.success !== true) {
            if (UI && UI.toast) UI.toast((res && res.error) || 'Gagal menghapus akun.');
            return;
          }
          // Bersihkan data lokal: sesi, keranjang, penerima, dan meja yang dipegang.
          try {
            if (Store && typeof Store.clearCustomerSession === 'function') Store.clearCustomerSession();
            if (Store && typeof Store.clearCart === 'function') Store.clearCart();
            if (Store && typeof Store.clearRecipient === 'function') Store.clearRecipient();
            if (Store && typeof Store.clearMyTable === 'function') Store.clearMyTable();
          } catch (_) {}
          if (UI && UI.toast) UI.toast('Akun Anda sudah dihapus.');
          mountProfile(container);
        }).catch(function () {
          if (UI && UI.toast) UI.toast('Koneksi bermasalah. Akun belum dihapus.');
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
