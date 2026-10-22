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

  function renderAffiliateApplyForm(container, program, session, prefill) {
    program = program || {};
    prefill = prefill || {};
    var isFixedPerItem = (program.commission_type === 'FIXED_PER_ITEM');
    var rateDisplay = isFixedPerItem
      ? (UI.money(program.commission_per_item || program.commission_rate || 1000) + ' per menu')
      : ((program.commission_rate != null ? program.commission_rate : 5) + '% per pesanan');
    var custName = prefill.full_name || (session && (session.name || session.displayName)) || '';
    if (custName.indexOf('@') !== -1) {
      custName = custName.split('@')[0];
    }
    var custPhone = sanitizePhone(prefill.phone || (session && session.phone) || '');

    var formData = {
      full_name: custName,
      phone: custPhone,
      social_channel: 'Instagram',
      social_media: prefill.social_media || '',
      bank_name: prefill.bank_name || 'BCA',
      bank_account_number: prefill.bank_account_number || '',
      bank_account_holder: prefill.bank_account_holder || custName,
      notes: prefill.notes || ''
    };

    var currentStep = 1;

    function renderShell() {
      container.innerHTML =
        '<div class="x-aux-page">' +
        '  <div class="x-aux-header">' +
        '    <button type="button" class="x-aux-back-btn" id="x-affiliate-back" aria-label="Kembali">' +
        '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
        '    </button>' +
        '    <h1 class="x-aux-title">Daftar Affiliate</h1>' +
        '  </div>' +
        '  <div class="x-aux-body">' +
        '    <div class="x-aff-wizard">' +
        '      <!-- Stepper Progress Bar -->' +
        '      <div class="x-aff-progress-bar" id="x-aff-progress-bar">' +
        '        <div class="x-aff-progress-seg active" id="pseg-1"></div>' +
        '        <div class="x-aff-progress-seg" id="pseg-2"></div>' +
        '        <div class="x-aff-progress-seg" id="pseg-3"></div>' +
        '        <div class="x-aff-progress-seg" id="pseg-4"></div>' +
        '      </div>' +
        '      <div id="x-aff-step-host"></div>' +
        '    </div>' +
        '  </div>' +
        '</div>';

      var backBtn = container.querySelector('#x-affiliate-back');
      if (backBtn) {
        backBtn.onclick = function () {
          if (currentStep > 1) {
            goToStep(currentStep - 1);
          } else {
            Router.navigate('home');
          }
        };
      }

      renderCurrentStep();
    }

    function updateProgressBar() {
      for (var i = 1; i <= 4; i++) {
        var seg = container.querySelector('#pseg-' + i);
        if (seg) {
          if (i <= currentStep) seg.classList.add('active');
          else seg.classList.remove('active');
        }
      }
    }

    function goToStep(step) {
      currentStep = step;
      updateProgressBar();
      renderCurrentStep();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function renderCurrentStep() {
      var host = container.querySelector('#x-aff-step-host');
      if (!host) return;

      if (currentStep === 1) renderStep1(host);
      else if (currentStep === 2) renderStep2(host);
      else if (currentStep === 3) renderStep3(host);
      else if (currentStep === 4) renderStep4(host);
    }

    // ── STEP 1: Data Diri ───────────────────────────────────────────
    function renderStep1(host) {
      host.innerHTML =
        '<div class="x-aff-step-container">' +
        '  <div class="x-aff-card">' +
        '    <div class="x-aff-step-badge">1 dari 4 • Data Diri</div>' +
        '    <h2 class="x-aff-step-title">Data Diri</h2>' +
        '    <p class="x-aff-step-desc">Isi nama dan nomor WhatsApp aktifmu.</p>' +
        '    <div class="x-aff-field-group">' +
        '      <label class="x-aff-label"><span>Nama Lengkap</span><span style="color:#ef4444;">*</span></label>' +
        '      <input type="text" id="x-step-name" class="x-aff-input" placeholder="Nama lengkapmu" value="' + UI.escape(formData.full_name) + '">' +
        '    </div>' +
        '    <div class="x-aff-field-group">' +
        '      <label class="x-aff-label"><span>Nomor WhatsApp</span><span style="color:#ef4444;">*</span></label>' +
        '      <input type="tel" id="x-step-phone" class="x-aff-input" placeholder="08xxxxxxxxxx" value="' + UI.escape(formData.phone) + '">' +
        '    </div>' +
        '    <button type="button" class="x-aff-btn-primary" id="x-step1-next" style="margin-top:20px;">Lanjut &rarr;</button>' +
        '  </div>' +
        '</div>';

      var nextBtn = host.querySelector('#x-step1-next');
      nextBtn.onclick = function () {
        var nameInput = host.querySelector('#x-step-name').value.trim();
        var phoneInput = host.querySelector('#x-step-phone').value.trim();

        if (!nameInput) {
          if (UI && UI.toast) UI.toast('Nama lengkap belum diisi');
          host.querySelector('#x-step-name').focus();
          return;
        }
        if (!phoneInput || phoneInput.indexOf('@') !== -1 || phoneInput.length < 8) {
          if (UI && UI.toast) UI.toast('Nomor WhatsApp belum valid (gunakan nomor HP aktif)');
          host.querySelector('#x-step-phone').focus();
          return;
        }

        formData.full_name = nameInput;
        formData.phone = phoneInput;
        if (!formData.bank_account_holder) formData.bank_account_holder = nameInput;
        goToStep(2);
      };
    }

    // ── STEP 2: Media Promosi ────────────────────────────────────────
    function renderStep2(host) {
      var channels = [
        { id: 'Instagram', name: 'Instagram', icon: '📸', ph: '@username' },
        { id: 'TikTok', name: 'TikTok', icon: '🎵', ph: '@username' },
        { id: 'WhatsApp', name: 'WhatsApp', icon: '💬', ph: 'No. WA / Grup' },
        { id: 'X (Twitter)', name: 'X / Twitter', icon: '🐦', ph: '@username' },
        { id: 'Teman & Kantor', name: 'Teman / Kantor', icon: '👥', ph: 'Nama kantor atau divisi' },
        { id: 'Lainnya', name: 'Lainnya', icon: '🌐', ph: 'Media / link promosi' }
      ];

      var chipsHtml = channels.map(function (c) {
        var isSel = formData.social_channel === c.id;
        return '<div class="x-aff-chip ' + (isSel ? 'selected' : '') + '" data-channel="' + c.id + '" data-ph="' + c.ph + '">' +
               '  <span class="x-aff-chip-icon">' + c.icon + '</span>' +
               '  <span>' + c.name + '</span>' +
               '</div>';
      }).join('');

      var currentChannelObj = channels.find(function (c) { return c.id === formData.social_channel; }) || channels[0];

      host.innerHTML =
        '<div class="x-aff-step-container">' +
        '  <div class="x-aff-card">' +
        '    <div class="x-aff-step-badge">2 dari 4 • Media Promosi</div>' +
        '    <h2 class="x-aff-step-title">Biasa Share di Mana?</h2>' +
        '    <p class="x-aff-step-desc">Pilih media yang paling sering kamu pakai:</p>' +
        '    <div class="x-aff-chips-grid" id="x-social-chips">' + chipsHtml + '</div>' +
        '    <div class="x-aff-field-group">' +
        '      <label class="x-aff-label"><span id="x-social-label">Akun / Link (' + UI.escape(formData.social_channel) + ')</span><span style="color:#ef4444;">*</span></label>' +
        '      <input type="text" id="x-step-social" class="x-aff-input" placeholder="' + UI.escape(currentChannelObj.ph) + '" value="' + UI.escape(formData.social_media) + '">' +
        '    </div>' +
        '    <button type="button" class="x-aff-btn-primary" id="x-step2-next" style="margin-top:20px;">Lanjut &rarr;</button>' +
        '    <button type="button" class="x-aff-btn-secondary" id="x-step2-back">&larr; Kembali</button>' +
        '  </div>' +
        '</div>';

      var chipEls = host.querySelectorAll('.x-aff-chip');
      var socialInput = host.querySelector('#x-step-social');
      var socialLabel = host.querySelector('#x-social-label');

      chipEls.forEach(function (chip) {
        chip.onclick = function () {
          chipEls.forEach(function (c) { c.classList.remove('selected'); });
          chip.classList.add('selected');
          var chId = chip.getAttribute('data-channel');
          var ph = chip.getAttribute('data-ph');
          formData.social_channel = chId;
          socialInput.placeholder = ph;
          socialLabel.textContent = 'Akun / Link (' + chId + ')';
        };
      });

      host.querySelector('#x-step2-back').onclick = function () { goToStep(1); };

      host.querySelector('#x-step2-next').onclick = function () {
        var socialVal = socialInput.value.trim();
        if (!socialVal) {
          if (UI && UI.toast) UI.toast('Isi nama akun atau link kamu');
          socialInput.focus();
          return;
        }
        formData.social_media = socialVal;
        goToStep(3);
      };
    }

    // ── STEP 3: Rekening Pencairan ──────────────────────────────────
    function renderStep3(host) {
      var popularBanks = ['BCA', 'Mandiri', 'BRI', 'BNI', 'GoPay', 'OVO', 'DANA', 'Lainnya'];
      var bankChipsHtml = popularBanks.map(function (b) {
        var isSel = formData.bank_name === b;
        return '<div class="x-aff-bank-chip ' + (isSel ? 'selected' : '') + '" data-bank="' + b + '">' + b + '</div>';
      }).join('');

      host.innerHTML =
        '<div class="x-aff-step-container">' +
        '  <div class="x-aff-card">' +
        '    <div class="x-aff-step-badge">3 dari 4 • Rekening</div>' +
        '    <h2 class="x-aff-step-title">Rekening Pencairan</h2>' +
        '    <p class="x-aff-step-desc">Tujuan transfer saat komisi ditarik:</p>' +
        '    <div class="x-aff-bank-chips" id="x-bank-chips">' + bankChipsHtml + '</div>' +
        '    <div class="x-aff-field-group">' +
        '      <label class="x-aff-label"><span>Bank / E-Wallet</span><span style="color:#ef4444;">*</span></label>' +
        '      <input type="text" id="x-step-bank-name" class="x-aff-input" placeholder="Contoh: BCA / GoPay" value="' + UI.escape(formData.bank_name) + '">' +
        '    </div>' +
        '    <div class="x-aff-field-group">' +
        '      <label class="x-aff-label"><span>Nomor Rekening / No. HP</span><span style="color:#ef4444;">*</span></label>' +
        '      <input type="tel" id="x-step-bank-acc" class="x-aff-input" placeholder="Nomor rekening atau HP e-wallet" value="' + UI.escape(formData.bank_account_number) + '">' +
        '    </div>' +
        '    <div class="x-aff-field-group">' +
        '      <label class="x-aff-label"><span>Nama Pemilik Rekening</span><span style="color:#ef4444;">*</span></label>' +
        '      <input type="text" id="x-step-bank-holder" class="x-aff-input" placeholder="Nama pemilik rekening" value="' + UI.escape(formData.bank_account_holder) + '">' +
        '    </div>' +
        '    <button type="button" class="x-aff-btn-primary" id="x-step3-next" style="margin-top:20px;">Lanjut &rarr;</button>' +
        '    <button type="button" class="x-aff-btn-secondary" id="x-step3-back">&larr; Kembali</button>' +
        '  </div>' +
        '</div>';

      var bankNameInput = host.querySelector('#x-step-bank-name');
      var bankChips = host.querySelectorAll('.x-aff-bank-chip');

      bankChips.forEach(function (chip) {
        chip.onclick = function () {
          bankChips.forEach(function (c) { c.classList.remove('selected'); });
          chip.classList.add('selected');
          var bName = chip.getAttribute('data-bank');
          if (bName === 'Lainnya') {
            bankNameInput.value = '';
            bankNameInput.placeholder = 'Ketik nama bank (contoh: CIMB, Jago, SeaBank)';
            bankNameInput.focus();
          } else {
            bankNameInput.value = bName;
            formData.bank_name = bName;
          }
        };
      });

      host.querySelector('#x-step3-back').onclick = function () { goToStep(2); };

      host.querySelector('#x-step3-next').onclick = function () {
        var bName = bankNameInput.value.trim();
        var bAcc = host.querySelector('#x-step-bank-acc').value.trim();
        var bHolder = host.querySelector('#x-step-bank-holder').value.trim();

        if (!bName) {
          if (UI && UI.toast) UI.toast('Pilih atau ketik bank / e-wallet');
          bankNameInput.focus();
          return;
        }
        if (!bAcc || bAcc.length < 5) {
          if (UI && UI.toast) UI.toast('Nomor rekening belum valid');
          host.querySelector('#x-step-bank-acc').focus();
          return;
        }
        if (!bHolder) {
          if (UI && UI.toast) UI.toast('Nama pemilik rekening belum diisi');
          host.querySelector('#x-step-bank-holder').focus();
          return;
        }

        formData.bank_name = bName;
        formData.bank_account_number = bAcc;
        formData.bank_account_holder = bHolder;
        goToStep(4);
      };
    }

    // ── STEP 4: Review & Submit ─────────────────────────────────────
    function renderStep4(host) {
      host.innerHTML =
        '<div class="x-aff-step-container">' +
        '  <div class="x-aff-card">' +
        '    <div class="x-aff-step-badge">4 dari 4 • Cek Data</div>' +
        '    <h2 class="x-aff-step-title">Cek Sekali Lagi</h2>' +
        '    <p class="x-aff-step-desc">Pastikan nomor rekening dan data sudah sesuai:</p>' +
        '    <div class="x-aff-summary-card">' +
        '      <div class="x-aff-summary-row">' +
        '        <span class="x-aff-summary-label">Nama</span>' +
        '        <span class="x-aff-summary-val">' + UI.escape(formData.full_name) + '</span>' +
        '      </div>' +
        '      <div class="x-aff-summary-row">' +
        '        <span class="x-aff-summary-label">WhatsApp</span>' +
        '        <span class="x-aff-summary-val">' + UI.escape(formData.phone) + '</span>' +
        '      </div>' +
        '      <div class="x-aff-summary-row">' +
        '        <span class="x-aff-summary-label">Media</span>' +
        '        <span class="x-aff-summary-val">' + UI.escape(formData.social_channel) + ' (' + UI.escape(formData.social_media) + ')</span>' +
        '      </div>' +
        '      <div class="x-aff-summary-row">' +
        '        <span class="x-aff-summary-label">Rekening</span>' +
        '        <span class="x-aff-summary-val">' + UI.escape(formData.bank_name) + ' - ' + UI.escape(formData.bank_account_number) + '<br><small style="color:#64748b;font-weight:400;">a.n. ' + UI.escape(formData.bank_account_holder) + '</small></span>' +
        '      </div>' +
        '      <div class="x-aff-summary-row">' +
        '        <span class="x-aff-summary-label">Komisi</span>' +
        '        <span class="x-aff-summary-val" style="color:#10b981;">' + rateDisplay + '</span>' +
        '      </div>' +
        '    </div>' +
        '    <div class="x-aff-field-group">' +
        '      <label class="x-aff-label"><span>Pesan Tambahan (Opsional)</span></label>' +
        '      <textarea id="x-step-notes" class="x-aff-input" placeholder="Tulis catatan jika ada..." style="resize:vertical;min-height:56px;">' + UI.escape(formData.notes) + '</textarea>' +
        '    </div>' +
        '    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;font-size:12px;color:#475569;line-height:1.45;margin-bottom:18px;">' +
        '      ⏱️ Pendaftaran dicek tim kami dalam 1×24 jam. Link referral langsung aktif begitu disetujui.' +
        '    </div>' +
        '    <button type="button" class="x-aff-btn-primary" id="x-step4-submit">Kirim Pendaftaran 🚀</button>' +
        '    <button type="button" class="x-aff-btn-secondary" id="x-step4-back">&larr; Ubah Data</button>' +
        '  </div>' +
        '</div>';

      host.querySelector('#x-step4-back').onclick = function () { goToStep(1); };

      var submitBtn = host.querySelector('#x-step4-submit');
      submitBtn.onclick = function () {
        var notesVal = (host.querySelector('#x-step-notes') ? host.querySelector('#x-step-notes').value : '').trim();
        formData.notes = notesVal;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="x-loc-spinner" style="margin-right:8px;"></span> Mengirim…';

        API.post('/customer/affiliate/apply', {
          full_name: formData.full_name,
          phone: formData.phone,
          social_media: formData.social_channel + ': ' + formData.social_media,
          bank_name: formData.bank_name,
          bank_account_number: formData.bank_account_number,
          bank_account_holder: formData.bank_account_holder,
          notes: formData.notes
        })
        .then(function (res) {
          if (UI && UI.toast) UI.toast('Pendaftaran terkirim! 🎉');
          var custId = (session && (session.customer_id || session.id || session.email)) || 'me';
          try {
            sessionStorage.setItem('xnt_aff_status_' + custId, 'PENDING');
            localStorage.setItem('xnt_aff_status_' + custId, 'PENDING');
          } catch (_) {}
          container.setAttribute('data-mounted-session', session ? session.token : '');
          container.setAttribute('data-mounted-view', 'affiliate-pending');
          renderAffiliatePendingView(container, (res && res.profile) || {}, program, session);
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Kirim Pendaftaran 🚀';
          var errMsg = (err && err.data && (err.data.error || err.data.message)) ||
                       (err && err.message) ||
                       'Gagal mengirim pendaftaran.';
          if (UI && UI.toast) UI.toast(errMsg);
        });
      };
    }

    renderShell();
    if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
  }

  function renderAffiliatePendingView(container, profile, program, session) {
    profile = profile || {};
    var dateStr = profile.created_at ? new Date(profile.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

    container.innerHTML =
      '<div class="x-aux-page">' +
      '  <div class="x-aux-header">' +
      '    <button type="button" class="x-aux-back-btn" id="x-affiliate-back" aria-label="Kembali">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
      '    </button>' +
      '    <h1 class="x-aux-title">Status Pendaftaran</h1>' +
      '  </div>' +
      '  <div class="x-aux-body">' +
      '    <div class="x-aff-wizard">' +
      '      <div class="x-aff-card" style="text-align:center;padding:32px 20px;">' +
      '        <div style="font-size:44px;line-height:1;margin-bottom:12px;">⏳</div>' +
      '        <div style="display:inline-block;background:#fef3c7;color:#b45309;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:12px;">Sedang Ditinjau</div>' +
      '        <h2 style="font-size:19px;font-weight:800;color:#0f172a;margin:0 0 6px;">Pendaftaran Sedang Dicek</h2>' +
      '        <p style="font-size:13px;color:#64748b;line-height:1.55;margin:0 auto 18px;max-width:320px;">' +
      '          Tim kami akan memeriksa data pendaftaranmu dalam 1×24 jam. Link referral akan otomatis aktif begitu disetujui.' +
      '        </p>' +
      '        <div class="x-aff-summary-card" style="text-align:left;">' +
      '          <div class="x-aff-summary-row"><span class="x-aff-summary-label">Media</span><span class="x-aff-summary-val">' + UI.escape(profile.social_media || '-') + '</span></div>' +
      '          <div class="x-aff-summary-row"><span class="x-aff-summary-label">Rekening</span><span class="x-aff-summary-val">' + UI.escape(profile.bank_name || '-') + ' - ' + UI.escape(profile.bank_account_number || '-') + '<br><small style="color:#64748b;font-weight:400;">a.n. ' + UI.escape(profile.bank_account_holder || '-') + '</small></span></div>' +
      '          <div class="x-aff-summary-row"><span class="x-aff-summary-label">Diajukan</span><span class="x-aff-summary-val">' + UI.escape(dateStr) + '</span></div>' +
      '        </div>' +
      '        <button type="button" class="x-aff-btn-secondary" id="x-aff-edit-apply-btn" style="color:#0284c7;font-weight:700;font-size:13px;">✏️ Ubah Data Pendaftaran</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    var backBtn = container.querySelector('#x-affiliate-back');
    if (backBtn) backBtn.onclick = function () { Router.navigate('home'); };

    var editBtn = container.querySelector('#x-aff-edit-apply-btn');
    if (editBtn) {
      editBtn.onclick = function () {
        container.setAttribute('data-mounted-view', 'affiliate-form');
        renderAffiliateApplyForm(container, program, session, profile);
      };
    }
    if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
  }

  function renderAffiliateRejectedView(container, profile, program, session) {
    profile = profile || {};
    var reason = profile.rejection_reason || 'Data pendaftaran belum sesuai kriteria.';

    container.innerHTML =
      '<div class="x-aux-page">' +
      '  <div class="x-aux-header">' +
      '    <button type="button" class="x-aux-back-btn" id="x-affiliate-back" aria-label="Kembali">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
      '    </button>' +
      '    <h1 class="x-aux-title">Status Pendaftaran</h1>' +
      '  </div>' +
      '  <div class="x-aux-body">' +
      '    <div class="x-aff-wizard">' +
      '      <div class="x-aff-card" style="text-align:center;padding:32px 20px;">' +
      '        <div style="font-size:44px;line-height:1;margin-bottom:12px;">❌</div>' +
      '        <div style="display:inline-block;background:#fee2e2;color:#b91c1c;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:12px;">Belum Disetujui</div>' +
      '        <h2 style="font-size:19px;font-weight:800;color:#0f172a;margin:0 0 6px;">Pendaftaran Belum Diterima</h2>' +
      '        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 14px;color:#991b1b;font-size:12.5px;line-height:1.45;margin:12px auto 16px;max-width:320px;text-align:left;">' +
      '          <b>Alasan:</b> ' + UI.escape(reason) +
      '        </div>' +
      '        <button type="button" class="x-aff-btn-primary" id="x-aff-reapply-btn" style="max-width:240px;margin:0 auto;">Ajukan Ulang Data 📝</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    var backBtn = container.querySelector('#x-affiliate-back');
    if (backBtn) backBtn.onclick = function () { Router.navigate('home'); };

    var reapplyBtn = container.querySelector('#x-aff-reapply-btn');
    if (reapplyBtn) {
      reapplyBtn.onclick = function () {
        container.setAttribute('data-mounted-view', 'affiliate-form');
        renderAffiliateApplyForm(container, program, session, profile);
      };
    }
    if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
  }

  function renderAffiliateGuestView(container) {
    container.innerHTML =
      '<div class="x-aux-page">' +
      '  <div class="x-aux-header">' +
      '    <button type="button" class="x-aux-back-btn" id="x-affiliate-back" aria-label="Kembali">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
      '    </button>' +
      '    <h1 class="x-aux-title">Daftar Affiliate</h1>' +
      '  </div>' +
      '  <div class="x-aux-body">' +
      '    <div class="x-aff-wizard">' +
      '      <!-- Hero Card -->' +
      '      <div class="x-aux-hero-card" style="background: linear-gradient(135deg, #064e3b 0%, #065f46 100%); margin-bottom:18px;">' +
      '        <div class="x-aux-badge" style="background:#10b981;color:#fff;">🍗 Bagi Info, Dapat Cuan</div>' +
      '        <h2 style="font-size:21px;font-weight:900;color:#fff;margin:10px 0 6px;letter-spacing:-0.02em;">Ajak Teman Makan, Dapat Komisi</h2>' +
      '        <p style="font-size:13px;color:#a7f3d0;line-height:1.55;margin:0 0 16px;">Suka menu Bangjo? Cukup bagikan link rekomendasi ke teman atau grup WA. Dapatkan komisi Rp1.000 tunai untuk tiap menu yang terjual dari link kamu.</p>' +
      '        <div class="x-aux-stats-grid">' +
      '          <div class="x-aux-stat-box"><span class="num" style="color:#fde047;">Rp1.000</span><span class="lbl">Tiap Menu Terjual</span></div>' +
      '          <div class="x-aux-stat-box"><span class="num" style="color:#a7f3d0;">Tanpa Modal</span><span class="lbl">Tinggal Share</span></div>' +
      '          <div class="x-aux-stat-box"><span class="num" style="color:#fff;">BCA / E-Wallet</span><span class="lbl">Tarik Kapan Saja</span></div>' +
      '        </div>' +
      '      </div>' +
      '      <!-- 3 Langkah Sederhana -->' +
      '      <div class="x-aff-card" style="margin-bottom:18px;">' +
      '        <h3 style="font-size:14.5px;font-weight:800;color:#0f172a;margin:0 0 14px;">Cara Kerjanya:</h3>' +
      '        <div style="display:flex;flex-direction:column;gap:12px;">' +
      '          <div style="display:flex;gap:12px;align-items:flex-start;">' +
      '            <div style="width:32px;height:32px;border-radius:10px;background:#ecfdf5;color:#059669;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex-shrink:0;">1</div>' +
      '            <div><div style="font-size:13.5px;font-weight:700;color:#0f172a;">Masuk dengan Google</div><div style="font-size:12px;color:#64748b;margin-top:2px;">Langsung aktif instan tanpa perlu isi formulir pendaftaran.</div></div>' +
      '          </div>' +
      '          <div style="display:flex;gap:12px;align-items:flex-start;">' +
      '            <div style="width:32px;height:32px;border-radius:10px;background:#eff6ff;color:#2563eb;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex-shrink:0;">2</div>' +
      '            <div><div style="font-size:13.5px;font-weight:700;color:#0f172a;">Bagikan Link ke WhatsApp</div><div style="font-size:12px;color:#64748b;margin-top:2px;">Dapatkan link rekomendasi instan dan kirim ke teman kantor, grup WA, atau keluarga.</div></div>' +
      '          </div>' +
      '          <div style="display:flex;gap:12px;align-items:flex-start;">' +
      '            <div style="width:32px;height:32px;border-radius:10px;background:#fef3c7;color:#d97706;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex-shrink:0;">3</div>' +
      '            <div><div style="font-size:13.5px;font-weight:700;color:#0f172a;">Terima Komisi Tunai</div><div style="font-size:12px;color:#64748b;margin-top:2px;">Dapatkan Rp1.000 per menu yang dipesan teman, langsung masuk saldo dan bisa ditarik.</div></div>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <button type="button" class="x-aff-btn-primary" id="x-affiliate-login-cta" style="padding:15px;">Masuk dengan Google ✨</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    var backBtn = container.querySelector('#x-affiliate-back');
    if (backBtn) backBtn.onclick = function () { Router.navigate('home'); };

    var loginCta = container.querySelector('#x-affiliate-login-cta');
    if (loginCta) {
      loginCta.onclick = function () {
        loginCta.disabled = true;
        var prevText = loginCta.textContent;
        loginCta.textContent = 'Membuka Google Sign-In…';
        startCustomerAuth('#affiliate', function () {
          mountAffiliate(container, true);
        }, loginCta, prevText);
      };
    }
    if (typeof window.__xentraHideSplash === 'function') window.__xentraHideSplash();
  }

  function renderAffiliateDashboard(container) {
    container.innerHTML =
      '<div class="x-aux-page">' +
      '  <div class="x-aux-header">' +
      '    <button type="button" class="x-aux-back-btn" id="x-affiliate-back" aria-label="Kembali">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
      '    </button>' +
      '    <h1 class="x-aux-title">Daftar Affiliate</h1>' +
      '  </div>' +
      '  <div class="x-aux-body" id="x-aff-dash-wrap">' +
      '    <div style="padding:48px 20px;text-align:center;color:#64748b;font-size:13.5px;"><span class="x-loc-spinner"></span> Memuat data affiliate…</div>' +
      '  </div>' +
      '</div>';

    var backBtn = container.querySelector('#x-affiliate-back');
    if (backBtn) backBtn.onclick = function () { Router.navigate('home'); };

    var dashWrap = container.querySelector('#x-aff-dash-wrap');

    API.get('/customer/affiliate/stats')
      .then(function (res) {
        if (!dashWrap) return;
        var data = (res && res.stats) || {};
        var profile = data.profile || {};
        var program = data.program || {};
        var conversions = data.conversions || [];
        var payouts = data.payouts || [];

        var code = profile.referral_code || '';
        var shareUrl = window.location.origin + '/?ref=' + encodeURIComponent(code);
        var waShareText = 'Yuk cobain pesan menu favorit di Bangjo lewat link rekomendasi aku ini: ' + shareUrl;

        var payable = Number(profile.balance_payable || 0);
        var pending = Number(profile.balance_pending || 0);
        var totalEarned = Number(profile.total_earnings || 0);
        var minPayout = Number(program.min_payout_amount || 50000);
        var canWithdraw = payable >= minPayout && profile.bank_account_number;

        var bankHtml = '';
        if (profile.bank_name && profile.bank_account_number) {
          bankHtml =
            '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin-top:10px;">' +
            '  <div style="display:flex;justify-content:space-between;align-items:center;">' +
            '    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Rekening Pencairan</div>' +
            '    <button type="button" id="x-aff-edit-bank-btn" style="background:none;border:none;color:#0284c7;font-size:12px;font-weight:700;cursor:pointer;">Ubah Rekening</button>' +
            '  </div>' +
            '  <div style="font-size:14px;font-weight:800;color:#0f172a;margin-top:4px;">' + UI.escape(profile.bank_name) + ' - ' + UI.escape(profile.bank_account_number) + '</div>' +
            '  <div style="font-size:12px;color:#475569;">a.n. ' + UI.escape(profile.bank_account_holder) + '</div>' +
            '</div>';
        } else {
          bankHtml =
            '<div style="background:#fffbeb;border:1px dashed #f59e0b;border-radius:12px;padding:12px 14px;margin-top:10px;text-align:center;">' +
            '  <div style="font-size:12.5px;font-weight:700;color:#b45309;margin-bottom:4px;">Belum Mengatur Rekening Pencairan</div>' +
            '  <div style="font-size:11.5px;color:#78350f;margin-bottom:8px;">Tambahkan nomor rekening Bank atau E-Wallet untuk mencairkan komisi tunai Anda.</div>' +
            '  <button type="button" id="x-aff-setup-bank-btn" style="background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;">+ Atur Rekening Sekarang</button>' +
            '</div>';
        }

        // Payout history list
        var payoutRowsHtml = '';
        if (payouts.length === 0) {
          payoutRowsHtml = '<div style="padding:14px;text-align:center;font-size:12px;color:#94a3b8;">Belum ada riwayat penarikan dana.</div>';
        } else {
          payouts.forEach(function (p) {
            var stBadge = p.status === 'PAID'
              ? '<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Ditransfer</span>'
              : (p.status === 'REJECTED'
                ? '<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Ditolak</span>'
                : '<span style="background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">Menunggu Transfer</span>');

            var dateStr = p.created_at ? new Date(p.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

            payoutRowsHtml +=
              '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9;">' +
              '  <div>' +
              '    <div style="font-size:13px;font-weight:700;color:#0f172a;">' + UI.money(p.amount) + '</div>' +
              '    <div style="font-size:11px;color:#64748b;">' + dateStr + (p.bank_name ? ' · ' + p.bank_name : '') + '</div>' +
              '  </div>' +
              '  <div style="text-align:right;">' + stBadge + '</div>' +
              '</div>';
          });
        }

        var isFixedPerItem = (program.commission_type === 'FIXED_PER_ITEM');
        var rateValueText = isFixedPerItem
          ? UI.money(program.commission_per_item || program.commission_rate || 1000)
          : ((program.commission_rate || 5) + '%');
        var rateLabelText = isFixedPerItem ? 'Per Menu Terjual' : 'Rate Komisi';
        var commissionExplain = isFixedPerItem
          ? 'komisi <strong>' + rateValueText + '</strong> tiap menu yang terjual'
          : '<strong>komisi ' + (program.commission_rate || 5) + '%</strong>';

        dashWrap.innerHTML =
          // Hero & Balance Grid
          '<div class="x-aux-hero-card" style="background:linear-gradient(135deg, #064e3b 0%, #065f46 100%);">' +
          '  <div class="x-aux-badge" style="background:#10b981;color:#fff;">Mitra Affiliate Aktif</div>' +
          '  <div style="margin:12px 0 4px;font-size:12px;color:#a7f3d0;text-transform:uppercase;letter-spacing:0.5px;">Saldo Komisi Siap Cair</div>' +
          '  <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px;">' + UI.money(payable) + '</div>' +
          '  <div class="x-aux-stats-grid" style="margin-top:14px;">' +
          '    <div class="x-aux-stat-box"><span class="num" style="color:#fde047;">' + UI.money(pending) + '</span><span class="lbl">Saldo Tertunda</span></div>' +
          '    <div class="x-aux-stat-box"><span class="num" style="color:#a7f3d0;">' + UI.money(totalEarned) + '</span><span class="lbl">Total Komisi</span></div>' +
          '    <div class="x-aux-stat-box"><span class="num" style="color:#fff;">' + rateValueText + '</span><span class="lbl">' + rateLabelText + '</span></div>' +
          '  </div>' +
          '</div>' +

          // Link & Kode Referral Card
          '<div class="x-aux-card" style="margin-top:16px;">' +
          '  <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Link Rekomendasi Anda</div>' +
          '  <div style="display:flex;gap:8px;align-items:center;">' +
          '    <input type="text" readonly value="' + UI.escape(shareUrl) + '" style="flex:1;background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;font-size:12px;font-weight:600;color:#334155;outline:none;" id="x-aff-share-url-input">' +
          '    <button type="button" id="x-aff-copy-link-btn" style="background:#0f172a;color:#fff;border:none;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">Salin</button>' +
          '  </div>' +
          '  <div style="display:flex;gap:8px;margin-top:10px;">' +
          '    <button type="button" id="x-aff-wa-share-btn" style="flex:1;background:#22c55e;color:#fff;border:none;border-radius:10px;padding:11px;font-size:12.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">' +
          '      <span>💬</span> Bagikan ke WhatsApp' +
          '    </button>' +
          '  </div>' +
          '  <div style="margin-top:10px;font-size:11.5px;color:#64748b;display:flex;justify-content:space-between;align-items:center;">' +
          '    <span>Kode Referral: <strong style="color:#0f172a;">' + UI.escape(code) + '</strong></span>' +
          '    <button type="button" id="x-aff-copy-code-btn" style="background:none;border:none;color:#0284c7;font-size:11.5px;font-weight:700;cursor:pointer;padding:0;">Salin Kode</button>' +
          '  </div>' +
          '</div>' +

          // Cara Dapat Komisi
          '<div class="x-aux-card" style="margin-top:16px;">' +
          '  <h3 style="font-size:13.5px;font-weight:700;color:#0f172a;margin:0 0 10px;">💡 Cara Dapat Komisi:</h3>' +
          '  <div style="font-size:12px;color:#475569;line-height:1.6;display:flex;flex-direction:column;gap:6px;">' +
          '    <div>1. Klik <strong>Bagikan ke WhatsApp</strong> atau salin link rekomendasi di atas.</div>' +
          '    <div>2. Kirim ke teman, keluarga, atau grup WA saat jam makan siang/malam.</div>' +
          '    <div>3. Tiap teman klik dan pesan menu, kamu langsung dapat ' + commissionExplain + ' tunai!</div>' +
          '  </div>' +
          '</div>' +

          // Bank Account Section
          '<div class="x-aux-card" style="margin-top:16px;">' +
          '  <h3 style="font-size:14px;font-weight:700;color:#0f172a;margin:0 0 4px;">Pencairan Komisi</h3>' +
          '  <div style="font-size:12px;color:#64748b;">Komisi dapat ditarik langsung ke rekening bank atau e-wallet Anda. Minimal penarikan: ' + UI.money(minPayout) + '</div>' +
          bankHtml +
          '  <button type="button" id="x-aff-withdraw-btn" class="x-aux-action-btn" style="margin-top:14px;background:' + (canWithdraw ? '#16a34a' : '#cbd5e1') + ';color:' + (canWithdraw ? '#fff' : '#64748b') + ';cursor:' + (canWithdraw ? 'pointer' : 'not-allowed') + ';" ' + (canWithdraw ? '' : 'disabled') + '>' +
          (payable < minPayout
            ? 'Saldo Belum Mencukupi Min. ' + UI.money(minPayout)
            : (!profile.bank_account_number ? 'Atur Rekening Dahulu' : 'Tarik Saldo ' + UI.money(payable))) +
          '  </button>' +
          '</div>' +

          // Payout History
          '<div class="x-aux-card" style="margin-top:16px;margin-bottom:32px;">' +
          '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '    <h3 style="font-size:14px;font-weight:700;color:#0f172a;margin:0;">Riwayat Penarikan Dana</h3>' +
          '    <span style="font-size:11px;color:#94a3b8;">' + payouts.length + ' transaksi</span>' +
          '  </div>' +
          payoutRowsHtml +
          '</div>';

        // Attach Event Listeners
        var copyLinkBtn = dashWrap.querySelector('#x-aff-copy-link-btn');
        if (copyLinkBtn) {
          copyLinkBtn.onclick = function () {
            if (navigator.clipboard) {
              navigator.clipboard.writeText(shareUrl).then(function () {
                if (UI && UI.toast) UI.toast('Link affiliate berhasil disalin!');
              });
            }
          };
        }

        var copyCodeBtn = dashWrap.querySelector('#x-aff-copy-code-btn');
        if (copyCodeBtn) {
          copyCodeBtn.onclick = function () {
            if (navigator.clipboard) {
              navigator.clipboard.writeText(code).then(function () {
                if (UI && UI.toast) UI.toast('Kode referral disalin: ' + code);
              });
            }
          };
        }

        var waBtn = dashWrap.querySelector('#x-aff-wa-share-btn');
        if (waBtn) {
          waBtn.onclick = function () {
            var url = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(waShareText);
            window.open(url, '_blank');
          };
        }

        var setupBankBtn = dashWrap.querySelector('#x-aff-setup-bank-btn');
        var editBankBtn = dashWrap.querySelector('#x-aff-edit-bank-btn');
        var onBankClick = function () {
          openBankModal(profile, function () {
            mountAffiliate(container, true);
          });
        };
        if (setupBankBtn) setupBankBtn.onclick = onBankClick;
        if (editBankBtn) editBankBtn.onclick = onBankClick;

        var withdrawBtn = dashWrap.querySelector('#x-aff-withdraw-btn');
        if (withdrawBtn && canWithdraw) {
          withdrawBtn.onclick = function () {
            openPayoutModal(profile, payable, minPayout, function () {
              mountAffiliate(container, true);
            });
          };
        }
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

    var popularBanks = ['BCA', 'Mandiri', 'BRI', 'BNI', 'GoPay', 'OVO', 'DANA', 'ShopeePay'];
    var chipsHtml = popularBanks.map(function (b) {
      return '<button type="button" class="x-aff-bank-chip-modal" data-bank="' + b + '" style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;color:#334155;cursor:pointer;">' + b + '</button>';
    }).join('');

    var overlay = document.createElement('div');
    overlay.className = 'x-overlay open';
    overlay.style.zIndex = '99999';
    overlay.innerHTML =
      '<div class="x-sheet" style="max-width:440px;margin:auto;border-radius:20px;padding:24px 20px;background:#fff;">' +
      '  <h3 style="font-size:16px;font-weight:800;color:#0f172a;margin:0 0 6px;">Rekening Bank / E-Wallet</h3>' +
      '  <p style="font-size:12.5px;color:#64748b;margin:0 0 16px;">Tujuan transfer saat komisi ditarik:</p>' +
      '  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;" id="x-modal-bank-chips">' + chipsHtml + '</div>' +
      '  <div style="display:flex;flex-direction:column;gap:12px;">' +
      '    <div>' +
      '      <label style="display:block;font-size:11.5px;font-weight:700;color:#334155;margin-bottom:4px;">Nama Bank / E-Wallet</label>' +
      '      <input type="text" id="x-input-bank-name" placeholder="Pilih chip di atas atau ketik di sini" value="' + UI.escape(profile.bank_name || '') + '" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:13px;">' +
      '    </div>' +
      '    <div>' +
      '      <label style="display:block;font-size:11.5px;font-weight:700;color:#334155;margin-bottom:4px;">Nomor Rekening / No. HP E-Wallet</label>' +
      '      <input type="text" id="x-input-bank-acc" placeholder="Contoh: 8830123456" value="' + UI.escape(profile.bank_account_number || '') + '" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:13px;">' +
      '    </div>' +
      '    <div>' +
      '      <label style="display:block;font-size:11.5px;font-weight:700;color:#334155;margin-bottom:4px;">Nama Pemilik Rekening</label>' +
      '      <input type="text" id="x-input-bank-holder" placeholder="Contoh: Budi Santoso" value="' + UI.escape(defaultHolder) + '" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:13px;">' +
      '    </div>' +
      '  </div>' +
      '  <div style="display:flex;gap:10px;margin-top:20px;">' +
      '    <button type="button" id="x-modal-bank-cancel" style="flex:1;background:#f1f5f9;color:#475569;border:none;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;">Batal</button>' +
      '    <button type="button" id="x-modal-bank-save" style="flex:2;background:#16a34a;color:#fff;border:none;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;">Simpan Rekening</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(overlay);

    var bankInput = overlay.querySelector('#x-input-bank-name');
    var accInput = overlay.querySelector('#x-input-bank-acc');
    overlay.querySelectorAll('.x-aff-bank-chip-modal').forEach(function (btn) {
      btn.onclick = function () {
        bankInput.value = btn.getAttribute('data-bank');
        accInput.focus();
      };
    });

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    overlay.querySelector('#x-modal-bank-cancel').onclick = close;

    overlay.querySelector('#x-modal-bank-save').onclick = function () {
      var bName = overlay.querySelector('#x-input-bank-name').value.trim();
      var bAcc = overlay.querySelector('#x-input-bank-acc').value.trim();
      var bHolder = overlay.querySelector('#x-input-bank-holder').value.trim();

      if (!bName || !bAcc || !bHolder) {
        if (UI && UI.toast) UI.toast('Harap lengkapi semua kolom rekening.');
        return;
      }

      API.put('/customer/affiliate/bank-details', {
        bank_name: bName,
        bank_account_number: bAcc,
        bank_account_holder: bHolder
      }).then(function (res) {
        if (res && res.success) {
          if (UI && UI.toast) UI.toast('Rekening pencairan berhasil disimpan.');
          close();
          if (typeof onSaved === 'function') onSaved();
        } else {
          if (UI && UI.toast) UI.toast('Gagal menyimpan: ' + (res.error || 'Error'));
        }
      }).catch(function (err) {
        if (UI && UI.toast) UI.toast('Gagal: ' + (err.message || 'Error'));
      });
    };
  }

  function openPayoutModal(profile, payable, minPayout, onDone) {
    var overlay = document.createElement('div');
    overlay.className = 'x-overlay open';
    overlay.style.zIndex = '99999';
    overlay.innerHTML =
      '<div class="x-sheet" style="max-width:440px;margin:auto;border-radius:20px;padding:24px 20px;background:#fff;">' +
      '  <h3 style="font-size:16px;font-weight:800;color:#0f172a;margin:0 0 6px;">Tarik Saldo Komisi</h3>' +
      '  <p style="font-size:12.5px;color:#64748b;margin:0 0 16px;">Dana akan ditransfer oleh pengelola resto ke rekening terdaftar Anda.</p>' +
      '  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin-bottom:14px;">' +
      '    <div style="font-size:11px;color:#64748b;">Tujuan Transfer:</div>' +
      '    <div style="font-size:13px;font-weight:700;color:#0f172a;">' + UI.escape(profile.bank_name) + ' - ' + UI.escape(profile.bank_account_number) + '</div>' +
      '    <div style="font-size:11.5px;color:#475569;">a.n. ' + UI.escape(profile.bank_account_holder) + '</div>' +
      '  </div>' +
      '  <div style="margin-bottom:14px;">' +
      '    <label style="display:block;font-size:11.5px;font-weight:700;color:#334155;margin-bottom:4px;">Nominal Penarikan (Rp)</label>' +
      '    <input type="number" id="x-input-payout-amt" value="' + payable + '" min="' + minPayout + '" max="' + payable + '" style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;font-weight:800;color:#0f172a;">' +
      '    <div style="font-size:11px;color:#64748b;margin-top:4px;">Maksimal penarikan: ' + UI.money(payable) + '</div>' +
      '  </div>' +
      '  <div style="display:flex;gap:10px;margin-top:20px;">' +
      '    <button type="button" id="x-modal-payout-cancel" style="flex:1;background:#f1f5f9;color:#475569;border:none;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;">Batal</button>' +
      '    <button type="button" id="x-modal-payout-confirm" style="flex:2;background:#16a34a;color:#fff;border:none;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;">Ajukan Pencairan</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(overlay);

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    overlay.querySelector('#x-modal-payout-cancel').onclick = close;

    overlay.querySelector('#x-modal-payout-confirm').onclick = function () {
      var amtInput = overlay.querySelector('#x-input-payout-amt');
      var amt = Number(amtInput.value);

      if (isNaN(amt) || amt < minPayout) {
        if (UI && UI.toast) UI.toast('Minimal penarikan adalah ' + UI.money(minPayout));
        return;
      }
      if (amt > payable) {
        if (UI && UI.toast) UI.toast('Nominal penarikan melebihi saldo yang tersedia.');
        return;
      }

      API.post('/customer/affiliate/payout', { amount: amt })
        .then(function (res) {
          if (res && res.success) {
            if (UI && UI.toast) UI.toast('Permintaan pencairan sebesar ' + UI.money(amt) + ' berhasil diajukan!');
            close();
            if (typeof onDone === 'function') onDone();
          } else {
            if (UI && UI.toast) UI.toast('Gagal mengajukan: ' + (res.error || 'Error'));
          }
        })
        .catch(function (err) {
          if (UI && UI.toast) UI.toast('Gagal: ' + (err.message || 'Error'));
        });
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
            if (UI && UI.toast) UI.toast('Ditambahkan ke keranjang');
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
