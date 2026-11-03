const puppeteer = require('/home/ubuntu/xentra-core/node_modules/puppeteer-core');
const path = require('path');
const fs = require('fs');

const artifactDir = '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff';

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 440, height: 920, deviceScaleFactor: 2 }
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:3001/driver/prototype', { waitUntil: 'networkidle0' });

  // 1. Standby
  await page.evaluate(() => goToStep(0));
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'driver_clean_v2_0_standby.png') });

  // 2. Incoming
  await page.evaluate(() => goToStep(1));
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'driver_clean_v2_1_alert.png') });

  // 3. Pickup
  await page.evaluate(() => {
    goToStep(2);
    toggleKitchenReady();
    toggleItem(0);
    toggleItem(1);
    toggleItem(2);
  });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'driver_clean_v2_2_pickup.png') });

  // 4. OTW
  await page.evaluate(() => goToStep(3));
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'driver_clean_v2_3_otw.png') });

  // 5. COD
  await page.evaluate(() => goToStep(4));
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'driver_clean_v2_4_cod.png') });

  // 6. Setor Kasir
  await page.evaluate(() => {
    state.driverCashCustody = 65000;
    state.cashSettledByKasir = false;
    goToStep(5);
  });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'driver_clean_v2_5_setor.png') });

  // 7. Profile
  await page.evaluate(() => openProfileScreen());
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(artifactDir, 'driver_clean_v2_6_profile.png') });

  await browser.close();
  console.log('All clean v2 screenshots captured!');
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
