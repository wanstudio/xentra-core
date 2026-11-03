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

  // 1. Standby Screen (clean header, no bottom bar)
  await page.evaluate(() => goToStep(0));
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_clean_header.png') });
  console.log('Saved clean header standby');

  // 2. Open Profile Screen by tapping header avatar
  await page.evaluate(() => openProfileScreen());
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_clean_profile.png') });
  console.log('Saved clean profile');

  // 3. Open Edit Phone Modal
  await page.evaluate(() => openEditPhoneModal());
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_edit_phone_modal.png') });
  console.log('Saved edit phone modal');

  // 4. Open Avatar Picker Modal
  await page.evaluate(() => {
    closeModal();
    openEditAvatarModal();
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: path.join(artifactDir, 'driver_proto_avatar_picker_modal.png') });
  console.log('Saved avatar picker modal');

  await browser.close();
  console.log('All polished screenshots captured successfully!');
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
