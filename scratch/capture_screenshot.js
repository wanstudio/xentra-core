const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2 });
  await page.goto('http://localhost:3001/merchant/prototype-pesanan', { waitUntil: 'networkidle0' });

  await new Promise(r => setTimeout(r, 600));

  // Screenshot of topbar element
  const topbar = await page.$('.topbar-wrapper');
  if (topbar) {
    await topbar.screenshot({
      path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_topbar_crop_flush.png'
    });
  }

  // Screenshot of phone top section (topbar + content below it)
  const phoneViewport = await page.$('#phone-viewport');
  if (phoneViewport) {
    const box = await phoneViewport.boundingBox();
    await page.screenshot({
      path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_prototype_flush_bottom.png',
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: box.width,
        height: 380
      }
    });
  }

  await browser.close();
  console.log('Done capturing screenshots');
})();
