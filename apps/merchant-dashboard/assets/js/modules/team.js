/**
 * XENTRA OWNER DASHBOARD — WORKFORCE & TEAM MODULE
 * Standalone modular controller for Team management, staff accounts, roles, permissions, invitations, and reset password.
 */
(function (window, document) {
  'use strict';

  var S = window.XentraShared || {};
  var $ = S.$ || function (id) { return document.getElementById(id); };
  var esc = S.esc || function (t) { return t || ''; };
  var showToast = S.showToast || function (m) { alert(m); };
  var API_BASE = S.API_BASE || '/api/v1';

  function adminFetch(url, options) {
    if (typeof window.adminFetch === 'function') return window.adminFetch(url, options);
    return fetch(url, options);
  }

  function getAuthHeaders(extraHeaders) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    var token = localStorage.getItem(S.TOKEN_KEY || 'xentra_merchant_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  function navigateTo(route) {
    if (typeof window.navigateTo === 'function') return window.navigateTo(route);
    window.location.hash = '#' + route;
  }

  function getStoredUser() {
    if (window.XentraShared && typeof window.XentraShared.getStoredUser === 'function') {
      return window.XentraShared.getStoredUser();
    }
    return null;
  }

  async function confirmFeatureAction(id, title, message, okLabel) {
    if (window.XentraUI && window.XentraUI.Modal && typeof window.XentraUI.Modal.confirm === 'function') {
      return window.XentraUI.Modal.confirm({ title: title, message: message, confirmText: okLabel });
    }
    if (window.XentraPresentation && typeof window.XentraPresentation.confirm === 'function') {
      return window.XentraPresentation.confirm({ id: id, title: title, message: message, okLabel: okLabel });
    }
    if (typeof window.confirmFeatureAction === 'function') {
      return window.confirmFeatureAction(id, title, message, okLabel);
    }
    return window.confirm(message);
  }

  function openExistingCardInPresentation(modalId, cardId, mode) {
    if (window.openExistingCardInPresentation) {
      return window.openExistingCardInPresentation(modalId, cardId, mode);
    }
    var el = $(modalId);
    if (el) el.style.display = 'block';
  }

  /* =========================================================================
     MODUL: WORKFORCE / TIM MANAGEMENT
     ========================================================================= */
  var _timUsers = [];
  var _timBranches = [];
  var _timRoleFilter = 'all';

  function getTimCurrentUserRole() {
    return (getStoredUser() || {}).role;
  }

  function _canManageTim() {
    return ['owner', 'brand_manager', 'branch_manager'].indexOf(getTimCurrentUserRole()) !== -1;
  }

  function _timRoleLabel(role) {
    var labels = { owner: 'Owner', brand_manager: 'Brand Manager', branch_manager: 'Branch Manager', cashier: 'Kasir', kitchen: 'Dapur', driver: 'Driver', purchasing: 'Petugas Belanja' };
    return labels[role] || role;
  }

  function _timRoleBadgeClass(role) {
    if (role === 'owner') return 'x-badge-info';
    if (role === 'brand_manager') return 'x-badge-success';
    if (role === 'branch_manager') return 'x-badge-warning';
    if (role === 'driver') return 'x-badge-primary';
    if (role === 'purchasing') return 'x-badge-success';
    return 'x-badge-muted';
  }

  function _timStatusBadge(status) {
    return '';
  }

  function _timBranchName(branchId) {
    if (!branchId) return '<span class="text-muted">—</span>';
    var b = _timBranches.find(function (x) { return x.id === branchId; });
    return b ? esc(b.name) : esc(branchId);
  }

  async function loadTim() {
    if (!_canManageTim()) return;
    try {
      var url = API_BASE + '/admin/users?limit=200';
      if (window._branchContextState && window._branchContextState.selected && window._branchContextState.selected !== 'all') {
        url += '&branch_id=' + encodeURIComponent(window._branchContextState.selected);
      }
      var res = await adminFetch(url, { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success) {
        _timUsers = data.users || [];
        renderTimTable();
      }
    } catch (e) {
      console.warn('[Tim Load Error]:', e);
    }
    // Also load branches for branch name display
    try {
      var bRes = await adminFetch(API_BASE + '/admin/branches', { headers: getAuthHeaders() });
      var bData = await bRes.json();
      if (bData.success) _timBranches = bData.branches || [];
    } catch (e) { /* ignore */ }
  }

  function renderTimTable() {
    var filtered = _timUsers;
    if (_timRoleFilter !== 'all') {
      filtered = _timUsers.filter(function (u) { return u.role === _timRoleFilter; });
    }

    var tbody = $('tim-table-body');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Tidak ada anggota tim ditemukan.</td></tr>';
      return;
    }

    var myId = (getStoredUser() || {}).id;
    var rows = filtered.map(function (u) {
      var isMe = u.id === myId;
      var isTargetOwner = u.role === 'owner';
      var isLastOwner = isTargetOwner && _timUsers.filter(function (x) { return x.role === 'owner'; }).length <= 1;
      var isActive = u.status === 'active';

      var isToggleDisabled = isMe || isLastOwner;
      var toggleTitle = '';
      if (isMe) {
        toggleTitle = 'Akun Anda (tidak dapat dinonaktifkan)';
      } else if (isLastOwner) {
        toggleTitle = 'Owner Utama (tidak dapat dinonaktifkan)';
      } else {
        toggleTitle = isActive ? 'Akun Aktif (klik untuk nonaktifkan)' : 'Akun Nonaktif (klik untuk aktifkan)';
      }

      var statusToggle = '' +
        '<label class="x-toggle' + (isActive ? ' x-toggle-on' : '') + '" title="' + toggleTitle + '" style="margin:0 auto;display:inline-block;vertical-align:middle;">' +
          '<input type="checkbox" id="tim-toggle-' + u.id + '" ' + (isActive ? 'checked ' : '') + (isToggleDisabled ? 'disabled ' : '') +
            'onchange="toggleUserStatus(\'' + u.id + '\', \'' + esc(u.full_name) + '\', this)" aria-label="Ubah status akun ' + esc(u.full_name) + '">' +
          '<span class="x-toggle-slider"></span>' +
        '</label>';

      var actions = '';
      if (isMe) {
        actions = '<span class="text-muted" style="font-size:11px;">Akun Anda</span>';
      } else {
        var menuItems = [
          "{ label: 'Edit Data & Peran', icon: '✏️', onClick: function() { openEditUser('" + u.id + "'); } }",
          "{ label: 'Reset Password', icon: '🔑', onClick: function() { resetUserPassword('" + u.id + "', '" + esc(u.full_name) + "'); } }"
        ];

        if (getTimCurrentUserRole() === 'owner' && !isLastOwner) {
          menuItems.push("{ divider: true }");
          menuItems.push("{ label: 'Hapus Anggota', icon: '🗑️', destructive: true, onClick: function() { deleteUser('" + u.id + "', '" + esc(u.full_name) + "'); } }");
        }

        actions = [
          '<div class="x-item-actions" style="justify-content:flex-end;">',
            '<button type="button" class="x-action-menu-trigger" aria-label="Aksi anggota tim ' + esc(u.full_name) + '" onclick="XentraActionMenu.open(this, [' +
              menuItems.join(',') +
            '])">',
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>',
            '</button>',
          '</div>'
        ].join('');
      }

      return '<tr>' +
        '<td><strong>' + esc(u.full_name) + '</strong></td>' +
        '<td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">' + esc(u.username) + '</code></td>' +
        '<td><span class="x-badge ' + _timRoleBadgeClass(u.role) + '">' + _timRoleLabel(u.role) + '</span></td>' +
        '<td>' + _timBranchName(u.branch_id) + '</td>' +
        '<td class="text-center" style="vertical-align:middle;text-align:center;">' + statusToggle + '</td>' +
        '<td class="text-right" style="white-space:nowrap;vertical-align:middle;">' + actions + '</td>' +
      '</tr>';
    });

    tbody.innerHTML = rows.join('');
  }

  function filterTimByRole(role) {
    _timRoleFilter = role;
    document.querySelectorAll('#tim-role-filters .x-cat-filter-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.role === role);
    });
    renderTimTable();
  }

  function openCreateUserModal() {
    $('modal-user-title').textContent = 'Tambah Anggota Tim';
    $('user-id').value = '';
    $('user-fullname').value = '';
    $('user-username').value = '';
    $('user-username').readOnly = false;
    $('user-password').value = '';
    $('user-password-group').style.display = '';
    $('user-password-hint').textContent = 'Wajib diisi saat membuat akun baru.';
    $('user-email').value = '';
    $('user-role').value = '';
    $('user-branch').value = '';

    var roleSelect = $('user-role');
    roleSelect.innerHTML = '';
    var currentRole = getTimCurrentUserRole();
    if (currentRole === 'owner') {
      roleSelect.innerHTML = '<option value="brand_manager">Brand Manager</option><option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option><option value="purchasing">Petugas Belanja (Purchasing)</option>';
    } else if (currentRole === 'brand_manager') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option><option value="purchasing">Petugas Belanja (Purchasing)</option>';
    } else if (currentRole === 'branch_manager') {
      roleSelect.innerHTML = '<option value="cashier">Kasir</option><option value="driver">Driver (Kurir)</option><option value="purchasing">Petugas Belanja (Purchasing)</option>';
    }

    var branchSelect = $('user-branch');
    branchSelect.innerHTML = '<option value="">— Tanpa Cabang —</option>';
    _timBranches.forEach(function (b) {
      branchSelect.innerHTML += '<option value="' + b.id + '">' + esc(b.name) + '</option>';
    });

    if (currentRole === 'branch_manager') {
      var myBranch = (getStoredUser() || {}).branch_id;
      if (myBranch) {
        branchSelect.value = myBranch;
        branchSelect.disabled = true;
      }
    } else {
      branchSelect.disabled = false;
    }

    openExistingCardInPresentation('modal-user', 'team-user-editor', 'bottom-sheet');
  }

  function openEditUser(userId) {
    var user = _timUsers.find(function (u) { return u.id === userId; });
    if (!user) return;

    $('modal-user-title').textContent = 'Edit Anggota Tim';
    $('user-id').value = user.id;
    $('user-fullname').value = user.full_name || '';
    $('user-username').value = user.username || '';
    $('user-username').readOnly = true;
    $('user-password-group').style.display = 'none';
    $('user-email').value = user.email || '';

    var roleSelect = $('user-role');
    roleSelect.innerHTML = '';
    var currentRole = getTimCurrentUserRole();
    if (currentRole === 'owner') {
      roleSelect.innerHTML = '<option value="brand_manager">Brand Manager</option><option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option><option value="purchasing">Petugas Belanja (Purchasing)</option>';
    } else if (currentRole === 'brand_manager') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option><option value="purchasing">Petugas Belanja (Purchasing)</option>';
    } else if (currentRole === 'branch_manager') {
      roleSelect.innerHTML = '<option value="cashier">Kasir</option><option value="driver">Driver (Kurir)</option><option value="purchasing">Petugas Belanja (Purchasing)</option>';
    }
    roleSelect.value = user.role;

    var branchSelect = $('user-branch');
    branchSelect.innerHTML = '<option value="">— Tanpa Cabang —</option>';
    _timBranches.forEach(function (b) {
      branchSelect.innerHTML += '<option value="' + b.id + '">' + esc(b.name) + '</option>';
    });
    branchSelect.value = user.branch_id || '';

    if (currentRole === 'branch_manager') {
      var myBranch = (getStoredUser() || {}).branch_id;
      if (myBranch) {
        branchSelect.value = myBranch;
        branchSelect.disabled = true;
      }
    } else {
      branchSelect.disabled = false;
    }

    openExistingCardInPresentation('modal-user', 'team-user-editor', 'bottom-sheet');
  }

  function closeUserModal() {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('team-user-editor')) {
      window.XentraPresentation.close('team-user-editor');
    } else {
      $('modal-user').style.display = 'none';
    }
  }

  async function submitUserForm(e) {
    if (e && e.preventDefault) e.preventDefault();
    var userId = $('user-id').value;
    var isEdit = !!userId;
    var payload = {
      full_name: $('user-fullname').value.trim(),
      role: $('user-role').value,
      branch_id: $('user-branch').value || undefined,
      email: $('user-email').value.trim() || undefined
    };

    if (!isEdit) {
      payload.username = $('user-username').value.trim();
      payload.password = $('user-password').value;
      if (!payload.username || payload.username.length < 3) {
        showToast('Username minimal 3 karakter.');
        return;
      }
      if (!payload.password || payload.password.length < 8) {
        showToast('Password minimal 8 karakter.');
        return;
      }
    }

    if (!payload.full_name) {
      showToast('Nama lengkap wajib diisi.');
      return;
    }

    if ((payload.role === 'driver' || payload.role === 'purchasing') && !payload.branch_id) {
      var roleName = payload.role === 'driver' ? 'Driver' : 'Petugas Belanja';
      showToast('Role ' + roleName + ' wajib ditugaskan ke salah satu cabang.');
      return;
    }

    try {
      var url = isEdit ? (API_BASE + '/admin/users/' + userId) : (API_BASE + '/admin/users');
      var method = isEdit ? 'PUT' : 'POST';
      var res = await adminFetch(url, {
        method: method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (data.success) {
        showToast(isEdit ? 'Profil anggota tim berhasil diperbarui.' : 'Anggota tim berhasil ditambahkan.');
        closeUserModal();
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }

  async function toggleUserStatus(userId, name, inputElem) {
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
      var confirmed = await confirmFeatureAction('disable-user', 'Nonaktifkan Akun', 'Nonaktifkan akun "' + name + '"? Staf ini tidak akan bisa login sampai diaktifkan kembali.', 'Nonaktifkan');
      if (!confirmed) {
        revert();
        return;
      }
    }

    if (inputElem) {
      inputElem.disabled = true;
    }

    try {
      var endpoint = willActivate ? '/enable' : '/disable';
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + endpoint, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil ' + (willActivate ? 'diaktifkan.' : 'dinonaktifkan.'));
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
        revert();
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
      revert();
    }
  }

  async function disableUser(userId, name) {
    if (!await confirmFeatureAction('disable-user-action', 'Nonaktifkan Akun', 'Nonaktifkan akun "' + name + '"? Staf ini tidak akan bisa login sampai diaktifkan kembali.', 'Nonaktifkan')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/disable', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil dinonaktifkan.');
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }

  async function enableUser(userId, name) {
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/enable', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Akun "' + name + '" berhasil diaktifkan.');
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }

  async function deleteUser(userId, name) {
    var confirmed = await confirmFeatureAction('delete-user', 'Hapus Anggota Tim', 'Hapus anggota "' + name + '"? Anggota akan kehilangan akses ke dashboard dan tim ini. Tindakan ini tidak dapat dibatalkan.', 'Hapus');
    if (!confirmed) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('Anggota "' + name + '" berhasil dihapus.');
        loadTim();
      } else {
        showToast('Gagal: ' + (data.error || data.message || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan saat menghapus anggota.');
    }
  }

  async function resetUserPassword(userId, name) {
    if (!await confirmFeatureAction('reset-user-password', 'Reset Password', 'Generate token reset password untuk "' + name + '"? Token hanya ditampilkan sekali.', 'Generate Token')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/users/' + userId + '/reset-password', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success && data.reset_token) {
        $('reset-password-user-name').value = name;
        $('reset-password-token').value = data.reset_token;
        openExistingCardInPresentation('modal-reset-password', 'team-reset-password', 'dialog');
      } else {
        showToast('Gagal: ' + (data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }

  function closeResetPasswordModal() {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('team-reset-password')) {
      window.XentraPresentation.close('team-reset-password');
    } else {
      $('modal-reset-password').style.display = 'none';
    }
  }

  /* =========================================================================
     MODUL: TEAM SECTION SWITCHER (Members, Invitations, Roles, Permissions)
     ========================================================================= */
  function switchTeamSection(sectionName, updateHash) {
    var valid = ['members', 'invitations', 'roles', 'permissions'];
    var sec = valid.indexOf(sectionName) !== -1 ? sectionName : 'members';

    ['members', 'invitations', 'roles', 'permissions'].forEach(function (name) {
      var el = $('team-section-' + name);
      if (el) el.style.display = name === sec ? '' : 'none';
    });

    document.querySelectorAll('#team-subnav .x-subnav-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.teamSection === sec);
    });

    if (sec === 'invitations') {
      loadInvitations();
    }

    if (updateHash !== false) {
      navigateTo('team/' + sec);
    }
  }

  /* =========================================================================
     MODUL: WORKFORCE INVITATIONS
     ========================================================================= */
  var _invitationsList = [];

  async function loadInvitations() {
    var tbody = $('invitations-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Memuat data undangan...</td></tr>';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/invitations', { headers: getAuthHeaders() });
      var data = await res.json();
      if (data.success) {
        _invitationsList = data.invitations || [];
        renderInvitationsTable(_invitationsList);
      } else {
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">' + esc(data.error || 'Gagal memuat undangan.') + '</td></tr>';
        }
      }
    } catch (err) {
      console.error('[Load Invitations Error]:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-danger">Kesalahan jaringan saat memuat undangan.</td></tr>';
      }
    }
  }

  function renderInvitationsTable(invitations) {
    var tbody = $('invitations-table-body');
    if (!tbody) return;

    if (!invitations || invitations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-muted">Belum ada undangan yang dibuat.</td></tr>';
      return;
    }

    var rows = invitations.map(function (inv) {
      var statusBadge = '';
      if (inv.status === 'pending') {
        statusBadge = '<span class="x-badge" style="background:#fef3c7;color:#92400e;font-weight:600;">Pending</span>';
      } else if (inv.status === 'accepted') {
        statusBadge = '<span class="x-badge" style="background:#ecfdf5;color:#047857;font-weight:600;">Accepted</span>';
      } else if (inv.status === 'revoked') {
        statusBadge = '<span class="x-badge" style="background:#fef2f2;color:#991b1b;font-weight:600;">Revoked</span>';
      } else if (inv.status === 'expired') {
        statusBadge = '<span class="x-badge" style="background:#f1f5f9;color:#64748b;font-weight:600;">Expired</span>';
      }

      var branchName = inv.branch_id ? _timBranchName(inv.branch_id) : '<span class="text-muted">Brand-wide</span>';
      var expiresFormatted = inv.expires_at ? new Date(inv.expires_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

      var actions = '—';
      if (inv.status === 'pending') {
        actions = '<div class="x-item-actions" style="justify-content:flex-end;gap:6px;">' +
          '<button type="button" class="x-btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="resendInvitation(\'' + inv.id + '\', \'' + esc(inv.email) + '\')">Kirim Ulang</button>' +
          '<button type="button" class="x-btn-secondary" style="padding:4px 8px;font-size:11px;color:#dc2626;" onclick="revokeInvitation(\'' + inv.id + '\', \'' + esc(inv.email) + '\')">Batalkan</button>' +
        '</div>';
      }

      return '<tr>' +
        '<td><strong>' + esc(inv.email) + '</strong></td>' +
        '<td><span class="x-badge ' + _timRoleBadgeClass(inv.role) + '">' + _timRoleLabel(inv.role) + '</span></td>' +
        '<td>' + branchName + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + expiresFormatted + '</td>' +
        '<td class="text-right">' + actions + '</td>' +
      '</tr>';
    });

    tbody.innerHTML = rows.join('');
  }

  function openInviteUserModal() {
    $('invite-input-email').value = '';

    var roleSelect = $('invite-input-role');
    roleSelect.innerHTML = '';
    var currentRole = getTimCurrentUserRole();
    if (currentRole === 'owner') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="brand_manager">Brand Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option><option value="purchasing">Petugas Belanja (Purchasing)</option>';
    } else if (currentRole === 'brand_manager') {
      roleSelect.innerHTML = '<option value="branch_manager">Branch Manager</option><option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option><option value="purchasing">Petugas Belanja (Purchasing)</option>';
    } else if (currentRole === 'branch_manager') {
      roleSelect.innerHTML = '<option value="cashier">Kasir</option><option value="kitchen">Dapur</option><option value="driver">Driver (Kurir)</option><option value="purchasing">Petugas Belanja (Purchasing)</option>';
    }

    var branchSelect = $('invite-input-branch');
    branchSelect.innerHTML = '<option value="">— Pilih Cabang —</option>';
    _timBranches.forEach(function (b) {
      branchSelect.innerHTML += '<option value="' + b.id + '">' + esc(b.name) + '</option>';
    });

    if (currentRole === 'branch_manager') {
      var myBranch = (getStoredUser() || {}).branch_id;
      if (myBranch) {
        branchSelect.value = myBranch;
        branchSelect.disabled = true;
      }
    } else {
      branchSelect.disabled = false;
    }

    handleInviteRoleChange();
    openExistingCardInPresentation('modal-invite-user', 'team-invite-editor', 'bottom-sheet');
  }

  function closeInviteUserModal() {
    if (window.XentraPresentation && window.XentraPresentation.isOpen('team-invite-editor')) {
      window.XentraPresentation.close('team-invite-editor');
    } else {
      $('modal-invite-user').style.display = 'none';
    }
  }

  function handleInviteRoleChange() {
    var role = $('invite-input-role').value;
    var branchGroup = $('invite-branch-group');
    var branchSelect = $('invite-input-branch');
    var isBranchRequired = role === 'branch_manager' || role === 'cashier' || role === 'kitchen' || role === 'driver';

    if (role === 'brand_manager') {
      if (branchGroup) branchGroup.style.display = 'none';
      if (branchSelect) branchSelect.required = false;
    } else {
      if (branchGroup) branchGroup.style.display = 'block';
      if (branchSelect) branchSelect.required = isBranchRequired;
    }
  }

  async function submitInviteUserForm(e) {
    if (e && e.preventDefault) e.preventDefault();
    var email = $('invite-input-email').value.trim();
    var role = $('invite-input-role').value;
    var branchId = $('invite-input-branch').value || undefined;

    if (!email) {
      showToast('Alamat email wajib diisi.');
      return;
    }

    if ((role === 'branch_manager' || role === 'cashier' || role === 'kitchen' || role === 'driver') && !branchId) {
      showToast('Peran ' + role + ' wajib memilih cabang penugasan.');
      return;
    }

    var btnSend = $('btn-send-invitation');
    if (btnSend) {
      btnSend.disabled = true;
      btnSend.textContent = 'Mengirim...';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/invitations', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ email: email, role: role, branch_id: branchId })
      });
      var data = await res.json();

      if (data.success) {
        showToast('Undangan berhasil dikirim ke ' + email);
        closeInviteUserModal();
        switchTeamSection('invitations');
      } else {
        showToast('Gagal: ' + (data.message || data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan saat mengirim undangan.');
    } finally {
      if (btnSend) {
        btnSend.disabled = false;
        btnSend.textContent = 'Kirim Undangan';
      }
    }
  }

  async function resendInvitation(invId, email) {
    if (!await confirmFeatureAction('resend-invitation', 'Kirim Ulang Undangan', 'Kirim ulang email undangan ke "' + email + '"? Token sebelumnya akan diperbarui.', 'Kirim Ulang')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/invitations/' + invId + '/resend', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Undangan berhasil dikirim ulang ke ' + email);
        loadInvitations();
      } else {
        showToast('Gagal: ' + (data.message || data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }

  async function revokeInvitation(invId, email) {
    if (!await confirmFeatureAction('revoke-invitation', 'Batalkan Undangan', 'Batalkan undangan untuk "' + email + '"? Tautan undangan tidak akan dapat digunakan lagi.', 'Batalkan')) return;
    try {
      var res = await adminFetch(API_BASE + '/admin/invitations/' + invId + '/revoke', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (data.success) {
        showToast('Undangan untuk ' + email + ' berhasil dibatalkan.');
        loadInvitations();
      } else {
        showToast('Gagal: ' + (data.message || data.error || 'Terjadi kesalahan.'));
      }
    } catch (err) {
      showToast('Kesalahan jaringan.');
    }
  }

  // Global window bindings for inline HTML handlers & dashboard routing
  window.loadTim = loadTim;
  window.filterTimByRole = filterTimByRole;
  window.openCreateUserModal = openCreateUserModal;
  window.openEditUser = openEditUser;
  window.closeUserModal = closeUserModal;
  window.submitUserForm = submitUserForm;
  window.toggleUserStatus = toggleUserStatus;
  window.disableUser = disableUser;
  window.enableUser = enableUser;
  window.deleteUser = deleteUser;
  window.resetUserPassword = resetUserPassword;
  window.closeResetPasswordModal = closeResetPasswordModal;
  window.switchTeamSection = switchTeamSection;
  window.loadInvitations = loadInvitations;
  window.openInviteUserModal = openInviteUserModal;
  window.closeInviteUserModal = closeInviteUserModal;
  window.handleInviteRoleChange = handleInviteRoleChange;
  window.submitInviteUserForm = submitInviteUserForm;
  window.resendInvitation = resendInvitation;
  window.revokeInvitation = revokeInvitation;

  window.XentraTeamModule = {
    loadTim: loadTim,
    loadInvitations: loadInvitations,
    switchTeamSection: switchTeamSection,
    openCreateUserModal: openCreateUserModal,
    openEditUser: openEditUser,
    closeUserModal: closeUserModal,
    submitUserForm: submitUserForm
  };

})(window, document);
