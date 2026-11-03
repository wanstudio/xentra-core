const puppeteer = require('puppeteer-core');
const path = require('path');

const ARTIFACT_DIR = '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff';

async function main() {
  console.log('Launching Chromium for 1:1 Prototype Parity Verification...');
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.setViewport({ width: 412, height: 860, deviceScaleFactor: 2 });

  // Disable ServiceWorker in puppeteer to avoid reload on test
  await page.evaluateOnNewDocument(() => {
    delete window.navigator.serviceWorker;
    localStorage.setItem('xentra_driver_token', 'valid-driver-token');
    localStorage.setItem('xentra_driver_user', JSON.stringify({
      id: 'drv-1',
      full_name: 'Agus Setiawan',
      username: 'agus_kurir',
      phone: '085711223344',
      nik: '1810011205940002',
      branch_id: 'b-1',
      branch_name: 'MyBangjo Pringsewu'
    }));
  });

  // Intercept driver API
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/api/v1/driver/history')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          deliveries: [
            {
              order_id: 'ord-mb-8921',
              order_number: 'MB-8921',
              delivery_status: 'delivered',
              customer: { name: 'Ibu Siti Rahma', phone: '081234567890' },
              destination: { address: 'Jl. Melati No. 14 (1.8 km)' },
              payment: { is_cod: true, amount: 65000, collected_amount: 65000, settled_at: null }
            },
            {
              order_id: 'ord-mb-8914',
              order_number: 'MB-8914',
              delivery_status: 'delivered',
              customer: { name: 'Pak Hendra Wijaya', phone: '081299887766' },
              destination: { address: 'Jl. Sudirman No. 88 (1.5 km)' },
              payment: { is_cod: false, amount: 48000 }
            }
          ]
        })
      });
    } else if (url.includes('/api/v1/driver/')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          driver: {
            id: 'drv-1',
            full_name: 'Agus Setiawan',
            username: 'agus_kurir',
            phone: '085711223344',
            nik: '1810011205940002',
            branch_id: 'b-1',
            branch_name: 'MyBangjo Pringsewu',
            vehicle_type: 'motorcycle',
            avatar_url: '/owner/assets/img/cat-chef-recipe.png',
            status: 'online'
          },
          is_online: true,
          tasks: [{
            order_id: 'ord-mb-8921',
            order_number: 'MB-8921',
            delivery_status: 'assigned',
            assignment_status: 'accepted',
            distance_meters: 2400,
            duration_seconds: 360,
            customer: {
              name: 'Ibu Siti Rahma',
              phone: '081234567890',
              address: 'Jl. Melati No. 14, RT 02 / RW 01, Pringsewu Barat',
              note: 'Membayar dengan uang Rp 100.000'
            },
            destination: {
              address: 'Jl. Melati No. 14, RT 02 / RW 01, Pringsewu Barat',
              note: 'Pagar hitam, sebelah warung Bu Sri.',
              latitude: -5.3645,
              longitude: 104.9820
            },
            payment: { is_cod: true, amount: 65000, collected_amount: 65000 },
            pickup: { branch_name: 'MyBangjo Pringsewu', address: 'Jl. Raya Pringsewu No. 88' },
            items: [
              { id: 1, product_name: 'Ayam Goreng Kremes', quantity: 2 },
              { id: 2, product_name: 'Sambal Bawang Ekstra', quantity: 1 },
              { id: 3, product_name: 'Es Teh Manis Jumbo', quantity: 2 }
            ]
          }]
        })
      });
    } else {
      req.continue();
    }
  });

  await page.goto('http://localhost:3001/driver/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));

  // Remove splash
  await page.evaluate(() => {
    if (window.Xentra && window.Xentra.hideSplash) window.Xentra.hideSplash();
    const splash = document.getElementById('x-splash');
    if (splash) splash.remove();
  });

  // 0. Capture Step 0: Task Hub Screen
  console.log('0. Capturing Step 0 Task Hub...');
  await page.evaluate(() => {
    window.__driverState.history = [
      { order_id: 'h1', delivery_status: 'delivered', payment: { is_cod: true, amount: 65000, settled_at: null } },
      { order_id: 'h2', delivery_status: 'delivered', payment: { is_cod: false, amount: 48000 } }
    ];
    window.__driverState.page = 'tasks';
    window.__driverRender();
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_v3_step0_task_hub_amoled.png'),
    fullPage: false
  });

  // 1. Capture Step 2: Pickup Screen (AMOLED + Stepper Node 1 + Cash Float + Checklist + Slider)
  console.log('1. Capturing Step 2 Pickup (AMOLED + Slider)...');
  await page.evaluate(() => {
    window.__driverState.selectedOrderId = 'ord-mb-8921';
    window.__driverState.pickupChecks = { 1: true, 2: true, 3: true };
    window.__driverState.page = 'pickup';
    window.__driverRender();
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_v3_step2_pickup_amoled.png'),
    fullPage: false
  });

  // 2. Capture Step 3: OTW Screen (AMOLED + Stepper Node 2 + Map + Slider Arrive)
  console.log('2. Capturing Step 3 OTW Map (AMOLED + Slider)...');
  await page.evaluate(() => {
    window.__driverState.page = 'map';
    const task = window.__driverState.tasks.find(t => t.order_id === 'ord-mb-8921');
    if (task) {
      task.delivery_status = 'on_delivery';
      task.arrived_at = null;
    }
    window.__driverRender();
  });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_v3_step3_otw_amoled.png'),
    fullPage: false
  });

  // 3. Capture Step 4: Arrived / POD Completion COD (AMOLED + Stepper Node 3 + COD Calc + Slider Finish)
  console.log('3. Capturing Step 4 POD COD (AMOLED + Slider)...');
  await page.evaluate(() => {
    const task = window.__driverState.tasks.find(t => t.order_id === 'ord-mb-8921');
    if (task) {
      task.payment = { is_cod: true, amount: 65000 };
    }
    window.__driverState.podPhoto = '/owner/assets/img/cat-chef-recipe.png';
    window.__driverState.tenderedAmount = 100000;
    window.__driverState.page = 'complete-action';
    window.__driverRender();
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_v3_step4_pod_cod_amoled.png'),
    fullPage: false
  });

  // 4. Capture Step 4: Arrived / POD Completion QRIS Anti-Salah Tagih
  console.log('4. Capturing Step 4 POD QRIS Anti-Salah Tagih (AMOLED + Slider)...');
  await page.evaluate(() => {
    const task = window.__driverState.tasks.find(t => t.order_id === 'ord-mb-8921');
    if (task) {
      task.payment = { is_cod: false, amount: 65000 };
    }
    window.__driverState.page = 'complete-action';
    window.__driverRender();
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_v3_step4_pod_qris_amoled.png'),
    fullPage: false
  });

  // 5. Capture Step 5: Cashier Settlement QR (COD Remittance)
  console.log('5. Capturing Step 5 Cashier Settlement QR...');
  await page.evaluate(() => {
    const task = window.__driverState.tasks.find(t => t.order_id === 'ord-mb-8921');
    if (task) {
      task.payment = { is_cod: true, amount: 65000, collected_amount: 65000 };
    }
    window.__driverState.lastCompleted = task;
    window.__driverState.cashSettledByKasir = false;
    window.__driverState.page = 'complete';
    window.__driverRender();
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_v3_step5_settlement_qr_amoled.png'),
    fullPage: false
  });

  // 6. Capture Step 6: Return To Store (RTS) Screen
  console.log('6. Capturing Step 6 RTS (AMOLED + 4-Node Stepper + Red Slider)...');
  await page.evaluate(() => {
    window.__driverState.activeRtsTask = {
      task: {
        order_id: 'ord-mb-8921',
        order_number: 'MB-8921',
        customer: { name: 'Ibu Siti Rahma' },
        pickup: { branch_name: 'MyBangjo Pringsewu' },
        payment: { is_cod: true, amount: 65000 }
      },
      reason: 'Pelanggan Tidak Merespons (>10 Menit)'
    };
    window.__driverState.page = 'return-to-store';
    window.__driverRender();
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_v3_step6_rts_amoled.png'),
    fullPage: false
  });

  // 7. Capture History Screen
  console.log('7. Capturing History & Shift Remittance Screen...');
  await page.evaluate(async () => {
    await window.__driverGo('history');
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_v3_history_amoled.png'),
    fullPage: false
  });

  // 8. Capture Profile Screen
  console.log('8. Capturing Profile Screen...');
  await page.evaluate(async () => {
    await window.__driverGo('profile');
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'driver_v3_profile_amoled.png'),
    fullPage: false
  });

  console.log('All 9 AMOLED v3 states successfully captured!');
  await browser.close();
}

main().catch(err => {
  console.error('Capture error:', err);
  process.exit(1);
});
