const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('xentra_merchant_token', 'mock-token-live-session');
    localStorage.setItem('xentra_merchant_user', JSON.stringify({
      id: 'u-bm-pringsewu',
      name: 'Rian Pratama',
      role: 'branch_manager',
      branch_id: 'branch_pringsewu',
      branch_name: 'MyBangjo Pringsewu',
      brand_name: 'MyBangjo'
    }));
  });

  await page.goto('http://localhost:3001/merchant-app/', { waitUntil: 'networkidle0' });

  await page.evaluate(() => {
    if (typeof navigateTo === 'function') navigateTo('pesanan');
    if (typeof setBMPesananTab === 'function') setBMPesananTab('in_process');
  });

  await new Promise(r => setTimeout(r, 600));

  await page.screenshot({ path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_real_pesanan_current.png' });
  await browser.close();
  console.log('Real app pesanan screen captured!');
})();
