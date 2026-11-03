const puppeteer = require('/home/ubuntu/xentra-core/node_modules/puppeteer-core');
const path = require('path');
const fs = require('fs');

const artifactDir = '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff';

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 480, height: 960, deviceScaleFactor: 2 }
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:3001/driver/prototype', { waitUntil: 'networkidle0' });

  // 1. Go to Profile Tab
  await page.evaluate(() => openProfileTab());
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_profile_overview.png') });
  console.log('Saved profile overview');

  // 2. Open Edit Vehicle Modal
  await page.evaluate(() => openEditVehicleModal());
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_profile_edit_vehicle.png') });
  console.log('Saved profile edit vehicle modal');

  // 3. Close modal and show Incomplete SIM state
  await page.evaluate(() => {
    closeModal();
    state.driverProfile.isFullyCompliant = false;
    render();
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_profile_compliance_warning.png') });
  console.log('Saved profile compliance warning');

  await browser.close();
  console.log('Profile screenshots done!');
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
