const puppeteer = require('/home/ubuntu/xentra-core/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--host-rules=MAP app.mybangjo.com 127.0.0.1']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto('http://app.mybangjo.com:3001/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.x-product', { timeout: 10000 });

  // Get bounding rects to verify exact halfway positioning
  const geometry = await page.evaluate(() => {
    const header = document.querySelector('.x-hero-header');
    const searchBox = document.querySelector('.x-menu-search-box');
    const hRect = header.getBoundingClientRect();
    const sRect = searchBox.getBoundingClientRect();
    return {
      headerBottom: hRect.bottom,
      searchTop: sRect.top,
      searchBottom: sRect.bottom,
      searchHeight: sRect.height,
      searchCenterY: sRect.top + sRect.height / 2,
      diffFromCenter: (sRect.top + sRect.height / 2) - hRect.bottom
    };
  });

  console.log('Geometry verification:', JSON.stringify(geometry, null, 2));

  await page.screenshot({ path: '/home/ubuntu/hero_search_halfway.png', clip: { x: 0, y: 0, width: 412, height: 480 } });
  console.log('Saved clipped screenshot to /home/ubuntu/hero_search_halfway.png');

  await browser.close();
})();
