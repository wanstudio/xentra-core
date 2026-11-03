const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  
  const token = 'xnt_auth_a892949b0be485a5675abae2a310d856da76ffa62f6f884d';
  const user = {
    id: 'usr_28eab1592cdcbee82cb03cf0c6aa4549',
    username: 'wan',
    email: 'ikhwansujatmiko91@gmail.com',
    full_name: 'Ikhwan',
    role: 'branch_manager',
    brand_id: 'brand_bangjo',
    branch_id: 'branch_1789606246242_08knv',
    branch_name: 'MyBangjo Pringsewu',
    brand_name: 'MyBangjo'
  };

  await page.evaluateOnNewDocument((tok, u) => {
    localStorage.setItem('xentra_merchant_token', tok);
    localStorage.setItem('xentra_merchant_user', JSON.stringify(u));
  }, token, user);

  await page.goto('http://localhost:3001/merchant/#pesanan', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));

  // 1. In Process Tab (with subfilters)
  await page.screenshot({ path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_real_topbar_in_process.png' });

  // 2. Click Terjadwal Tab (subfilters must be hidden, bottom indicator flush)
  await page.click('.bm-pesanan-nav-tab[data-tab-status="scheduled"]');
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_real_topbar_scheduled_flush.png' });

  // 3. Click Selesai Tab
  await page.click('.bm-pesanan-nav-tab[data-tab-status="completed"]');
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_real_topbar_selesai.png' });

  // 4. Return to In Process Tab
  await page.click('.bm-pesanan-nav-tab[data-tab-status="in_process"]');
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_real_topbar_return_in_process.png' });

  console.log('Real merchant header verification captured!');
  await browser.close();
})();
