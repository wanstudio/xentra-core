(function () {
  'use strict';

  var app = document.getElementById('driver-app');

  var state = {
    page: 'tasks',
    delivery: {
      id: '#XTR-1042',
      customer: 'Andi Pratama',
      address: 'Jl. Ahmad Yani No. 12',
      city: 'Bandar Lampung',
      items: 3,
      cod: 87000,
      tendered: 100000,
      branch: 'Xentra Bangjo Timur',
      pickupAddress: 'Jl. Soekarno Hatta No. 10',
      distance: '4.2 km',
      eta: '12 menit',
      status: 'assigned',
      accepted: false,
      pickedUp: false,
      onDelivery: false,
      delivered: false,
      codCollected: false,
      handedOver: false
    }
  };

  function rupiah(value) {
    return 'Rp' + Number(value || 0).toLocaleString('id-ID');
  }

  function icon(name) {
    var icons = {
      bell: '♧', back: '‹', arrow: '→', pin: '●', phone: '☎', chat: '◌',
      bag: '▣', clock: '◷', map: '⌖', check: '✓', close: '×', user: '♙',
      history: '◫', truck: '▱', settings: '⚙', nav: '➤', box: '□', info: 'i'
    };
    return icons[name] || '•';
  }

  function shell(title, body, active, options) {
    options = options || {};
    var header = options.back
      ? '<header class="driver-header"><div class="back-row" style="margin:0"><button class="back-btn" data-action="back">' + icon('back') + '</button><div class="back-title">' + title + '</div></div></header>'
      : '<header class="driver-header"><div class="brand"><span class="brand-mark">X</span><span>Xentra Driver</span></div><div class="header-meta"><span class="header-branch">Bangjo Timur</span><button class="icon-btn" aria-label="Notifikasi">' + icon('bell') + '</button></div></header>';

    var nav = options.hideNav ? '' :
      '<nav class="bottom-nav">' +
        navItem('tasks', 'Tugas', 'bag', active) +
        navItem('history', 'Riwayat', 'history', active) +
        navItem('profile', 'Profil', 'user', active) +
      '</nav>';

    app.innerHTML = '<div class="driver-shell">' + header + '<main class="content">' + body + '</main>' + nav + '</div><div id="toast" class="toast"></div>';
    bind();
  }

  function navItem(page, label, ico, active) {
    return '<button class="nav-item ' + (active === page ? 'active' : '') + '" data-page="' + page + '"><span class="nav-icon">' + icon(ico) + '</span><span>' + label + '</span></button>';
  }

  function taskCard(kind) {
    var d = state.delivery;
    if (kind === 'active') {
      return '<article class="card task-card">' +
        '<div class="task-top"><span class="task-id">' + d.id + '</span><span class="pill orange">Sedang Diantar</span></div>' +
        '<div class="customer-row"><span class="pin">' + icon('pin') + '</span><div><div class="customer-name">' + d.customer + '</div><div class="address">' + d.address + '<br>' + d.city + '</div></div></div>' +
        '<div class="meta-row"><span class="meta-item">' + icon('bag') + ' ' + d.items + ' item</span><span class="meta-item">🟧 COD ' + rupiah(d.cod) + '</span></div>' +
        '<button class="primary-btn" data-page="delivery-detail" style="margin-top:14px">Lihat Pengantaran ' + icon('arrow') + '</button>' +
      '</article>';
    }
    return '<article class="card task-card">' +
      '<div class="task-top"><span class="task-id">' + d.id + '</span><span class="pill orange">Tugas Baru</span></div>' +
      '<div class="customer-row"><span class="pin" style="background:#fff1ed;color:#e5484d">' + icon('pin') + '</span><div><div class="customer-name">' + d.customer + '</div><div class="address">' + d.address + '<br>' + d.city + '</div></div></div>' +
      '<div class="meta-row"><span class="meta-item">' + icon('bag') + ' ' + d.items + ' item</span><span class="meta-item">🟧 COD ' + rupiah(d.cod) + '</span></div>' +
      '<button class="primary-btn" data-page="new-task" style="margin-top:14px">Lihat Tugas ' + icon('arrow') + '</button>' +
    '</article>';
  }

  function renderTasks() {
    var d = state.delivery;
    var hasActive = d.accepted;
    var body = '<h1 class="screen-title">Tugas</h1><div class="screen-subtitle">Kelola pengantaran yang sedang Anda jalankan.</div>' +
      '<div class="status-card"><div class="status-dot">✓</div><div><div class="status-title">Tersedia</div><div class="status-copy">Siap menerima tugas baru</div></div></div>';

    if (hasActive) {
      body += '<div class="section-head"><div class="section-title">Tugas Aktif</div><span class="badge-count">1</span></div>' + taskCard('active');
    } else {
      body += '<div class="section-head"><div class="section-title">Tugas Baru</div><span class="badge-count">1</span></div>' + taskCard('new');
    }

    if (d.delivered) {
      body += '<div class="card compact"><div class="info-box success"><span>✓</span><div>Pengantaran ' + d.id + ' sudah selesai. COD sudah diterima dan menunggu serah terima ke Kasir.</div></div></div>';
    }

    shell('Tugas', body, 'tasks');
  }

  function renderNewTask() {
    var d = state.delivery;
    var body = '<div class="back-row"><button class="back-btn" data-action="back">‹</button><div class="back-title">Tugas Baru</div></div>' +
      '<div class="card">' +
        '<div class="task-top"><span class="task-id">Pengantaran ' + d.id + '</span><span class="pill orange">Menunggu Anda</span></div>' +
        '<div class="customer-row"><span class="pin">' + icon('pin') + '</span><div><div class="customer-name">' + d.customer + '</div><div class="address">' + d.address + '<br>' + d.city + '</div></div></div>' +
        '<div class="meta-row"><span class="meta-item">⌖ ' + d.distance + '</span><span class="meta-item">◷ ' + d.eta + '</span></div>' +
        '<div class="money-card"><div class="money-label">COD / Bayar di Tempat</div><div class="money">' + rupiah(d.cod) + '</div></div>' +
        '<div class="info-box"><span>i</span><div>Terima tugas jika Anda siap mengambil pesanan dari cabang dan mengantarkannya ke pelanggan.</div></div>' +
      '</div>' +
      '<div class="sticky-action"><div class="btn-row"><button class="danger-btn" data-action="reject">× Tolak</button><button class="primary-btn" data-action="accept">✓ Terima Tugas</button></div></div>';
    shell('Tugas Baru', body, 'tasks', {hideNav:true});
  }

  function renderDetail() {
    var d = state.delivery;
    var next = d.accepted && !d.pickedUp ? 'Ambil Pesanan' : (d.pickedUp && !d.onDelivery ? 'Mulai Antar' : 'Lihat Pengantaran');
    var action = d.accepted && !d.pickedUp ? 'pickup' : (d.pickedUp && !d.onDelivery ? 'start-delivery' : 'delivery-map');

    var body = '<div class="back-row"><button class="back-btn" data-action="back">‹</button><div class="back-title">Pengantaran ' + d.id + '</div></div>' +
      '<div class="card"><div class="info-box success"><span>✓</span><div><strong>Tugas Diterima</strong><br>Siap ambil pesanan di cabang.</div></div></div>' +
      '<div class="card"><div class="section-title">Tujuan</div><div class="customer-row"><span class="pin">' + icon('pin') + '</span><div style="flex:1"><div class="customer-name">' + d.customer + '</div><div class="address">' + d.address + '<br>' + d.city + '</div></div><button class="icon-btn">☎</button></div><button class="secondary-btn" data-action="navigate" style="margin-top:13px">⌖ Buka Navigasi</button></div>' +
      '<div class="card"><div class="section-title">Pesanan</div><div class="meta-row"><span class="meta-item">▣ ' + d.items + ' item</span><span class="meta-item">🟧 COD</span></div></div>' +
      '<div class="card"><div class="section-title">Pembayaran</div><div class="money">' + rupiah(d.cod) + '</div><div class="pill orange" style="margin-top:8px">Bayar di Tempat (COD)</div></div>' +
      '<div class="sticky-action"><button class="primary-btn" data-action="' + action + '">' + next + ' ' + icon('arrow') + '</button></div>';
    shell('Detail Pengantaran', body, 'tasks', {hideNav:true});
  }

  function renderPickup() {
    var d = state.delivery;
    var body = '<div class="back-row"><button class="back-btn" data-action="back">‹</button><div class="back-title">Ambil Pesanan</div></div>' +
      '<div class="card"><div class="customer-row" style="margin-top:0"><span class="pin" style="background:#fff0f4;color:#d64572">▣</span><div><div class="customer-name">' + d.branch + '</div><div class="address">' + d.pickupAddress + '<br>' + d.city + '</div></div></div></div>' +
      '<div class="card"><div class="task-top"><span class="task-id">Pesanan ' + d.id + '</span><span class="pill blue">' + d.items + ' item</span></div><div class="money-card"><div class="money-label">COD</div><div class="money">' + rupiah(d.cod) + '</div></div>' +
      '<div class="info-box"><span>i</span><div>Tunjukkan nomor pesanan ini ke staf untuk mengambil pesanan.</div></div>' +
      '<div style="font-size:30px;font-weight:900;text-align:center;padding:16px;background:#f7f9fc;border-radius:14px;margin-top:12px">' + d.id + '</div>' +
      '<div class="check-list"><div class="check"><span class="check-icon">✓</span>Jumlah item sesuai</div><div class="check"><span class="check-icon">✓</span>Kemasan dalam kondisi baik</div><div class="check"><span class="check-icon">✓</span>Minuman dan makanan lengkap</div></div></div>' +
      '<div class="sticky-action"><button class="primary-btn" data-action="confirm-pickup">Konfirmasi Pesanan Diambil ' + icon('arrow') + '</button></div>';
    shell('Ambil Pesanan', body, 'tasks', {hideNav:true});
  }

  function renderMap() {
    var d = state.delivery;
    var body = '<div class="hero-map"><div class="map-grid"></div><div class="nav-banner"><div class="nav-turn">↗ &nbsp; 200 m</div><div class="nav-road">Jl. Ahmad Yani</div></div><div class="route"></div><div class="map-pin a">A</div><div class="map-pin b">B</div><div class="map-controls"><button class="map-control">➤</button><button class="map-control">⌾</button></div></div>' +
      '<div class="map-sheet"><div class="route-stats"><div class="route-stat"><strong>5 menit</strong><span>ETA</span></div><div class="route-stat"><strong>2.1 km</strong><span>tersisa</span></div></div>' +
      '<div class="customer-row" style="margin-top:0"><span class="pin" style="background:#fff0f0;color:var(--red)">●</span><div style="flex:1"><div class="customer-name">' + d.customer + '</div><div class="address">' + d.address + '<br>' + d.city + '</div></div><button class="icon-btn">☎</button></div>' +
      '<button class="secondary-btn" data-action="navigate" style="margin-top:13px">⌖ Buka Navigasi</button>' +
      '<div class="sticky-action"><button class="primary-btn green" data-action="complete-delivery">Selesaikan Pengantaran ' + icon('arrow') + '</button></div></div>';
    shell('Sedang Mengantar', body, 'tasks', {hideNav:true});
  }

  function renderCod() {
    var d = state.delivery;
    var tendered = d.tendered;
    var change = Math.max(0, tendered - d.cod);
    var body = '<div class="back-row"><button class="back-btn" data-action="back">‹</button><div class="back-title">Konfirmasi COD</div></div>' +
      '<div class="card"><div class="money-card"><div class="money-label">Yang harus dibayar (COD)</div><div class="money">' + rupiah(d.cod) + '</div></div>' +
      '<label class="input-label">Uang diterima dari pelanggan</label><input id="tendered" class="money-input" inputmode="numeric" value="' + tendered + '">' +
      '<div class="change-box"><div class="change-label">Kembalian untuk pelanggan</div><div id="change" class="change-value">' + rupiah(change) + '</div></div>' +
      '<div class="info-box warning" style="margin-top:12px"><span>!</span><div>Uang tunai ini akan tetap berada pada Anda sampai diserahkan kepada Kasir.</div></div></div>' +
      '<div class="sticky-action"><button class="primary-btn" data-action="collect-cod">Konfirmasi Uang Diterima</button></div>';
    shell('Konfirmasi COD', body, 'tasks', {hideNav:true});
  }

  function renderComplete() {
    var d = state.delivery;
    var body = '<div class="card complete"><div class="summary-icon">✓</div><h2>Pengantaran Selesai</h2><p>Pelanggan telah menerima pesanan.</p></div>' +
      '<div class="card"><div class="customer-row" style="margin-top:0"><span class="pin">▣</span><div><div class="customer-name">Pesanan ' + d.id + '</div><div class="address">' + d.customer + '<br>' + d.address + '</div></div></div><div class="meta-row"><span class="meta-item">▣ ' + d.items + ' item</span><span class="meta-item">🟧 COD ' + rupiah(d.cod) + '</span><span class="pill green">✓ Uang diterima</span></div></div>' +
      '<div class="cash-custody"><div class="label">UANG COD DI TANGAN ANDA</div><div class="value">' + rupiah(d.cod) + '</div><div style="font-size:12px;color:#8b520b;margin-top:5px">Serahkan uang ini kepada Kasir untuk penyelesaian pembayaran.</div></div>' +
      '<div class="sticky-action"><button class="primary-btn" data-action="back-tasks">Kembali ke Tugas</button></div>';
    shell('Pengantaran Selesai', body, 'tasks', {hideNav:true});
  }

  function renderHistory() {
    var body = '<h1 class="screen-title">Riwayat Pengantaran</h1><div class="screen-subtitle">Pengantaran yang sudah selesai.</div>' +
      '<div class="history-group"><div class="history-date">Hari ini <span style="font-weight:500">• 6 Oktober 2026</span></div>' +
      historyRow('#XTR-1042','Andi Pratama','14:32','COD Rp87.000') +
      historyRow('#XTR-1041','Budi Santoso','12:10','Online') +
      historyRow('#XTR-1040','Siti Rahmawati','10:05','COD Rp65.000') +
      '</div><div class="history-group"><div class="history-date">Kemarin <span style="font-weight:500">• 5 Oktober 2026</span></div>' +
      historyRow('#XTR-1039','Rina Marlina','17:20','Online') + '</div>';
    shell('Riwayat', body, 'history');
  }

  function historyRow(id, name, time, payment) {
    return '<div class="history-row"><span class="history-pin">●</span><div class="history-main"><div class="history-id">' + id + '</div><div class="history-name">' + name + '</div><div class="history-time">' + time + '</div></div><div class="history-right"><span class="pill green">Terkirim</span><div class="amount">' + payment + '</div></div><span class="chevron">›</span></div>';
  }

  function renderProfile() {
    var body = '<h1 class="screen-title">Profil</h1><div class="screen-subtitle">Identitas dan pengaturan operasional.</div>' +
      '<div class="card"><div class="profile-head"><div class="avatar">👨‍✈️</div><div><div class="profile-name">Driver</div><div class="profile-role">Driver • Xentra Bangjo Timur</div></div></div></div>' +
      '<div class="profile-list">' +
        profileItem('●','Status','Tersedia','availability') +
        profileItem('▱','Kendaraan','Motor — BE 1234 XX') +
        profileItem('➤','Aplikasi Navigasi','Google Maps','navigate') +
        profileItem('?','Bantuan') +
        profileItem('i','Tentang Xentra') +
        profileItem('↪','Keluar','', 'logout') +
      '</div>';
    shell('Profil', body, 'profile');
  }

  function profileItem(i, label, value, action) {
    return '<button class="profile-item" data-action="' + (action || '') + '"><span class="left">' + i + '</span><span class="body"><span class="label">' + label + '</span>' + (value ? '<span class="value">' + value + '</span>' : '') + '</span><span class="chevron">›</span></button>';
  }

  function toast(message) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 1800);
  }

  function go(page) {
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
      el.addEventListener('click', function () { go(el.getAttribute('data-page')); });
    });

    app.querySelectorAll('[data-action]').forEach(function (el) {
      el.addEventListener('click', function () { handleAction(el.getAttribute('data-action')); });
    });

    var input = document.getElementById('tendered');
    if (input) {
      input.addEventListener('input', function () {
        var value = Number(String(input.value).replace(/[^0-9]/g, '')) || 0;
        state.delivery.tendered = value;
        var change = Math.max(0, value - state.delivery.cod);
        var out = document.getElementById('change');
        if (out) out.textContent = rupiah(change);
      });
    }
  }

  function handleAction(action) {
    var d = state.delivery;
    if (action === 'back') return go('tasks');
    if (action === 'back-tasks') return go('tasks');

    if (action === 'accept') {
      d.accepted = true;
      toast('Tugas diterima');
      return go('delivery-detail');
    }

    if (action === 'reject') {
      toast('Tugas ditolak pada demo UI');
      return go('tasks');
    }

    if (action === 'pickup') return go('pickup');

    if (action === 'confirm-pickup') {
      d.pickedUp = true;
      toast('Pesanan berhasil diambil');
      return go('delivery-detail');
    }

    if (action === 'start-delivery') {
      d.onDelivery = true;
      toast('Pengantaran dimulai');
      return go('map');
    }

    if (action === 'delivery-map') return go('map');

    if (action === 'complete-delivery') {
      d.delivered = true;
      if (d.cod) return go('cod');
      return go('complete');
    }

    if (action === 'collect-cod') {
      var tendered = Number(d.tendered || 0);
      if (tendered < d.cod) {
        toast('Uang yang diterima kurang dari total COD');
        return;
      }
      d.codCollected = true;
      toast('COD diterima');
      return go('complete');
    }

    if (action === 'navigate') {
      toast('Navigasi akan dihubungkan ke aplikasi pilihan Driver');
      return;
    }

    if (action === 'availability') {
      toast('Pengaturan availability akan dihubungkan ke akun Driver');
      return;
    }

    if (action === 'logout') {
      toast('Logout akan dihubungkan ke session Driver');
    }
  }

  render();
})();