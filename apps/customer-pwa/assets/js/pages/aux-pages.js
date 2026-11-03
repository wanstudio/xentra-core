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

  function startCustomerAuth(returnHash, onSuccess, btnEl, originalBtnText) {
    returnHash = returnHash || '#affiliate';
    try { sessionStorage.setItem('xnt_auth_return_hash', returnHash); } catch (_) {}

    function resetButton() {
      if (btnEl) {
        btnEl.disabled = false;
        if (originalBtnText) btnEl.textContent = originalBtnText;
      }
    }

    if (UI && UI.toast) UI.toast('Membuka Google Sign-In…');

    if (API) {
      API.post('/customer/auth/broker/init', {})
        .then(function (res) {
          if (res && res.success && res.broker_url) {
            window.location.href = res.broker_url;
          } else {
            resetButton();
            var errMsg = (res && (res.error || res.message)) || 'Gagal membuka Google Sign-In. Silakan coba lagi.';
            if (UI && UI.toast) UI.toast(errMsg);
          }
        })
        .catch(function (err) {
          resetButton();
          var msg = (err && err.data && (err.data.error || err.data.message)) ||
                    (err && err.message) ||
                    'Gagal menghubungi server Google Sign-In.';
          if (UI && UI.toast) UI.toast(msg);
        });
    } else {
      resetButton();
    }
  }
  window.startCustomerAuth = startCustomerAuth;

  function sanitizePhone(raw) {
    if (!raw) return '';
    raw = String(raw).trim();
    if (raw.indexOf('@') !== -1) return ''; // Email address is never a valid phone number
    var digits = raw.replace(/[^0-9+]/g, '');
    if (digits.length < 8 || digits.length > 16) return '';
    return digits;
  }

  // ══════════════════════════════════════════════════════════════
  //  1. AFFILIATE VIEW (INSTANT SHARE & EARN — ZERO FORMULIR)
  // ══════════════════════════════════════════════════════════════
  function mountAffiliate(container, force) {
    if (!container) return;

    var session = Store ? Store.getState().customerSession : null;
    var isLoggedIn = Boolean(session && session.token);

    if (!isLoggedIn) {
      if (!force && container.getAttribute('data-mounted-view') === 'affiliate-guest') return;
      container.setAttribute('data-mounted-view', 'affiliate-guest');
      container.setAttribute('data-mounted-session', 'guest');
      renderAffiliateGuestView(container);
      return;
    }

    // Clean up any email previously stored in session.phone
    if (session && session.phone && typeof session.phone === 'string' && session.phone.indexOf('@') !== -1) {
      session.phone = '';
      if (Store && typeof Store.setCustomerSession === 'function') {
        Store.setCustomerSession(session);
      }
    }

    // If ALREADY mounted for this customer session and not forcing, DO NOT wipe or re-render!
    // The view is already live; switching views back and forth relies purely on display toggles.
    var currentMountedSession = container.getAttribute('data-mounted-session');
    var currentMountedView = container.getAttribute('data-mounted-view');
    if (!force && currentMountedSession === session.token && currentMountedView === 'affiliate-dash') {
      return;
    }

    // INSTANT SHARE & EARN: Every logged-in customer directly gets their active Dashboard!
    // Zero application forms, zero wait time, zero friction.
    container.setAttribute('data-mounted-session', session.token);
    container.setAttribute('data-mounted-view', 'affiliate-dash');
    renderAffiliateDashboard(container);
  }

  // Legacy stubs (deprecated in 2026 redesign — direct 1-tap activation replaces multi-step forms)
  function renderAffiliateApplyForm(container) { mountAffiliate(container, true); }
  function renderAffiliatePendingView(container) { mountAffiliate(container, true); }
  function renderAffiliateRejectedView(container) { mountAffiliate(container, true); }

  function renderAffiliateGuestView(container) {
    container.innerHTML =
      '<div class="x-aux-page">' +
      '  <div class="x-aux-header" style="background:var(--x-lime, #b6ff00);border-bottom:1px solid rgba(0,0,0,0.06);">' +
      '    <button type="button" class="x-aux-back-btn" id="x-affiliate-back" aria-label="Kembali" style="background:#fff;">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
      '    </button>' +
      '    <h1 class="x-aux-title" style="color:#111111;">Bagi Info, Dapat Cuan</h1>' +
      '    <div style="width:36px;"></div>' +
      '  </div>' +
      '  <div class="x-aux-body" style="padding:0;background:#ffffff;" id="x-aff-guest-body">' +
      '    <div style="padding:48px 20px;text-align:center;color:#64748b;font-size:13.5px;"><span class="x-loc-spinner"></span> Memuat program affiliate…</div>' +
      '  </div>' +
      '</div>';

    var backBtn = container.querySelector('#x-affiliate-back');
    if (backBtn) backBtn.onclick = function () { Router.navigate('home'); };

    var guestBody = container.querySelector('#x-aff-guest-body');

    API.get('/customer/affiliate/program')
      .then(function (res) {
        if (!guestBody) return;
        var prog = (res && res.program) || {};
        var commissionPerItem = Number(prog.commission_per_item || 1000);
        var rateText = UI.money(commissionPerItem);
        var recentPayouts = (prog.recent_payouts && prog.recent_payouts.length > 0)
          ? prog.recent_payouts
          : [
              { name: 'Dimas S.', amount: 45000, method: 'GoPay' },
              { name: 'Rina P.', amount: 62000, method: 'BCA' },
              { name: 'Fajar K.', amount: 38000, method: 'DANA' }
            ];

        var defaultPorsi = 10;
        var defaultDaily = defaultPorsi * commissionPerItem;
        var defaultMonthly = defaultDaily * 30;

        guestBody.innerHTML =
          // Hero
          '<div class="x-aff-teaser-hero">' +
          '  <div class="x-aff-teaser-badge">🍗 Foodie Partner Bangjo</div>' +
          '  <h2 class="x-aff-teaser-title">Suka Makan di Sini?<br>Ajak Teman, Panen Cuan!</h2>' +
          '  <p class="x-aff-teaser-desc">Cukup bagikan rekomendasi menu favoritmu ke WhatsApp. Dapatkan komisi tunai instan tiap kali teman memesan.</p>' +
          '  <div class="x-aff-value-grid">' +
          '    <div class="x-aff-value-pill">' +
          '      <div class="x-aff-value-num" style="color:#059669;" id="x-aff-rate-pill">' + rateText + '</div>' +
          '      <div class="x-aff-value-lbl">Tiap Porsi Menu</div>' +
          '    </div>' +
          '    <div class="x-aff-value-pill">' +
          '      <div class="x-aff-value-num">⚡ Instan</div>' +
          '      <div class="x-aff-value-lbl">0 Formulir Ribet</div>' +
          '    </div>' +
          '    <div class="x-aff-value-pill">' +
          '      <div class="x-aff-value-num">BCA / E-Wallet</div>' +
          '      <div class="x-aff-value-lbl">Tarik Kapan Saja</div>' +
          '    </div>' +
          '  </div>' +
          '</div>' +

          // Main Wrap
          '<div style="padding:20px 18px 100px;">' +
          // Live Ticker
          '  <div class="x-aff-ticker">' +
          '    <div class="x-aff-ticker-dot"></div>' +
          '    <div class="x-aff-ticker-text" id="x-aff-ticker-txt">🔥 <b>' + UI.escape(recentPayouts[0].name) + '</b> baru saja mencairkan komisi <b>' + UI.money(recentPayouts[0].amount) + '</b> via ' + UI.escape(recentPayouts[0].method || 'E-Wallet') + '</div>' +
          '  </div>' +

          // Interactive Calculator
          '  <div class="x-aff-calc-card">' +
          '    <div class="x-aff-calc-header">' +
          '      <div class="x-aff-calc-title">🧮 Hitung Potensi Cuanmu</div>' +
          '      <span class="x-aff-calc-badge">Simulasi</span>' +
          '    </div>' +
          '    <div class="x-aff-slider-wrap">' +
          '      <div class="x-aff-slider-labels">' +
          '        <span>Porsi dipesan temanmu/hari:</span>' +
          '        <span class="x-aff-slider-val" id="x-aff-slider-val">' + defaultPorsi + ' Porsi</span>' +
          '      </div>' +
          '      <input type="range" class="x-aff-slider" id="x-aff-calc-range" min="2" max="50" step="2" value="' + defaultPorsi + '">' +
          '    </div>' +
          '    <div class="x-aff-calc-result">' +
          '      <div>' +
          '        <div class="x-aff-calc-res-lbl">POTENSI KOMISI BULANAN</div>' +
          '        <div class="x-aff-calc-res-num" id="x-aff-monthly-val">' + UI.money(defaultMonthly) + '</div>' +
          '        <div class="x-aff-calc-res-hint" id="x-aff-daily-val">≈ ' + UI.money(defaultDaily) + ' setiap hari</div>' +
          '      </div>' +
          '      <div style="font-size:32px;">💰</div>' +
          '    </div>' +
          '  </div>' +

          // 3 Simple Steps
          '  <div style="margin-bottom:24px;">' +
          '    <h3 style="font-size:15px;font-weight:800;color:#0f172a;margin-bottom:14px;">Cara Mulai dalam 30 Detik:</h3>' +
          '    <div class="x-aff-step-item">' +
          '      <div class="x-aff-step-icon" style="background:#eff6ff;color:#2563eb;">1️⃣</div>' +
          '      <div>' +
          '        <div class="x-aff-step-name">Sekali Tap Langsung Aktif</div>' +
          '        <div class="x-aff-step-text">Langsung aktif tanpa formulir bertele-tele dan tanpa tunggu review 1x24 jam.</div>' +
          '      </div>' +
          '    </div>' +
          '    <div class="x-aff-step-item">' +
          '      <div class="x-aff-step-icon" style="background:#fef3c7;color:#d97706;">2️⃣</div>' +
          '      <div>' +
          '        <div class="x-aff-step-name">Bagikan ke Teman / Grup WA</div>' +
          '        <div class="x-aff-step-text">Kirim saat jam lapar kantor, teman kos, atau keluarga via 1-klik share.</div>' +
          '      </div>' +
          '    </div>' +
          '    <div class="x-aff-step-item">' +
          '      <div class="x-aff-step-icon" style="background:#ecfdf5;color:#059669;">3️⃣</div>' +
          '      <div>' +
          '        <div class="x-aff-step-name">Komisi Tunai Masuk Saldo</div>' +
          '        <div class="x-aff-step-text">Tarik uang komisi langsung ke rekening BCA, Mandiri, BRI, atau E-Wallet pilihanmu.</div>' +
          '      </div>' +
          '    </div>' +
          '  </div>' +
          '</div>' +

          // Sticky Bottom CTA Dock
          '<div class="x-aff-bottom-dock">' +
          '  <button type="button" class="x-aff-super-btn" id="x-aff-join-cta">' +
          '    <span>Mulai Jadi Partner</span>' +
          '    <span class="accent-pill">1-Tap Aktif ⚡</span>' +
          '  </button>' +
          '</div>';

        // Calculator slider event
        var slider = guestBody.querySelector('#x-aff-calc-range');
        var sliderVal = guestBody.querySelector('#x-aff-slider-val');
        var monthlyVal = guestBody.querySelector('#x-aff-monthly-val');
        var dailyVal = guestBody.querySelector('#x-aff-daily-val');

        if (slider) {
          slider.oninput = function () {
            var porsi = Number(slider.value) || 2;
            sliderVal.textContent = porsi + ' Porsi';
            var d = porsi * commissionPerItem;
            var m = d * 30;
            monthlyVal.textContent = UI.money(m);
            dailyVal.textContent = '≈ ' + UI.money(d) + ' setiap hari';
          };
        }

        // Live Ticker rotation
        var tickerTxt = guestBody.querySelector('#x-aff-ticker-txt');
        if (tickerTxt && recentPayouts.length > 1) {
          var tIdx = 0;
          var tInterval = setInterval(function () {
            if (!document.body.contains(tickerTxt)) {
              clearInterval(tInterval);
              return;
            }
            tIdx = (tIdx + 1) % recentPayouts.length;
            var item = recentPayouts[tIdx];
            tickerTxt.innerHTML = '🔥 <b>' + UI.escape(item.name) + '</b> baru saja mencairkan komisi <b>' + UI.money(item.amount) + '</b> via ' + UI.escape(item.method || 'E-Wallet');
          }, 3500);
        }

        // Join CTA Click
        var joinCta = guestBody.querySelector('#x-aff-join-cta');
        if (joinCta) {
          joinCta.onclick = function () {
            var session = Store ? Store.getState().customerSession : null;
            if (session && session.token) {
              joinCta.disabled = true;
              joinCta.innerHTML = '<span>Mengaktifkan Partner…</span>';
              API.post('/customer/affiliate/activate', {})
                .then(function () {
                  if (UI && UI.toast) UI.toast('Selamat! Kamu resmi jadi Foodie Partner Bangjo');
                  mountAffiliate(container, true);
                })
                .catch(function () {
                  mountAffiliate(container, true);
                });
            } else {
              joinCta.disabled = true;
              var prevHtml = joinCta.innerHTML;
              joinCta.innerHTML = '<span>Membuka Google Sign-In…</span>';
              startCustomerAuth('#affiliate', function () {
                mountAffiliate(container, true);
              }, joinCta, prevHtml);
            }
          };
        }

        if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
      })
      .catch(function (err) {
        if (!guestBody) return;
        guestBody.innerHTML =
          '<div style="padding:48px 20px;text-align:center;">' +
          '  <div style="font-size:32px;margin-bottom:8px;">⚠️</div>' +
          '  <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:6px;">Gagal Memuat Program</div>' +
          '  <div style="font-size:12px;color:#64748b;margin-bottom:14px;">' + UI.escape((err && (err.message || err.error)) || 'Koneksi terputus') + '</div>' +
          '  <button type="button" class="x-aux-action-btn" id="x-aff-retry-guest" style="max-width:180px;margin:0 auto;background:#111;color:#fff;">Coba Lagi</button>' +
          '</div>';
        var retry = guestBody.querySelector('#x-aff-retry-guest');
        if (retry) retry.onclick = function () { renderAffiliateGuestView(container); };
        if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
      });
  }

  function renderAffiliateDashboard(container) {
    container.innerHTML =
      '<div class="x-aux-page">' +
      '  <div class="x-aux-header" style="background:#0f172a;color:#ffffff;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:space-between;">' +
      '    <button type="button" class="x-aux-back-btn" id="x-affiliate-back" aria-label="Kembali" style="background:rgba(255,255,255,0.12);color:#fff;flex-shrink:0;">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali" style="filter:brightness(0) invert(1);">' +
      '    </button>' +
      '    <h1 class="x-aux-title" style="color:#ffffff;flex:1;text-align:left;margin-left:4px;">Partner Dashboard</h1>' +
      '    <button type="button" id="x-aff-help-top" aria-label="Bantuan Customer Service" style="background:rgba(255,255,255,0.12);border:none;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;color:#ffffff;cursor:pointer;flex-shrink:0;margin-left:auto;">' +
      '      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '        <path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"></path>' +
      '        <path d="M21 16v2a4 4 0 0 1-4 4h-5"></path>' +
      '      </svg>' +
      '    </button>' +
      '  </div>' +
      '  <div class="x-aux-body" style="padding:0;background:#f8fafc;" id="x-aff-dash-wrap">' +
      '    <div style="padding:48px 20px;text-align:center;color:#64748b;font-size:13.5px;"><span class="x-loc-spinner"></span> Memuat dashboard affiliate…</div>' +
      '  </div>' +
      '</div>';

    var backBtn = container.querySelector('#x-affiliate-back');
    if (backBtn) backBtn.onclick = function () { Router.navigate('home'); };

    var helpTop = container.querySelector('#x-aff-help-top');
    if (helpTop) {
      helpTop.onclick = function () {
        var waHelp = 'https://api.whatsapp.com/send?phone=628112345678&text=' + encodeURIComponent('Halo Tim Bangjo, saya butuh bantuan terkait Program Foodie Partner Affiliate.');
        window.open(waHelp, '_blank');
      };
    }

    var dashWrap = container.querySelector('#x-aff-dash-wrap');

    API.get('/customer/affiliate/stats')
      .then(function (res) {
        if (!dashWrap) return;
        var data = (res && res.stats) || {};
        var profile = data.profile || {};
        var program = data.program || {};
        var tier = data.tier || { name: 'Foodie Pemula', level: 1, badge: '🥉 Foodie Pemula • Level 1' };
        var payouts = data.payouts || [];

        // Auto-activate profile if not already active
        if (profile.status !== 'ACTIVE') {
          API.post('/customer/affiliate/activate', {}).then(function (actRes) {
            if (actRes && actRes.profile) profile = actRes.profile;
          }).catch(function () {});
        }

        var session = Store ? Store.getState().customerSession : null;
        var rawName = (session && (session.name || session.displayName)) || 'Foodie Partner';
        if (rawName.indexOf('@') !== -1) rawName = rawName.split('@')[0];
        var initial = rawName.charAt(0).toUpperCase() || 'F';

        var code = profile.referral_code || 'BANGJO';
        var shareUrl = window.location.origin + '/?ref=' + encodeURIComponent(code);

        var payable = Number(profile.balance_payable || 0);
        var pending = Number(profile.balance_pending || 0);
        var minPayout = Number(program.min_payout_amount || 50000);
        var canWithdraw = payable >= minPayout;
        var hasBank = Boolean(profile.bank_account_number && profile.bank_name);
        var progressPct = Math.min(100, Math.round((payable / minPayout) * 100));

        var waDefaultText = 'Yuk pesan menu spesial di Bangjo lewat link rekomendasi aku ini, dijamin nagih: ' + shareUrl;

        // Payout rows
        var payoutRowsHtml = '';
        if (payouts.length === 0) {
          payoutRowsHtml = '<div style="padding:16px;text-align:center;font-size:12px;color:#94a3b8;">Belum ada riwayat penarikan dana.</div>';
        } else {
          payouts.forEach(function (p) {
            var stBadge = p.status === 'PAID'
              ? '<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Ditransfer</span>'
              : (p.status === 'REJECTED'
                ? '<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Ditolak</span>'
                : '<span style="background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Menunggu Transfer</span>');
            var dateStr = p.requested_at ? new Date(p.requested_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

            payoutRowsHtml +=
              '<div class="x-aff-payout-row-item" data-payout-id="' + UI.escape(p.id) + '" style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #f1f5f9;cursor:pointer;">' +
              '  <div>' +
              '    <div style="font-size:13px;font-weight:800;color:#0f172a;">' + UI.money(p.amount) + '</div>' +
              '    <div style="font-size:11px;color:#64748b;">' + dateStr + (p.bank_name ? ' · ' + UI.escape(p.bank_name) : '') + '</div>' +
              '  </div>' +
              '  <div style="display:flex;align-items:center;gap:6px;">' +
              '    ' + stBadge +
              '    <span style="font-size:13px;color:#94a3b8;font-weight:700;">›</span>' +
              '  </div>' +
              '</div>';
          });
        }

        dashWrap.innerHTML =
          // Dark Executive Hero
          '<div class="x-aff-dash-hero">' +
          '  <div class="x-aff-user-row">' +
          '    <div class="x-aff-avatar-meta">' +
          '      <div class="x-aff-avatar">' + initial + '</div>' +
          '      <div>' +
          '        <div class="x-aff-username">Halo, ' + UI.escape(rawName) + ' 👋</div>' +
          '        <div class="x-aff-tier-badge">' + (tier.badge || '⭐ Foodie Star') + '</div>' +
          '      </div>' +
          '    </div>' +
          '  </div>' +

          // Wallet Card
          '  <div class="x-aff-wallet-box">' +
          '    <div class="x-aff-wallet-lbl">TOTAL KOMISI TERSEDIA</div>' +
          '    <div class="x-aff-balance-row">' +
          '      <div class="x-aff-wallet-val">' + UI.money(payable) + '</div>' +
          '      <div class="x-aff-wallet-tag">⏳ ' + UI.money(pending) + ' menunggu selesai</div>' +
          '    </div>' +
          (!canWithdraw ?
            '<div style="margin:10px 0 12px;">' +
            '  <div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:4px;">' +
            '    <span>Target Minimal Tarik: ' + UI.money(minPayout) + '</span>' +
            '    <span><b>' + progressPct + '%</b></span>' +
            '  </div>' +
            '  <div style="background:rgba(255,255,255,0.15);border-radius:999px;height:6px;overflow:hidden;">' +
            '    <div style="background:#b6ff00;height:100%;width:' + progressPct + '%;border-radius:999px;"></div>' +
            '  </div>' +
            '</div>' : '') +
          '    <button type="button" class="x-aff-withdraw-btn" id="x-aff-withdraw-btn" style="' + (canWithdraw ? 'background:#b6ff00;color:#0f172a;' : 'background:rgba(255,255,255,0.14);color:rgba(255,255,255,0.9);') + '">' +
          '      <span>💸 ' + (canWithdraw ? 'Tarik Saldo ke Rekening / E-Wallet' : 'Minimal Penarikan ' + UI.money(minPayout)) + '</span>' +
          '    </button>' +
          '  </div>' +
          '</div>' +

          // Content Container
          '<div style="padding:18px 18px 40px;">' +

          // Bank & E-Wallet Target Card
          '  <div class="x-aff-bank-target-card" id="x-aff-bank-target-card" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:14px 16px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,0.03);">' +
          '    <div style="display:flex;align-items:center;gap:12px;min-width:0;">' +
          '      <div style="width:40px;height:40px;border-radius:12px;background:' + (hasBank ? '#ecfdf5' : '#fffbeb') + ';color:' + (hasBank ? '#059669' : '#d97706') + ';display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">' +
          '        ' + (hasBank ? '💳' : '⚠️') +
          '      </div>' +
          '      <div style="min-width:0;">' +
          '        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Tujuan Pencairan Saldo</div>' +
          '        <div style="font-size:13px;font-weight:800;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
          '          ' + (hasBank ? (UI.escape(profile.bank_name) + ' · ' + UI.escape(profile.bank_account_number)) : 'Belum diatur (DANA / BCA)') +
          '        </div>' +
          '        <div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
          '          ' + (hasBank ? ('a.n. ' + UI.escape(profile.bank_account_holder)) : 'Atur rekening / no. HP DANA untuk transfer komisi') +
          '        </div>' +
          '      </div>' +
          '    </div>' +
          '    <button type="button" id="x-aff-btn-edit-bank" style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:700;color:#0f172a;cursor:pointer;flex-shrink:0;">' +
          '      ' + (hasBank ? '✏️ Ubah' : '➕ Atur') +
          '    </button>' +
          '  </div>' +

          // Instant Link Sharing Hub
          '  <div class="x-aff-share-hub">' +
          '    <div class="x-aff-share-hub-title">🔗 Link Rekomendasi Kamu</div>' +
          '    <div class="x-aff-share-hub-desc">Bagikan link ini agar pesanan temanmu otomatis tercatat & komisimu langsung masuk:</div>' +
          '    <div class="x-aff-reflink-box">' +
          '      <span class="x-aff-reflink-text">' + UI.escape(shareUrl) + '</span>' +
          '      <button type="button" class="x-aff-copy-btn" id="x-aff-copy-ref-btn">' +
          '        <span>📋 Salin</span>' +
          '      </button>' +
          '    </div>' +
          '    <div class="x-aff-quick-grid">' +
          '      <div class="x-aff-quick-tile" id="x-aff-share-wa">' +
          '        <div class="x-aff-tile-icon" style="background:#25D366;color:#fff;">' +
          '          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0012.04 2zM17.5 16.5c-.24.67-1.19 1.29-1.95 1.45-.52.11-1.2.2-3.48-.75-2.92-1.22-4.8-4.2-4.95-4.4-.14-.2-1.19-1.58-1.19-3.02s.75-2.14 1.02-2.43c.27-.29.59-.36.79-.36.2 0 .4 0 .57.01.19.01.44-.07.69.52.25.6.86 2.1.94 2.25.08.16.14.34.03.55-.11.21-.16.34-.32.53-.16.19-.34.42-.48.56-.16.16-.33.33-.14.66.19.33.84 1.38 1.8 2.24 1.24 1.11 2.29 1.45 2.62 1.61.33.16.52.14.71-.08.2-.22.84-.98 1.06-1.32.22-.34.45-.29.75-.17.3.11 1.92.9 2.25 1.07.33.16.55.25.63.39.08.13.08.77-.16 1.44z"/></svg>' +
          '        </div>' +
          '        <span class="x-aff-tile-lbl">WhatsApp</span>' +
          '      </div>' +
          '      <div class="x-aff-quick-tile" id="x-aff-share-ig">' +
          '        <div class="x-aff-tile-icon" style="background:linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);color:#fff;">' +
          '          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"></circle></svg>' +
          '        </div>' +
          '        <span class="x-aff-tile-lbl">IG Story</span>' +
          '      </div>' +
          '      <div class="x-aff-quick-tile" id="x-aff-share-qr">' +
          '        <div class="x-aff-tile-icon" style="background:#0f172a;color:#fff;">' +
          '          <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm13-2h3v2h-3v-2zm-5 0h2v3h-2v-3zm2 3h3v3h-3v-3zm3 3h3v2h-3v-2zm-5 0h2v2h-2v-2zm3-3h2v3h-2v-3z"/></svg>' +
          '        </div>' +
          '        <span class="x-aff-tile-lbl">Kartu QR</span>' +
          '      </div>' +
          '    </div>' +
          '  </div>' +

          // Metric Funnel
          '  <div class="x-aff-metric-grid">' +
          '    <div class="x-aff-metric-cell">' +
          '      <div class="x-aff-metric-num">' + (data.total_clicks || 0) + '</div>' +
          '      <div class="x-aff-metric-lbl">Total Klik</div>' +
          '    </div>' +
          '    <div class="x-aff-metric-cell">' +
          '      <div class="x-aff-metric-num" style="color:#059669;">' + (data.total_orders || 0) + '</div>' +
          '      <div class="x-aff-metric-lbl">Menu Terjual</div>' +
          '    </div>' +
          '    <div class="x-aff-metric-cell">' +
          '      <div class="x-aff-metric-num" style="color:#2563eb;">' + UI.money(profile.total_withdrawn || 0) + '</div>' +
          '      <div class="x-aff-metric-lbl">Total Ditarik</div>' +
          '    </div>' +
          '  </div>' +

          // WhatsApp Templates
          '  <div style="background:#ffffff;border-radius:20px;border:1px solid #e2e8f0;padding:16px 18px;margin-bottom:18px;">' +
          '    <div style="font-size:13.5px;font-weight:800;color:#0f172a;margin-bottom:10px;">✍️ Template Pesan WhatsApp Siap Pakai</div>' +
          '    <div class="x-aff-tpl-card">' +
          '      <div>' +
          '        <b>💼 Mode Makan Siang Kantor:</b><br>' +
          '        "Gais makan siang apa hari ini? Cobain Ayam Tulang Lunak Bangjo yuk, pesan lewat link rekomendasi ini:"' +
          '      </div>' +
          '      <button type="button" class="x-aff-copy-btn" id="x-aff-tpl-btn-1" style="padding:6px 10px;font-size:11px;">Kirim WA</button>' +
          '    </div>' +
          '    <div class="x-aff-tpl-card">' +
          '      <div>' +
          '        <b>🍗 Mode Rekomen Geprek Nagih:</b><br>' +
          '        "Sumpah sambel geprek lombok ijo Bangjo nagih bgt! Pesan langsung lewat link ini praktis & hemat:"' +
          '      </div>' +
          '      <button type="button" class="x-aff-copy-btn" id="x-aff-tpl-btn-2" style="padding:6px 10px;font-size:11px;">Kirim WA</button>' +
          '    </div>' +
          '  </div>' +

          // QR Story Card Promo Box
          '  <div class="x-aff-story-box">' +
          '    <div style="width:48px;height:48px;background:#fff;border-radius:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.06);flex-shrink:0;">' +
          '      <svg viewBox="0 0 24 24" fill="#0f172a" width="28" height="28"><path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm13-2h3v2h-3v-2zm-5 0h2v3h-2v-3zm2 3h3v3h-3v-3zm3 3h3v2h-3v-2zm-5 0h2v2h-2v-2zm3-3h2v3h-2v-3z"/></svg>' +
          '    </div>' +
          '    <div style="flex:1;">' +
          '      <div style="font-size:13px;font-weight:800;color:#1e3a1e;">Download Kartu Story QR</div>' +
          '      <div style="font-size:11px;color:#3f6212;margin-top:2px;line-height:1.4;">Pasang di status WhatsApp atau IG Story dengan 1 klik.</div>' +
          '    </div>' +
          '    <button type="button" id="x-aff-view-qr-card-btn" style="background:#111;color:#fff;border:none;border-radius:12px;padding:8px 12px;font-size:11.5px;font-weight:700;cursor:pointer;">Lihat</button>' +
          '  </div>' +

          // Payout History
          '  <div style="background:#ffffff;border-radius:20px;border:1px solid #e2e8f0;padding:16px 18px;">' +
          '    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '      <h3 style="font-size:14px;font-weight:800;color:#0f172a;margin:0;">Riwayat Penarikan Dana</h3>' +
          '      <span style="font-size:11px;color:#94a3b8;">' + payouts.length + ' transaksi</span>' +
          '    </div>' +
          payoutRowsHtml +
          '  </div>' +

          '</div>';

        // Attach Event Handlers
        var copyRefBtn = dashWrap.querySelector('#x-aff-copy-ref-btn');
        if (copyRefBtn) {
          copyRefBtn.onclick = function () {
            if (navigator.clipboard) {
              navigator.clipboard.writeText(shareUrl).then(function () {
                if (UI && UI.toast) UI.toast('Link rekomendasi berhasil disalin!');
              });
            } else {
              if (UI && UI.toast) UI.toast('Link: ' + shareUrl);
            }
          };
        }

        var shareWaTile = dashWrap.querySelector('#x-aff-share-wa');
        if (shareWaTile) {
          shareWaTile.onclick = function () {
            var url = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(waDefaultText);
            window.open(url, '_blank');
          };
        }

        var shareIgTile = dashWrap.querySelector('#x-aff-share-ig');
        var shareQrTile = dashWrap.querySelector('#x-aff-share-qr');
        var viewQrCardBtn = dashWrap.querySelector('#x-aff-view-qr-card-btn');
        var onStoryClick = function () {
          profile.program = program;
          var featProd = (program && program.featured_product) || null;
          openStoryModal(profile, shareUrl, {
            customerName: rawName,
            tierBadge: tier.badge,
            foodUrl: (featProd && featProd.image_url) || null,
            foodTitle: (featProd && featProd.name) || null
          });
        };
        if (shareIgTile) {
          shareIgTile.onclick = function () {
            var featProd = (program && program.featured_product) || null;
            shareToInstagramStory(rawName, profile.referral_code || '', shareUrl, {
              foodUrl: (featProd && featProd.image_url) || null,
              foodTitle: (featProd && featProd.name) || null
            });
          };
        }
        if (shareQrTile) shareQrTile.onclick = onStoryClick;
        if (viewQrCardBtn) viewQrCardBtn.onclick = onStoryClick;

        var tplBtn1 = dashWrap.querySelector('#x-aff-tpl-btn-1');
        if (tplBtn1) {
          tplBtn1.onclick = function () {
            var msg = 'Gais makan siang apa hari ini? Cobain Ayam Tulang Lunak Bangjo yuk, pesan lewat link rekomendasi ini:\n' + shareUrl;
            window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(msg), '_blank');
          };
        }

        var tplBtn2 = dashWrap.querySelector('#x-aff-tpl-btn-2');
        if (tplBtn2) {
          tplBtn2.onclick = function () {
            var msg = 'Sumpah sambel geprek lombok ijo Bangjo nagih bgt! Pesan langsung lewat link ini praktis & hemat:\n' + shareUrl;
            window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(msg), '_blank');
          };
        }

        var editBankBtn = dashWrap.querySelector('#x-aff-btn-edit-bank');
        if (editBankBtn) {
          editBankBtn.onclick = function () {
            openBankModal(profile, function () {
              mountAffiliate(container, true);
            });
          };
        }

        var withdrawBtn = dashWrap.querySelector('#x-aff-withdraw-btn');
        if (withdrawBtn) {
          withdrawBtn.onclick = function () {
            if (canWithdraw) {
              openPayoutModal(profile, payable, minPayout, function () {
                mountAffiliate(container, true);
              });
            } else {
              openWithdrawGuidanceModal(profile, payable, minPayout, function () {
                openBankModal(profile, function () {
                  mountAffiliate(container, true);
                });
              });
            }
          };
        }

        dashWrap.querySelectorAll('.x-aff-payout-row-item').forEach(function (row) {
          row.onclick = function () {
            var pid = row.getAttribute('data-payout-id');
            var found = payouts.find(function (it) { return String(it.id) === String(pid); });
            if (found) openPayoutDetailModal(found);
          };
        });

        if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
      })
      .catch(function (err) {
        if (!dashWrap) return;
        var errMsg = (err && (err.message || err.error)) || 'Terjadi kesalahan jaringan';
        var isSessionExpired = err.status === 401 || /session|unauthorized|expired|token/i.test(errMsg);

        if (isSessionExpired) {
          if (Store && typeof Store.clearCustomerSession === 'function') {
            Store.clearCustomerSession();
          }
          dashWrap.innerHTML =
            '<div style="padding:48px 20px;text-align:center;">' +
            '  <div style="font-size:36px;margin-bottom:8px;">🔒</div>' +
            '  <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:6px;">Sesi Masuk Telah Berakhir</div>' +
            '  <p style="font-size:12.5px;color:#64748b;margin:0 0 16px;line-height:1.5;">Sesi akun Anda telah kedaluwarsa. Silakan masuk kembali untuk mengakses program affiliate.</p>' +
            '  <button type="button" class="x-aux-action-btn" id="x-aff-relogin-btn" style="max-width:200px;margin:0 auto;background:#16a34a;color:#fff;">Masuk Kembali</button>' +
            '</div>';

          var reloginBtn = dashWrap.querySelector('#x-aff-relogin-btn');
          if (reloginBtn) {
            reloginBtn.onclick = function () {
              reloginBtn.disabled = true;
              var prevText = reloginBtn.textContent;
              reloginBtn.textContent = 'Membuka Google Sign-In…';
              startCustomerAuth('#affiliate', function () {
                mountAffiliate(container, true);
              }, reloginBtn, prevText);
            };
          }
          if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
          return;
        }

        dashWrap.innerHTML =
          '<div style="padding:48px 20px;text-align:center;">' +
          '  <div style="font-size:36px;margin-bottom:8px;">⚠️</div>' +
          '  <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:6px;">Gagal Memuat Dashboard</div>' +
          '  <div style="font-size:12px;color:#64748b;margin-bottom:14px;">' + UI.escape(errMsg) + '</div>' +
          '  <button type="button" class="x-aux-action-btn" id="x-aff-retry-btn" style="max-width:180px;margin:0 auto;background:#0284c7;color:#fff;">Coba Lagi</button>' +
          '</div>';

        var retryBtn = dashWrap.querySelector('#x-aff-retry-btn');
        if (retryBtn) retryBtn.onclick = function () { mountAffiliate(container, true); };
        if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
      });
  }

  function openBankModal(profile, onSaved) {
    profile = profile || {};
    var session = Store ? Store.getState().customerSession : null;
    var defaultHolder = profile.bank_account_holder || (session && (session.name || session.displayName)) || '';
    if (defaultHolder.indexOf('@') !== -1) defaultHolder = defaultHolder.split('@')[0];

    var popularDestinations = [
      { name: 'DANA', icon: '📱', type: 'ewallet' },
      { name: 'GoPay', icon: '📱', type: 'ewallet' },
      { name: 'OVO', icon: '📱', type: 'ewallet' },
      { name: 'ShopeePay', icon: '📱', type: 'ewallet' },
      { name: 'BCA', icon: '🏦', type: 'bank' },
      { name: 'Mandiri', icon: '🏦', type: 'bank' },
      { name: 'BRI', icon: '🏦', type: 'bank' },
      { name: 'BNI', icon: '🏦', type: 'bank' }
    ];

    var curBank = profile.bank_name || '';
    var chipsHtml = popularDestinations.map(function (d) {
      var isSel = curBank.toUpperCase() === d.name.toUpperCase();
      return '<button type="button" class="x-aff-bank-chip-modal" data-bank="' + d.name + '" data-type="' + d.type + '" style="background:' + (isSel ? '#0f172a' : '#f1f5f9') + ';color:' + (isSel ? '#ffffff' : '#334155') + ';border:1px solid ' + (isSel ? '#0f172a' : '#cbd5e1') + ';border-radius:10px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px;">' +
        '<span>' + d.icon + '</span><span>' + d.name + '</span>' +
      '</button>';
    }).join('');

    var overlay = document.createElement('div');
    overlay.className = 'x-overlay open';
    overlay.style.zIndex = '99999';
    overlay.innerHTML =
      '<div class="x-sheet" style="max-width:440px;margin:auto;border-radius:24px;padding:24px 20px;background:#fff;">' +
      '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
      '    <h3 style="font-size:17px;font-weight:800;color:#0f172a;margin:0;">Rekening Bank / E-Wallet</h3>' +
      '    <button type="button" id="x-modal-bank-x" style="background:#f1f5f9;border:none;border-radius:999px;width:30px;height:30px;font-size:15px;color:#64748b;cursor:pointer;">✕</button>' +
      '  </div>' +
      '  <p style="font-size:12.5px;color:#64748b;margin:0 0 16px;">Pilih tujuan pencairan komisi (DANA, GoPay, atau Rekening Bank):</p>' +
      '  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;" id="x-modal-bank-chips">' + chipsHtml + '</div>' +
      '  <div style="display:flex;flex-direction:column;gap:12px;">' +
      '    <div>' +
      '      <label style="display:block;font-size:11.5px;font-weight:700;color:#334155;margin-bottom:5px;">Nama Bank / E-Wallet</label>' +
      '      <input type="text" id="x-input-bank-name" placeholder="Pilih chip di atas atau ketik di sini" value="' + UI.escape(profile.bank_name || '') + '" style="width:100%;box-sizing:border-box;padding:11px 13px;border:1.5px solid #cbd5e1;border-radius:12px;font-size:13px;font-weight:600;">' +
      '    </div>' +
      '    <div>' +
      '      <label style="display:block;font-size:11.5px;font-weight:700;color:#334155;margin-bottom:5px;" id="x-lbl-bank-acc">Nomor Rekening / No. HP E-Wallet</label>' +
      '      <input type="tel" id="x-input-bank-acc" placeholder="Contoh: 081234567890 atau 8830123456" value="' + UI.escape(profile.bank_account_number || '') + '" style="width:100%;box-sizing:border-box;padding:11px 13px;border:1.5px solid #cbd5e1;border-radius:12px;font-size:14px;font-weight:700;">' +
      '      <small style="font-size:11px;color:#64748b;display:block;margin-top:4px;">Pastikan nomor terdaftar aktif di aplikasi DANA / m-Banking Anda.</small>' +
      '    </div>' +
      '    <div>' +
      '      <label style="display:block;font-size:11.5px;font-weight:700;color:#334155;margin-bottom:5px;">Nama Pemilik Akun / Rekening</label>' +
      '      <input type="text" id="x-input-bank-holder" placeholder="Masukkan nama sesuai rekening / KTP" value="' + UI.escape(defaultHolder) + '" style="width:100%;box-sizing:border-box;padding:11px 13px;border:1.5px solid #cbd5e1;border-radius:12px;font-size:13px;font-weight:600;">' +
      '      <small style="font-size:11px;color:#64748b;display:block;margin-top:4px;">Sesuai nama KTP / nama yang terdaftar di akun tujuan.</small>' +
      '    </div>' +
      '  </div>' +
      '  <div style="display:flex;gap:10px;margin-top:20px;">' +
      '    <button type="button" id="x-modal-bank-cancel" style="flex:1;background:#f1f5f9;color:#475569;border:none;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;">Batal</button>' +
      '    <button type="button" id="x-modal-bank-save" style="flex:2;background:#0f172a;color:#fff;border:none;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;">Simpan Rekening</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(overlay);

    var bankInput = overlay.querySelector('#x-input-bank-name');
    var accInput = overlay.querySelector('#x-input-bank-acc');
    var accLbl = overlay.querySelector('#x-lbl-bank-acc');

    overlay.querySelectorAll('.x-aff-bank-chip-modal').forEach(function (btn) {
      btn.onclick = function () {
        var selectedBank = btn.getAttribute('data-bank');
        var selectedType = btn.getAttribute('data-type');
        bankInput.value = selectedBank;
        if (selectedType === 'ewallet') {
          accLbl.textContent = 'Nomor HP Akun ' + selectedBank;
          accInput.placeholder = 'Contoh: 081234567890';
        } else {
          accLbl.textContent = 'Nomor Rekening ' + selectedBank;
          accInput.placeholder = 'Contoh: 8830123456';
        }
        overlay.querySelectorAll('.x-aff-bank-chip-modal').forEach(function (b) {
          b.style.background = '#f1f5f9';
          b.style.color = '#334155';
          b.style.borderColor = '#cbd5e1';
        });
        btn.style.background = '#0f172a';
        btn.style.color = '#ffffff';
        btn.style.borderColor = '#0f172a';
        accInput.focus();
      };
    });

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    overlay.querySelector('#x-modal-bank-x').onclick = close;
    overlay.querySelector('#x-modal-bank-cancel').onclick = close;

    overlay.querySelector('#x-modal-bank-save').onclick = function () {
      var bName = bankInput.value.trim();
      var bAcc = accInput.value.replace(/[^0-9]/g, '').trim();
      var bHolder = overlay.querySelector('#x-input-bank-holder').value.trim();

      if (!bName) {
        if (UI && UI.toast) UI.toast('Harap pilih atau isi nama Bank / E-Wallet.');
        return;
      }
      if (!bAcc || bAcc.length < 5) {
        if (UI && UI.toast) UI.toast('Nomor rekening atau nomor HP tidak valid.');
        return;
      }
      if (!bHolder) {
        if (UI && UI.toast) UI.toast('Harap isi nama pemilik rekening/akun.');
        return;
      }

      var saveBtn = overlay.querySelector('#x-modal-bank-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Menyimpan...';

      API.put('/customer/affiliate/bank-details', {
        bank_name: bName,
        bank_account_number: bAcc,
        bank_account_holder: bHolder
      }).then(function (res) {
        if (res && res.success) {
          if (UI && UI.toast) UI.toast('Rekening pencairan berhasil disimpan.');
          close();
          if (typeof onSaved === 'function') onSaved(res.profile);
        } else {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Simpan Rekening';
          if (UI && UI.toast) UI.toast('Gagal menyimpan: ' + (res.error || 'Error'));
        }
      }).catch(function (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Simpan Rekening';
        if (UI && UI.toast) UI.toast('Gagal: ' + (err.message || 'Error'));
      });
    };
  }

  function openWithdrawGuidanceModal(profile, payable, minPayout, onOpenBank) {
    var needed = Math.max(0, minPayout - payable);
    var pct = Math.min(100, Math.round((payable / minPayout) * 100));
    var estimatedItems = Math.ceil(needed / 1000);

    var overlay = document.createElement('div');
    overlay.className = 'x-overlay open';
    overlay.style.zIndex = '99999';
    overlay.innerHTML =
      '<div class="x-sheet" style="max-width:440px;margin:auto;border-radius:24px;padding:24px 20px;background:#fff;">' +
      '  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">' +
      '    <div>' +
      '      <span style="display:inline-block;background:#fef3c7;color:#b45309;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;margin-bottom:6px;">Minimal Tarik ' + UI.money(minPayout) + '</span>' +
      '      <h3 style="font-size:17px;font-weight:800;color:#0f172a;margin:0;">Saldo Belum Mencukupi</h3>' +
      '    </div>' +
      '    <button type="button" id="x-modal-guidance-x" style="background:#f1f5f9;border:none;border-radius:999px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:15px;color:#64748b;cursor:pointer;">✕</button>' +
      '  </div>' +
      '  <p style="font-size:12.5px;color:#64748b;margin:0 0 16px;line-height:1.5;">Komisi dapat dicairkan langsung ke rekening atau e-wallet setelah saldo mencapai batas minimal <b>' + UI.money(minPayout) + '</b>.</p>' +
      '  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:16px;margin-bottom:16px;">' +
      '    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">' +
      '      <span style="color:#64748b;">Saldo Komisi Anda:</span>' +
      '      <span style="font-weight:800;color:#0f172a;">' + UI.money(payable) + '</span>' +
      '    </div>' +
      '    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px;">' +
      '      <span style="color:#64748b;">Target Penarikan:</span>' +
      '      <span style="font-weight:800;color:#16a34a;">' + UI.money(minPayout) + '</span>' +
      '    </div>' +
      '    <div style="background:#e2e8f0;border-radius:999px;height:8px;overflow:hidden;margin-bottom:10px;">' +
      '      <div style="background:#16a34a;height:100%;width:' + pct + '%;border-radius:999px;transition:width 0.3s ease;"></div>' +
      '    </div>' +
      '    <div style="font-size:11.5px;color:#0369a1;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:8px 10px;line-height:1.4;">' +
      '      💡 Butuh <b>' + UI.money(needed) + '</b> lagi (sekitar <b>' + estimatedItems + ' menu</b> terjual) untuk bisa melakukan pencairan.' +
      '    </div>' +
      '  </div>' +
      '  <div style="margin-bottom:20px;">' +
      '    <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:8px;">Tips Cepat Kumpulkan Saldo:</div>' +
      '    <ul style="margin:0;padding-left:18px;font-size:12px;color:#64748b;line-height:1.6;">' +
      '      <li>Bagikan <b>Kartu Story Instagram</b> ke teman dan follower.</li>' +
      '      <li>Kirim rekomendasi menu via <b>WhatsApp</b> saat jam makan siang.</li>' +
      '      <li>Setiap menu yang dipesan via linkmu langsung menambah saldo Rp 1.000.</li>' +
      '    </ul>' +
      '  </div>' +
      '  <div style="display:flex;flex-direction:column;gap:10px;">' +
      '    <button type="button" id="x-modal-guidance-setup-bank" style="width:100%;background:#0f172a;color:#fff;border:none;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;">' +
      '      💳 Atur Rekening / DANA Sekarang' +
      '    </button>' +
      '    <button type="button" id="x-modal-guidance-close" style="width:100%;background:#f1f5f9;color:#475569;border:none;border-radius:12px;padding:11px;font-weight:700;font-size:13px;cursor:pointer;">' +
      '      Kembali ke Dashboard' +
      '    </button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(overlay);

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    overlay.querySelector('#x-modal-guidance-x').onclick = close;
    overlay.querySelector('#x-modal-guidance-close').onclick = close;
    overlay.querySelector('#x-modal-guidance-setup-bank').onclick = function () {
      close();
      if (typeof onOpenBank === 'function') onOpenBank();
    };
  }

  function openPayoutModal(profile, payable, minPayout, onDone) {
    if (!profile.bank_account_number) {
      openBankModal(profile, function (updatedProfile) {
        openPayoutModal(updatedProfile || profile, payable, minPayout, onDone);
      });
      return;
    }

    var defaultAmts = [50000, 100000];
    var chipsAmts = defaultAmts.filter(function (a) { return a >= minPayout && a <= payable; });

    var chipsHtml = chipsAmts.map(function (a) {
      return '<button type="button" class="x-aff-amt-chip" data-amt="' + a + '" style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;color:#0f172a;cursor:pointer;">' + UI.money(a) + '</button>';
    }).join('');
    chipsHtml += '<button type="button" class="x-aff-amt-chip" data-amt="' + payable + '" style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;color:#047857;cursor:pointer;">Tarik Semua (' + UI.money(payable) + ')</button>';

    var overlay = document.createElement('div');
    overlay.className = 'x-overlay open';
    overlay.style.zIndex = '99999';
    overlay.innerHTML =
      '<div class="x-sheet" style="max-width:440px;margin:auto;border-radius:24px;padding:24px 20px;background:#fff;">' +
      '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
      '    <h3 style="font-size:17px;font-weight:800;color:#0f172a;margin:0;">Tarik Saldo Komisi</h3>' +
      '    <button type="button" id="x-modal-payout-x" style="background:#f1f5f9;border:none;border-radius:999px;width:30px;height:30px;font-size:15px;color:#64748b;cursor:pointer;">✕</button>' +
      '  </div>' +
      '  <p style="font-size:12.5px;color:#64748b;margin:0 0 16px;">Dana akan ditransfer oleh resto ke rekening / e-wallet terdaftar Anda.</p>' +
      '  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:12px 14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">' +
      '    <div>' +
      '      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Tujuan Transfer:</div>' +
      '      <div style="font-size:13px;font-weight:800;color:#0f172a;margin-top:2px;">' + UI.escape(profile.bank_name) + ' - ' + UI.escape(profile.bank_account_number) + '</div>' +
      '      <div style="font-size:11.5px;color:#475569;">a.n. ' + UI.escape(profile.bank_account_holder) + '</div>' +
      '    </div>' +
      '    <button type="button" id="x-modal-payout-change-bank" style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;color:#0f172a;cursor:pointer;">Ubah</button>' +
      '  </div>' +
      '  <div style="margin-bottom:14px;">' +
      '    <label style="display:block;font-size:11.5px;font-weight:700;color:#334155;margin-bottom:6px;">Nominal Penarikan (Rp)</label>' +
      '    <input type="number" id="x-input-payout-amt" value="' + payable + '" min="' + minPayout + '" max="' + payable + '" style="width:100%;box-sizing:border-box;padding:12px;border:1.5px solid #cbd5e1;border-radius:12px;font-size:17px;font-weight:800;color:#0f172a;">' +
      '    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">' + chipsHtml + '</div>' +
      '    <div style="font-size:11px;color:#64748b;margin-top:8px;">Saldo komisi dapat dicairkan: <b>' + UI.money(payable) + '</b> (Min. ' + UI.money(minPayout) + ')</div>' +
      '  </div>' +
      '  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:10px 12px;font-size:11.5px;color:#166534;line-height:1.4;margin-bottom:16px;">' +
      '    ⚡ <b>Bebas Biaya Admin</b>: Penarikan diproses oleh kasir/admin resto langsung ke rekening/e-wallet Anda.' +
      '  </div>' +
      '  <div style="display:flex;gap:10px;">' +
      '    <button type="button" id="x-modal-payout-cancel" style="flex:1;background:#f1f5f9;color:#475569;border:none;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;">Batal</button>' +
      '    <button type="button" id="x-modal-payout-confirm" style="flex:2;background:#0f172a;color:#fff;border:none;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;">Ajukan Pencairan</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(overlay);

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    var amtInput = overlay.querySelector('#x-input-payout-amt');
    overlay.querySelectorAll('.x-aff-amt-chip').forEach(function (btn) {
      btn.onclick = function () {
        amtInput.value = btn.getAttribute('data-amt');
      };
    });

    overlay.querySelector('#x-modal-payout-x').onclick = close;
    overlay.querySelector('#x-modal-payout-cancel').onclick = close;

    overlay.querySelector('#x-modal-payout-change-bank').onclick = function () {
      close();
      openBankModal(profile, function (upd) {
        openPayoutModal(upd || profile, payable, minPayout, onDone);
      });
    };

    overlay.querySelector('#x-modal-payout-confirm').onclick = function () {
      var amt = Number(amtInput.value);

      if (isNaN(amt) || amt < minPayout) {
        if (UI && UI.toast) UI.toast('Minimal penarikan adalah ' + UI.money(minPayout));
        return;
      }
      if (amt > payable) {
        if (UI && UI.toast) UI.toast('Nominal penarikan melebihi saldo yang tersedia.');
        return;
      }

      var confirmBtn = overlay.querySelector('#x-modal-payout-confirm');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Memproses...';

      API.post('/customer/affiliate/payout', { amount: amt })
        .then(function (res) {
          if (res && res.success) {
            if (UI && UI.toast) UI.toast('Permintaan pencairan sebesar ' + UI.money(amt) + ' berhasil diajukan!');
            close();
            if (typeof onDone === 'function') onDone();
          } else {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Ajukan Pencairan';
            if (UI && UI.toast) UI.toast('Gagal mengajukan: ' + (res.error || 'Error'));
          }
        })
        .catch(function (err) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Ajukan Pencairan';
          if (UI && UI.toast) UI.toast('Gagal: ' + (err.message || 'Error'));
        });
    };
  }

  function openPayoutDetailModal(payout) {
    if (!payout) return;
    var statusTitle = payout.status === 'PAID'
      ? 'Dana Berhasil Ditransfer'
      : (payout.status === 'REJECTED' ? 'Penarikan Ditolak' : 'Menunggu Transfer Resto');
    var statusColor = payout.status === 'PAID'
      ? '#16a34a'
      : (payout.status === 'REJECTED' ? '#dc2626' : '#d97706');
    var statusIcon = payout.status === 'PAID'
      ? '✅'
      : (payout.status === 'REJECTED' ? '❌' : '⏳');
    var dateReq = payout.requested_at ? new Date(payout.requested_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
    var dateProc = payout.processed_at ? new Date(payout.processed_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : null;

    var overlay = document.createElement('div');
    overlay.className = 'x-overlay open';
    overlay.style.zIndex = '99999';
    overlay.innerHTML =
      '<div class="x-sheet" style="max-width:440px;margin:auto;border-radius:24px;padding:24px 20px;background:#fff;">' +
      '  <div style="text-align:center;padding:12px 0 16px;">' +
      '    <div style="font-size:38px;margin-bottom:8px;">' + statusIcon + '</div>' +
      '    <div style="font-size:12px;font-weight:800;color:' + statusColor + ';text-transform:uppercase;letter-spacing:0.5px;">' + statusTitle + '</div>' +
      '    <div style="font-size:26px;font-weight:900;color:#0f172a;margin-top:4px;">' + UI.money(payout.amount) + '</div>' +
      '  </div>' +
      '  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;font-size:12px;margin-bottom:18px;">' +
      '    <div style="display:flex;justify-content:space-between;">' +
      '      <span style="color:#64748b;">No. Referensi</span>' +
      '      <span style="font-weight:700;color:#0f172a;font-family:monospace;">' + UI.escape(payout.id) + '</span>' +
      '    </div>' +
      '    <div style="display:flex;justify-content:space-between;">' +
      '      <span style="color:#64748b;">Tujuan Transfer</span>' +
      '      <span style="font-weight:700;color:#0f172a;">' + UI.escape(payout.bank_name) + ' (' + UI.escape(payout.bank_account_number) + ')</span>' +
      '    </div>' +
      '    <div style="display:flex;justify-content:space-between;">' +
      '      <span style="color:#64748b;">Nama Pemilik</span>' +
      '      <span style="font-weight:700;color:#0f172a;">' + UI.escape(payout.bank_account_holder) + '</span>' +
      '    </div>' +
      '    <div style="display:flex;justify-content:space-between;">' +
      '      <span style="color:#64748b;">Waktu Pengajuan</span>' +
      '      <span style="color:#334155;">' + dateReq + '</span>' +
      '    </div>' +
      (dateProc ?
        '<div style="display:flex;justify-content:space-between;">' +
        '  <span style="color:#64748b;">Waktu Diproses</span>' +
        '  <span style="color:#334155;">' + dateProc + '</span>' +
        '</div>' : '') +
      (payout.transfer_receipt_url ?
        '<div style="display:flex;justify-content:space-between;border-top:1px dashed #e2e8f0;padding-top:8px;">' +
        '  <span style="color:#64748b;">Bukti / Ref Transfer</span>' +
        '  <span style="font-weight:700;color:#16a34a;">' + UI.escape(payout.transfer_receipt_url) + '</span>' +
        '</div>' : '') +
      (payout.rejection_reason ?
        '<div style="background:#fef2f2;border:1px solid #fecaca;padding:8px 10px;border-radius:8px;color:#991b1b;margin-top:4px;">' +
        '  <b>Alasan Penolakan:</b> ' + UI.escape(payout.rejection_reason) +
        '</div>' : '') +
      '  </div>' +
      '  <button type="button" id="x-modal-detail-close" style="width:100%;background:#0f172a;color:#fff;border:none;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;">Tutup</button>' +
      '</div>';

    document.body.appendChild(overlay);

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    overlay.querySelector('#x-modal-detail-close').onclick = close;
  }

  function roundRect(ctx, x, y, width, height, radius) {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function preloadStoryAssets(referralCode, qrObj, callback, opts) {
    opts = opts || {};
    var brandState = (Store && Store.getState && Store.getState().brand) || {};
    var brandName = brandState.name || 'MyBangjo';
    var brandTagline = brandState.tagline || 'Spesial Ayam Tulang Lunak';
    var logoUrl = brandState.logo_url || '/assets/uploads/logos/logo-e77d9c69a2f29ba0-1790611597659.png';
    var foodUrl = opts.foodUrl || '/assets/uploads/originals/brand_bangjo/med_b2d4b51563eb2d22_1791149148155.png';
    var foodTitle = opts.foodTitle || 'Ayam Tulang Lunak Bangjo';

    var toLoad = [
      { key: 'logoImg', src: logoUrl },
      { key: 'foodImg', src: foodUrl }
    ];

    if (!qrObj) {
      toLoad.push({
        key: 'qrImg',
        src: '/api/customer/affiliate/qr-code?code=' + encodeURIComponent(referralCode || '')
      });
    }

    var assets = {
      brandName: brandName,
      brandTagline: brandTagline,
      logoUrl: logoUrl,
      foodUrl: foodUrl,
      foodTitle: foodTitle,
      logoImg: null,
      foodImg: null,
      qrImg: null
    };

    var remaining = toLoad.length;
    var finished = false;

    function finish() {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        callback(assets);
      }
    }

    var timer = setTimeout(function () {
      finish();
    }, 3500);

    toLoad.forEach(function (item) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        assets[item.key] = img;
        remaining--;
        if (remaining <= 0) finish();
      };
      img.onerror = function () {
        assets[item.key] = null;
        remaining--;
        if (remaining <= 0) finish();
      };
      img.src = item.src;
    });
  }

  function buildStoryCanvas(rawName, referralCode, qrObj, assets) {
    assets = assets || {};
    var canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    var brandName = assets.brandName || 'MyBangjo';
    var brandTagline = assets.brandTagline || 'Spesial Ayam Tulang Lunak';
    var foodTitle = assets.foodTitle || 'Ayam Tulang Lunak Bangjo';
    var logoImg = assets.logoImg || null;
    var foodImg = assets.foodImg || null;
    var qrImg = assets.qrImg || null;

    // 1. Rich dark gradient background
    var bgGrad = ctx.createLinearGradient(0, 0, 0, 1920);
    bgGrad.addColorStop(0, '#080c15');
    bgGrad.addColorStop(0.4, '#0f172a');
    bgGrad.addColorStop(1, '#172033');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1080, 1920);

    // Lime radial glow at top
    var limeGlow = ctx.createRadialGradient(540, 240, 20, 540, 240, 550);
    limeGlow.addColorStop(0, 'rgba(182, 255, 0, 0.18)');
    limeGlow.addColorStop(1, 'rgba(8, 12, 21, 0)');
    ctx.fillStyle = limeGlow;
    ctx.fillRect(0, 0, 1080, 650);

    // Warm food glow
    var warmGlow = ctx.createRadialGradient(540, 750, 40, 540, 750, 480);
    warmGlow.addColorStop(0, 'rgba(245, 158, 11, 0.12)');
    warmGlow.addColorStop(1, 'rgba(8, 12, 21, 0)');
    ctx.fillStyle = warmGlow;
    ctx.fillRect(0, 400, 1080, 800);

    // 2. Client Branding Header
    if (logoImg && logoImg.width && logoImg.height) {
      ctx.save();
      roundRect(ctx, 290, 136, 84, 84, 20);
      ctx.clip();
      ctx.drawImage(logoImg, 290, 136, 84, 84);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 2;
      roundRect(ctx, 290, 136, 84, 84, 20);
      ctx.stroke();

      ctx.font = '900 42px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(brandName, 395, 178);

      ctx.font = '800 20px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#b6ff00';
      ctx.fillText(brandTagline.toUpperCase(), 395, 210);
    } else {
      ctx.font = '900 40px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(brandName + ' • ' + brandTagline.toUpperCase(), 540, 180);
    }

    // 3. Partner Status Badge
    ctx.fillStyle = '#b6ff00';
    roundRect(ctx, 310, 250, 460, 56, 28);
    ctx.fill();

    ctx.font = '900 22px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#111111';
    ctx.textAlign = 'center';
    ctx.fillText('🍗 OFFICIAL FOODIE PARTNER', 540, 286);

    // 4. Recommendation Endorsement
    ctx.font = '700 28px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'center';
    ctx.fillText('Rekomendasi Spesial dari ' + (rawName || 'Mitra'), 540, 350);

    // 5. Hero Food Card
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 20;
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 3;
    roundRect(ctx, 110, 390, 860, 790, 36);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Food Photo
    if (foodImg && foodImg.width && foodImg.height) {
      var iw = foodImg.width;
      var ih = foodImg.height;
      var tw = 808;
      var th = 540;
      var scale = Math.max(tw / iw, th / ih);
      var sw = tw / scale;
      var sh = th / scale;
      var sx = (iw - sw) / 2;
      var sy = (ih - sh) / 2;

      ctx.save();
      roundRect(ctx, 136, 416, 808, 540, 28);
      ctx.clip();
      ctx.drawImage(foodImg, sx, sy, sw, sh, 136, 416, 808, 540);

      // Dark gradient overlay on photo
      var fGrad = ctx.createLinearGradient(0, 720, 0, 956);
      fGrad.addColorStop(0, 'rgba(15, 23, 42, 0)');
      fGrad.addColorStop(1, 'rgba(15, 23, 42, 0.85)');
      ctx.fillStyle = fGrad;
      ctx.fillRect(136, 700, 808, 256);
      ctx.restore();
    }

    // Floating badges on food
    roundRect(ctx, 160, 440, 230, 48, 24);
    ctx.fillStyle = '#ea580c';
    ctx.fill();
    ctx.font = '800 20px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText('🔥 MENU ANDALAN', 275, 471);

    roundRect(ctx, 740, 440, 180, 48, 24);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fill();
    ctx.font = '800 20px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#facc15';
    ctx.fillText('⭐ 4.9 / 5.0', 830, 471);

    // Food Meta inside card
    ctx.font = '900 40px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(foodTitle, 160, 1015);

    ctx.font = '600 24px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Gurih renyah sampai ke tulang • Sambal khas juara', 160, 1060);

    roundRect(ctx, 160, 1090, 460, 44, 22);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.fill();
    ctx.font = '700 20px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('🏷️ DISKON EKSTRA PEMESANAN ONLINE', 178, 1120);

    // 6. Link CTA Pill
    var ctaGrad = ctx.createLinearGradient(130, 0, 950, 0);
    ctaGrad.addColorStop(0, '#b6ff00');
    ctaGrad.addColorStop(1, '#a3e635');
    ctx.fillStyle = ctaGrad;
    roundRect(ctx, 130, 1215, 820, 78, 39);
    ctx.fill();

    ctx.font = '900 26px -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.fillText('👉 TAP STIKER LINK UNTUK PESAN LANGSUNG', 540, 1264);

    // 7. Bottom Card: QR + Referral Code
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 15;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 110, 1325, 860, 310, 32);
    ctx.fill();
    ctx.restore();

    // QR Code on Left
    var qrLeft = 145;
    var qrTop = 1355;
    var qrSize = 250;
    if (qrObj && typeof qrObj.getModuleCount === 'function') {
      var modCount = qrObj.getModuleCount();
      var cellSize = qrSize / modCount;
      ctx.fillStyle = '#0f172a';
      for (var r = 0; r < modCount; r++) {
        for (var c = 0; c < modCount; c++) {
          if (qrObj.isDark(r, c)) {
            ctx.fillRect(qrLeft + c * cellSize, qrTop + r * cellSize, cellSize + 0.35, cellSize + 0.35);
          }
        }
      }
    } else if (qrImg) {
      ctx.drawImage(qrImg, qrLeft, qrTop, qrSize, qrSize);
    }

    // Divider
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(435, 1355);
    ctx.lineTo(435, 1605);
    ctx.stroke();

    // Right Column
    ctx.font = '800 20px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.fillText('KODE PROMO / REFERRAL', 465, 1395);

    roundRect(ctx, 465, 1415, 465, 76, 18);
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.font = '900 44px monospace';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(referralCode || '', 490, 1469);

    ctx.font = '600 22px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('Gunakan saat pesan online di:', 465, 1530);

    ctx.font = '900 26px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#16a34a';
    ctx.fillText('🌐 app.mybangjo.com', 465, 1572);

    // 8. Footer
    ctx.font = '700 23px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.fillText('100% Halal • Dapur Higienis • Pengantaran Cepat', 540, 1715);

    ctx.font = '500 18px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('MyBangjo Customer Partner App', 540, 1755);

    return canvas;
  }

  function renderAndDownloadStory(rawName, referralCode, shareUrl, qrObj, qrSrc, opts) {
    opts = opts || {};
    if (UI && UI.toast) UI.toast('Menyiapkan gambar HD 1080×1920…');

    preloadStoryAssets(referralCode, qrObj, function (assets) {
      try {
        var canvas = buildStoryCanvas(rawName, referralCode, qrObj, assets);
        if (!canvas) return;

        var dataUrl = canvas.toDataURL('image/png');
        var a = document.createElement('a');
        a.download = 'bangjo-story-' + (referralCode || 'referral') + '.png';
        a.href = dataUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        if (UI && UI.toast) UI.toast('Gambar HD Story berhasil diunduh!');
      } catch (err) {
        console.error('Download error:', err);
        if (UI && UI.toast) UI.toast('Gagal mengunduh gambar: ' + (err.message || 'Error'));
      }
    }, opts);
  }

  function shareToInstagramStory(rawName, referralCode, shareUrl, opts) {
    opts = opts || {};
    if (UI && UI.toast) UI.toast('Menyiapkan Story untuk Instagram…');

    // 1. Copy link automatically so customer can paste in Instagram link sticker
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl).catch(function () {});
    }

    var qrObj = null;
    try {
      if (typeof window !== 'undefined' && window.qrcode) {
        qrObj = window.qrcode(0, 'M');
        qrObj.addData(shareUrl);
        qrObj.make();
      }
    } catch (e) {
      console.warn('QR error:', e);
    }

    preloadStoryAssets(referralCode, qrObj, function (assets) {
      try {
        var canvas = buildStoryCanvas(rawName, referralCode, qrObj, assets);
        if (!canvas) return;

        var fileName = 'bangjo-story-' + (referralCode || 'promo') + '.png';

        if (canvas.toBlob) {
          canvas.toBlob(function (blob) {
            if (!blob) return;

            var file = null;
            try {
              file = new File([blob], fileName, { type: 'image/png' });
            } catch (_) {}

            var canShare = Boolean(file && navigator.canShare && navigator.canShare({ files: [file] }));

            if (canShare) {
              // Direct OS native share sheet: Instagram Stories receives the image and opens Story editor directly!
              navigator.share({
                files: [file],
                title: 'Bangjo Foodie Partner',
                text: 'Pesan menu favorit Bangjo: ' + shareUrl
              }).then(function () {
                if (UI && UI.toast) UI.toast('Berhasil membuka Instagram Story!');
              }).catch(function (err) {
                if (err && err.name !== 'AbortError') {
                  console.warn('Share error:', err);
                }
              });
            } else {
              // Fallback for browsers/webviews where file sharing is not supported:
              // Download image to device gallery and trigger Instagram story intent
              var a = document.createElement('a');
              a.download = fileName;
              a.href = canvas.toDataURL('image/png');
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);

              if (UI && UI.toast) {
                UI.toast('Gambar kartu tersimpan di Galeri & link disalin! Membuka Instagram…');
              }

              var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
              if (isMobile) {
                window.location.href = 'intent://#Intent;action=com.instagram.share.ADD_TO_STORY;package=com.instagram.android;end;';
                setTimeout(function () {
                  window.location.href = 'instagram-stories://share';
                  setTimeout(function () {
                    window.open('https://www.instagram.com/', '_blank');
                  }, 1200);
                }, 600);
              } else {
                window.open('https://www.instagram.com/', '_blank');
              }
            }
          }, 'image/png');
        }
      } catch (err) {
        console.error('IG Story error:', err);
      }
    }, opts);
  }

  function openStoryModal(profile, shareUrl, opts) {
    opts = opts || {};
    var rawName = opts.customerName || (profile && profile.customer_name) || 'Mitra Bangjo';
    var referralCode = (profile && profile.referral_code) || '';
    var qrSrc = '';
    var qrObj = null;

    try {
      if (typeof window !== 'undefined' && window.qrcode) {
        qrObj = window.qrcode(0, 'M');
        qrObj.addData(shareUrl);
        qrObj.make();
        qrSrc = qrObj.createDataURL(6, 2);
      }
    } catch (e) {
      console.warn('QR error:', e);
    }
    if (!qrSrc) {
      qrSrc = '/api/customer/affiliate/qr-code?code=' + encodeURIComponent(referralCode);
    }

    var brandState = (Store && Store.getState && Store.getState().brand) || {};
    var brandName = brandState.name || 'MyBangjo';
    var brandTagline = brandState.tagline || 'Spesial Ayam Tulang Lunak';
    var logoUrl = brandState.logo_url || '/assets/uploads/logos/logo-e77d9c69a2f29ba0-1790611597659.png';

    var featured = (profile && profile.program && profile.program.featured_product) || null;
    var foodUrl = opts.foodUrl || (featured && featured.image_url) || '/assets/uploads/originals/brand_bangjo/med_b2d4b51563eb2d22_1791149148155.png';
    var foodTitle = opts.foodTitle || (featured && featured.name) || 'Ayam Tulang Lunak Bangjo';

    var overlay = document.createElement('div');
    overlay.className = 'x-overlay open';
    overlay.style.zIndex = '99999';

    overlay.innerHTML =
      '<div class="x-story-sheet">' +
      '  <div class="x-story-drag-bar"></div>' +
      '  <div class="x-story-modal-header">' +
      '    <div class="x-story-modal-title">Kartu Story & QR Promo</div>' +
      '    <button type="button" class="x-story-close-btn" id="x-story-modal-close" aria-label="Tutup">✕</button>' +
      '  </div>' +
      '  <div class="x-story-poster-frame">' +
      '    <div class="x-story-poster-brand">' +
      '      <img src="' + UI.escape(logoUrl) + '" class="x-story-poster-brand-logo" alt="Logo">' +
      '      <div class="x-story-poster-brand-info">' +
      '        <div class="x-story-poster-brand-name">' + UI.escape(brandName) + '</div>' +
      '        <div class="x-story-poster-brand-tagline">' + UI.escape(brandTagline) + '</div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="x-story-poster-badge">🍗 OFFICIAL FOODIE PARTNER</div>' +
      '    <div class="x-story-poster-user">Rekomendasi dari <b>' + UI.escape(rawName) + '</b></div>' +
      '    <div class="x-story-poster-food-card">' +
      '      <div class="x-story-poster-food-img-wrap">' +
      '        <img src="' + UI.escape(foodUrl) + '" class="x-story-poster-food-img" alt="' + UI.escape(foodTitle) + '">' +
      '        <span class="x-story-poster-food-tag">🔥 Menu Andalan</span>' +
      '        <span class="x-story-poster-food-rate">⭐ 4.9</span>' +
      '      </div>' +
      '      <div class="x-story-poster-food-meta">' +
      '        <div class="x-story-poster-food-title">' + UI.escape(foodTitle) + '</div>' +
      '        <div class="x-story-poster-food-desc">Gurih renyah sampai ke tulang • Sambal khas juara</div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="x-story-poster-cta-pill">👉 Tap Stiker Link untuk Pesan</div>' +
      '    <div class="x-story-poster-bottom-card">' +
      '      <div class="x-story-poster-bottom-qr">' +
      '        <img class="x-story-poster-qr-img" id="x-story-modal-img" src="' + qrSrc + '" alt="QR Code">' +
      '      </div>' +
      '      <div class="x-story-poster-bottom-divider"></div>' +
      '      <div class="x-story-poster-bottom-info">' +
      '        <div class="x-story-poster-bottom-lbl">KODE REFERRAL</div>' +
      '        <div class="x-story-poster-bottom-code">' + UI.escape(referralCode) + '</div>' +
      '        <div class="x-story-poster-bottom-url">🌐 app.mybangjo.com</div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="x-story-poster-sub">100% Halal • Fresh Dapur • Siap Antar Cepat</div>' +
      '  </div>' +
      '  <div class="x-story-actions-wrap">' +
      '    <button type="button" class="x-story-btn-download" id="x-story-download-btn">' +
      '      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>' +
      '      <span>Unduh Gambar Story (HD 1080×1920)</span>' +
      '    </button>' +
      '    <button type="button" class="x-story-btn-wa" id="x-story-wa-btn">' +
      '      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0012.04 2z"/></svg>' +
      '      <span>Bagikan ke WhatsApp</span>' +
      '    </button>' +
      '    <button type="button" class="x-story-btn-copy" id="x-story-copy-btn">' +
      '      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>' +
      '      <span>Salin Link Story</span>' +
      '    </button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(overlay);

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    overlay.querySelector('#x-story-modal-close').onclick = close;
    overlay.onclick = function (e) {
      if (e.target === overlay) close();
    };

    overlay.querySelector('#x-story-copy-btn').onclick = function () {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(shareUrl).then(function () {
          if (UI && UI.toast) UI.toast('Link story berhasil disalin!');
        });
      } else {
        if (UI && UI.toast) UI.toast('Link: ' + shareUrl);
      }
    };

    overlay.querySelector('#x-story-wa-btn').onclick = function () {
      var waMsg = 'Pesan menu favorit Bangjo lewat link rekomendasi ini:\n' + shareUrl;
      window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(waMsg), '_blank');
    };

    overlay.querySelector('#x-story-download-btn').onclick = function () {
      renderAndDownloadStory(rawName, referralCode, shareUrl, qrObj, qrSrc, { foodUrl: foodUrl, foodTitle: foodTitle });
    };
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
            loginBtn.disabled = true;
            var prevText = loginBtn.textContent;
            loginBtn.textContent = 'Membuka Google Sign-In…';
            startCustomerAuth('#history', function () {
              mountHistory(container);
            }, loginBtn, prevText);
          };
        }
        if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
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
          if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
          return;
        }

        var html = '';
        orders.forEach(function (ord) {
          var statusColor = ord.status === 'completed' ? '#00A637' : (ord.status === 'cancelled' || ord.status === 'rejected' ? '#ef4444' : '#0284c7');
          var statusLabel = ord.status === 'completed' ? 'Selesai' : (ord.status === 'cancelled' ? 'Dibatalkan' : (ord.status === 'rejected' ? 'Ditolak' : 'Diproses'));
          var isReservation = ord.order_type === 'reservation';
          var itemsText = isReservation
            ? 'Reservasi meja'
            : ((ord.items || []).map(function (it) { return it.quantity + 'x ' + it.product_name; }).join(', ') || 'Item pesanan');
          var dateStr = ord.created_at ? new Date(ord.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
          var reservationInfo = '';
          if (isReservation) {
            var reservationDate = ord.reservation_date || '';
            var reservationTime = ord.reservation_time || '';
            var guestCount = Number(ord.guest_count || 0);
            reservationInfo =
              '<div class="x-history-date" style="margin-top:6px;color:#92400e;font-weight:700;">' +
              'Reservasi: ' + UI.escape(reservationDate || '—') +
              (reservationTime ? ' • ' + UI.escape(reservationTime) : '') +
              (guestCount > 0 ? ' • ' + guestCount + ' tamu' : '') +
              '</div>';
          }

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
            reservationInfo +
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
        if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
      })
      .catch(function () {
        if (listWrap) {
          listWrap.innerHTML =
            '<div style="padding:32px 20px;text-align:center;color:#ef4444;font-size:13px;">Gagal memuat riwayat pesanan. Periksa koneksi internet Anda.</div>';
        }
        if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
      });
  }

  // ══════════════════════════════════════════════════════════════
  //  3. PROFILE VIEW (FLOWBITE_USER-SOLID.SVG)
  // ══════════════════════════════════════════════════════════════

  // Alur hapus akun, satu tempat. Dipakai halaman Pengaturan Akun.
  function bindDeleteAccountFlow(container) {

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
      }).catch(function (err) {
        // Sebab sebenarnya harus terlihat. Pesan generik "koneksi bermasalah"
        // menyembunyikan alasan sesungguhnya (mis. 429 terlalu sering), dan itu
        // membuat masalah yang bisa dijelaskan jadi tidak bisa didiagnosis.
        var status = err && err.status ? (' (' + err.status + ')') : '';
        var reason = (err && err.message) ? err.message : 'Koneksi bermasalah.';
        if (UI && UI.toast) UI.toast('Akun belum dihapus: ' + reason + status);
      });
    };
  }


  }

  function mountAccountSettings(container) {
    if (!container) return;
    container.innerHTML =
      '<div class="x-aux-page">' +
      '  <div class="x-aux-header">' +
      '    <button type="button" class="x-aux-back-btn" id="x-acc-back" aria-label="Kembali">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
      '    </button>' +
      '    <h1 class="x-aux-title">Pengaturan Akun</h1>' +
      '  </div>' +
      '  <div class="x-aux-body">' +
      '    <p style="font-size:12.5px;color:#64748b;line-height:1.5;margin:0 0 14px;">Menghapus akun berarti Anda keluar dari akun ini, dan alamat serta sesi Anda hilang. Riwayat pesanan tetap tersimpan di resto, tanpa terhubung lagi ke Anda.</p>' +
      '    <button type="button" id="x-profile-delete" style="width:100%;height:46px;border-radius:12px;border:1.5px solid #fecaca;background:#fff;color:#dc2626;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;">Hapus Akun</button>' +
      '  </div>' +
      '</div>';
    var back = container.querySelector('#x-acc-back');
    if (back) back.onclick = function () { Router.navigate('profile'); };
    bindDeleteAccountFlow(container);
    if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
  }

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
      '      <button type="button" class="x-profile-menu-item" id="x-profile-btn-collections">' +
      '        <div class="left"><span class="icon">🔖</span><span>My Collections</span></div>' +
      '        <div style="display:flex;align-items:center;gap:6px;">' +
      (function () {
        var count = (Store && Store.getCollections) ? Store.getCollections().length : 0;
        return count > 0 ? '<span style="background:#fee2e2;color:#dc2626;font-size:11px;font-weight:700;padding:2px 8px;border-radius:12px;">' + count + '</span>' : '';
      })() +
      '          <img src="/assets/icons/arrowback.svg" alt="" style="transform:rotate(180deg);width:14px;opacity:0.4;">' +
      '        </div>' +
      '      </button>' +
      '      <button type="button" class="x-profile-menu-item" id="x-profile-btn-affiliate">' +
      '        <div class="left"><span class="icon">🎁</span><span>Daftar Affiliate (Ajak Teman)</span></div>' +
      '        <img src="/assets/icons/arrowback.svg" alt="" style="transform:rotate(180deg);width:14px;opacity:0.4;">' +
      '      </button>' +
      '      <button type="button" class="x-profile-menu-item" id="x-profile-btn-account">' +
      '        <div class="left"><span class="icon">⚙️</span><span>Pengaturan Akun</span></div>' +
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

    var colBtn = container.querySelector('#x-profile-btn-collections');
    if (colBtn) {
      colBtn.onclick = function () {
        Router.navigate('collections');
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
    }    var accBtn = container.querySelector('#x-profile-btn-account');
    if (accBtn) accBtn.onclick = function () { Router.navigate('account-settings'); };

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
    if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
  }

  // ══════════════════════════════════════════════════════════════
  //  COLLECTIONS VIEW (#collections) — Wishlist
  // ══════════════════════════════════════════════════════════════
  function mountCollections(container) {
    if (!container) return;

    function render() {
      var collections = (Store && Store.getCollections) ? Store.getCollections() : [];

      var contentHtml = '';
      if (!collections || collections.length === 0) {
        contentHtml =
          '<div style="text-align:center;padding:50px 20px;">' +
          '  <div style="width:72px;height:72px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px;">🔖</div>' +
          '  <h2 style="font-size:18px;font-weight:700;color:#0f172a;margin:0 0 6px;">Belum Ada Menu Disimpan</h2>' +
          '  <p style="font-size:13.5px;color:#64748b;line-height:1.5;max-width:280px;margin:0 auto 24px;">Simpan menu favoritmu dengan menekan tombol Simpan di detail menu.</p>' +
          '  <button type="button" class="x-aux-submit-btn" style="width:100%;max-width:240px;margin:0 auto;display:block;" id="x-collections-explore-btn">Jelajahi Menu</button>' +
          '</div>';
      } else {
        var itemsHtml = '';
        for (var i = 0; i < collections.length; i++) {
          var item = collections[i];
          var title = item.name || item.title || item.menu_title || 'Menu Favorit';
          var subtitle = item.menu_subtitle || item.subtitle || (Array.isArray(item.menu_detail) ? item.menu_detail.join(' + ') : '') || item.description || '';
          var price = Number(item.price || 0);
          var regPrice = Number(item.regular_price || price);
          var isPromo = regPrice > price;
          var imgSrc = item.image_url || item.image || '/assets/icons/food-placeholder.png';

          itemsHtml +=
            '<div class="x-collection-card" data-product-id="' + UI.escape(item.id) + '">' +
            '  <img class="x-collection-thumb" src="' + UI.escape(imgSrc) + '" alt="' + UI.escape(title) + '" loading="lazy" onerror="this.style.opacity=0.3;">' +
            '  <div class="x-collection-info">' +
            '    <div class="x-collection-title">' + UI.escape(title) + '</div>' +
            (subtitle ? '    <div class="x-collection-desc">' + UI.escape(subtitle) + '</div>' : '') +
            '    <div class="x-collection-price-row">' +
            '      <span class="x-collection-price">' + UI.money(price) + '</span>' +
            (isPromo ? '      <span class="x-collection-old-price">' + UI.money(regPrice) + '</span>' : '') +
            (isPromo ? '      <span class="x-collection-promo-tag">Promo</span>' : '') +
            '    </div>' +
            '  </div>' +
            '  <div class="x-collection-actions">' +
            '    <button type="button" class="x-collection-btn-add" data-id="' + UI.escape(item.id) + '" title="Pesan">+ Pesan</button>' +
            '    <button type="button" class="x-collection-btn-remove" data-id="' + UI.escape(item.id) + '" title="Hapus">' +
            '      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
            '    </button>' +
            '  </div>' +
            '</div>';
        }

        contentHtml =
          '<div style="font-size:13px;color:#64748b;font-weight:600;margin-bottom:12px;">' + collections.length + ' menu tersimpan</div>' +
          '<div class="x-collections-list">' + itemsHtml + '</div>';
      }

      container.innerHTML =
        '<div class="x-aux-page">' +
        '  <div class="x-aux-header">' +
        '    <button type="button" class="x-aux-back-btn" id="x-collections-back" aria-label="Kembali">' +
        '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
        '    </button>' +
        '    <h1 class="x-aux-title">My Collections</h1>' +
        '  </div>' +
        '  <div class="x-aux-body">' +
        contentHtml +
        '  </div>' +
        '</div>';

      var backBtn = container.querySelector('#x-collections-back');
      if (backBtn) {
        backBtn.onclick = function () {
          Router.navigate('profile');
        };
      }

      var exploreBtn = container.querySelector('#x-collections-explore-btn');
      if (exploreBtn) {
        exploreBtn.onclick = function () {
          Router.navigate('home');
        };
      }

      // Add to cart buttons
      var addBtns = container.querySelectorAll('.x-collection-btn-add');
      addBtns.forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var pid = btn.getAttribute('data-id');
          var matched = collections.find(function (c) { return String(c.id) === String(pid); });
          if (matched && Store && typeof Store.addItem === 'function') {
            Store.addItem(matched, 1);
          }
        };
      });

      // Remove buttons
      var removeBtns = container.querySelectorAll('.x-collection-btn-remove');
      removeBtns.forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var pid = btn.getAttribute('data-id');
          if (Store && typeof Store.removeFromCollections === 'function') {
            Store.removeFromCollections(pid);
            if (UI && UI.toast) UI.toast('Menu dihapus dari My Collections');
            render();
          }
        };
      });

      // Card click opens full detail modal
      var cards = container.querySelectorAll('.x-collection-card');
      cards.forEach(function (card) {
        card.onclick = function () {
          var pid = card.getAttribute('data-product-id');
          var matched = collections.find(function (c) { return String(c.id) === String(pid); });
          if (matched) {
            if (typeof window.openProductDetail === 'function') {
              window.openProductDetail(matched);
            } else if (window.XentraHome && typeof window.XentraHome.openProductDetail === 'function') {
              window.XentraHome.openProductDetail(matched);
            }
          }
        };
      });
    }

    render();
    if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
  }

  // Expose
  window.XentraAuxPages = {
    mountAffiliate: mountAffiliate,
    mountHistory: mountHistory,
    mountProfile: mountProfile,
    mountAccountSettings: mountAccountSettings,
    mountCollections: mountCollections
  };
})();
