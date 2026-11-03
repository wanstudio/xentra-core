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

  await new Promise(r => setTimeout(r, 500));

  // 1. Screenshot of State A: "Dalam proses" (with subfilters inside topbar)
  const phoneViewport = await page.$('#phone-viewport');
  if (phoneViewport) {
    const box = await phoneViewport.boundingBox();
    await page.screenshot({
      path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_state_in_process_with_subfilters.png',
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: box.width,
        height: 380
      }
    });
  }

  // Crop topbar in State A
  const topbar = await page.$('.topbar-wrapper');
  if (topbar) {
    await topbar.screenshot({
      path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_topbar_in_process.png'
    });
  }

  // 2. Click "Terjadwal" -> State B: Other tabs (indicator flush to bottom edge, no subfilters)
  await page.click('#tab-scheduled');
  await new Promise(r => setTimeout(r, 400));

  if (phoneViewport) {
    const box = await phoneViewport.boundingBox();
    await page.screenshot({
      path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_state_scheduled_flush_bottom.png',
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: box.width,
        height: 340
      }
    });
  }

  if (topbar) {
    await topbar.screenshot({
      path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_topbar_scheduled_flush.png'
    });
  }

  // 3. Click back to "Dalam proses" -> State D (verify subfilters return seamlessly)
  await page.click('#tab-in-process');
  await new Promise(r => setTimeout(r, 400));

  if (phoneViewport) {
    const box = await phoneViewport.boundingBox();
    await page.screenshot({
      path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_return_to_in_process.png',
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: box.width,
        height: 380
      }
    });
  }

  await browser.close();
  console.log('Successfully captured screenshots of both states!');
})();
