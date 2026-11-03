import re

path = "/home/ubuntu/xentra-core/apps/merchant-shared/prototypes/owner-beranda-2026.html"
with open(path, "r", encoding="utf-8") as f:
    text = f.read()

# 1. Update Quick Actions item 5 to Program Affiliate
old_qa5 = """            <!-- 5. Cabang Outlet -->
            <button type="button" class="quick-action-item" onclick="showToast('Cabang & Kesehatan', 'Pengaturan Outlet & Kesehatan Operasional')">
              <div class="squircle-icon-wrap squircle-teal">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z"/>
                </svg>
              </div>
              <span class="quick-action-label">Cabang<br>& Outlet</span>
            </button>"""

new_qa5 = """            <!-- 5. Program Affiliate -->
            <button type="button" class="quick-action-item" onclick="showToast('Program Affiliate', 'Kelola Komisi Afiliasi B2C, Story Promo & Penarikan')">
              <div class="squircle-icon-wrap squircle-teal">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                </svg>
              </div>
              <span class="quick-action-label">Program<br>Affiliate</span>
            </button>"""

if old_qa5 in text:
    text = text.replace(old_qa5, new_qa5)
    print("Updated Quick Action 5 to Program Affiliate.")

# 2. Update Top Products Card with interactive tabs
old_top_prod = """<section class="top-products-card">
          <div class="section-header-row" style="margin-bottom: 4px;">
            <h3 class="section-title">Menu Terlaris Hari Ini</h3>
            <span style="font-size: 11.5px; font-weight: 700; color: var(--brand-green); cursor: pointer;" onclick="showToast('Laporan Menu', 'Membuka ranking penjualan semua menu')">Lihat Semua</span>
          </div>"""

new_top_prod = """<section class="top-products-card">
          <div class="section-header-row" style="margin-bottom: 6px;">
            <h3 class="section-title">Menu Unggulan & Terlaris</h3>
            <span style="font-size: 11.5px; font-weight: 700; color: var(--brand-green); cursor: pointer;" onclick="showToast('Laporan Menu', 'Membuka ranking penjualan semua menu')">Lihat Semua</span>
          </div>

          <!-- Product Filter Tabs -->
          <div class="product-filter-tabs">
            <button type="button" class="product-filter-tab active" id="tab-prod-sold" onclick="switchProductTab('sold')">🔥 Porsi Terlaris</button>
            <button type="button" class="product-filter-tab" id="tab-prod-margin" onclick="switchProductTab('margin')">💰 Margin Tertinggi (%)</button>
          </div>

          <div id="product-list-container">"""

# Close container before </section>
old_top_prod_end = """              <span class="product-item-margin">Margin 64%</span>
            </div>
          </div>
        </section>"""

new_top_prod_end = """              <span class="product-item-margin">Margin 64%</span>
            </div>
          </div>
          </div>
        </section>"""

if old_top_prod in text:
    text = text.replace(old_top_prod, new_top_prod)
    text = text.replace(old_top_prod_end, new_top_prod_end)
    print("Updated Top Products with interactive tabs.")

# 3. Add 3 new bottom sheets right after target-sheet
sheets_to_add = """
    <!-- ==========================================================================
         PERIOD SELECTOR BOTTOM SHEET
         ========================================================================== -->
    <div class="bottom-sheet" id="period-sheet">
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">Pilih Periode Penjualan</h3>
      <div class="branch-list-group">
        <div class="branch-select-row selected" id="row-period-today" onclick="selectPeriod('Hari ini', '29 Oktober 2026', 'Rp 4.320.000', 'Rp 1.2jt', 'Rp 3.12jt', 'Rp 53.3rb', '81 total pesanan', 80.3)">
          <div>
            <div class="branch-select-name">Hari ini</div>
            <div class="branch-select-sub">29 Oktober 2026 (Realtime)</div>
          </div>
          <span style="font-size: 16px; color: var(--brand-green);">✓</span>
        </div>

        <div class="branch-select-row" id="row-period-yesterday" onclick="selectPeriod('Kemarin', '28 Oktober 2026', 'Rp 3.850.000', 'Rp 950rb', 'Rp 2.90jt', 'Rp 52.0rb', '74 total pesanan', 71.5)">
          <div>
            <div class="branch-select-name">Kemarin</div>
            <div class="branch-select-sub">28 Oktober 2026 • 74 transaksi</div>
          </div>
        </div>

        <div class="branch-select-row" id="row-period-7d" onclick="selectPeriod('7 Hari Terakhir', '23 - 29 Oktober 2026', 'Rp 28.450.000', 'Rp 7.8jt', 'Rp 20.65jt', 'Rp 54.1rb', '526 total pesanan', 92.4)">
          <div>
            <div class="branch-select-name">7 Hari Terakhir</div>
            <div class="branch-select-sub">23 - 29 Oktober 2026 • 526 transaksi</div>
          </div>
        </div>

        <div class="branch-select-row" id="row-period-month" onclick="selectPeriod('Bulan Ini', '1 - 29 Oktober 2026', 'Rp 114.800.000', 'Rp 32.5jt', 'Rp 82.3jt', 'Rp 53.8rb', '2.133 total pesanan', 88.6)">
          <div>
            <div class="branch-select-name">Bulan Ini (Oktober)</div>
            <div class="branch-select-sub">1 - 29 Oktober 2026 • 2.133 transaksi</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==========================================================================
         LIVE OPS ORDER STAGE BOTTOM SHEET
         ========================================================================== -->
    <div class="bottom-sheet" id="ops-stage-sheet">
      <div class="sheet-handle"></div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <h3 class="sheet-title" id="ops-stage-sheet-title" style="margin: 0; font-size: 16px;">Pesanan Baru (3 Menunggu)</h3>
        <span style="font-size: 10.5px; font-weight: 800; background: var(--bg-subtle); color: var(--brand-green-dark); padding: 3px 8px; border-radius: var(--radius-full); border: 1px solid var(--border-light);" id="ops-stage-sheet-badge">Live Radar</span>
      </div>
      <p style="font-size: 11px; color: var(--text-muted); margin: 0 0 12px 0;" id="ops-stage-sheet-desc">
        Pesanan masuk yang memerlukan konfirmasi dapur atau update status kasir.
      </p>

      <div id="ops-stage-tickets-list" style="max-height: 48vh; overflow-y: auto;">
        <!-- Tickets rendered by JS -->
      </div>

      <div style="margin-top: 12px; display: flex; gap: 8px;">
        <button type="button" class="btn-primary" style="flex: 1; padding: 12px; font-size: 12px;" onclick="handleStageBatchAction()">
          <span id="ops-stage-action-btn-text">✓ Konfirmasi Semua ke Dapur</span>
        </button>
        <button type="button" class="btn-cancel" style="padding: 12px 16px; font-size: 12px;" onclick="closeAllSheets()">
          Tutup
        </button>
      </div>
    </div>

    <!-- ==========================================================================
         MENU 86 (HABIS) INTERVENTION BOTTOM SHEET
         ========================================================================== -->
    <div class="bottom-sheet" id="menu-86-sheet">
      <div class="sheet-handle"></div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <h3 class="sheet-title" style="margin: 0; font-size: 16px;">🚫 Kendali Menu Habis (86)</h3>
        <span style="font-size: 10.5px; font-weight: 800; background: #fff7ed; color: #ea580c; padding: 3px 8px; border-radius: var(--radius-full); border: 1px solid #ffedd5;">Emergency Stop</span>
      </div>
      <p style="font-size: 11px; color: var(--text-muted); margin: 0 0 12px 0;">
        Menu yang ditandai 86 otomatis disembunyikan dari aplikasi pelanggan PWA & POS kasir.
      </p>

      <div id="menu-86-items-list" style="max-height: 48vh; overflow-y: auto;">
        <!-- Menu 86 items rendered by JS -->
      </div>

      <div style="margin-top: 14px;">
        <button type="button" class="btn-primary" style="width: 100%; padding: 12px; font-size: 12.5px;" onclick="closeAllSheets(); showToast('Status 86 Disimpan', 'Sinkronisasi menu habis berhasil diterapkan ke semua POS & PWA');">
          ✓ Selesai & Terapkan Perubahan
        </button>
      </div>
    </div>
"""

if 'id="period-sheet"' not in text:
    # Insert right before </main> or after target-sheet
    text = text.replace('    </div>\n  </div>\n\n  <!-- ==========================================================================\n       INTERACTIVE CLIENT CONTROLLER', sheets_to_add + '\n    </div>\n  </div>\n\n  <!-- ==========================================================================\n       INTERACTIVE CLIENT CONTROLLER')
    print("Added new bottom sheets.")

# 4. Add JS methods
js_methods = """
    // ── NEW 2026 ENHANCEMENTS: CONTROLLER METHODS ──

    // Close all sheets update
    const origCloseAllSheets = closeAllSheets;
    closeAllSheets = function() {
      if (origCloseAllSheets) origCloseAllSheets();
      const pSheet = document.getElementById('period-sheet');
      if (pSheet) pSheet.classList.remove('active');
      const opsSheet = document.getElementById('ops-stage-sheet');
      if (opsSheet) opsSheet.classList.remove('active');
      const m86Sheet = document.getElementById('menu-86-sheet');
      if (m86Sheet) m86Sheet.classList.remove('active');
    };

    // Open Period Selector Sheet
    function openPeriodMenu() {
      closeAllSheets();
      document.getElementById('sheet-overlay').classList.add('active');
      const pSheet = document.getElementById('period-sheet');
      if (pSheet) pSheet.classList.add('active');
    }

    // Select Period
    function selectPeriod(label, dateStr, rev, cash, online, aov, txCountStr, targetPct) {
      document.getElementById('kpi-period-label').textContent = label;
      document.getElementById('kpi-date-text').textContent = dateStr;
      document.getElementById('kpi-revenue-display').textContent = rev;
      document.getElementById('substat-cash').textContent = cash;
      document.getElementById('substat-online').textContent = online;
      const aovEl = document.getElementById('substat-aov');
      if (aovEl) aovEl.textContent = aov;
      const txEl = document.getElementById('substat-total-tx');
      if (txEl) txEl.textContent = txCountStr;
      
      const targetLbl = document.getElementById('target-progress-label');
      if (targetLbl) targetLbl.textContent = 'Capaian Target: ' + targetPct + '%';
      const targetBar = document.getElementById('target-fill-bar');
      if (targetBar) targetBar.style.width = Math.min(targetPct, 100) + '%';

      // Update row selection styling
      const rows = document.querySelectorAll('#period-sheet .branch-select-row');
      rows.forEach(r => {
        r.classList.remove('selected');
        const check = r.querySelector('span[style*="var(--brand-green)"]');
        if (check) check.remove();
      });
      event.currentTarget.classList.add('selected');
      const checkSpan = document.createElement('span');
      checkSpan.style.cssText = 'font-size: 16px; color: var(--brand-green);';
      checkSpan.textContent = '✓';
      event.currentTarget.appendChild(checkSpan);

      closeAllSheets();
      showToast('Periode Dipilih: ' + label, 'Data penjualan diperbarui untuk ' + dateStr);
    }

    // Live Ops Tickets Data
    const opsStageTickets = {
      baru: [
        { id: '#MB-8921', customer: 'Bpk. Denny', items: '2x Mie Bang Jo Gurih, 1x Kopi Jo Aren', price: 'Rp 50.000', type: 'Tunai COD', branch: 'Pringsewu', time: '4 mnt lalu' },
        { id: '#MB-8920', customer: 'Ibu Rina', items: '1x Paket Ayam Tulang Lunak Kremes + Nasi', price: 'Rp 50.000', type: 'QRIS Mandiri', branch: 'Pringsewu', time: '8 mnt lalu' },
        { id: '#MB-8919', customer: 'Mas Kevin', items: '3x Es Teh Manis Jumbo, 1x Nasi Kulit', price: 'Rp 38.000', type: 'ShopeePay', branch: 'Gadingrejo', time: '12 mnt lalu' }
      ],
      dapur: [
        { id: '#MB-8918', customer: 'Bpk. Hendra', items: '4x Ayam Kampung Asli Lombok Ijo + 4x Nasi', price: 'Rp 144.000', type: 'GoFood', branch: 'Pringsewu', time: '15 mnt lalu' },
        { id: '#MB-8917', customer: 'Kak Vania', items: '2x Paket Ayam Geprek + 2x Es Teh Kampul', price: 'Rp 68.000', type: 'GrabFood', branch: 'Pringsewu', time: '18 mnt lalu' },
        { id: '#MB-8916', customer: 'Ibu Maya', items: '1x Mie Bang Jo Pedas Level 3', price: 'Rp 18.000', type: 'Dine-In Meja 4', branch: 'Kemiling', time: '21 mnt lalu' }
      ],
      siap: [
        { id: '#MB-8914', customer: 'Mas Fajar', items: '2x Paket Ayam Tulang Lunak Jumbo', price: 'Rp 95.000', type: 'Takeaway Kasir', branch: 'Pringsewu', time: '25 mnt lalu' },
        { id: '#MB-8913', customer: 'Bpk. Aris', items: '3x Es Kopi Jo Susu', price: 'Rp 54.000', type: 'Pickup OTW', branch: 'Gadingrejo', time: '28 mnt lalu' }
      ],
      kurir: [
        { id: '#MB-8915', customer: 'Kak Aurel', items: 'Alamat: Jl. Kenanga No. 12 (Kurir: Budi - Motor 02)', price: 'Rp 82.000', type: 'Delivery Internal', branch: 'Pringsewu', time: 'Estimasi tiba 5 mnt' },
        { id: '#MB-8912', customer: 'Bpk. Dodi', items: 'Alamat: Perum Gading No. 4B (Kurir: Ilham - Motor 01)', price: 'Rp 110.000', type: 'Delivery Internal', branch: 'Gadingrejo', time: 'Estimasi tiba 9 mnt' },
        { id: '#MB-8911', customer: 'Ibu Citra', items: 'Alamat: Jl. Teuku Umar No. 88 (Kurir: Riko - Motor 04)', price: 'Rp 65.000', type: 'Delivery Internal', branch: 'Kemiling', time: 'Estimasi tiba 14 mnt' }
      ]
    };

    let currentOpsStage = 'baru';

    function openOpsStageSheet(stage) {
      currentOpsStage = stage;
      closeAllSheets();
      document.getElementById('sheet-overlay').classList.add('active');
      const sheet = document.getElementById('ops-stage-sheet');
      sheet.classList.add('active');

      const titleMap = {
        baru: '⏳ Pesanan Baru (3 Menunggu Konfirmasi)',
        dapur: '🍳 Dapur KDS (6 Tiket Sedang Dimasak)',
        siap: '📦 Siap Serah (2 Paket Menunggu Pengambilan)',
        kurir: '🛵 Kurir OTW (3 Pengantaran Berjalan)'
      };

      const btnMap = {
        baru: '✓ Konfirmasi Semua ke Dapur',
        dapur: '✓ Tandai Dapur Selesai',
        siap: '✓ Serahkan ke Kurir / Pembeli',
        kurir: '📍 Buka Peta Pelacakan Kurir'
      };

      document.getElementById('ops-stage-sheet-title').textContent = titleMap[stage] || 'Alur Pesanan';
      document.getElementById('ops-stage-action-btn-text').textContent = btnMap[stage] || 'Aksi Tahap';

      renderStageTickets(stage);
    }

    function renderStageTickets(stage) {
      const container = document.getElementById('ops-stage-tickets-list');
      const tickets = opsStageTickets[stage] || [];
      
      let html = '';
      tickets.forEach((t, idx) => {
        html += `
          <div class="ops-ticket-card">
            <div class="ops-ticket-header">
              <div>
                <span class="ops-ticket-id">${t.id} • ${t.customer}</span>
                <span style="font-size: 10px; color: var(--text-muted); display: block;">${t.branch} • ${t.type}</span>
              </div>
              <span class="ops-ticket-time">${t.time}</span>
            </div>
            <div class="ops-ticket-items">${t.items}</div>
            <div class="ops-ticket-footer">
              <span class="ops-ticket-price">${t.price}</span>
              <button type="button" class="ops-ticket-btn" onclick="showToast('${t.id}', 'Tiket ${t.id} berhasil diproses')">Proses Tiket</button>
            </div>
          </div>
        `;
      });
      container.innerHTML = html;
    }

    function handleStageBatchAction() {
      const text = document.getElementById('ops-stage-action-btn-text').textContent;
      showToast('Aksi Berhasil', text + ' telah dieksekusi secara instan.');
      closeAllSheets();
    }

    // Menu 86 Data
    let menu86Data = [
      { id: 'm1', name: 'Ayam Tulang Lunak Kremes', cat: 'Ayam & Bebek', is86: true, price: 'Rp 50.000' },
      { id: 'm2', name: 'Kopi Jo Gula Aren', cat: 'Minuman Kopi', is86: true, price: 'Rp 18.000' },
      { id: 'm3', name: 'Pisang Bakar Coklat Keju', cat: 'Snack & Dessert', is86: true, price: 'Rp 15.000' },
      { id: 'm4', name: 'Mie Bang Jo Gurih Spesial', cat: 'Mie & Pasta', is86: false, price: 'Rp 16.000' },
      { id: 'm5', name: 'Ayam Kampung Asli Lombok Ijo', cat: 'Ayam & Bebek', is86: false, price: 'Rp 36.000' },
      { id: 'm6', name: 'Es Teh Kampul Solo Jumbo', cat: 'Minuman Dingin', is86: false, price: 'Rp 7.000' }
    ];

    function openMenu86Sheet() {
      closeAllSheets();
      document.getElementById('sheet-overlay').classList.add('active');
      const sheet = document.getElementById('menu-86-sheet');
      sheet.classList.add('active');
      renderMenu86List();
    }

    function renderMenu86List() {
      const container = document.getElementById('menu-86-items-list');
      let html = '';
      menu86Data.forEach(item => {
        html += `
          <div class="menu-86-item">
            <div class="menu-86-item-info">
              <span class="menu-86-item-name">${item.name}</span>
              <span class="menu-86-item-cat">${item.cat} • ${item.price}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 10px; font-weight: 700; color: ${item.is86 ? '#ea580c' : 'var(--brand-green-dark)'};">
                ${item.is86 ? 'Habis (86)' : 'Tersedia'}
              </span>
              <label class="ios-switch">
                <input type="checkbox" ${item.is86 ? 'checked' : ''} onchange="toggleItem86('${item.id}', this.checked)">
                <span class="ios-slider ${item.is86 ? 'blue' : 'green'}"></span>
              </label>
            </div>
          </div>
        `;
      });
      container.innerHTML = html;
    }

    function toggleItem86(itemId, isChecked) {
      const found = menu86Data.find(m => m.id === itemId);
      if (found) {
        found.is86 = isChecked;
        const count86 = menu86Data.filter(m => m.is86).length;
        document.getElementById('menu-86-summary-title').textContent = count86 + ' Menu Ditandai Habis (86)';
        const names86 = menu86Data.filter(m => m.is86).map(m => m.name.split(' ')[0]).join(', ');
        document.getElementById('menu-86-summary-sub').textContent = names86 ? (names86 + ' & lainnya') : 'Semua menu dalam kondisi tersedia penuh';
        renderMenu86List();
        showToast(found.name, isChecked ? 'Ditandai HABIS (86) - Disembunyikan dari POS & PWA' : 'Dikembalikan TERSEDIA di katalog resto');
      }
    }

    // Toggle Store Emergency Open / Close
    function toggleStoreOpen(isOpen) {
      const lbl = document.getElementById('status-toko-label');
      if (isOpen) {
        lbl.textContent = 'Buka Normal';
        lbl.style.color = 'var(--text-muted)';
        showToast('Status Toko: Buka', 'Seluruh cabang kembali beroperasi normal menerima pesanan.');
      } else {
        lbl.textContent = 'Tutup Sementara';
        lbl.style.color = '#ef4444';
        showToast('Darurat: Toko Ditutup', 'Semua order masuk ditangguhkan sementara sampai dibuka kembali.');
      }
    }

    // Toggle Store Online / Delivery Pause
    function toggleOnlineOrders(isOnline) {
      const lbl = document.getElementById('status-online-label');
      if (isOnline) {
        lbl.textContent = 'Aktif Menerima';
        lbl.style.color = 'var(--text-muted)';
        showToast('Delivery Online: Aktif', 'Kanal pesanan delivery pelanggan PWA & Food Channel kembali dibuka.');
      } else {
        lbl.textContent = 'Dijeda (Pause)';
        lbl.style.color = '#f59e0b';
        showToast('Delivery Dijeda (30 Mnt)', 'Kanal delivery di-pause sementara agar dapur tidak overload.');
      }
    }

    // Switch Top Products Tabs (Sold vs Margin)
    function switchProductTab(tab) {
      const tabSold = document.getElementById('tab-prod-sold');
      const tabMargin = document.getElementById('tab-prod-margin');
      const container = document.getElementById('product-list-container');
      if (!container) return;

      if (tab === 'sold') {
        if (tabSold) tabSold.classList.add('active');
        if (tabMargin) tabMargin.classList.remove('active');
        container.innerHTML = `
          <div class="product-item-row">
            <div class="product-left-group">
              <span class="product-rank-badge rank-gold">1</span>
              <div class="product-name-col">
                <span class="product-item-title">Paket Ayam Geprek Petruk Jumbo</span>
                <span class="product-item-sub">34 porsi terjual • Dapur Utama</span>
              </div>
            </div>
            <div class="product-right-col">
              <span class="product-item-rev">Rp 850.000</span>
              <span class="product-item-margin">Margin 68%</span>
            </div>
          </div>
          <div class="product-item-row">
            <div class="product-left-group">
              <span class="product-rank-badge rank-silver">2</span>
              <div class="product-name-col">
                <span class="product-item-title">Es Teh Kampul Solo Jumbo</span>
                <span class="product-item-sub">52 gelas terjual • Bar Minuman</span>
              </div>
            </div>
            <div class="product-right-col">
              <span class="product-item-rev">Rp 364.000</span>
              <span class="product-item-margin">Margin 82%</span>
            </div>
          </div>
          <div class="product-item-row">
            <div class="product-left-group">
              <span class="product-rank-badge rank-bronze">3</span>
              <div class="product-name-col">
                <span class="product-item-title">Nasi Kulit Sambal Bawang</span>
                <span class="product-item-sub">22 porsi terjual • Dapur Utama</span>
              </div>
            </div>
            <div class="product-right-col">
              <span class="product-item-rev">Rp 440.000</span>
              <span class="product-item-margin">Margin 64%</span>
            </div>
          </div>
        `;
      } else {
        if (tabMargin) tabMargin.classList.add('active');
        if (tabSold) tabSold.classList.remove('active');
        container.innerHTML = `
          <div class="product-item-row">
            <div class="product-left-group">
              <span class="product-rank-badge rank-gold" style="background:#08a94f;color:#fff;">1</span>
              <div class="product-name-col">
                <span class="product-item-title">Es Teh Kampul Solo Jumbo</span>
                <span class="product-item-sub">52 gelas terjual • Bar Minuman</span>
              </div>
            </div>
            <div class="product-right-col">
              <span class="product-item-rev">Rp 364.000</span>
              <span class="product-item-margin" style="color:var(--brand-green-dark);background:var(--brand-green-light);font-weight:800;">Margin 82%</span>
            </div>
          </div>
          <div class="product-item-row">
            <div class="product-left-group">
              <span class="product-rank-badge rank-silver" style="background:#05853e;color:#fff;">2</span>
              <div class="product-name-col">
                <span class="product-item-title">Kopi Jo Aren Susu</span>
                <span class="product-item-sub">28 cup terjual • Bar Minuman</span>
              </div>
            </div>
            <div class="product-right-col">
              <span class="product-item-rev">Rp 420.000</span>
              <span class="product-item-margin" style="color:var(--brand-green-dark);background:var(--brand-green-light);font-weight:800;">Margin 76%</span>
            </div>
          </div>
          <div class="product-item-row">
            <div class="product-left-group">
              <span class="product-rank-badge rank-bronze" style="background:#04632e;color:#fff;">3</span>
              <div class="product-name-col">
                <span class="product-item-title">Paket Ayam Geprek Petruk Jumbo</span>
                <span class="product-item-sub">34 porsi terjual • Dapur Utama</span>
              </div>
            </div>
            <div class="product-right-col">
              <span class="product-item-rev">Rp 850.000</span>
              <span class="product-item-margin" style="color:var(--brand-green-dark);background:var(--brand-green-light);font-weight:800;">Margin 68%</span>
            </div>
          </div>
        `;
      }
    }
"""

if 'openOpsStageSheet' not in text:
    text = text.replace('  </script>', js_methods + '\n  </script>')
    print("Injected JS methods.")

with open(path, "w", encoding="utf-8") as f:
    f.write(text)

print("Prototype enhancement complete.")
