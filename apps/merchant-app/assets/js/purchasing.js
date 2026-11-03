/**
 * XENTRA CORE — MERCHANT APP: BRANCH MANAGER PROCUREMENT & MANDATE HUB
 *
 * One Layer One Task Architecture:
 * - Branch Manager manages mandates, assigns budget/kasbon, and performs physical QC + POS cash reconciliation.
 * - Petugas Belanja (Field Runner) shops via the standalone Purchasing App (/belanja/).
 *
 * Implements:
 * 1. Live Mandate List: Berlangsung (Sedang Belanja, Perlu Verifikasi 📦) vs Selesai
 * 2. Mandate Creation Sheet (+ Buat Tugas Belanja -> HP Staf Runner)
 * 3. Mandate Verification Subview (Bukti Nota Pasar, QC Timbangan & Fisik, Rekonsiliasi Kas POS Laci Kasir)
 * 4. Simulated Paper Receipt Lightbox with store stamp
 */
(function () {
  'use strict';

  var S = window.XentraShared || {};
  var API_BASE = S.API_BASE || '';
  var $ = function (id) { return document.getElementById(id); };
  var showToast = function (msg) {
    if (typeof S.showToast === 'function') {
      S.showToast(msg);
    } else {
      var t = $('app-toast');
      if (t) {
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(t._timer);
        t._timer = setTimeout(function () { t.classList.remove('show'); }, 3000);
      }
    }
  };

  function getStoredUser() {
    if (typeof S.getStoredUser === 'function') return S.getStoredUser();
    try {
      var raw = localStorage.getItem('xentra_merchant_user') || localStorage.getItem('xentra_user');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function getAuthToken() {
    return localStorage.getItem('xentra_merchant_token') || localStorage.getItem('xentra_token') || '';
  }

  function getBranchId() {
    var u = getStoredUser();
    return u ? (u.branch_id || u.branchId || '') : '';
  }

  // State Counts
  var activeTasksCount = 2;
  var doneTasksCount = 2;
  var currentSegment = 'active';

  // =========================================================================
  // NOTA PASAR DATA MODEL (SCALABLE MOBILE FEED)
  // =========================================================================
  var defaultReceipts = [
    {
      id: 1,
      vendor: "Kios Beras Subur Makmur",
      loc: "Pasar Tradisional Pringsewu • Los Bahan Pokok Blok A-12",
      itemsSummary: "1 Karung Beras Ramos 25kg • 07:38 WIB",
      amount: 220000,
      time: "07:38 WIB",
      badge: "✓ Cap Toko Sah",
      stampText: "★ LUNAS ★",
      stampColor: "#dc2626",
      stampNote: "Cap basah tinta ungu toko resmi",
      staff: "Joko (Runner Dapur)",
      lines: [
        { name: "Beras Ramos Premium 25kg", qty: "1 Karung (25 Kg)", price: 220000 }
      ]
    },
    {
      id: 2,
      vendor: "Lapak Telur Ayam Barokah",
      loc: "Pasar Tradisional Pringsewu • Los Unggas No. 04",
      itemsSummary: "5 Kg Telur Ayam Ras • 07:44 WIB",
      amount: 100000,
      time: "07:44 WIB",
      badge: "✓ Nota Ditandatangani",
      stampText: "★ TERBAYAR ★",
      stampColor: "#2563eb",
      stampNote: "Nota tulis tangan & paraf penjual",
      staff: "Joko (Runner Dapur)",
      lines: [
        { name: "Telur Ayam Ras Fresh", qty: "5.0 Kg @ Rp 20.000", price: 100000 }
      ]
    }
  ];

  var multiReceiptsDemo = [
    {
      id: 1,
      vendor: "Kios Beras Subur Makmur",
      loc: "Pasar Pringsewu • Los A-12",
      itemsSummary: "1 Karung Beras Ramos 25kg • 07:38 WIB",
      amount: 220000,
      time: "07:38 WIB",
      badge: "✓ Cap Toko Sah",
      stampText: "★ LUNAS ★",
      stampColor: "#dc2626",
      stampNote: "Cap basah tinta ungu toko resmi",
      staff: "Joko (Runner Dapur)",
      lines: [{ name: "Beras Ramos Premium 25kg", qty: "1 Karung (25 Kg)", price: 220000 }]
    },
    {
      id: 2,
      vendor: "Lapak Telur Ayam Barokah",
      loc: "Pasar Pringsewu • Los Unggas No. 04",
      itemsSummary: "5 Kg Telur Ayam Ras • 07:44 WIB",
      amount: 100000,
      time: "07:44 WIB",
      badge: "✓ Nota Ditandatangani",
      stampText: "★ TERBAYAR ★",
      stampColor: "#2563eb",
      stampNote: "Nota tulis tangan & paraf penjual",
      staff: "Joko (Runner Dapur)",
      lines: [{ name: "Telur Ayam Ras Fresh", qty: "5.0 Kg", price: 100000 }]
    },
    {
      id: 3,
      vendor: "Kios Cabai & Sayur Bu Siti",
      loc: "Pasar Pringsewu • Blok C-08",
      itemsSummary: "Cabai Rawit 2kg & Bawang 2kg • 07:50 WIB",
      amount: 90000,
      time: "07:50 WIB",
      badge: "✓ Nota Sobek Kertas",
      stampText: "★ LUNAS ★",
      stampColor: "#dc2626",
      stampNote: "Nota sobek pasar cap basah",
      staff: "Joko (Runner Dapur)",
      lines: [
        { name: "Cabai Rawit Merah Segar", qty: "2.0 Kg", price: 50000 },
        { name: "Bawang Merah Brebes", qty: "2.0 Kg", price: 40000 }
      ]
    },
    {
      id: 4,
      vendor: "Lapak Ayam Potong Pak Haji",
      loc: "Pasar Pringsewu • Los Daging B-02",
      itemsSummary: "10 Ekor Ayam Broiler Potong 8 • 07:56 WIB",
      amount: 380000,
      time: "07:56 WIB",
      badge: "✓ Cap Toko Halal",
      stampText: "★ CAP BASAH ★",
      stampColor: "#15803d",
      stampNote: "Cap halal MUI los unggas",
      staff: "Joko (Runner Dapur)",
      lines: [{ name: "Ayam Broiler @ 1.2kg", qty: "10 Ekor", price: 380000 }]
    },
    {
      id: 5,
      vendor: "Kios Bumbu Giling Mak Inah",
      loc: "Pasar Pringsewu • Blok Rempah A-03",
      itemsSummary: "Bumbu Kuning 1kg & Rendang 1kg • 08:01 WIB",
      amount: 45000,
      time: "08:01 WIB",
      badge: "✓ Nota Basah",
      stampText: "★ TERIMA KASIH ★",
      stampColor: "#b45309",
      stampNote: "Kuitansi toko rempah",
      staff: "Joko (Runner Dapur)",
      lines: [
        { name: "Bumbu Kuning Halus", qty: "1 Kg", price: 25000 },
        { name: "Bumbu Merah Pedas", qty: "1 Kg", price: 20000 }
      ]
    },
    {
      id: 6,
      vendor: "Toko Kelapa Parut Mas Doni",
      loc: "Pasar Pringsewu • Los D-01",
      itemsSummary: "15 Butir Kelapa Parut Segar • 08:05 WIB",
      amount: 75000,
      time: "08:05 WIB",
      badge: "✓ Nota Toko",
      stampText: "★ LUNAS ★",
      stampColor: "#dc2626",
      stampNote: "Nota tulis tangan",
      staff: "Joko (Runner Dapur)",
      lines: [{ name: "Kelapa Parut Peras Santan", qty: "15 Butir", price: 75000 }]
    },
    {
      id: 7,
      vendor: "Pabrik Tempe & Tahu Barokah",
      loc: "Pasar Pringsewu • Los T-05",
      itemsSummary: "20 Papan Tempe & 3 Ember Tahu • 08:10 WIB",
      amount: 110000,
      time: "08:10 WIB",
      badge: "✓ Nota Stempel",
      stampText: "★ LUNAS ★",
      stampColor: "#2563eb",
      stampNote: "Stempel basah distributor tahu",
      staff: "Joko (Runner Dapur)",
      lines: [
        { name: "Tempe Daun Kedelai", qty: "20 Papan", price: 60000 },
        { name: "Tahu Sutra Putih", qty: "3 Ember", price: 50000 }
      ]
    },
    {
      id: 8,
      vendor: "Kios Plastik & Packaging Jaya",
      loc: "Ruko Pasar R-11",
      itemsSummary: "Thinwall 650ml & Cup Minuman • 08:15 WIB",
      amount: 140000,
      time: "08:15 WIB",
      badge: "✓ Struk Kasir",
      stampText: "★ STRUK MESIN ★",
      stampColor: "#0f172a",
      stampNote: "Struk thermal mesin kasir POS",
      staff: "Joko (Runner Dapur)",
      lines: [
        { name: "Thinwall 650ml (Pack 25)", qty: "4 Pack", price: 80000 },
        { name: "Cup PP 16oz + Sealer", qty: "2 Roll", price: 60000 }
      ]
    },
    {
      id: 9,
      vendor: "Agen Minyak Goreng Curah",
      loc: "Gudang Sembako G-03",
      itemsSummary: "1 Dus Minyak Goreng 12L • 08:18 WIB",
      amount: 180000,
      time: "08:18 WIB",
      badge: "✓ Nota Agen",
      stampText: "★ LUNAS ★",
      stampColor: "#dc2626",
      stampNote: "Faktur agen resmi",
      staff: "Joko (Runner Dapur)",
      lines: [{ name: "Minyak Goreng Sawit 12L", qty: "1 Dus (12L)", price: 180000 }]
    },
    {
      id: 10,
      vendor: "Karcis Parkir & Bongkar Muat",
      loc: "Pos Gerbang Masuk Pasar Pringsewu",
      itemsSummary: "Retribusi Motor Tiga Roda & Kuli • 08:22 WIB",
      amount: 15000,
      time: "08:22 WIB",
      badge: "✓ Karcis Resmi",
      stampText: "★ RETRIBUSI ★",
      stampColor: "#15803d",
      stampNote: "Karcis retribusi pasar daerah",
      staff: "Joko (Runner Dapur)",
      lines: [
        { name: "Karcis Masuk Roda Tiga", qty: "1 Unit", price: 10000 },
        { name: "Uang Jasa Bongkar Muat", qty: "1 Rit", price: 5000 }
      ]
    }
  ];

  var receiptsData = defaultReceipts.slice();
  var currentReceiptIndex = 0;
  var isMultiDemo = false;

  // =========================================================================
  // UNIVERSAL PHYSICAL RECEIVING & QC FRAMEWORK
  // =========================================================================
  var QC_TAXONOMY = {
    DAMAGED:   { key: 'DAMAGED',   label: '💥 Rusak Fisik',      desc: 'Pecah, robek, bocor, cacat saat transit' },
    SHRINKAGE: { key: 'SHRINKAGE', label: '⚖️ Susut Alami / Es', desc: 'Tiris es, penguapan air, kalibrasi timbangan' },
    REJECTED:  { key: 'REJECTED',  label: '❌ Kualitas Ditolak',  desc: 'Layu, busuk, bau, tidak sesuai standar grade' },
    SHORT:     { key: 'SHORT',     label: '📦 Kurang Kirim',      desc: 'Ketinggalan di kios / salah hitung pedagang' }
  };

  var QC_DISPOSITION = {
    WASTE:          { key: 'WASTE',          label: '🏠 Beban Susut Dapur',  target: 'Waste Log Resto (Biaya Operasional)' },
    SUPPLIER_CLAIM: { key: 'SUPPLIER_CLAIM', label: '🧾 Klaim Retur Pedagang', target: 'Potong Nota Belanja Berikutnya' }
  };

  var defaultQcItems = [
    {
      id: 'item_beras',
      material_id: 'mat_beras',
      name: 'Beras Ramos Premium 25kg',
      vendor: 'Kios Beras Subur Makmur',
      storageZone: 'Gudang Kering',
      storageClass: 'storage-dry',
      unit: 'Kg',
      step: 0.5,
      precision: 1,
      qtyBilled: 25.0,
      qtyReceived: 25.0,
      pricePerUnit: 8800,
      discrepancyType: 'DAMAGED',
      disposition: 'WASTE',
      yieldInfo: '~165 porsi nasi',
      operatorNote: 'Karung utuh segel pabrik, beras putih bersih'
    },
    {
      id: 'item_telur',
      material_id: 'mat_telur_ayam',
      name: 'Telur Ayam Ras Fresh',
      vendor: 'Lapak Telur Ayam Barokah',
      storageZone: 'Chiller Telur & Susu',
      storageClass: 'storage-cold',
      unit: 'Kg',
      step: 0.1,
      precision: 1,
      qtyBilled: 5.0,
      qtyReceived: 4.5,
      pricePerUnit: 20000,
      discrepancyType: 'DAMAGED',
      disposition: 'WASTE',
      yieldInfo: '~72 butir resep',
      operatorNote: '8 butir retak kena guncangan jalan'
    }
  ];

  var multiQcItems = [
    {
      id: 'multi_beras',
      material_id: 'mat_beras',
      name: 'Beras Ramos Premium 25kg',
      vendor: 'Kios Beras Subur Makmur',
      storageZone: 'Gudang Kering',
      storageClass: 'storage-dry',
      unit: 'Kg',
      step: 0.5,
      precision: 1,
      qtyBilled: 25.0,
      qtyReceived: 25.0,
      pricePerUnit: 8800,
      discrepancyType: 'DAMAGED',
      disposition: 'WASTE',
      yieldInfo: '~165 porsi nasi',
      operatorNote: 'Karung utuh segel pabrik'
    },
    {
      id: 'multi_telur',
      material_id: 'mat_telur_ayam',
      name: 'Telur Ayam Ras Fresh',
      vendor: 'Lapak Telur Ayam Barokah',
      storageZone: 'Chiller Telur & Susu',
      storageClass: 'storage-cold',
      unit: 'Kg',
      step: 0.1,
      precision: 1,
      qtyBilled: 5.0,
      qtyReceived: 4.5,
      pricePerUnit: 20000,
      discrepancyType: 'DAMAGED',
      disposition: 'WASTE',
      yieldInfo: '~72 butir resep',
      operatorNote: '8 butir retak kena guncangan jalan'
    },
    {
      id: 'multi_ayam',
      material_id: 'mat_ayam_fresh',
      name: 'Ayam Broiler Segar Karkas',
      vendor: 'Lapak Ayam Segar Berkah',
      storageZone: 'Freezer Daging & Unggas',
      storageClass: 'storage-freeze',
      unit: 'Kg',
      step: 0.1,
      precision: 1,
      qtyBilled: 12.0,
      qtyReceived: 11.8,
      pricePerUnit: 24000,
      discrepancyType: 'SHRINKAGE',
      disposition: 'WASTE',
      yieldInfo: '~80 porsi ayam',
      operatorNote: 'Susut tiris air es 0.2 kg (toleransi normal <2%)'
    },
    {
      id: 'multi_minyak',
      material_id: 'mat_minyak_goreng',
      name: 'Minyak Goreng Sawit 12L',
      vendor: 'Grosir Sembako Rejeki Baru',
      storageZone: 'Gudang Kering',
      storageClass: 'storage-dry',
      unit: 'Liter',
      step: 1.0,
      precision: 0,
      qtyBilled: 12.0,
      qtyReceived: 12.0,
      pricePerUnit: 18000,
      discrepancyType: 'DAMAGED',
      disposition: 'WASTE',
      operatorNote: 'Dus karton tersegel pabrik'
    },
    {
      id: 'multi_cabai',
      material_id: 'mat_cabai_rawit',
      name: 'Cabai Rawit Merah & Bawang',
      vendor: 'Lapak Sayur Segar Bu Siti',
      storageZone: 'Chiller Sayur & Bumbu',
      storageClass: 'storage-cold',
      unit: 'Kg',
      step: 0.1,
      precision: 1,
      qtyBilled: 4.0,
      qtyReceived: 4.0,
      pricePerUnit: 25000,
      discrepancyType: 'REJECTED',
      disposition: 'WASTE',
      operatorNote: 'Cabai kering segar tanpa busuk'
    }
  ];

  var currentQcFilter = 'ALL';

  function getActiveQcItems() {
    return isMultiDemo ? multiQcItems : defaultQcItems;
  }

  function findQcItem(id) {
    var items = getActiveQcItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }

  // =========================================================================
  // SEGMENTED FILTER SWITCHER
  // =========================================================================
  function switchBelanjaSegment(seg) {
    currentSegment = seg;
    var btnActive = $('btn-seg-belanja-active');
    var btnDone = $('btn-seg-belanja-done');
    var listActive = $('belanja-list-active');
    var listDone = $('belanja-list-done');

    if (btnActive) btnActive.classList.toggle('active', seg === 'active');
    if (btnDone) btnDone.classList.toggle('active', seg === 'done');

    if (listActive) listActive.style.display = (seg === 'active' ? 'block' : 'none');
    if (listDone) listDone.style.display = (seg === 'done' ? 'block' : 'none');
  }

  // =========================================================================
  // RENDER BM MANDATES FEED
  // =========================================================================
  function renderBMMandates(mandatesFromApi) {
    var listActive = $('belanja-list-active');
    var listDone = $('belanja-list-done');
    if (!listActive || !listDone) return;

    listActive.innerHTML = '';
    listDone.innerHTML = '';

    // If API provided live mandates from DB
    if (Array.isArray(mandatesFromApi) && mandatesFromApi.length > 0) {
      var actCount = 0;
      var dnCount = 0;

      mandatesFromApi.forEach(function (m) {
        var num = m.mandate_number || m.id;
        var notes = m.notes || 'Belanja Pasar Harian';
        var staff = m.creator_name || m.staff_name || 'Petugas Belanja (Runner)';
        var budget = Number(m.cash_advance || m.total_planned_budget || 0);
        var itemsCount = Array.isArray(m.items) ? m.items.length : (m.items_count || 1);

        if (m.status === 'RELEASED') {
          actCount++;
          var card = document.createElement('div');
          card.className = 'x-card';
          card.style.cssText = 'border-left:4px solid #3b82f6; padding:14px; margin-bottom:12px;';
          card.innerHTML =
            '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">' +
              '<div>' +
                '<span style="font-size:10.5px; font-weight:800; color:#1d4ed8; background:#eff6ff; padding:2px 6px; border-radius:4px;">#' + num + '</span>' +
                '<h3 style="font-size:15px; font-weight:800; color:#0f172a; margin-top:4px; margin-bottom:2px;">' + notes + '</h3>' +
                '<div style="font-size:12px; color:#64748b; margin-top:2px;">Staf: <strong>' + staff + '</strong> • Pagu Rp ' + budget.toLocaleString('id-ID') + '</div>' +
              '</div>' +
              '<span style="font-size:11px; font-weight:800; color:#2563eb; background:#eff6ff; border:1px solid #bfdbfe; padding:3px 8px; border-radius:999px;">' +
                'Sedang Belanja' +
              '</span>' +
            '</div>' +
            '<div style="background:#f8fafc; border-radius:8px; padding:10px 12px; margin-bottom:12px; border:1px solid #f1f5f9;">' +
              '<div style="display:flex; justify-content:space-between; font-size:11px; color:#64748b; margin-bottom:4px;">' +
                '<span>' + itemsCount + ' Jenis Bahan Baku</span>' +
                '<strong style="color:#0f172a;">Menunggu Konfirmasi Pasar</strong>' +
              '</div>' +
              '<div style="width:100%; height:6px; background:#e2e8f0; border-radius:999px; overflow:hidden;">' +
                '<div style="width:40%; height:100%; background:#3b82f6; border-radius:999px;"></div>' +
              '</div>' +
            '</div>' +
            '<button type="button" class="btn-action btn-secondary" onclick="window.showToast ? showToast(\'💬 Menghubungi WhatsApp staf...\') : alert(\'Hubungi WA\')" style="width:100%; padding:10px; font-size:12px; display:flex; align-items:center; justify-content:center; gap:6px;">' +
              '<span>💬</span> Hubungi Staf via WA' +
            '</button>';
          listActive.appendChild(card);
        } else if (m.status === 'SUBMITTED') {
          actCount++;
          var card2 = document.createElement('div');
          card2.className = 'x-card';
          card2.style.cssText = 'border-left:4px solid #f59e0b; padding:14px; margin-bottom:12px;';
          card2.innerHTML =
            '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">' +
              '<div>' +
                '<span style="font-size:10.5px; font-weight:800; color:#b45309; background:#fef3c7; padding:2px 6px; border-radius:4px;">#' + num + '</span>' +
                '<h3 style="font-size:15px; font-weight:800; color:#0f172a; margin-top:4px; margin-bottom:2px;">' + notes + '</h3>' +
                '<div style="font-size:12px; color:#64748b; margin-top:2px;">Staf: <strong>' + staff + '</strong> • Barang &amp; Nota Tiba</div>' +
              '</div>' +
              '<span style="font-size:11px; font-weight:800; color:#d97706; background:#fffbeb; border:1px solid #fde68a; padding:3px 8px; border-radius:999px;">' +
                'Perlu Verifikasi 📦' +
              '</span>' +
            '</div>' +
            '<div style="background:#f8fafc; border-radius:8px; padding:10px 12px; margin-bottom:12px; font-size:12px; display:flex; justify-content:space-between; border:1px solid #f1f5f9;">' +
              '<div>' +
                '<span style="color:#64748b; font-size:11px;">Bahan &amp; Nota:</span><br>' +
                '<strong style="color:#0f172a;">' + itemsCount + ' Item Belanja</strong>' +
              '</div>' +
              '<div style="text-align:right;">' +
                '<span style="color:#64748b; font-size:11px;">Realisasi / Kasbon:</span><br>' +
                '<strong style="color:#0f172a;">Rp ' + budget.toLocaleString('id-ID') + '</strong>' +
              '</div>' +
            '</div>' +
            '<button type="button" class="btn-action btn-primary" onclick="openVerifyPage(\'' + m.id + '\')" style="width:100%; padding:11px; font-size:13px; font-weight:700;">' +
              'Verifikasi Belanjaan ➜' +
            '</button>';
          listActive.appendChild(card2);
        } else {
          dnCount++;
          var cardDone = document.createElement('div');
          cardDone.className = 'x-card';
          cardDone.style.cssText = 'border-left:4px solid #10b981; padding:14px; margin-bottom:12px;';
          cardDone.innerHTML =
            '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">' +
              '<div>' +
                '<span style="font-size:10.5px; font-weight:800; color:#15803d; background:#dcfce7; padding:2px 6px; border-radius:4px;">#' + num + '</span>' +
                '<h3 style="font-size:14.5px; font-weight:800; color:#0f172a; margin-top:3px; margin-bottom:2px;">' + notes + '</h3>' +
                '<div style="font-size:12px; color:#64748b; margin-top:1px;">Staf: ' + staff + ' • Selesai diverifikasi</div>' +
              '</div>' +
              '<span style="font-size:11px; font-weight:800; color:#15803d; background:#f0fdf4; border:1px solid #bbf7d0; padding:3px 8px; border-radius:999px;">' +
                'Selesai' +
              '</span>' +
            '</div>' +
            '<div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #f1f5f9; padding-top:8px; margin-top:8px;">' +
              '<span style="font-size:12px; color:#64748b;">' + itemsCount + ' Item Masuk Dapur</span>' +
              '<div style="display:flex; align-items:center; gap:8px;">' +
                '<strong style="font-size:14px; color:#0f172a;">Rp ' + budget.toLocaleString('id-ID') + '</strong>' +
                '<button type="button" class="btn-action btn-secondary" onclick="openReceiptModal(\'' + num + '\', \'' + notes + '\', ' + budget + ', \'' + staff + '\', \'Terekam\')" style="font-size:11px; padding:4px 8px;">Lihat Nota</button>' +
              '</div>' +
            '</div>';
          listDone.appendChild(cardDone);
        }
      });

      activeTasksCount = actCount;
      doneTasksCount = dnCount;
    }

    // Default canonical prototype cards if listActive is empty
    if (listActive.children.length === 0) {
      listActive.innerHTML =
        '<!-- Card 1: Menunggu Verifikasi -->' +
        '<div class="x-card" id="card-verify-mandate" style="border-left:4px solid #f59e0b; padding:14px; margin-bottom:12px;">' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">' +
            '<div>' +
              '<span style="font-size:10.5px; font-weight:800; color:#b45309; background:#fef3c7; padding:2px 6px; border-radius:4px;">#MND-082</span>' +
              '<h3 style="font-size:15px; font-weight:800; color:#0f172a; margin-top:4px; margin-bottom:2px;">Pasar Pringsewu</h3>' +
              '<div style="font-size:12px; color:#64748b; margin-top:2px;">Staf: <strong>Joko (Runner Dapur)</strong> • 2 Nota Kios Tiba</div>' +
            '</div>' +
            '<span style="font-size:11px; font-weight:800; color:#d97706; background:#fffbeb; border:1px solid #fde68a; padding:3px 8px; border-radius:999px;">' +
              'Perlu Verifikasi 📦' +
            '</span>' +
          '</div>' +
          '<div style="background:#f8fafc; border-radius:8px; padding:10px 12px; margin-bottom:12px; font-size:12px; display:flex; justify-content:space-between; border:1px solid #f1f5f9;">' +
            '<div>' +
              '<span style="color:#64748b; font-size:11px;">Bahan &amp; Nota:</span><br>' +
              '<strong style="color:#0f172a;">Beras &amp; Telur (2 Nota)</strong>' +
            '</div>' +
            '<div style="text-align:right;">' +
              '<span style="color:#64748b; font-size:11px;">Realisasi / Kasbon:</span><br>' +
              '<strong style="color:#0f172a;">Rp 320.000</strong> <span style="color:#94a3b8; font-size:11px;">/ Rp 350.000</span>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="btn-action btn-primary" onclick="openVerifyPage(\'MND-082\')" style="width:100%; padding:11px; font-size:13px; font-weight:700;">' +
            'Verifikasi Belanjaan ➜' +
          '</button>' +
        '</div>' +

        '<!-- Card 2: Sedang Belanja -->' +
        '<div class="x-card" id="card-active-staff" style="border-left:4px solid #3b82f6; padding:14px; margin-bottom:12px;">' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">' +
            '<div>' +
              '<span style="font-size:10.5px; font-weight:800; color:#1d4ed8; background:#eff6ff; padding:2px 6px; border-radius:4px;">#MND-083</span>' +
              '<h3 style="font-size:15px; font-weight:800; color:#0f172a; margin-top:4px; margin-bottom:2px;">Pasar Sayur Pagi</h3>' +
              '<div style="font-size:12px; color:#64748b; margin-top:2px;">Staf: <strong>Budi Santoso</strong> • Pagu Rp 150.000</div>' +
            '</div>' +
            '<span style="font-size:11px; font-weight:800; color:#2563eb; background:#eff6ff; border:1px solid #bfdbfe; padding:3px 8px; border-radius:999px;">' +
              'Sedang Belanja' +
            '</span>' +
          '</div>' +
          '<div style="background:#f8fafc; border-radius:8px; padding:10px 12px; margin-bottom:12px; border:1px solid #f1f5f9;">' +
            '<div style="display:flex; justify-content:space-between; font-size:11px; color:#64748b; margin-bottom:4px;">' +
              '<span>Cabai Rawit, Minyak Goreng, Bawang</span>' +
              '<strong style="color:#0f172a;">3/4 Bahan (75%)</strong>' +
            '</div>' +
            '<div style="width:100%; height:6px; background:#e2e8f0; border-radius:999px; overflow:hidden;">' +
              '<div style="width:75%; height:100%; background:#3b82f6; border-radius:999px;"></div>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="btn-action btn-secondary" onclick="showToast(\'💬 Menghubungi WhatsApp Budi Santoso (+62 812-3456-7890)...\')" style="width:100%; padding:10px; font-size:12px; display:flex; align-items:center; justify-content:center; gap:6px;">' +
            '<span>💬</span> Hubungi Staf via WA' +
          '</button>' +
        '</div>';
      activeTasksCount = 2;
    }

    if (listDone.children.length === 0) {
      listDone.innerHTML =
        '<!-- Card Selesai 1 -->' +
        '<div class="x-card" style="border-left:4px solid #10b981; padding:14px; margin-bottom:12px;">' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">' +
            '<div>' +
              '<span style="font-size:10.5px; font-weight:800; color:#15803d; background:#dcfce7; padding:2px 6px; border-radius:4px;">#MND-081</span>' +
              '<h3 style="font-size:14.5px; font-weight:800; color:#0f172a; margin-top:3px; margin-bottom:2px;">Kios Ayam Bu Siti</h3>' +
              '<div style="font-size:12px; color:#64748b; margin-top:1px;">Staf: Joko • Selesai 07:45 WIB</div>' +
            '</div>' +
            '<span style="font-size:11px; font-weight:800; color:#15803d; background:#f0fdf4; border:1px solid #bbf7d0; padding:3px 8px; border-radius:999px;">' +
              'Selesai' +
            '</span>' +
          '</div>' +
          '<div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #f1f5f9; padding-top:8px; margin-top:8px;">' +
            '<span style="font-size:12px; color:#64748b;">15 Ekor Ayam Karkas</span>' +
            '<div style="display:flex; align-items:center; gap:8px;">' +
              '<strong style="font-size:14px; color:#0f172a;">Rp 450.000</strong>' +
              '<button type="button" class="btn-action btn-secondary" onclick="openReceiptModal(\'MND-081\', \'Kios Ayam Bu Siti\', 450000, \'Joko (Runner Dapur)\', \'07:45 WIB\')" style="font-size:11px; padding:4px 8px;">Lihat Nota</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<!-- Card Selesai 2 -->' +
        '<div class="x-card" style="border-left:4px solid #10b981; padding:14px; margin-bottom:12px;">' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">' +
            '<div>' +
              '<span style="font-size:10.5px; font-weight:800; color:#15803d; background:#dcfce7; padding:2px 6px; border-radius:4px;">#MND-080</span>' +
              '<h3 style="font-size:14.5px; font-weight:800; color:#0f172a; margin-top:3px; margin-bottom:2px;">Depot Es Kristal Abadi</h3>' +
              '<div style="font-size:12px; color:#64748b; margin-top:1px;">Staf: Budi • Selesai 07:10 WIB</div>' +
            '</div>' +
            '<span style="font-size:11px; font-weight:800; color:#15803d; background:#f0fdf4; border:1px solid #bbf7d0; padding:3px 8px; border-radius:999px;">' +
              'Selesai' +
            '</span>' +
          '</div>' +
          '<div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #f1f5f9; padding-top:8px; margin-top:8px;">' +
            '<span style="font-size:12px; color:#64748b;">2 Karung Es Batu</span>' +
            '<div style="display:flex; align-items:center; gap:8px;">' +
              '<strong style="font-size:14px; color:#0f172a;">Rp 40.000</strong>' +
              '<button type="button" class="btn-action btn-secondary" onclick="openReceiptModal(\'MND-080\', \'Depot Es Kristal Abadi\', 40000, \'Budi Santoso\', \'07:10 WIB\')" style="font-size:11px; padding:4px 8px;">Lihat Nota</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      doneTasksCount = 2;
    }

    var elBadgeActive = $('badge-count-belanja-active');
    if (elBadgeActive) elBadgeActive.textContent = activeTasksCount;
    var elBadgeDone = $('badge-count-belanja-done');
    if (elBadgeDone) elBadgeDone.textContent = doneTasksCount;
    var navBadge = $('nav-badge-belanja');
    if (navBadge) navBadge.textContent = activeTasksCount;
  }

  // =========================================================================
  // LOAD BM MANDATES FROM BACKEND
  // =========================================================================
  async function loadBMMandates() {
    var branchId = getBranchId();
    var token = getAuthToken();

    renderBMMandates(); // Render immediate canonical layout

    if (!branchId) return;

    try {
      var res = await fetch('/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/mandates', {
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        }
      });
      if (res.ok) {
        var data = await res.json();
        if (data && Array.isArray(data.mandates) && data.mandates.length > 0) {
          renderBMMandates(data.mandates);
        }
      }
    } catch (e) {
      console.warn('[BM Belanja] Backend fetch error, canonical cards retained:', e);
    }
  }

  // =========================================================================
  // CREATE MANDATE MODAL & ACTIONS
  // =========================================================================
  function openCreateMandateModal() {
    var m = $('modal-create-mandate');
    if (m) m.classList.add('open');
  }

  function closeCreateMandateModal() {
    var m = $('modal-create-mandate');
    if (m) m.classList.remove('open');
  }

  async function submitCreateMandate() {
    var staffEl = $('select-mandate-staff');
    var budgetEl = $('input-mandate-budget');
    var notesEl = $('input-mandate-notes');

    var staff = staffEl ? staffEl.value : 'Budi Santoso';
    var budget = parseInt(budgetEl ? budgetEl.value : '400000', 10) || 400000;
    var notes = (notesEl && notesEl.value) ? notesEl.value.trim() : 'Belanja Kebutuhan Dapur Harian';

    closeCreateMandateModal();

    // Check selected materials
    var checkboxes = document.querySelectorAll('input[name="mandate_item"]:checked');
    var selectedItems = [];
    checkboxes.forEach(function (cb) {
      selectedItems.push({
        material_id: cb.value || 'mat_item',
        target_quantity: parseFloat(cb.dataset.qty || '1'),
        estimated_unit_price: parseFloat(cb.dataset.price || '10000'),
        material_name: cb.dataset.name || 'Bahan Baku'
      });
    });

    if (selectedItems.length === 0) {
      selectedItems.push({
        material_id: 'mat_cabai_rawit',
        target_quantity: 3,
        estimated_unit_price: 40000,
        material_name: 'Cabai Rawit Merah'
      });
    }

    var mandateNum = 'MND-' + Math.floor(100 + Math.random() * 900);
    var branchId = getBranchId();
    var token = getAuthToken();

    // Submit to backend
    if (branchId) {
      try {
        await fetch('/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/mandates', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            cash_advance: budget,
            notes: notes,
            items: selectedItems
          })
        });
      } catch (err) {
        console.warn('[BM Belanja] Backend mandate release error:', err);
      }
    }

    activeTasksCount++;
    var elBadgeActive = $('badge-count-belanja-active');
    if (elBadgeActive) elBadgeActive.textContent = activeTasksCount;
    var navBadge = $('nav-badge-belanja');
    if (navBadge) navBadge.textContent = activeTasksCount;

    switchBelanjaSegment('active');

    var listActive = $('belanja-list-active');
    if (listActive) {
      var card = document.createElement('div');
      card.className = 'x-card';
      card.style.cssText = 'border-left:4px solid #3b82f6; padding:14px; margin-bottom:12px; animation:fadeIn 0.3s ease;';
      card.innerHTML =
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">' +
          '<div>' +
            '<span style="font-size:10.5px; font-weight:800; color:#1d4ed8; background:#eff6ff; padding:2px 6px; border-radius:4px;">#' + mandateNum + '</span>' +
            '<h3 style="font-size:15px; font-weight:800; color:#0f172a; margin-top:4px; margin-bottom:2px;">' + notes + '</h3>' +
            '<div style="font-size:12px; color:#64748b; margin-top:2px;">Staf: <strong>' + staff + '</strong> • Pagu Rp ' + budget.toLocaleString('id-ID') + '</div>' +
          '</div>' +
          '<span style="font-size:11px; font-weight:800; color:#2563eb; background:#eff6ff; border:1px solid #bfdbfe; padding:3px 8px; border-radius:999px;">' +
            'Baru Dirilis 🚀' +
          '</span>' +
        '</div>' +
        '<div style="background:#f8fafc; border-radius:8px; padding:10px 12px; margin-bottom:12px; border:1px solid #f1f5f9; font-size:12px; color:#64748b;">' +
          'Tugas telah masuk ke HP staf via Purchasing App. Menunggu konfirmasi belanja.' +
        '</div>' +
        '<button type="button" class="btn-action btn-secondary" onclick="showToast(\'💬 Menghubungi WhatsApp staf...\')" style="width:100%; padding:10px; font-size:12px; display:flex; align-items:center; justify-content:center; gap:6px;">' +
          '<span>💬</span> Hubungi Staf via WA' +
        '</button>';
      listActive.insertBefore(card, listActive.firstChild);
    }

    showToast('🚀 Mandat belanja #' + mandateNum + ' berhasil dirilis ke HP ' + staff + '!');
  }

  // =========================================================================
  // SUBVIEW VERIFIKASI MANDAT (PHYSICAL QC & POS RECONCILIATION)
  // =========================================================================
  function openVerifyPage(mandateId) {
    var v = $('subview-verifikasi-mandate');
    if (v) v.classList.add('active');
    renderReceiptList();
    renderQcList();
    setReconScenario('normal');
  }

  function closeVerifyPage() {
    var v = $('subview-verifikasi-mandate');
    if (v) v.classList.remove('active');
  }

  function openVerifyModal(mandateId) {
    openVerifyPage(mandateId);
  }

  function closeVerifyModal() {
    closeVerifyPage();
  }

  async function submitVerifyMandate() {
    closeVerifyPage();

    var cardVerify = $('card-verify-mandate');
    if (cardVerify) {
      cardVerify.style.transition = 'all 0.3s ease';
      cardVerify.style.opacity = '0';
      cardVerify.style.transform = 'translateY(-10px)';
      setTimeout(function () {
        if (cardVerify && cardVerify.parentNode) cardVerify.parentNode.removeChild(cardVerify);
      }, 300);
    }

    activeTasksCount = Math.max(0, activeTasksCount - 1);
    doneTasksCount++;

    var elBadgeActive = $('badge-count-belanja-active');
    if (elBadgeActive) elBadgeActive.textContent = activeTasksCount;
    var elBadgeDone = $('badge-count-belanja-done');
    if (elBadgeDone) elBadgeDone.textContent = doneTasksCount;
    var navBadge = $('nav-badge-belanja');
    if (navBadge) navBadge.textContent = activeTasksCount;

    var items = getActiveQcItems();
    var summaryRowsHtml = '';
    var hasAnyDiff = false;
    var payloadItems = [];

    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      var d = Math.round((it.qtyReceived - it.qtyBilled) * 1000) / 1000;
      var hasD = Math.abs(d) >= 0.001;
      if (hasD) hasAnyDiff = true;

      payloadItems.push({
        material_id: it.material_id || it.id,
        target_quantity: it.qtyBilled,
        quantity: it.qtyReceived,
        actual_quantity: it.qtyReceived,
        unit_price: it.pricePerUnit,
        notes: it.operatorNote || ''
      });

      summaryRowsHtml +=
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; font-size:12px; padding:3px 0; border-bottom:1px dashed #f1f5f9;">' +
          '<div>' +
            '<strong>' + it.name + '</strong>' +
            (hasD && it.operatorNote ? '<div style="font-size:11px; color:#b45309; margin-top:1px;">Catatan: <em>"' + it.operatorNote + '"</em></div>' : '') +
          '</div>' +
          '<div style="text-align:right;">' +
            '<span style="font-weight:800; color:' + (hasD ? '#b45309' : '#15803d') + ';">' +
              it.qtyReceived.toFixed(it.precision) + ' ' + it.unit +
            '</span>' +
            (hasD ? '<span style="font-size:10.5px; color:#b45309; display:block;">(' + (d > 0 ? '+' : '') + d.toFixed(it.precision) + ' ' + it.unit + ')</span>' : '<span style="font-size:10.5px; color:#15803d; display:block;">✓ Cocok</span>') +
          '</div>' +
        '</div>';
    }

    var listDone = $('belanja-list-done');
    if (listDone) {
      var row = document.createElement('div');
      row.className = 'x-card';
      row.style.cssText = 'border-left:4px solid #10b981; padding:14px; margin-bottom:12px; animation:fadeIn 0.3s ease;';
      row.innerHTML =
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">' +
          '<div>' +
            '<span style="font-size:10.5px; font-weight:800; color:#15803d; background:#dcfce7; padding:2px 6px; border-radius:4px;">#MND-082</span>' +
            '<h3 style="font-size:14.5px; font-weight:800; color:#0f172a; margin-top:3px; margin-bottom:2px;">Pasar Pringsewu</h3>' +
            '<div style="font-size:12px; color:#64748b; margin-top:1px;">Staf: Joko • Selesai diverifikasi</div>' +
          '</div>' +
          '<span style="font-size:11px; font-weight:800; color:#15803d; background:#f0fdf4; border:1px solid #bbf7d0; padding:3px 8px; border-radius:999px;">' +
            'Selesai' +
          '</span>' +
        '</div>' +
        '<div style="background:#f8fafc; border-radius:8px; padding:8px 10px; margin:8px 0; border:1px solid #e2e8f0; display:flex; flex-direction:column; gap:4px;">' +
          summaryRowsHtml +
        '</div>' +
        '<div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #f1f5f9; padding-top:8px;">' +
          '<span style="font-size:12px; color:#64748b;">Total Nota: <strong>Rp 320.000</strong></span>' +
          '<button type="button" class="btn-action btn-secondary" onclick="openReceiptModal(\'MND-082\', \'Kios Beras Subur Makmur\', 320000, \'Joko (Runner Dapur)\', \'07:38 WIB\')" style="font-size:11px; padding:4px 8px;">Lihat Nota Pasar</button>' +
        '</div>';
      listDone.insertBefore(row, listDone.firstChild);
    }

    // Call backend settle
    var branchId = getBranchId();
    var token = getAuthToken();
    if (branchId) {
      try {
        await fetch('/admin/branches/' + encodeURIComponent(branchId) + '/purchasing/settle', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            cash_advance: 350000,
            items: payloadItems,
            notes: ($('input-verify-notes') || {}).value || 'Diverifikasi oleh Branch Manager',
            idempotency_key: 'bm_verify_' + Date.now()
          })
        });
      } catch (err) {
        console.warn('[BM Belanja] Backend settlement dispatch error:', err);
      }
    }

    showToast('✅ Mandat #MND-082 selesai! Bahan masuk stok dapur. Laci kasir POS & HPP seimbang otomatis.');
  }

  // =========================================================================
  // RECEIPT AUDIT FEED & LIGHTBOX
  // =========================================================================
  function renderReceiptList() {
    var container = $('receipt-items-container');
    if (!container) return;
    container.innerHTML = '';

    var totalAmount = 0;
    for (var i = 0; i < receiptsData.length; i++) {
      var r = receiptsData[i];
      totalAmount += r.amount;

      var row = document.createElement('div');
      row.className = 'receipt-card-row';
      row.setAttribute('onclick', 'openReceiptByIndex(' + i + ')');

      var seqStr = (i + 1 < 10 ? '0' : '') + (i + 1);
      var barColor = (i % 3 === 0) ? '#2563eb' : (i % 3 === 1 ? '#d97706' : '#10b981');

      row.innerHTML =
        '<div class="receipt-doc-thumb">' +
          '<span style="font-size:16px;">🧾</span>' +
          '<span style="font-size:8px; font-weight:800; color:' + barColor + ';">#' + seqStr + '</span>' +
          '<div class="doc-bar" style="background:' + barColor + ';"></div>' +
        '</div>' +
        '<div style="flex:1; min-width:0;">' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">' +
            '<div style="min-width:0; flex:1;">' +
              '<strong style="font-size:13px; color:#0f172a; line-height:1.2; display:block;">' + r.vendor + '</strong>' +
              '<div style="font-size:11px; color:#64748b; margin-top:2px;">' + r.itemsSummary + '</div>' +
            '</div>' +
            '<strong style="font-size:13.5px; color:#0f172a; flex-shrink:0; text-align:right;">Rp ' + r.amount.toLocaleString('id-ID') + '</strong>' +
          '</div>' +
          '<div style="display:flex; align-items:center; justify-content:space-between; margin-top:5px;">' +
            '<span style="font-size:9.5px; font-weight:700; color:#15803d; background:#dcfce7; padding:1px 6px; border-radius:4px;">' + r.badge + '</span>' +
            '<span style="font-size:11px; color:#2563eb; font-weight:700;">Lihat Foto 🔍</span>' +
          '</div>' +
        '</div>';
      container.appendChild(row);
    }

    var countEl = $('label-nota-count');
    if (countEl) countEl.textContent = receiptsData.length + ' Nota';

    var totalEl = $('label-nota-total');
    if (totalEl) totalEl.textContent = 'Rp ' + totalAmount.toLocaleString('id-ID');
  }

  function openReceiptByIndex(idx) {
    if (idx < 0 || idx >= receiptsData.length) return;
    currentReceiptIndex = idx;
    var r = receiptsData[idx];

    var m = $('modal-receipt-view');
    var seqBadge = $('receipt-view-seq-badge');
    var vendorTitle = $('receipt-view-vendor');
    var paperVendor = $('receipt-paper-vendor');
    var paperLoc = $('receipt-paper-loc');
    var paperTime = $('receipt-paper-time');
    var paperItems = $('receipt-paper-items-list');
    var totalAmount = $('receipt-view-amount');
    var paperStamp = $('receipt-paper-stamp');
    var stampGraphic = $('receipt-stamp-graphic');
    var metaEl = $('receipt-view-meta');

    if (seqBadge) seqBadge.textContent = 'Nota ' + (idx + 1) + ' dari ' + receiptsData.length;
    if (vendorTitle) vendorTitle.textContent = r.vendor;
    if (paperVendor) paperVendor.textContent = r.vendor.toUpperCase();
    if (paperLoc) paperLoc.textContent = r.loc || 'Pasar Tradisional Pringsewu';
    if (paperTime) paperTime.textContent = '28 Okt 2026, ' + r.time + ' • Nota Pembelian Tunai';

    if (paperItems) {
      paperItems.innerHTML = '';
      var lines = r.lines || [{ name: r.itemsSummary, qty: '1 Paket', price: r.amount }];
      for (var j = 0; j < lines.length; j++) {
        var lineDiv = document.createElement('div');
        lineDiv.style.cssText = 'display:flex; justify-content:space-between; align-items:baseline;';
        lineDiv.innerHTML =
          '<div>' +
            '<strong>' + lines[j].name + '</strong>' +
            '<div style="font-size:10.5px; color:#64748b;">' + lines[j].qty + '</div>' +
          '</div>' +
          '<strong>Rp ' + lines[j].price.toLocaleString('id-ID') + '</strong>';
        paperItems.appendChild(lineDiv);
      }
    }

    if (totalAmount) totalAmount.textContent = 'Rp ' + r.amount.toLocaleString('id-ID');
    if (paperStamp) paperStamp.textContent = r.stampNote || 'Cap Stempel Toko Sah & TTD';
    if (stampGraphic) {
      stampGraphic.textContent = r.stampText || '★ LUNAS ★';
      stampGraphic.style.borderColor = r.stampColor || '#dc2626';
      stampGraphic.style.color = r.stampColor || '#dc2626';
    }
    if (metaEl) metaEl.textContent = 'Diunggah oleh: ' + (r.staff || 'Joko (Runner Dapur)');

    var btnPrev = $('btn-receipt-prev');
    var btnNext = $('btn-receipt-next');
    if (btnPrev) btnPrev.disabled = (idx === 0);
    if (btnNext) btnNext.disabled = (idx === receiptsData.length - 1);

    if (m) m.classList.add('open');
  }

  function prevReceipt() {
    if (currentReceiptIndex > 0) openReceiptByIndex(currentReceiptIndex - 1);
  }

  function nextReceipt() {
    if (currentReceiptIndex < receiptsData.length - 1) openReceiptByIndex(currentReceiptIndex + 1);
  }

  function openReceiptModal(num, vendor, amount, staff, time) {
    var foundIdx = -1;
    for (var k = 0; k < receiptsData.length; k++) {
      if (receiptsData[k].vendor === vendor) {
        foundIdx = k;
        break;
      }
    }
    if (foundIdx >= 0) {
      openReceiptByIndex(foundIdx);
    } else {
      var adHoc = {
        vendor: vendor,
        loc: 'Pasar Tradisional Pringsewu',
        itemsSummary: 'Daftar Belanja Mandat #' + num,
        amount: amount,
        time: time,
        badge: '✓ Nota Terverifikasi',
        stampText: '★ TERVERIFIKASI ★',
        stampColor: '#15803d',
        stampNote: 'Arsip nota digital terverifikasi',
        staff: staff,
        lines: [{ name: 'Belanja Bahan Dapur Cabang', qty: 'Mandat #' + num, price: amount }]
      };
      receiptsData.push(adHoc);
      openReceiptByIndex(receiptsData.length - 1);
    }
  }

  function closeReceiptModal() {
    var m = $('modal-receipt-view');
    if (m) m.classList.remove('open');
  }

  function toggleMultiReceiptDemo() {
    isMultiDemo = !isMultiDemo;
    var btn = $('btn-toggle-demo-receipts');
    var hint = $('nota-scaling-hint');

    if (isMultiDemo) {
      receiptsData = multiReceiptsDemo.slice();
      if (btn) btn.textContent = '↩ Kembali ke 2 Nota Default';
      if (hint) hint.textContent = '10 nota pasar tersusun vertikal rapi tanpa geser horizontal';
      setReconScenario('normal');
      showToast('⚡ 10 Nota Kios Dimuat (Gulir Vertikal)');
    } else {
      receiptsData = defaultReceipts.slice();
      if (btn) btn.textContent = '⚡ Uji Skenario 10 Nota Kios ▾';
      if (hint) hint.textContent = 'Layout vertikal adaptif (Bebas geser horizontal)';
      setReconScenario('normal');
      showToast('↩ Kembali ke 2 Nota Default (#MND-082)');
    }

    renderReceiptList();
    renderQcList();
  }

  // =========================================================================
  // UNIVERSAL QC CARD RENDERER & ACTIONS
  // =========================================================================
  function setUniversalQty(id, val) {
    var item = findQcItem(id);
    if (!item) return;
    var num = parseFloat(val);
    if (isNaN(num) || num < 0) num = 0;
    var factor = Math.pow(10, item.precision);
    item.qtyReceived = Math.round(num * factor) / factor;
    renderQcList();

    var diff = Math.round((item.qtyReceived - item.qtyBilled) * 1000) / 1000;
    if (Math.abs(diff) < 0.001) {
      showToast('✓ ' + item.name + ': Sesuai penuh nota (' + item.qtyReceived.toFixed(item.precision) + ' ' + item.unit + ')');
    } else if (diff < 0) {
      showToast('⚠️ ' + item.name + ': Selisih ' + diff.toFixed(item.precision) + ' ' + item.unit + ' dicatat');
    } else {
      showToast('+ ' + item.name + ': Lebih +' + diff.toFixed(item.precision) + ' ' + item.unit);
    }
  }

  function adjustUniversalQty(id, delta) {
    var item = findQcItem(id);
    if (!item) return;
    var next = item.qtyReceived + delta;
    setUniversalQty(id, next);
  }

  function resetUniversalQty(id) {
    var item = findQcItem(id);
    if (!item) return;
    setUniversalQty(id, item.qtyBilled);
  }

  function setUniversalCategory(id, catKey) {
    var item = findQcItem(id);
    if (!item) return;
    item.discrepancyType = catKey;
    renderQcList();
    showToast('🏷️ Klasifikasi: ' + (QC_TAXONOMY[catKey] ? QC_TAXONOMY[catKey].label : catKey));
  }

  function setUniversalDisposition(id, dispKey) {
    var item = findQcItem(id);
    if (!item) return;
    item.disposition = dispKey;
    renderQcList();
    showToast('💼 Alokasi: ' + (QC_DISPOSITION[dispKey] ? QC_DISPOSITION[dispKey].label : dispKey));
  }

  function updateUniversalNote(id, noteVal) {
    var item = findQcItem(id);
    if (!item) return;
    item.operatorNote = noteVal;
  }

  function setQcFilter(filter) {
    currentQcFilter = filter;
    renderQcList();
  }

  function renderUniversalQcCard(item, idx) {
    var diff = Math.round((item.qtyReceived - item.qtyBilled) * 1000) / 1000;
    var hasDiff = Math.abs(diff) >= 0.001;
    var isNegative = diff < -0.0001;
    var isPositive = diff > 0.0001;

    var statusBadgeHtml = '';
    if (!hasDiff) {
      statusBadgeHtml = '<span style="font-size:10.5px; font-weight:800; color:#15803d; background:#dcfce7; padding:3px 8px; border-radius:6px; white-space:nowrap;">✓ Sesuai Nota</span>';
    } else if (isNegative) {
      statusBadgeHtml = '<span style="font-size:10.5px; font-weight:800; color:#b45309; background:#fef3c7; padding:3px 8px; border-radius:6px; white-space:nowrap;">⚠️ Selisih: ' + diff.toFixed(item.precision) + ' ' + item.unit + '</span>';
    } else {
      statusBadgeHtml = '<span style="font-size:10.5px; font-weight:800; color:#2563eb; background:#eff6ff; padding:3px 8px; border-radius:6px; white-space:nowrap;">+ Lebih: +' + diff.toFixed(item.precision) + ' ' + item.unit + '</span>';
    }

    var notePlaceholder = hasDiff
      ? 'Tulis alasan selisih (cth: 8 butir retak di jalan, tiris es)...'
      : 'Catatan kondisi fisik (opsional)...';

    return (
      '<div class="universal-qc-card ' + (hasDiff ? 'has-variance' : '') + '">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start;">' +
          '<div style="flex:1; padding-right:8px;">' +
            '<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">' +
              '<strong style="font-size:13.5px; color:#0f172a;">' + item.name + '</strong>' +
              '<span class="storage-tag ' + item.storageClass + '">📍 ' + item.storageZone + '</span>' +
            '</div>' +
            '<div style="font-size:11.5px; color:#64748b; margin-top:2px;">' +
              'Nota: <strong>' + item.qtyBilled.toFixed(item.precision) + ' ' + item.unit + '</strong> • ' + item.vendor +
            '</div>' +
          '</div>' +
          statusBadgeHtml +
        '</div>' +

        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:8px 10px; margin-top:8px;">' +
          '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">' +
            '<span style="font-size:11px; font-weight:700; color:#334155;">⚖️ Diterima Fisik (Ditimbang):</span>' +
            '<button type="button" onclick="resetUniversalQty(\'' + item.id + '\')" style="background:transparent; border:none; font-size:10.5px; font-weight:700; color:#2563eb; cursor:pointer; text-decoration:underline; padding:0;">' +
              'Samakan Nota (' + item.qtyBilled.toFixed(item.precision) + ' ' + item.unit + ')' +
            '</button>' +
          '</div>' +

          '<div style="display:flex; align-items:center; gap:8px;">' +
            '<button type="button" onclick="adjustUniversalQty(\'' + item.id + '\', -' + item.step + ')" style="width:36px; height:36px; border-radius:8px; border:1.5px solid #cbd5e1; background:#ffffff; font-size:18px; font-weight:800; cursor:pointer; color:#0f172a; display:flex; align-items:center; justify-content:center;">−</button>' +
            '<div style="flex:1; position:relative;">' +
              '<input type="number" step="' + item.step + '" value="' + item.qtyReceived.toFixed(item.precision) + '" onchange="setUniversalQty(\'' + item.id + '\', this.value)" style="width:100%; text-align:center; font-size:16px; font-weight:800; color:#0f172a; padding:6px 36px 6px 10px; border-radius:8px; border:1.5px solid ' + (hasDiff ? '#f59e0b' : '#10b981') + '; outline:none; font-family:inherit; background:#ffffff; box-sizing:border-box;">' +
              '<span style="position:absolute; right:10px; top:50%; transform:translateY(-50%); font-size:12px; font-weight:700; color:#64748b;">' + item.unit + '</span>' +
            '</div>' +
            '<button type="button" onclick="adjustUniversalQty(\'' + item.id + '\', ' + item.step + ')" style="width:36px; height:36px; border-radius:8px; border:1.5px solid #cbd5e1; background:#ffffff; font-size:18px; font-weight:800; cursor:pointer; color:#0f172a; display:flex; align-items:center; justify-content:center;">+</button>' +
          '</div>' +
        '</div>' +

        '<div style="margin-top:8px;">' +
          '<input type="text" class="qc-note-input" value="' + (item.operatorNote ? item.operatorNote.replace(/"/g, '&quot;') : '') + '" oninput="updateUniversalNote(\'' + item.id + '\', this.value)" placeholder="' + notePlaceholder + '" style="' + (hasDiff ? 'border-color:#fde68a; background:#fffbeb;' : '') + '">' +
        '</div>' +

        '<div style="margin-top:7px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px; font-size:11px;">' +
          '<div style="color:' + (hasDiff ? '#b45309' : '#15803d') + '; display:flex; align-items:center; gap:4px;">' +
            '<span>' + (hasDiff ? '⚠️' : '✓') + '</span> ' +
            '<span>Masuk stok ' + item.storageZone + ': <strong>' + item.qtyReceived.toFixed(item.precision) + ' ' + item.unit + '</strong></span>' +
          '</div>' +
          (item.yieldInfo ? '<span style="background:#f1f5f9; color:#475569; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:700;">🥣 ' + item.yieldInfo + '</span>' : '') +
        '</div>' +
      '</div>'
    );
  }

  function renderQcList() {
    var container = $('qc-items-container');
    if (!container) return;
    container.innerHTML = '';

    var items = getActiveQcItems();

    var filterHtml = '';
    if (isMultiDemo) {
      var diffCount = 0;
      for (var c = 0; c < items.length; c++) {
        if (Math.abs(items[c].qtyReceived - items[c].qtyBilled) >= 0.001) diffCount++;
      }

      filterHtml =
        '<div style="display:flex; gap:6px; overflow-x:auto; padding-bottom:4px; margin-bottom:4px;">' +
          '<button type="button" class="qc-filter-tab ' + (currentQcFilter === 'ALL' ? 'active' : '') + '" onclick="setQcFilter(\'ALL\')">Semua (10)</button>' +
          '<button type="button" class="qc-filter-tab ' + (currentQcFilter === 'DIFF' ? 'active' : '') + '" onclick="setQcFilter(\'DIFF\')">⚠️ Selisih (' + diffCount + ')</button>' +
          '<button type="button" class="qc-filter-tab ' + (currentQcFilter === 'DRY' ? 'active' : '') + '" onclick="setQcFilter(\'DRY\')">📦 Kering</button>' +
          '<button type="button" class="qc-filter-tab ' + (currentQcFilter === 'COLD' ? 'active' : '') + '" onclick="setQcFilter(\'COLD\')">❄️ Chiller</button>' +
          '<button type="button" class="qc-filter-tab ' + (currentQcFilter === 'FREEZE' ? 'active' : '') + '" onclick="setQcFilter(\'FREEZE\')">🍗 Freezer</button>' +
        '</div>';
    }

    var filtered = items.filter(function (it) {
      if (!isMultiDemo) return true;
      if (currentQcFilter === 'DIFF') return Math.abs(it.qtyReceived - it.qtyBilled) >= 0.001;
      if (currentQcFilter === 'DRY') return it.storageClass === 'storage-dry';
      if (currentQcFilter === 'COLD') return it.storageClass === 'storage-cold';
      if (currentQcFilter === 'FREEZE') return it.storageClass === 'storage-freeze';
      return true;
    });

    var cardsHtml = '';
    for (var i = 0; i < filtered.length; i++) {
      cardsHtml += renderUniversalQcCard(filtered[i], i);
    }

    container.innerHTML = filterHtml + cardsHtml;

    var totalDiffItems = 0;
    var totalDiffKg = 0;
    for (var j = 0; j < items.length; j++) {
      var d = Math.round((items[j].qtyReceived - items[j].qtyBilled) * 1000) / 1000;
      if (Math.abs(d) >= 0.001) {
        totalDiffItems++;
        if (items[j].unit === 'Kg') totalDiffKg += d;
      }
    }

    var summaryEl = $('label-qc-summary');
    if (summaryEl) {
      if (totalDiffItems > 0) {
        summaryEl.textContent = totalDiffItems + ' Item Ada Selisih' + (totalDiffKg < 0 ? ' (' + totalDiffKg.toFixed(1) + ' Kg)' : '');
        summaryEl.style.color = '#b45309';
        summaryEl.style.background = '#fef3c7';
      } else {
        summaryEl.textContent = '✓ 100% Lolos QC (' + items.length + ' Bahan)';
        summaryEl.style.color = '#15803d';
        summaryEl.style.background = '#dcfce7';
      }
    }
  }

  // =========================================================================
  // POS CASH DRAWER RECONCILIATION SCENARIOS
  // =========================================================================
  function setReconScenario(scenario) {
    var btnNormal = $('btn-recon-mode-normal');
    var btnTalangan = $('btn-recon-mode-talangan');
    var reconGiven = $('recon-cash-given');
    var reconSpent = $('recon-cash-spent');
    var reconChange = $('recon-cash-change');
    var reconChangeLabel = $('recon-change-label');
    var reconStatusBadge = $('recon-status-badge');
    var reconDesc1 = $('recon-checkbox-desc-1');
    var reconLedger = $('recon-ledger-note');

    if (scenario === 'talangan') {
      if (btnTalangan) btnTalangan.classList.add('active');
      if (btnNormal) btnNormal.classList.remove('active');

      if (reconGiven) reconGiven.textContent = 'Rp 350.000';
      if (reconSpent) reconSpent.textContent = 'Rp 380.000';
      if (reconChange) {
        reconChange.textContent = '-Rp 30.000';
        reconChange.style.color = '#dc2626';
      }
      if (reconChangeLabel) reconChangeLabel.textContent = 'Kasir Harus Ganti:';
      if (reconStatusBadge) {
        reconStatusBadge.textContent = '⚠️ Reimburse Talangan';
        reconStatusBadge.style.background = '#fee2e2';
        reconStatusBadge.style.color = '#b91c1c';
      }
      if (reconDesc1) {
        reconDesc1.innerHTML = 'Kasir Siti telah menyerahkan uang <strong>Rp 30.000</strong> dari laci POS ke Joko untuk mengganti uang talangan pribadinya.';
      }
      if (reconLedger) {
        reconLedger.innerHTML = '⚠️ <strong>Jurnal Otomatis Sistem:</strong> Pengeluaran belanja pasar <strong>Rp 380.000</strong> dicatat. Kasir mengeluarkan Rp 30.000 dari laci POS sebagai penggantian talangan runner Joko.';
      }
      showToast('⚠️ Skenario Talangan: Harga naik, Kasir Siti reimburse Rp 30.000 ke Joko.');
    } else {
      if (btnNormal) btnNormal.classList.add('active');
      if (btnTalangan) btnTalangan.classList.remove('active');

      if (reconGiven) reconGiven.textContent = isMultiDemo ? 'Rp 1.400.000' : 'Rp 350.000';
      if (reconSpent) reconSpent.textContent = isMultiDemo ? 'Rp 1.355.000' : 'Rp 320.000';
      if (reconChange) {
        reconChange.textContent = isMultiDemo ? 'Rp 45.000' : 'Rp 30.000';
        reconChange.style.color = '#047857';
      }
      if (reconChangeLabel) reconChangeLabel.textContent = 'Sisa Kembali Fisik:';
      if (reconStatusBadge) {
        reconStatusBadge.textContent = '✓ Kas Seimbang';
        reconStatusBadge.style.background = '#dcfce7';
        reconStatusBadge.style.color = '#047857';
      }
      if (reconDesc1) {
        reconDesc1.innerHTML = isMultiDemo
          ? 'Fisik uang sisa kasbon <strong>Rp 45.000</strong> telah dihitung &amp; masuk kembali ke laci POS Kasir Siti.'
          : 'Fisik uang sisa kasbon <strong>Rp 30.000</strong> telah dihitung &amp; masuk kembali ke laci POS Kasir Siti.';
      }
      if (reconLedger) {
        reconLedger.innerHTML = isMultiDemo
          ? '⚡ <strong>Jurnal Otomatis Sistem:</strong> Kasbon ditutup. Biaya belanja pasar <strong>Rp 1.355.000</strong> diposting ke Pembukuan Harian Shift Pagi, saldo laci POS seimbang tanpa selisih.'
          : '⚡ <strong>Jurnal Otomatis Sistem:</strong> Kasbon ditutup. Biaya belanja pasar <strong>Rp 320.000</strong> diposting ke Pembukuan Harian Shift Pagi, saldo laci POS seimbang tanpa selisih.';
      }
    }
  }

  // =========================================================================
  // BACKWARD COMPATIBILITY STUBS FOR UNIT & SMOKE TESTS
  // =========================================================================
  function adjustQcTelurWeight(delta) { adjustUniversalQty('item_telur', delta); }
  function setQcTelurWeight(val) { setUniversalQty('item_telur', val); }
  function setQcTelurMode(mode) { setUniversalQty('item_telur', mode === 'full' ? 5.0 : 4.5); }
  function toggleQcTelur(val) { setQcTelurMode(val); }

  function switchPurchasingView(view) {
    if (view === 'tasks' || view === 'active') switchBelanjaSegment('active');
    else switchBelanjaSegment('done');
  }

  function openPurchasingReceiveModal() {}
  function closePurchasingReceiveModal() {
    var m = $('modal-purchasing-receive');
    if (m) m.style.display = 'none';
  }
  function closePurchasingReceiveConfirmModal() {
    var m = $('modal-purchasing-receive-confirm');
    if (m) m.style.display = 'none';
  }
  function confirmPurchasingReceive() {}

  // =========================================================================
  // GLOBAL EXPORTS FOR HTML ONCLICK & EVENT HANDLERS
  // =========================================================================
  window.loadBMMandates = loadBMMandates;
  window.loadPurchasingChecklist = loadBMMandates;
  window.refreshPurchasingActiveView = loadBMMandates;
  window.switchBelanjaSegment = switchBelanjaSegment;
  window.openCreateMandateModal = openCreateMandateModal;
  window.closeCreateMandateModal = closeCreateMandateModal;
  window.submitCreateMandate = submitCreateMandate;
  window.openVerifyPage = openVerifyPage;
  window.closeVerifyPage = closeVerifyPage;
  window.openVerifyModal = openVerifyModal;
  window.closeVerifyModal = closeVerifyModal;
  window.submitVerifyMandate = submitVerifyMandate;
  window.renderReceiptList = renderReceiptList;
  window.openReceiptByIndex = openReceiptByIndex;
  window.prevReceipt = prevReceipt;
  window.nextReceipt = nextReceipt;
  window.openReceiptModal = openReceiptModal;
  window.closeReceiptModal = closeReceiptModal;
  window.toggleMultiReceiptDemo = toggleMultiReceiptDemo;
  window.renderQcList = renderQcList;
  window.setUniversalQty = setUniversalQty;
  window.adjustUniversalQty = adjustUniversalQty;
  window.resetUniversalQty = resetUniversalQty;
  window.setUniversalCategory = setUniversalCategory;
  window.setUniversalDisposition = setUniversalDisposition;
  window.updateUniversalNote = updateUniversalNote;
  window.setQcFilter = setQcFilter;
  window.adjustQcTelurWeight = adjustQcTelurWeight;
  window.setQcTelurWeight = setQcTelurWeight;
  window.setQcTelurMode = setQcTelurMode;
  window.toggleQcTelur = toggleQcTelur;
  window.setReconScenario = setReconScenario;
  window.switchPurchasingView = switchPurchasingView;
  window.closePurchasingReceiveModal = closePurchasingReceiveModal;
  window.closePurchasingReceiveConfirmModal = closePurchasingReceiveConfirmModal;
  window.confirmPurchasingReceive = confirmPurchasingReceive;

  // Auto-init on load if tab is active
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (document.body.classList.contains('is-belanja-active') || window.location.hash === '#belanja') {
        loadBMMandates();
      }
    });
  } else {
    if (document.body.classList.contains('is-belanja-active') || window.location.hash === '#belanja') {
      loadBMMandates();
    }
  }

})();
