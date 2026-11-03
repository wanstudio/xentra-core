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

  await new Promise(r => setTimeout(r, 400));

  // Click tab "Terjadwal"
  await page.click('#tab-scheduled');
  await new Promise(r => setTimeout(r, 300));

  const phoneViewport = await page.$('#phone-viewport');
  if (phoneViewport) {
    const box = await phoneViewport.boundingBox();
    await page.screenshot({
      path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_tab_scheduled_flush.png',
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: box.width,
        height: 300
      }
    });
  }

  await browser.close();
  console.log('Tab click test passed!');
})();
