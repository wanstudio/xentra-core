import re

path = "/home/ubuntu/xentra-core/apps/merchant-shared/prototypes/owner-beranda-2026.html"
with open(path, "r", encoding="utf-8") as f:
    text = f.read()

# 1. Update Substats Row in hero-sales-card
old_substat = """            <div class="substat-cell">
              <span class="substat-title">Total Transaksi</span>
              <span class="substat-value" id="substat-total-tx">81 transaksi</span>
              <span class="substat-desc">78 berhasil | 3 batal</span>
            </div>"""

new_substat = """            <div class="substat-cell">
              <span class="substat-title">Rata-rata Order</span>
              <span class="substat-value" id="substat-aov">Rp 53.3rb</span>
              <span class="substat-desc" id="substat-total-tx">81 total pesanan</span>
            </div>"""

if old_substat in text:
    text = text.replace(old_substat, new_substat)
    print("Replaced 3rd substat with AOV.")

# 2. Extract section-wrap (Alur Pesanan Berjalan)
sec_wrap_match = re.search(r"(<!-- ── 4\. LIVE RESTAURANT OPERATIONS RADAR.*?<\/section>)", text, re.DOTALL)
if sec_wrap_match:
    sec_wrap_content = sec_wrap_match.group(1)
    # Remove it from its old location
    text = text.replace(sec_wrap_content, "")
    print("Extracted section-wrap.")

    # Modernize stage cards in sec_wrap_content to have click handlers openOpsStageSheet
    sec_wrap_content = re.sub(r"onclick=\"showToast\('Pesanan Baru',[^)]*\)\"", "onclick=\"openOpsStageSheet('baru')\"", sec_wrap_content)
    sec_wrap_content = re.sub(r"onclick=\"showToast\('Dapur \(KDS\)',[^)]*\)\"", "onclick=\"openOpsStageSheet('dapur')\"", sec_wrap_content)
    sec_wrap_content = re.sub(r"onclick=\"showToast\('Siap Serah',[^)]*\)\"", "onclick=\"openOpsStageSheet('siap')\"", sec_wrap_content)
    sec_wrap_content = re.sub(r"onclick=\"showToast\('Kurir Mengantar',[^)]*\)\"", "onclick=\"openOpsStageSheet('kurir')\"", sec_wrap_content)

    emergency_card_html = """
        <!-- ── 3. LIVE RESTAURANT OPERATIONS RADAR (Alur Pesanan Berjalan) ── -->
""" + sec_wrap_content + """

        <!-- ── 4. PUSAT KENDALI OPERASIONAL & DARURAT CABANG ── -->
        <section class="emergency-control-card" id="emergency-control-section">
          <div class="section-header-row" style="margin-bottom: 4px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 15px;">⚡</span>
              <h3 class="section-title">Kendali Cepat Cabang</h3>
            </div>
            <span class="emergency-branch-tag" id="emergency-branch-tag">Semua Cabang Aktif</span>
          </div>

          <!-- Switch Grid: 2 Clean iOS Toggles -->
          <div class="emergency-toggle-grid">
            <!-- 1. Toko Buka / Tutup -->
            <div class="emergency-toggle-card">
              <div class="emergency-toggle-info">
                <span class="emergency-toggle-title">Status Toko</span>
                <span class="emergency-toggle-desc" id="status-toko-label">Buka Normal</span>
              </div>
              <label class="ios-switch">
                <input type="checkbox" id="switch-status-toko" checked onchange="toggleStoreOpen(this.checked)">
                <span class="ios-slider green"></span>
              </label>
            </div>

            <!-- 2. Pesanan Online / Delivery -->
            <div class="emergency-toggle-card">
              <div class="emergency-toggle-info">
                <span class="emergency-toggle-title">Pesanan Online</span>
                <span class="emergency-toggle-desc" id="status-online-label">Aktif Menerima</span>
              </div>
              <label class="ios-switch">
                <input type="checkbox" id="switch-status-online" checked onchange="toggleOnlineOrders(this.checked)">
                <span class="ios-slider blue"></span>
              </label>
            </div>
          </div>

          <!-- 3. Menu Habis (86 Intervention) Banner -->
          <div class="menu-86-banner" onclick="openMenu86Sheet()">
            <div class="menu-86-left">
              <span class="menu-86-icon">🚫</span>
              <div class="menu-86-text">
                <span class="menu-86-title" id="menu-86-summary-title">3 Menu Ditandai Habis (86)</span>
                <span class="menu-86-sub" id="menu-86-summary-sub">Ayam Tulang Lunak, Kopi Jo & Pisang Bakar</span>
              </div>
            </div>
            <button type="button" class="btn-manage-86">
              <span>Kelola 86</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </section>
"""

    # Insert right after </section> of hero-sales-card
    target_needle = "</section>\n\n        <!-- ── 3. PERFORMA ANTAR CABANG"
    if target_needle in text:
        text = text.replace(target_needle, "</section>\n" + emergency_card_html + "\n        <!-- ── 5. PERFORMA ANTAR CABANG")
        print("Inserted Alur Pesanan & Emergency Card right after hero card.")
    else:
        text = re.sub(r"(<\/section>[\s\r\n]+<!-- ── 3\. PERFORMA ANTAR CABANG)", r"</section>\n" + emergency_card_html + r"\n        <!-- ── 5. PERFORMA ANTAR CABANG", text, count=1)
        print("Inserted via regex.")

with open(path, "w", encoding="utf-8") as f:
    f.write(text)

print("Step 1 & 2 complete.")
