const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff';

async function main() {
  console.log('Launching Chromium for Visual Verification...');
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const mobilePage = await browser.newPage();
  await mobilePage.setViewport({ width: 412, height: 860, deviceScaleFactor: 2 });

  // -------------------------------------------------------------
  // 1. Prototype Step 6: Return To Store (RTS)
  // -------------------------------------------------------------
  console.log('1. Capturing Prototype Step 6 RTS...');
  await mobilePage.goto('http://localhost:3001/driver/prototype.html', { waitUntil: 'networkidle0' });
  await mobilePage.evaluate(() => {
    goToStep(6);
  });
  await new Promise(r => setTimeout(r, 600));
  await mobilePage.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_proto_step6_rts.png'),
    fullPage: false
  });

  // -------------------------------------------------------------
  // 2. Prototype Step 4: Non-Tunai / QRIS (Anti-Salah Tagih Banner)
  // -------------------------------------------------------------
  console.log('2. Capturing Prototype Step 4 QRIS Anti-Salah Tagih...');
  await mobilePage.evaluate(() => {
    state.paymentType = 'QRIS';
    state.orderAmount = 65000;
    goToStep(4);
  });
  await new Promise(r => setTimeout(r, 600));
  await mobilePage.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_proto_step4_qris.png'),
    fullPage: false
  });

  // Setup Request Interception for Driver Production App
  await mobilePage.setRequestInterception(true);
  mobilePage.on('request', req => {
    const url = req.url();
    if (url.includes('/api/v1/driver/')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          driver: {
            id: 'drv-1',
            name: 'Budi Pratama (Kurir)',
            phone: '081234567890',
            branch_id: 'b-1',
            branch_name: 'Cabang Pringsewu',
            vehicle_type: 'motorcycle',
            vehicle_plate: 'B 4521 ABC',
            status: 'online'
          },
          is_online: true,
          tasks: [{
            order_id: 'ord-mb-8921',
            order_number: 'MB-8921',
            delivery_status: 'on_delivery',
            customer: { name: 'Ibu Siti Rahma', phone: '081234567890', address: 'Jl. Melati No. 14, Pringsewu Barat' },
            payment: { is_cod: true, amount: 65000, collected_amount: 65000 },
            pickup: { branch_name: 'MyBangjo Cabang Pringsewu' },
            items: [{ id: 1, product_name: 'Ayam Geprek Sambal Korek', quantity: 2 }]
          }]
        })
      });
    } else {
      req.continue();
    }
  });

  // Pre-seed token
  await mobilePage.evaluateOnNewDocument(() => {
    localStorage.setItem('xentra_driver_token', 'valid-driver-token');
    localStorage.setItem('xentra_driver_user', JSON.stringify({
      id: 'drv-1',
      name: 'Budi Pratama (Kurir)',
      phone: '081234567890',
      branch_id: 'b-1',
      branch_name: 'Cabang Pringsewu'
    }));
  });

  // -------------------------------------------------------------
  // 3. Production Driver App Step 6: Return To Store (RTS) Screen
  // -------------------------------------------------------------
  console.log('3. Capturing Production Driver App Step 6 RTS...');
  await mobilePage.goto('http://localhost:3001/driver/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 600));

  await mobilePage.evaluate(() => {
    if (window.Xentra && window.Xentra.hideSplash) window.Xentra.hideSplash();
    const splash = document.getElementById('x-splash');
    if (splash) splash.remove();

    window.__driverState.activeRtsTask = {
      task: {
        order_id: 'ord-mb-8921',
        order_number: 'MB-8921',
        customer: { name: 'Ibu Siti Rahma' },
        pickup: { branch_name: 'MyBangjo Cabang Pringsewu' },
        payment: { is_cod: true, amount: 65000 }
      },
      reason: 'Pelanggan Tidak Dapat Dihubungi (>10 Menit)'
    };
    window.__driverState.page = 'return-to-store';
    if (typeof window.__driverRender === 'function') window.__driverRender();
  });
  await new Promise(r => setTimeout(r, 600));
  await mobilePage.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_prod_step6_rts.png'),
    fullPage: false
  });

  // -------------------------------------------------------------
  // 4. Production Driver App Step 4: Anti-Salah Tagih Banner (QRIS)
  // -------------------------------------------------------------
  console.log('4. Capturing Production Driver App Step 4 QRIS Anti-Salah Tagih...');
  await mobilePage.evaluate(() => {
    window.__driverState.tasks = [{
      order_id: 'ord-mb-8921',
      order_number: 'MB-8921',
      delivery_status: 'on_delivery',
      customer: { name: 'Ibu Siti Rahma', phone: '0812-3456-7890' },
      payment: { is_cod: false, amount: 65000 },
      pickup: { branch_name: 'MyBangjo Cabang Pringsewu' },
      items: [{ id: 'it-1', product_name: 'Ayam Geprek Sambal Korek Level 3', quantity: 2 }]
    }];
    window.__driverState.selectedOrderId = 'ord-mb-8921';
    window.__driverState.podPhoto = null;
    window.__driverState.podBypass = null;
    window.__driverState.page = 'complete-action';
    if (typeof window.__driverRender === 'function') window.__driverRender();
  });
  await new Promise(r => setTimeout(r, 600));
  await mobilePage.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_prod_step4_antisalahtagih.png'),
    fullPage: false
  });

  // -------------------------------------------------------------
  // 5. Production Driver App Step 4: COD with Quick Calculator Chips
  // -------------------------------------------------------------
  console.log('5. Capturing Production Driver App Step 4 COD Quick Calculator...');
  await mobilePage.evaluate(() => {
    window.__driverState.tasks = [{
      order_id: 'ord-mb-8922',
      order_number: 'MB-8922',
      delivery_status: 'on_delivery',
      customer: { name: 'Budi Santoso', phone: '0813-9876-5432' },
      payment: { is_cod: true, amount: 65000 },
      pickup: { branch_name: 'MyBangjo Cabang Pringsewu' },
      items: [{ id: 'it-2', product_name: 'Bebek Goreng Kremes Sambal Terasi', quantity: 1 }]
    }];
    window.__driverState.selectedOrderId = 'ord-mb-8922';
    window.__driverState.tenderedAmount = 100000;
    window.__driverState.podPhoto = null;
    window.__driverState.podBypass = null;
    window.__driverState.page = 'complete-action';
    if (typeof window.__driverRender === 'function') window.__driverRender();
  });
  await new Promise(r => setTimeout(r, 600));
  await mobilePage.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_prod_step4_cod_calculator.png'),
    fullPage: false
  });

  // -------------------------------------------------------------
  // 6. Production Driver App Step 5: COD Settlement QR Code
  // -------------------------------------------------------------
  console.log('6. Capturing Production Driver App Step 5 Settlement QR...');
  await mobilePage.evaluate(() => {
    window.__driverState.lastCompleted = {
      order_id: 'ord-mb-8922',
      order_number: 'MB-8922',
      delivery_status: 'delivered',
      customer: { name: 'Budi Santoso' },
      payment: { is_cod: true, amount: 65000, collected_amount: 65000 },
      pickup: { branch_name: 'MyBangjo Cabang Pringsewu' }
    };
    window.__driverState.page = 'complete';
    if (typeof window.__driverRender === 'function') window.__driverRender();
  });
  await new Promise(r => setTimeout(r, 600));
  await mobilePage.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_prod_step5_settlement_qr.png'),
    fullPage: false
  });

  // -------------------------------------------------------------
  // 7. POS App: Modal Kurir Drawer Handover Quick Chips
  // -------------------------------------------------------------
  console.log('7. Capturing POS App Drawer Kurir Handover Quick Chips...');
  const posPage = await browser.newPage();
  await posPage.setViewport({ width: 412, height: 860, deviceScaleFactor: 2 });
  await posPage.goto('http://localhost:3001/pos/', { waitUntil: 'domcontentloaded' });
  await posPage.evaluate(() => {
    if (window.Xentra && window.Xentra.hideSplash) window.Xentra.hideSplash();
    const splash = document.getElementById('x-splash');
    if (splash) splash.remove();

    if (typeof openCashMovementModal === 'function') {
      openCashMovementModal('out');
    }
  });
  await new Promise(r => setTimeout(r, 600));
  await posPage.screenshot({
    path: path.join(ARTIFACT_DIR, 'pos_prod_driver_drawer.png'),
    fullPage: false
  });

  // -------------------------------------------------------------
  // 8. POS App: Scan QR Setoran COD Kurir Modal
  // -------------------------------------------------------------
  console.log('8. Capturing POS App Scan QR COD Modal...');
  await posPage.evaluate(() => {
    const prevModal = document.getElementById('pos-cash-movement-modal');
    if (prevModal) prevModal.remove();

    if (typeof openPosCodScannerModal === 'function') {
      openPosCodScannerModal();
    }
  });
  await new Promise(r => setTimeout(r, 600));
  await posPage.screenshot({
    path: path.join(ARTIFACT_DIR, 'pos_prod_scan_cod_modal.png'),
    fullPage: false
  });

  // -------------------------------------------------------------
  // 9. Merchant App: Auto-Dispatch vs Manual Tabs Modal (Desktop view)
  // -------------------------------------------------------------
  console.log('9. Capturing Merchant App Dispatch Modal...');
  const desktopPage = await browser.newPage();
  await desktopPage.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1.5 });
  await desktopPage.goto('http://localhost:3001/merchant-app/index.html', { waitUntil: 'domcontentloaded' });
  await desktopPage.evaluate(() => {
    if (window.Xentra && window.Xentra.hideSplash) window.Xentra.hideSplash();
    const splash = document.getElementById('x-splash');
    if (splash) splash.remove();

    const modal = document.getElementById('bm-order-modal');
    const title = document.getElementById('bm-modal-title');
    const body = document.getElementById('bm-modal-body');
    const selector = document.getElementById('bm-dispatch-selector');

    if (modal && selector) {
      if (title) title.textContent = 'Pesanan #MB-8921 • Delivery';
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
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:12px;font-weight:700;color:#0f172a;">
            <div>Budi Pratama (Kurir B)</div>
            <div style="font-size:11px;color:#64748b;">Honda Beat • B 4521 ABC</div>
          </td>
          <td style="padding:12px;font-weight:700;color:#0f172a;">#MB-8921</td>
          <td style="padding:12px;font-weight:800;color:#92400e;">Rp 65.000</td>
          <td style="padding:12px;">
            <span style="background:#fef3c7;color:#92400e;font-size:11.5px;font-weight:800;padding:4px 8px;border-radius:6px;display:inline-block;">
              ⚠️ Di Tangan Kurir (Belum Disetor)
            </span>
          </td>
          <td style="padding:12px;font-size:11.5px;color:#64748b;">31 Okt 2026, 11:20 WIB</td>
          <td style="padding:12px;">
            <span style="font-size:11px;color:#64748b;">Menunggu scan setoran kasir</span>
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

  await browser.close();
  console.log('All screenshots captured successfully!');
}

main().catch(err => {
  console.error('Capture error:', err);
  process.exit(1);
});
