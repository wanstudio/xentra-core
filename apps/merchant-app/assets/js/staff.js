/**
 * XENTRA CORE — MERCHANT APP STAFF
 *
 * Branch Manager branch-scoped staff management.
 */
(function () {
  'use strict';

  var S = window.XentraShared;
  var API_BASE = S.API_BASE;
  var $ = S.$;
  var esc = S.esc;
  var showToast = S.showToast;
  var adminFetch = S.adminFetch;
  var getAuthHeaders = S.getAuthHeaders;
  var getStoredUser = S.getStoredUser;

  /* =========================================================================
     BM-4: STAF OPERASIONAL CABANG (BRANCH-SCOPED WORKFORCE)
     ========================================================================= */
  var _bmStaffState = {
    users: [],
    fetchSeq: 0
  };

  async function loadBMStaff() {
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) return;

    var tbody = $('bm-staff-tbody');
    if (tbody && (!_bmStaffState.users || !_bmStaffState.users.length)) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Memuat daftar staf cabang...</td></tr>';
    }

    var currentSeq = ++_bmStaffState.fetchSeq;

    try {
      var res = await adminFetch(API_BASE + '/admin/users?limit=100&branch_id=' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();

      if (currentSeq !== _bmStaffState.fetchSeq) return;

      if (res.ok && data.success && Array.isArray(data.users)) {
        _bmStaffState.users = data.users;
        renderBMStaffTable(data.users);
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Gagal memuat staf cabang: ' + esc(data.error || 'Terjadi kesalahan') + '</td></tr>';
        }
      }
    } catch (err) {
      if (currentSeq !== _bmStaffState.fetchSeq) return;
      console.warn('[BM Staff Load Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat staf.</td></tr>';
      }
    }
  }
  window.loadBMStaff = loadBMStaff;

  function renderBMStaffTable(users) {
    var tbody = $('bm-staff-tbody');
    if (!tbody) return;

    var totalCount = (users || []).length;
    var activeCount = (users || []).filter(function (u) { return u.status === 'active'; }).length;
    var inactiveCount = totalCount - activeCount;

    if ($('bm-staff-stat-total')) $('bm-staff-stat-total').textContent = totalCount;
    if ($('bm-staff-stat-active')) $('bm-staff-stat-active').textContent = activeCount;
    if ($('bm-staff-stat-inactive')) $('bm-staff-stat-inactive').textContent = inactiveCount;

    if (!users || !users.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada staf kasir atau operasional terdaftar di cabang ini.</td></tr>';
      return;
    }

    var myId = (getStoredUser() || {}).id;

    tbody.innerHTML = users.map(function (u) {
      var isMe = u.id === myId;
      var isActive = u.status === 'active';
      var roleBadge = u.role === 'cashier'
        ? '<span class="x-badge x-badge-warning">KASIR</span>'
        : (u.role === 'kitchen' ? '<span class="x-badge" style="background:#ede9fe;color:#6d28d9;">DAPUR</span>' : '<span class="x-badge x-badge-info">' + esc(u.role).toUpperCase() + '</span>');

      var statusToggle = '' +
        '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" style="margin:0 auto;display:inline-block;vertical-align:middle;">' +
          '<input type="checkbox" ' + (isActive ? 'checked ' : '') + (isMe ? 'disabled ' : '') +
            'onchange="toggleBMStaffStatus(\'' + u.id + '\', \'' + esc(u.full_name) + '\', this)">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      var actions = '';
      if (isMe) {
        actions = '<span class="text-muted" style="font-size:11px;">Akun Anda</span>';
      } else {
        actions = '<div style="display:flex; justify-content:flex-end; gap:6px;">' +
          '<button type="button" class="x-btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="resetBMStaffPassword(\'' + u.id + '\', \'' + esc(u.full_name) + '\')">Reset Password</button>' +
        '</div>';
      }

      return '<tr>' +
        '<td><strong>' + esc(u.full_name) + '</strong></td>' +
        '<td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">' + esc(u.username) + '</code></td>' +
        '<td>' + roleBadge + '</td>' +
        '<td style="color:var(--text-muted);">' + esc(u.email || '—') + '</td>' +
        '<td class="text-center" style="vertical-align:middle;text-align:center;">' + statusToggle + '</td>' +
        '<td class="text-right" style="white-space:nowrap;vertical-align:middle;">' + actions + '</td>' +
      '</tr>';
    }).join('');
  }

  function openBMAddCashierModal() {
    var modal = $('modal-bm-add-cashier');
    if (modal) {
      var form = $('form-bm-add-cashier');
      if (form) form.reset();
      modal.style.display = 'flex';
    }
  }
  window.openBMAddCashierModal = openBMAddCashierModal;

  function closeBMAddCashierModal() {
    var modal = $('modal-bm-add-cashier');
    if (modal) modal.style.display = 'none';
  }
  window.closeBMAddCashierModal = closeBMAddCashierModal;

  async function submitBMAddCashier(e) {
    if (e && e.preventDefault) e.preventDefault();
    var user = getStoredUser();
    var branchId = user ? (user.branch_id || user.branchId) : null;
    if (!branchId) {
      showToast('Gagal: Sesi branch manager tidak valid.');
      return;
    }

    var fullName = ($('bm-cashier-fullname') ? $('bm-cashier-fullname').value : '').trim();
    var username = ($('bm-cashier-username') ? $('bm-cashier-username').value : '').trim();
    var password = ($('bm-cashier-password') ? $('bm-cashier-password').value : '').trim();
    var email = ($('bm-cashier-email') ? $('bm-cashier-email').value : '').trim();

    if (!fullName || !username || !password) {
      showToast('Harap lengkapi semua kolom wajib.');
      return;
    }

    var btn = $('btn-bm-submit-cashier');
    if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

    try {
      var res = await adminFetch(API_BASE + '/admin/users', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          full_name: fullName,
          username: username,
          password: password,
          email: email || undefined,
          role: 'cashier',
          branch_id: branchId
        })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Akun kasir ' + username + ' berhasil ditambahkan.');
        closeBMAddCashierModal();
        loadBMStaff();
      } else {
        showToast('Gagal menambahkan kasir: ' + (data.error || data.message || 'Terjadi kesalahan'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Simpan Akun'; }
    }
  }
  window.submitBMAddCashier = submitBMAddCashier;

  async function toggleBMStaffStatus(userId, name, inputElem) {
    var willActivate = inputElem ? inputElem.checked : false;
    var revert = function () {
      if (inputElem) {
        inputElem.checked = !willActivate;
        inputElem.disabled = false;
        var parentLabel = inputElem.closest('.x-toggle');
        if (parentLabel) {
          parentLabel.classList.toggle('x-toggle-on', !willActivate);
        }
      }
    };

    if (!willActivate) {
      if (!confirm('Nonaktifkan akun kasir "' + name + '"? Kasir ini tidak akan bisa login sampai diaktifkan kembali.')) {
        revert();
        return;
      }
    }

    if (inputElem) inputElem.disabled = true;

    try {
      var endpoint = willActivate ? '/enable' : '/disable';
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + endpoint, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil ' + (willActivate ? 'diaktifkan.' : 'dinonaktifkan.'));
        loadBMStaff();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
        revert();
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
      revert();
    }
  }
  window.toggleBMStaffStatus = toggleBMStaffStatus;

  async function resetBMStaffPassword(userId, name) {
    if (!confirm('Generate token reset password untuk kasir "' + name + '"? Token hanya dapat dilihat sekali.')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/reset-password', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success && data.reset_token) {
        if ($('reset-password-user-name')) $('reset-password-user-name').value = name;
        if ($('reset-password-token')) $('reset-password-token').value = data.reset_token;
        if ($('modal-reset-password')) $('modal-reset-password').style.display = 'flex';
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }
  window.resetBMStaffPassword = resetBMStaffPassword;


})();
