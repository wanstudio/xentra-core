const puppeteer = require('puppeteer-core');
const path = require('path');

const ARTIFACT_DIR = '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff';

async function main() {
  console.log('Capturing remaining surfaces (Merchant & Owner)...');
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const desktopPage = await browser.newPage();
  await desktopPage.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1.5 });

  await desktopPage.setRequestInterception(true);
  desktopPage.on('request', req => {
    const url = req.url();
    if (url.includes('/api/v1/admin/auth/me') || url.includes('/api/v1/auth/me')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          user: { id: 'u-1', name: 'Owner Resto', role: 'owner', branch_id: 'b-1' }
        })
      });
    } else if (url.includes('/api/v1/admin/branches')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          branches: [{ id: 'b-1', name: 'Cabang Pringsewu', dispatch_mode: 'auto', auto_dispatch_timeout_seconds: 60 }]
        })
      });
    } else if (url.includes('/api/v1/admin/drivers')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          drivers: [
            { id: 'drv-1', name: 'Budi Pratama (Kurir B)', vehicle_plate: 'B 4521 ABC', is_online: 1, active_tasks: 0 },
            { id: 'drv-2', name: 'Ahmad Santoso (Kurir A)', vehicle_plate: 'BE 1234 XY', is_online: 1, active_tasks: 1 }
          ]
        })
      });
    } else if (url.includes('/api/v1/admin/finance/cod-custody')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          total_unremitted: 65000,
          pending_count: 1,
          ledger: [{
            order_id: 'ord-mb-8921',
            order_number: 'MB-8921',
            driver_id: 'drv-1',
            driver_name: 'Budi Pratama (Kurir B)',
            vehicle_plate: 'B 4521 ABC',
            cod_collected_amount: 65000,
            cod_cash_custody: 'driver',
            delivered_at: '2026-10-31T11:20:00Z',
            is_settled: 0
          }]
        })
      });
    } else {
      req.continue();
    }
  });

  await desktopPage.evaluateOnNewDocument(() => {
    localStorage.setItem('xentra_merchant_token', 'mock-merchant-token');
    localStorage.setItem('xentra_merchant_user', JSON.stringify({
      id: 'u-1',
      name: 'Owner Resto',
      role: 'owner',
      branch_id: 'b-1'
    }));
  });

  // -------------------------------------------------------------
  // 9. Merchant App: Auto-Dispatch vs Manual Tabs Modal
  // -------------------------------------------------------------
  console.log('9. Capturing Merchant App Dispatch Modal...');
  await desktopPage.goto('http://localhost:3001/merchant-app/index.html', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 600));

  await desktopPage.evaluate(() => {
    if (window.Xentra && window.Xentra.hideSplash) window.Xentra.hideSplash();
    const splash = document.getElementById('x-splash');
    if (splash) splash.remove();

    const modal = document.getElementById('bm-order-modal');
    const title = document.getElementById('bm-modal-title');
    const body = document.getElementById('bm-modal-body');
    const selector = document.getElementById('bm-dispatch-selector');

    if (modal && selector) {
      if (title) title.textContent = 'Pesanan #MB-8921 • Pengantaran Delivery';
      if (body) {
        body.innerHTML = `
          <div style="padding:16px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:14px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:800;font-size:15px;color:#0f172a;">Pelanggan: Ibu Siti Rahma</span>
                <span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:800;padding:3px 8px;border-radius:6px;">COD Rp 65.000</span>
              </div>
              <div style="font-size:12.5px;color:#64748b;margin-top:4px;">Jl. Melati No. 14, Pringsewu Barat (1.8 km)</div>
            </div>
          </div>
        `;
      }
      selector.style.display = 'block';

      // Pre-populate driver list in manual select
      const driverSelect = document.getElementById('bm-select-driver');
      if (driverSelect) {
        driverSelect.innerHTML = `
          <option value="">-- Pilih Kurir Outlet --</option>
          <option value="drv-1" selected>🛵 Budi Pratama (B 4521 ABC) - Siap (0 Antaran)</option>
          <option value="drv-2">🛵 Ahmad Santoso (BE 1234 XY) - Sibuk (1 Antaran)</option>
        `;
      }

      modal.classList.add('active');
      modal.style.display = 'flex';
    }
  });
  await new Promise(r => setTimeout(r, 600));
  await desktopPage.screenshot({
    path: path.join(ARTIFACT_DIR, 'merchant_prod_dispatch_modal.png'),
    fullPage: false
  });

  // -------------------------------------------------------------
  // 10. Owner App: COD Custody & Courier Liability Tab
  // -------------------------------------------------------------
  console.log('10. Capturing Owner App COD Custody Ledger...');
  await desktopPage.goto('http://localhost:3001/owner/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 600));

  await desktopPage.evaluate(() => {
    if (window.Xentra && window.Xentra.hideSplash) window.Xentra.hideSplash();
    const splash = document.getElementById('x-splash');
    if (splash) splash.remove();

    const tbody = document.getElementById('fin-cod-tbody');
    const badge = document.getElementById('owner-cod-liability-badge');
    const tabFin = document.getElementById('tab-fin-cod-custody');

    if (badge) badge.textContent = 'Rp 65.000 (1 Tertahan)';
    if (tbody) {
      tbody.innerHTML = `
        <tr style="border-bottom:1px solid #e2e8f0;background:#ffffff;">
          <td style="padding:14px;font-weight:700;color:#0f172a;">
            <div style="font-size:13.5px;">Budi Pratama (Kurir B)</div>
            <div style="font-size:11.5px;color:#64748b;">Honda Beat • B 4521 ABC</div>
          </td>
          <td style="padding:14px;font-weight:700;color:#0f172a;">#MB-8921</td>
          <td style="padding:14px;font-weight:800;color:#92400e;font-size:14px;">Rp 65.000</td>
          <td style="padding:14px;">
            <span style="background:#fef3c7;border:1px solid #fde68a;color:#92400e;font-size:11.5px;font-weight:800;padding:4px 8px;border-radius:6px;display:inline-block;">
              ⚠️ Di Tangan Kurir (Belum Disetor)
            </span>
          </td>
          <td style="padding:14px;font-size:12px;color:#64748b;">31 Okt 2026, 11:20 WIB</td>
          <td style="padding:14px;">
            <span style="font-size:11.5px;color:#64748b;">Menunggu scan setoran kasir</span>
          </td>
        </tr>
      `;
    }

    document.querySelectorAll('.owner-subview').forEach(v => v.style.display = 'none');
    const viewFin = document.getElementById('owner-view-finance');
    if (viewFin) viewFin.style.display = 'block';

    document.querySelectorAll('.fin-subnav-pill').forEach(p => p.classList.remove('active'));
    const pill = document.querySelector('[data-fin-subtab="cod-custody"]');
    if (pill) pill.classList.add('active');

    if (tabFin) tabFin.style.display = 'block';
  });
  await new Promise(r => setTimeout(r, 600));
  await desktopPage.screenshot({
    path: path.join(ARTIFACT_DIR, 'owner_prod_cod_custody_tab.png'),
    fullPage: false
  });

  // -------------------------------------------------------------
  // 11. Customer PWA: Order Received / Live Tracking & In-App Chat
  // -------------------------------------------------------------
  console.log('11. Capturing Customer PWA Live Tracking & Chat...');
  const customerPage = await browser.newPage();
  await customerPage.setViewport({ width: 412, height: 860, deviceScaleFactor: 2 });
  await customerPage.goto('http://localhost:3001/order-received?order_id=ord-mb-8921', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 800));
  await customerPage.screenshot({
    path: path.join(ARTIFACT_DIR, 'customer_prod_tracking_chat.png'),
    fullPage: false
  });

  await browser.close();
  console.log('Remaining surfaces captured successfully!');
}

main().catch(err => {
  console.error('Capture error:', err);
  process.exit(1);
});
