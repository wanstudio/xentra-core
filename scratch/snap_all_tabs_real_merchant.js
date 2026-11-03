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

  // 1. In Process Tab
  await page.screenshot({ path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_tab_in_process_real.png' });

  // 2. Click Selesai Tab
  await page.click('.bm-pesanan-nav-tab[data-tab-status="completed"]');
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_tab_selesai_real.png' });

  // 3. Click Terjadwal Tab
  await page.click('.bm-pesanan-nav-tab[data-tab-status="scheduled"]');
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_tab_terjadwal_real.png' });

  // 4. Click Batal Tab
  await page.click('.bm-pesanan-nav-tab[data-tab-status="cancelled"]');
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff/screenshot_tab_batal_real.png' });

  console.log('All tabs captured successfully!');
  await browser.close();
})();
