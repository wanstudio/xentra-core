const puppeteer = require('/home/ubuntu/xentra-core/node_modules/puppeteer-core');
const path = require('path');
const fs = require('fs');

const artifactDir = '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff';

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 500, height: 980, deviceScaleFactor: 2 }
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:3001/driver/prototype', { waitUntil: 'networkidle0' });

  // 1. Step 0: Standby
  await page.evaluate(() => goToStep(0));
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_0_standby.png') });
  console.log('Saved step 0');

  // 2. Step 1: Alert
  await page.evaluate(() => goToStep(1));
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_1_alert.png') });
  console.log('Saved step 1');

  // 3. Step 2: Pickup (simulate kitchen ready & checklist)
  await page.evaluate(() => {
    goToStep(2);
    toggleKitchenReady();
    toggleItemCheck(0);
    toggleItemCheck(1);
    toggleItemCheck(2);
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_2_pickup.png') });
  console.log('Saved step 2');

  // 4. Step 3: OTW Antar
  await page.evaluate(() => goToStep(3));
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_3_otw.png') });
  console.log('Saved step 3');

  // 5. Step 4: COD Tagihan & Kembalian
  await page.evaluate(() => {
    goToStep(4);
    setTendered(100000);
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_4_cod.png') });
  console.log('Saved step 4');

  // 6. Step 5: Kasir Settlement Pending
  await page.evaluate(() => {
    state.driverCashCustody = 65000;
    state.cashSettledByKasir = false;
    goToStep(5);
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_5_kasir_ticket.png') });
  console.log('Saved step 5 pending');

  // 7. Step 5b: Kasir Validated (Lunas)
  await page.evaluate(() => {
    simulateKasirValidate();
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_6_kasir_settled.png') });
  console.log('Saved step 5 settled');

  await browser.close();
  console.log('All screenshots captured successfully!');
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
