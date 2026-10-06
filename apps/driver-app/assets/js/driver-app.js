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
    history: [],
    selectedOrderId: null,
    lastCompleted: null,
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
    if (state.driver) localStorage.setItem(USER_KEY, JSON.stringify(state.driver));
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
    } catch (_) {
      var networkError = new Error('Koneksi ke Xentra gagal. Periksa koneksi internet Anda.');
      networkError.code = 'NETWORK_ERROR';
      throw networkError;
    }

    var data = null;
    try { data = await res.json(); } catch (_) {}

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

  function isAcceptedAssigned(task) {
    return task.delivery_status === 'assigned' && task.assignment_status === 'accepted';
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
      app.querySelectorAll('.primary-btn, .danger-btn, .secondary-btn').forEach(function (button) {
        button.disabled = true;
      });
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
    var newTask = isNewTask(task);

    return '<article class="card task-card">' +
      '<div class="task-top"><span class="task-id">' + escapeHTML(task.order_number || task.order_id) + '</span><span class="pill ' + (newTask ? 'orange' : 'blue') + '">' + escapeHTML(formatDeliveryStatus(task)) + '</span></div>' +
      '<div class="customer-row"><span class="pin">' + icon('pin') + '</span><div style="min-width:0"><div class="customer-name">' + escapeHTML(customer.name || 'Pelanggan') + '</div><div class="address">' + escapeHTML(destination.address || 'Alamat tujuan belum tersedia') + '</div></div></div>' +
      '<div class="meta-row"><span class="meta-item">' + icon('bag') + ' ' + Number(task.item_count || 0) + ' item</span>' +
      (payment.is_cod ? '<span class="meta-item">🟧 COD ' + rupiah(payment.amount) + '</span>' : '<span class="meta-item">✓ Online</span>') +
      '</div>' +
      '<button class="primary-btn" data-order="' + escapeHTML(task.order_id) + '" data-page="' + (newTask ? 'new-task' : 'delivery-detail') + '" style="margin-top:14px">' +
      (newTask ? 'Lihat Tugas' : 'Lihat Pengantaran') + ' ' + icon('arrow') + '</button>' +
    '</article>';
  }

  function renderTasks() {
    if (state.loading) return shell('Tugas', loadingBody('Memuat tugas…'), 'tasks');
    if (state.error) return shell('Tugas', errorBody(state.error), 'tasks');

    var newTasks = state.tasks.filter(isNewTask);
    var activeTasks = state.tasks.filter(isActiveTask);
    var acceptedAssigned = state.tasks.filter(isAcceptedAssigned);

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
    var action = '';
    var actionLabel = '';

    if (isAcceptedAssigned(task)) {
      action = 'pickup';
      actionLabel = 'Ambil Pesanan';
    } else if (task.delivery_status === 'picked_up') {
      action = 'start-delivery';
      actionLabel = 'Mulai Antar';
    } else if (task.delivery_status === 'on_delivery') {
      action = 'delivery-map';
      actionLabel = 'Lihat Pengantaran';
    }

    var statusBox = isAcceptedAssigned(task)
      ? '<div class="info-box"><span>→</span><div><strong>Tugas Diterima</strong><br>Pesanan siap untuk diambil dari cabang.</div></div>'
      : task.delivery_status === 'picked_up'
        ? '<div class="info-box success"><span>✓</span><div><strong>Pesanan Diambil</strong><br>Siap dimulai untuk pengantaran.</div></div>'
        : '<div class="info-box success"><span>✓</span><div><strong>Sedang Diantar</strong><br>Pengantaran sedang berjalan.</div></div>';

    var body = '<div class="back-row"><button class="back-btn" data-action="back">‹</button><div class="back-title">Pengantaran ' + escapeHTML(task.order_number || task.order_id) + '</div></div>' +
      '<div class="card">' + statusBox + '</div>' +
      '<div class="card"><div class="section-title">Tujuan</div><div class="customer-row"><span class="pin">' + icon('pin') + '</span><div style="flex:1"><div class="customer-name">' + escapeHTML(c.name || 'Pelanggan') + '</div><div class="address">' + escapeHTML(d.address || 'Alamat tujuan belum tersedia') + '</div></div><button class="icon-btn" data-action="call" aria-label="Telepon pelanggan">☎</button></div><button class="secondary-btn" data-action="navigate" style="margin-top:13px">⌖ Buka Navigasi</button></div>' +
      '<div class="card"><div class="section-title">Pesanan</div><div class="meta-row"><span class="meta-item">▣ ' + Number(task.item_count || 0) + ' item</span></div></div>' +
      '<div class="card"><div class="section-title">Pembayaran</div><div class="money">' + (p.is_cod ? rupiah(p.amount) : 'Sudah dibayar') + '</div><div class="pill ' + (p.is_cod ? 'orange' : 'green') + '" style="margin-top:8px">' + (p.is_cod ? 'Bayar di Tempat (COD)' : 'Online') + '</div></div>';

    if (action) {
      body += '<div class="sticky-action"><button class="primary-btn" data-action="' + action + '">' + actionLabel + ' ' + icon('arrow') + '</button></div>';
    }

    shell('Detail Pengantaran', body, 'tasks', {hideNav:true});
  }

  function renderPickup() {
    var task = selectedTask();
    if (!task) return shell('Ambil Pesanan', errorBody('Tugas tidak ditemukan.'), 'tasks', {hideNav:true});

    var p = task.payment || {};
    var pickupName = task.pickup && task.pickup.branch_name || 'Cabang';
    var body = '<div class="back-row"><button class="back-btn" data-action="back">‹</button><div class="back-title">Ambil Pesanan</div></div>' +
      '<div class="card"><div class="customer-row" style="margin-top:0"><span class="pin" style="background:#fff0f4;color:#d64572">▣</span><div><div class="customer-name">' + escapeHTML(pickupName) + '</div><div class="address">Tunjukkan nomor pesanan kepada staf.</div></div></div></div>' +
      '<div class="card"><div class="task-top"><span class="task-id">Pesanan ' + escapeHTML(task.order_number || task.order_id) + '</span><span class="pill blue">' + Number(task.item_count || 0) + ' item</span></div>' +
      (p.is_cod ? '<div class="money-card"><div class="money-label">COD</div><div class="money">' + rupiah(p.amount) + '</div></div>' : '') +
      '<div class="info-box"><span>i</span><div>Pastikan jumlah dan kondisi pesanan sesuai sebelum Anda mengonfirmasi pengambilan.</div></div>' +
      '<div class="check-list"><div class="check"><span class="check-icon">✓</span>Jumlah item sesuai</div><div class="check"><span class="check-icon">✓</span>Kemasan dalam kondisi baik</div></div></div>' +
      '<div class="sticky-action"><button class="primary-btn" data-action="confirm-pickup">Konfirmasi Pesanan Diambil ' + icon('arrow') + '</button></div>';

    shell('Ambil Pesanan', body, 'tasks', {hideNav:true});
  }

  function renderMap() {
    var task = selectedTask();
    if (!task) return shell('Sedang Mengantar', errorBody('Tugas pengantaran tidak ditemukan.'), 'tasks', {hideNav:true});

    var c = task.customer || {};
    var d = task.destination || {};
    var body = '<div class="hero-map"><div class="map-grid"></div><div class="nav-banner"><div class="nav-turn">Tujuan Pengantaran</div><div class="nav-road">' + escapeHTML(d.address || 'Alamat tujuan') + '</div></div><div class="route"></div><div class="map-pin a">A</div><div class="map-pin b">B</div><div class="map-controls"><button class="map-control">➤</button><button class="map-control">⌾</button></div></div>' +
      '<div class="map-sheet"><div class="route-stats"><div class="route-stat"><strong>' + escapeHTML(task.duration_seconds ? Math.round(Number(task.duration_seconds) / 60) + ' menit' : '—') + '</strong><span>ETA</span></div><div class="route-stat"><strong>' + escapeHTML(task.distance_meters ? (Number(task.distance_meters) / 1000).toFixed(1) + ' km' : '—') + '</strong><span>jarak</span></div></div>' +
      '<div class="customer-row" style="margin-top:0"><span class="pin" style="background:#fff0f0;color:var(--red)">●</span><div style="flex:1"><div class="customer-name">' + escapeHTML(c.name || 'Pelanggan') + '</div><div class="address">' + escapeHTML(d.address || 'Alamat tujuan belum tersedia') + '</div></div><button class="icon-btn" data-action="call" aria-label="Telepon pelanggan">☎</button></div>' +
      '<button class="secondary-btn" data-action="navigate" style="margin-top:13px">⌖ Buka Navigasi</button>' +
      '<div class="sticky-action"><button class="primary-btn green" data-action="complete-delivery">Selesaikan Pengantaran ' + icon('arrow') + '</button></div></div>';

    shell('Sedang Mengantar', body, 'tasks', {hideNav:true});
  }

  function renderCod() {
    var task = selectedTask();
    if (!task) return shell('Konfirmasi COD', errorBody('Tugas pengantaran tidak ditemukan.'), 'tasks', {hideNav:true});

    var p = task.payment || {};
    var body = '<div class="back-row"><button class="back-btn" data-action="back">‹</button><div class="back-title">Konfirmasi COD</div></div>' +
      '<div class="card"><div class="money-card"><div class="money-label">Yang harus dibayar (COD)</div><div class="money">' + rupiah(p.amount) + '</div></div>' +
      '<label class="input-label" for="tendered">Uang diterima dari pelanggan</label><input id="tendered" class="money-input" inputmode="numeric" autocomplete="off" placeholder="Masukkan nominal">' +
      '<div class="change-box"><div class="change-label">Kembalian untuk pelanggan</div><div id="change" class="change-value">Rp0</div></div>' +
      '<div class="info-box warning" style="margin-top:12px"><span>!</span><div>Uang tunai ini akan tetap berada pada Anda sampai diserahkan kepada Kasir.</div></div></div>' +
      '<div class="sticky-action"><button class="primary-btn" data-action="complete-cod">Konfirmasi Uang Diterima</button></div>';

    shell('Konfirmasi COD', body, 'tasks', {hideNav:true});
  }

  function renderComplete() {
    var task = state.lastCompleted || selectedTask();
    if (!task) return shell('Pengantaran Selesai', errorBody('Ringkasan pengantaran tidak tersedia.'), 'tasks', {hideNav:true});

    var c = task.customer || {};
    var p = task.payment || {};
    var amount = p.collected_amount != null ? p.collected_amount : p.amount;
    var cashState = p.is_cod
      ? '<div class="cash-custody"><div class="label">UANG COD DI TANGAN ANDA</div><div class="value">' + rupiah(amount) + '</div><div style="font-size:12px;color:#8b520b;margin-top:5px">Serahkan uang ini kepada Kasir untuk penyelesaian pembayaran.</div></div>'
      : '<div class="info-box success"><span>✓</span><div>Pembayaran online sudah tercatat. Tidak ada kas COD yang perlu diserahkan.</div></div>';

    var body = '<div class="card complete"><div class="summary-icon">✓</div><h2>Pengantaran Selesai</h2><p>Pelanggan telah menerima pesanan.</p></div>' +
      '<div class="card"><div class="customer-row" style="margin-top:0"><span class="pin">▣</span><div><div class="customer-name">Pesanan ' + escapeHTML(task.order_number || task.order_id) + '</div><div class="address">' + escapeHTML(c.name || 'Pelanggan') + '</div></div></div><div class="meta-row"><span class="meta-item">▣ ' + Number(task.item_count || 0) + ' item</span>' +
      (p.is_cod ? '<span class="meta-item">🟧 COD ' + rupiah(p.amount) + '</span><span class="pill green">✓ Uang diterima</span>' : '<span class="pill green">✓ Online</span>') +
      '</div></div>' + cashState +
      '<div class="sticky-action"><button class="primary-btn" data-action="back-tasks">Kembali ke Tugas</button></div>';

    shell('Pengantaran Selesai', body, 'tasks', {hideNav:true});
  }

  function renderHistory() {
    if (state.loading) return shell('Riwayat', loadingBody('Memuat riwayat…'), 'history');
    if (state.error) return shell('Riwayat', errorBody(state.error), 'history');

    var body = '<h1 class="screen-title">Riwayat Pengantaran</h1><div class="screen-subtitle">Pengantaran yang sudah selesai.</div>';

    if (!state.history.length) {
      body += '<div class="empty"><div class="empty-art">' + icon('history') + '</div><h3>Belum ada riwayat</h3><p>Riwayat akan muncul setelah Anda menyelesaikan pengantaran.</p></div>';
    } else {
      body += '<div class="history-group"><div class="history-date">Terbaru</div>';
      state.history.forEach(function (task) {
        var c = task.customer || {};
        var p = task.payment || {};
        body += historyRow(task.order_number || task.order_id, c.name || 'Pelanggan', p.is_cod ? 'COD ' + rupiah(p.amount) : 'Online');
      });
      body += '</div>';
    }

    shell('Riwayat', body, 'history');
  }

  function historyRow(id, name, payment) {
    return '<div class="history-row"><span class="history-pin">●</span><div class="history-main"><div class="history-id">' + escapeHTML(id) + '</div><div class="history-name">' + escapeHTML(name) + '</div><div class="history-time">Terkirim</div></div><div class="history-right"><span class="pill green">Terkirim</span><div class="amount">' + escapeHTML(payment) + '</div></div></div>';
  }

  function renderProfile() {
    if (!state.driver) return shell('Profil', loadingBody('Memuat profil…'), 'profile');

    var body = '<h1 class="screen-title">Profil</h1><div class="screen-subtitle">Identitas dan pengaturan operasional.</div>' +
      '<div class="card"><div class="profile-head"><div class="avatar">D</div><div><div class="profile-name">' + escapeHTML(state.driver.full_name || state.driver.username || 'Driver') + '</div><div class="profile-role">Driver • ' + escapeHTML(state.driver.branch_name || 'Cabang') + '</div></div></div></div>' +
      '<div class="profile-list">' +
        profileItem('●','Status','Tersedia','availability') +
        profileItem('▱','Kendaraan','Belum dikonfigurasi') +
        profileItem('➤','Aplikasi Navigasi','Google Maps','navigate') +
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
        '<textarea id="driver-reject-reason" maxlength="500" placeholder="Masukkan alasan penolakan"></textarea>' +
        '<div class="sheet-actions"><button class="danger-btn" data-sheet-action="cancel">Batal</button><button class="primary-btn" data-sheet-action="submit">Tolak Tugas</button></div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', async function (event) {
      if (event.target === overlay) return;
      var action = event.target.closest('[data-sheet-action]');
      if (!action) return;

      if (action.getAttribute('data-sheet-action') === 'cancel') {
        overlay.remove();
        return;
      }

      var input = document.getElementById('driver-reject-reason');
      var reason = input ? input.value.trim() : '';
      if (!reason) {
        toast('Alasan penolakan wajib diisi');
        if (input) input.focus();
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
      var data = await api('/driver/tasks/' + encodeURIComponent(task.order_id) + '/accept', { method: 'POST' });
      state.busy = false;
      state.selectedOrderId = task.order_id;
      await refreshTasks(false);
      if (data && data.task) state.tasks.push(data.task);
      state.page = 'delivery-detail';
      toast('Tugas diterima');
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
      state.selectedOrderId = null;
      state.busy = false;
      await refreshTasks(false);
      state.page = 'tasks';
      toast('Tugas ditolak');
      render();
    } catch (err) {
      state.busy = false;
      render();
      toast(err.message || 'Tugas gagal ditolak');
    }
  }

  async function transitionTask(endpoint, payload, nextPage) {
    var task = selectedTask();
    if (!task || state.busy) return;

    state.busy = true;
    render();

    try {
      var data = await api('/driver/tasks/' + encodeURIComponent(task.order_id) + '/' + endpoint, {
        method: 'POST',
        body: payload ? JSON.stringify(payload) : undefined
      });

      state.busy = false;
      if (data && data.task) {
        if (nextPage === 'complete') state.lastCompleted = data.task;
      }

      if (nextPage === 'complete') {
        state.page = 'complete';
        state.lastCompleted = (data && data.task) || task;
      } else {
        await refreshTasks(false);
        state.selectedOrderId = task.order_id;
        state.page = nextPage;
      }

      toast(endpoint === 'pickup' ? 'Pesanan berhasil diambil' : endpoint === 'start' ? 'Pengantaran dimulai' : 'Pengantaran selesai');
      render();
    } catch (err) {
      state.busy = false;
      render();
      toast(err.message || 'Tindakan gagal diproses');
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

  async function refreshHistory() {
    state.loading = true;
    state.error = null;
    renderHistory();

    try {
      var data = await api('/driver/history');
      state.history = Array.isArray(data.deliveries) ? data.deliveries : [];
      state.loading = false;
      return data;
    } catch (err) {
      if (err.status === 401) return null;
      state.loading = false;
      state.error = err.message || 'Riwayat tidak dapat dimuat.';
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

  async function go(page) {
    if (page === 'history') {
      state.page = 'history';
      await refreshHistory();
      render();
      return;
    }
    state.page = page;
    render();
  }

  function render() {
    if (state.page === 'tasks') return renderTasks();
    if (state.page === 'new-task') return renderNewTask();
    if (state.page === 'delivery-detail') return renderDetail();
    if (state.page === 'pickup') return renderPickup();
    if (state.page === 'map') return renderMap();
    if (state.page === 'cod') return renderCod();
    if (state.page === 'complete') return renderComplete();
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

    var input = document.getElementById('tendered');
    if (input) {
      input.addEventListener('input', function () {
        var value = Number(String(input.value).replace(/[^0-9]/g, '')) || 0;
        var task = selectedTask();
        var expected = task && task.payment ? Number(task.payment.amount || 0) : 0;
        var change = Math.max(0, value - expected);
        var out = document.getElementById('change');
        if (out) out.textContent = rupiah(change);
      });
    }
  }

  async function handleAction(action) {
    if (action === 'back' || action === 'back-tasks') {
      state.lastCompleted = null;
      state.page = 'tasks';
      return refreshTasks(false).then(render);
    }

    if (action === 'reload') {
      if (state.page === 'history') await refreshHistory();
      else await refreshTasks(true);
      render();
      return;
    }

    if (action === 'accept') return acceptTask();
    if (action === 'reject') return showRejectSheet();

    if (action === 'pickup') {
      state.page = 'pickup';
      return render();
    }

    if (action === 'confirm-pickup') {
      return transitionTask('pickup', null, 'delivery-detail');
    }

    if (action === 'start-delivery') {
      return transitionTask('start', null, 'map');
    }

    if (action === 'delivery-map') {
      state.page = 'map';
      return render();
    }

    if (action === 'complete-delivery') {
      var task = selectedTask();
      if (!task) return toast('Tugas pengantaran tidak ditemukan');
      if (task.payment && task.payment.is_cod) {
        state.page = 'cod';
        return render();
      }
      return transitionTask('complete', null, 'complete');
    }

    if (action === 'complete-cod') {
      var codTask = selectedTask();
      var input = document.getElementById('tendered');
      var tendered = input ? Number(String(input.value).replace(/[^0-9]/g, '')) || 0 : 0;
      var expected = codTask && codTask.payment ? Number(codTask.payment.amount || 0) : 0;
      if (tendered < expected) {
        toast('Uang yang diterima kurang dari total COD');
        return;
      }
      return transitionTask('complete', { cod_amount_tendered: tendered }, 'complete');
    }

    if (action === 'call') {
      var selected = selectedTask() || state.lastCompleted;
      var phone = selected && selected.customer && selected.customer.phone;
      if (!phone) return toast('Nomor pelanggan tidak tersedia');
      window.location.href = 'tel:' + phone;
      return;
    }

    if (action === 'navigate') {
      var navTask = selectedTask();
      var destination = navTask && navTask.destination;
      if (!destination || destination.latitude == null || destination.longitude == null) {
        return toast('Koordinat tujuan belum tersedia');
      }
      window.location.href = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(destination.latitude + ',' + destination.longitude);
      return;
    }

    if (action === 'availability') return toast('Availability Driver akan dihubungkan setelah API availability diterapkan.');
    if (action === 'next-stage-info') return toast('Tahap berikutnya mengikuti state Delivery dari server.');

    if (action === 'logout') {
      try { await api('/auth/logout', { method: 'POST' }); } catch (_) {}
      clearSession();
      window.location.href = '/login?target=driver';
    }
  }

  window.addEventListener('popstate', function () {
    state.page = 'tasks';
    refreshTasks(false).then(render);
  });

  loadDriver();
})();