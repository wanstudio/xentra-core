(function () {
  'use strict';

  var app = document.getElementById('driver-app');
  var TOKEN_KEY = 'xentra_driver_token';
  var USER_KEY = 'xentra_driver_user';

  var state = {
    page: 'tasks',
    driver: null,
    brand: null,
    tasks: [],
    selectedOrderId: null,
    loading: true,
    error: null,
    busy: false
  };

  function rupiah(value) {
    return 'Rp' + Number(value || 0).toLocaleString('id-ID');
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function persistUser() {
    if (state.driver) {
      localStorage.setItem(USER_KEY, JSON.stringify(state.driver));
    }
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function api(path, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers || {});
    if (!headers['Content-Type'] && options.body) headers['Content-Type'] = 'application/json';
    var t = token();
    if (t) headers.Authorization = 'Bearer ' + t;

    var res;
    try {
      res = await fetch('/api/v1' + path, Object.assign({}, options, {
        headers: headers,
        credentials: 'same-origin'
      }));
    } catch (err) {
      var networkError = new Error('Koneksi ke Xentra gagal. Periksa koneksi internet Anda.');
      networkError.code = 'NETWORK_ERROR';
      throw networkError;
    }

    var data = null;
    try {
      data = await res.json();
    } catch (_) {}

    if (res.status === 401) {
      clearSession();
      window.location.href = '/login?target=driver';
      var authError = new Error('Sesi Driver tidak valid.');
      authError.status = 401;
      throw authError;
    }

    if (!res.ok) {
      var message = (data && (data.message || data.error)) || 'Permintaan tidak dapat diproses.';
      var err = new Error(message);
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }

    return data || {};
  }

  function icon(name) {
    var icons = {
      bell: '♧', back: '‹', arrow: '→', pin: '●', phone: '☎', chat: '◌',
      bag: '▣', clock: '◷', map: '⌖', check: '✓', close: '×', user: '♙',
      history: '◫', truck: '▱', settings: '⚙', nav: '➤', box: '□', info: 'i'
    };
    return icons[name] || '•';
  }

  function formatDeliveryStatus(task) {
    if (!task) return 'Tugas';
    if (task.delivery_status === 'on_delivery') return 'Sedang Diantar';
    if (task.delivery_status === 'picked_up') return 'Pesanan Diambil';
    if (task.delivery_status === 'assigned' && task.assignment_status === 'accepted') return 'Siap Ambil';
    return 'Tugas Baru';
  }

  function isNewTask(task) {
    return task.delivery_status === 'assigned' && task.assignment_status === 'pending';
  }

  function isActiveTask(task) {
    return task.delivery_status === 'picked_up' || task.delivery_status === 'on_delivery';
  }

  function selectedTask() {
    return state.tasks.find(function (task) {
      return String(task.order_id) === String(state.selectedOrderId);
    }) || null;
  }

  function shell(title, body, active, options) {
    options = options || {};

    var header = options.back
      ? '<header class="driver-header"><div class="back-row" style="margin:0"><button class="back-btn" data-action="back">' + icon('back') + '</button><div class="back-title">' + escapeHTML(title) + '</div></div></header>'
      : '<header class="driver-header"><div class="brand"><span class="brand-mark">X</span><span>Xentra Driver</span></div><div class="header-meta"><span class="header-branch">' + escapeHTML(state.driver && state.driver.branch_name || '') + '</span><button class="icon-btn" aria-label="Notifikasi">' + icon('bell') + '</button></div></header>';

    var nav = options.hideNav ? '' :
      '<nav class="bottom-nav">' +
        navItem('tasks', 'Tugas', 'bag', active) +
        navItem('history', 'Riwayat', 'history', active) +
        navItem('profile', 'Profil', 'user', active) +
      '</nav>';

    app.innerHTML = '<div class="driver-shell">' + header + '<main class="content">' + body + '</main>' + nav + '</div><div id="toast" class="toast"></div>';
    bind();

    if (state.busy) {
      var primaryButtons = app.querySelectorAll('.primary-btn, .danger-btn, .secondary-btn');
      primaryButtons.forEach(function (button) { button.disabled = true; });
    }
  }

  function navItem(page, label, ico, active) {
    return '<button class="nav-item ' + (active === page ? 'active' : '') + '" data-page="' + page + '"><span class="nav-icon">' + icon(ico) + '</span><span>' + label + '</span></button>';
  }

  function loadingBody(message) {
    return '<div class="loading"><div style="display:grid;justify-items:center;gap:10px"><div class="spinner"></div><div>' + escapeHTML(message || 'Memuat…') + '</div></div></div>';
  }

  function errorBody(message) {
    return '<div class="card"><div class="info-box warning"><span>!</span><div>' + escapeHTML(message) + '</div></div><button class="primary-btn" data-action="reload" style="margin-top:12px">Coba Lagi</button></div>';
  }

  function taskCard(task) {
    var customer = task.customer || {};
    var destination = task.destination || {};
    var payment = task.payment || {};
    var label = formatDeliveryStatus(task);
    var action = isNewTask(task) ? 'new-task' : 'delivery-detail';

    return '<article class="card task-card">' +
      '<div class="task-top"><span class="task-id">' + escapeHTML(task.order_number || task.order_id) + '</span><span class="pill ' + (isNewTask(task) ? 'orange' : 'blue') + '">' + escapeHTML(label) + '</span></div>' +
      '<div class="customer-row"><span class="pin">' + icon('pin') + '</span><div style="min-width:0"><div class="customer-name">' + escapeHTML(customer.name || 'Pelanggan') + '</div><div class="address">' + escapeHTML(destination.address || 'Alamat tujuan belum tersedia') + '</div></div></div>' +
      '<div class="meta-row"><span class="meta-item">' + icon('bag') + ' ' + Number(task.item_count || 0) + ' item</span>' +
      (payment.is_cod ? '<span class="meta-item">🟧 COD ' + rupiah(payment.amount) + '</span>' : '<span class="meta-item">✓ Online</span>') +
      '</div>' +
      '<button class="primary-btn" data-order="' + escapeHTML(task.order_id) + '" data-page="' + action + '" style="margin-top:14px">' +
      (isNewTask(task) ? 'Lihat Tugas' : 'Lihat Pengantaran') + ' ' + icon('arrow') + '</button>' +
    '</article>';
  }

  function renderTasks() {
    if (state.loading) return shell('Tugas', loadingBody('Memuat tugas…'), 'tasks');
    if (state.error) return shell('Tugas', errorBody(state.error), 'tasks');

    var newTasks = state.tasks.filter(isNewTask);
    var activeTasks = state.tasks.filter(isActiveTask);
    var acceptedAssigned = state.tasks.filter(function (task) {
      return task.delivery_status === 'assigned' && task.assignment_status === 'accepted';
    });

    var body = '<h1 class="screen-title">Tugas</h1><div class="screen-subtitle">Pengantaran yang ditugaskan kepada Anda.</div>' +
      '<div class="status-card"><div class="status-dot">✓</div><div><div class="status-title">Tersedia</div><div class="status-copy">Status availability akan dihubungkan pada tahap berikutnya.</div></div></div>';

    if (activeTasks.length) {
      body += '<div class="section-head"><div class="section-title">Tugas Aktif</div><span class="badge-count">' + activeTasks.length + '</span></div>';
      activeTasks.forEach(function (task) { body += taskCard(task); });
    }

    if (acceptedAssigned.length) {
      body += '<div class="section-head"><div class="section-title">Siap Diambil</div><span class="badge-count">' + acceptedAssigned.length + '</span></div>';
      acceptedAssigned.forEach(function (task) { body += taskCard(task); });
    }

    if (newTasks.length) {
      body += '<div class="section-head"><div class="section-title">Tugas Baru</div><span class="badge-count">' + newTasks.length + '</span></div>';
      newTasks.forEach(function (task) { body += taskCard(task); });
    }

    if (!state.tasks.length) {
      body += '<div class="empty"><div class="empty-art">' + icon('box') + '</div><h3>Tidak ada tugas saat ini</h3><p>Anda akan melihat tugas baru ketika Branch Manager menugaskan pengantaran kepada Anda.</p><button class="secondary-btn" data-action="reload">Muat Ulang</button></div>';
    }

    shell('Tugas', body, 'tasks');
  }

  function renderNewTask() {
    var task = selectedTask();
    if (!task) return shell('Tugas Baru', errorBody('Tugas tidak ditemukan atau sudah berubah.'), 'tasks', {hideNav:true});

    var c = task.customer || {};
    var d = task.destination || {};
    var p = task.payment || {};

    var body = '<div class="back-row"><button class="back-btn" data-action="back">‹</button><div class="back-title">Tugas Baru</div></div>' +
      '<div class="card">' +
        '<div class="task-top"><span class="task-id">Pengantaran ' + escapeHTML(task.order_number || task.order_id) + '</span><span class="pill orange">Menunggu Anda</span></div>' +
        '<div class="customer-row"><span class="pin">' + icon('pin') + '</span><div><div class="customer-name">' + escapeHTML(c.name || 'Pelanggan') + '</div><div class="address">' + escapeHTML(d.address || 'Alamat tujuan belum tersedia') + '</div></div></div>' +
        '<div class="meta-row"><span class="meta-item">⌖ ' + escapeHTML(task.distance_meters ? (Number(task.distance_meters) / 1000).toFixed(1) + ' km' : 'Jarak akan dihitung') + '</span><span class="meta-item">◷ ' + escapeHTML(task.duration_seconds ? Math.round(Number(task.duration_seconds) / 60) + ' menit' : 'ETA akan dihitung') + '</span></div>' +
        (p.is_cod ? '<div class="money-card"><div class="money-label">COD / Bayar di Tempat</div><div class="money">' + rupiah(p.amount) + '</div></div>' : '<div class="money-card"><div class="money-label">Pembayaran</div><div class="money">Sudah dibayar</div></div>') +
        '<div class="info-box"><span>i</span><div>Terima tugas jika Anda siap mengambil pesanan dari cabang dan mengantarkannya ke pelanggan.</div></div>' +
      '</div>' +
      '<div class="sticky-action"><div class="btn-row"><button class="danger-btn" data-action="reject">× Tolak</button><button class="primary-btn" data-action="accept">✓ Terima Tugas</button></div></div>';

    shell('Tugas Baru', body, 'tasks', {hideNav:true});
  }

  function renderDetail() {
    var task = selectedTask();
    if (!task) return shell('Pengantaran', errorBody('Tugas tidak ditemukan atau sudah tidak menjadi tugas Anda.'), 'tasks', {hideNav:true});

    var c = task.customer || {};
    var d = task.destination || {};
    var p = task.payment || {};
    var accepted = task.delivery_status === 'assigned' && task.assignment_status === 'accepted';
    var active = isActiveTask(task);

    var nextBlock = accepted
      ? '<div class="info-box"><span>→</span><div><strong>Langkah berikutnya: Ambil Pesanan.</strong><br>Wiring pickup akan diaktifkan setelah boundary Driver API tahap ini selesai.</div></div>'
      : (active
        ? '<div class="info-box success"><span>✓</span><div><strong>' + escapeHTML(formatDeliveryStatus(task)) + '</strong><br>Pengantaran ini sedang Anda jalankan.</div></div>'
        : '<div class="info-box"><span>i</span><div>Status pengantaran saat ini: ' + escapeHTML(task.delivery_status) + '.</div></div>');

    var body = '<div class="back-row"><button class="back-btn" data-action="back">‹</button><div class="back-title">Pengantaran ' + escapeHTML(task.order_number || task.order_id) + '</div></div>' +
      '<div class="card">' + nextBlock + '</div>' +
      '<div class="card"><div class="section-title">Tujuan</div><div class="customer-row"><span class="pin">' + icon('pin') + '</span><div style="flex:1"><div class="customer-name">' + escapeHTML(c.name || 'Pelanggan') + '</div><div class="address">' + escapeHTML(d.address || 'Alamat tujuan belum tersedia') + '</div></div><button class="icon-btn" data-action="call" aria-label="Telepon pelanggan">☎</button></div><button class="secondary-btn" data-action="navigate" style="margin-top:13px">⌖ Buka Navigasi</button></div>' +
      '<div class="card"><div class="section-title">Pesanan</div><div class="meta-row"><span class="meta-item">▣ ' + Number(task.item_count || 0) + ' item</span></div></div>' +
      '<div class="card"><div class="section-title">Pembayaran</div><div class="money">' + (p.is_cod ? rupiah(p.amount) : 'Sudah dibayar') + '</div><div class="pill ' + (p.is_cod ? 'orange' : 'green') + '" style="margin-top:8px">' + (p.is_cod ? 'Bayar di Tempat (COD)' : 'Online') + '</div></div>';

    if (accepted) {
      body += '<div class="sticky-action"><button class="secondary-btn" disabled>Ambil Pesanan • Tahap berikutnya</button></div>';
    } else if (active) {
      body += '<div class="sticky-action"><button class="secondary-btn" data-action="next-stage-info">Tahap aktif</button></div>';
    }

    shell('Detail Pengantaran', body, 'tasks', {hideNav:true});
  }

  function renderHistory() {
    var body = '<h1 class="screen-title">Riwayat Pengantaran</h1><div class="screen-subtitle">Riwayat akan menggunakan endpoint delivery history setelah API tahap berikutnya tersedia.</div>' +
      '<div class="empty"><div class="empty-art">' + icon('history') + '</div><h3>Riwayat belum dihubungkan</h3><p>Implementasi pertama Driver PWA berfokus pada identity dan assignment. Riwayat tidak menggunakan data contoh.</p></div>';
    shell('Riwayat', body, 'history');
  }

  function renderProfile() {
    if (!state.driver) return shell('Profil', loadingBody('Memuat profil…'), 'profile');

    var body = '<h1 class="screen-title">Profil</h1><div class="screen-subtitle">Identitas dan pengaturan operasional.</div>' +
      '<div class="card"><div class="profile-head"><div class="avatar">D</div><div><div class="profile-name">' + escapeHTML(state.driver.full_name || state.driver.username || 'Driver') + '</div><div class="profile-role">Driver • ' + escapeHTML(state.driver.branch_name || 'Cabang') + '</div></div></div></div>' +
      '<div class="profile-list">' +
        profileItem('●','Status','Tersedia','availability') +
        profileItem('▱','Kendaraan','Belum dikonfigurasi') +
        profileItem('➤','Aplikasi Navigasi','Pilih saat wiring navigasi','navigate') +
        profileItem('?','Bantuan') +
        profileItem('i','Tentang Xentra') +
        profileItem('↪','Keluar','', 'logout') +
      '</div>';
    shell('Profil', body, 'profile');
  }

  function profileItem(i, label, value, action) {
    return '<button class="profile-item" data-action="' + (action || '') + '"><span class="left">' + i + '</span><span class="body"><span class="label">' + escapeHTML(label) + '</span>' + (value ? '<span class="value">' + escapeHTML(value) + '</span>' : '') + '</span><span class="chevron">›</span></button>';
  }

  function toast(message) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function showRejectSheet() {
    var existing = document.getElementById('driver-reject-sheet');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'driver-reject-sheet';
    overlay.className = 'sheet-backdrop';
    overlay.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="reject-title">' +
        '<div class="sheet-handle"></div>' +
        '<h3 id="reject-title">Tolak Tugas</h3>' +
        '<p>Alasan penolakan wajib dicatat agar Branch Manager dapat menindaklanjuti penugasan.</p>' +
        '<textarea id="driver-reject-reason" maxlength="500" placeholder="Contoh: sedang tidak tersedia untuk mengambil pesanan."></textarea>' +
        '<div class="sheet-actions"><button class="danger-btn" data-sheet-action="cancel">Batal</button><button class="primary-btn" data-sheet-action="submit">Tolak Tugas</button></div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', async function (event) {
      if (event.target === overlay) return;
      var action = event.target.closest('[data-sheet-action]');
      if (!action) return;
      var actionName = action.getAttribute('data-sheet-action');
      if (actionName === 'cancel') {
        overlay.remove();
        return;
      }
      var reasonInput = document.getElementById('driver-reject-reason');
      var reason = reasonInput ? reasonInput.value.trim() : '';
      if (!reason) {
        toast('Alasan penolakan wajib diisi');
        if (reasonInput) reasonInput.focus();
        return;
      }
      overlay.remove();
      await rejectTask(reason);
    });

    var input = document.getElementById('driver-reject-reason');
    if (input) setTimeout(function () { input.focus(); }, 50);
  }

  async function acceptTask() {
    var task = selectedTask();
    if (!task || state.busy) return;
    state.busy = true;
    renderNewTask();
    try {
      await api('/driver/tasks/' + encodeURIComponent(task.order_id) + '/accept', { method: 'POST' });
      toast('Tugas diterima');
      await refreshTasks(false);
      state.selectedOrderId = task.order_id;
      state.page = 'delivery-detail';
      state.busy = false;
      render();
    } catch (err) {
      state.busy = false;
      render();
      toast(err.message || 'Tugas gagal diterima');
    }
  }

  async function rejectTask(reason) {
    var task = selectedTask();
    if (!task || state.busy) return;
    state.busy = true;
    try {
      await api('/driver/tasks/' + encodeURIComponent(task.order_id) + '/reject', {
        method: 'POST',
        body: JSON.stringify({ reason: reason })
      });
      toast('Tugas ditolak');
      state.selectedOrderId = null;
      state.busy = false;
      await refreshTasks(false);
      state.page = 'tasks';
      render();
    } catch (err) {
      state.busy = false;
      render();
      toast(err.message || 'Tugas gagal ditolak');
    }
  }

  async function refreshTasks(showLoading) {
    if (showLoading) {
      state.loading = true;
      state.error = null;
      renderTasks();
    }
    try {
      var data = await api('/driver/tasks');
      state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      state.loading = false;
      state.error = null;
      return data;
    } catch (err) {
      if (err.status === 401) return null;
      state.loading = false;
      state.error = err.message || 'Tugas tidak dapat dimuat.';
      return null;
    }
  }

  async function loadDriver() {
    state.loading = true;
    state.error = null;
    if (!token()) {
      window.location.href = '/login?target=driver';
      return;
    }

    try {
      var data = await api('/driver/me');
      state.driver = data.driver || null;
      state.brand = data.brand || null;
      persistUser();
    } catch (err) {
      if (err.status === 401) return;
      state.loading = false;
      state.error = err.message || 'Profil Driver tidak dapat dimuat.';
      renderTasks();
      return;
    }

    await refreshTasks(false);
    state.loading = false;
    render();
  }

  function go(page) {
    state.page = page;
    render();
  }

  function render() {
    if (state.page === 'tasks') return renderTasks();
    if (state.page === 'new-task') return renderNewTask();
    if (state.page === 'delivery-detail') return renderDetail();
    if (state.page === 'history') return renderHistory();
    if (state.page === 'profile') return renderProfile();
    return renderTasks();
  }

  function bind() {
    app.querySelectorAll('[data-page]').forEach(function (el) {
      el.addEventListener('click', function () {
        var page = el.getAttribute('data-page');
        var orderId = el.getAttribute('data-order');
        if (orderId) state.selectedOrderId = orderId;
        go(page);
      });
    });

    app.querySelectorAll('[data-action]').forEach(function (el) {
      el.addEventListener('click', function () {
        handleAction(el.getAttribute('data-action'));
      });
    });
  }

  async function handleAction(action) {
    if (action === 'back') return go('tasks');
    if (action === 'reload') {
      await refreshTasks(true);
      render();
      return;
    }
    if (action === 'accept') return acceptTask();
    if (action === 'reject') return showRejectSheet();
    if (action === 'next-stage-info') return toast('Tahap pickup akan dihubungkan setelah API pickup selesai.');
    if (action === 'call') {
      var task = selectedTask();
      var phone = task && task.customer && task.customer.phone;
      if (!phone) return toast('Nomor pelanggan tidak tersedia');
      window.location.href = 'tel:' + phone;
      return;
    }
    if (action === 'navigate') {
      return toast('Navigasi akan dihubungkan dengan GPS + Mapbox/OSRM pada tahap berikutnya.');
    }
    if (action === 'availability') {
      return toast('Availability Driver akan dihubungkan setelah contract availability API diterapkan.');
    }
    if (action === 'logout') {
      try {
        await api('/auth/logout', { method: 'POST' });
      } catch (_) {}
      clearSession();
      window.location.href = '/login?target=driver';
    }
  }

  window.addEventListener('popstate', function () {
    go('tasks');
  });

  loadDriver();
})();