const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto('http://localhost:3001/merchant/prototype-pesanan', { waitUntil: 'networkidle0' });

  await new Promise(r => setTimeout(r, 600));

  // Topbar element crop
  const topbar = await page.$('.topbar-wrapper');
  if (topbar) {
    await topbar.screenshot({
      path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_topbar_bottom_flush.png'
    });
  }

  // Upper phone viewport
  const phoneViewport = await page.$('#phone-viewport');
  if (phoneViewport) {
    const box = await phoneViewport.boundingBox();
    await page.screenshot({
      path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_prototype_viewport_flush.png',
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: box.width,
        height: 400
      }
    });
  }

  await browser.close();
  console.log('Successfully captured screenshots!');
})();
