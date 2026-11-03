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

  // 1. Merchant App
  await page.goto('http://localhost:3001/merchant/#pesanan', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));

  const appMetrics = await page.evaluate(() => {
    const header = document.querySelector('#bm-pesanan-topbar');
    const r1 = header.querySelector('.x-mobile-topbar-main');
    const r2 = header.querySelector('.x-mobile-operational-row');
    const r3 = header.querySelector('.bm-pesanan-nav-tabs');
    const r4 = header.querySelector('.stage-subfilter-bar');
    const bR1 = r1.getBoundingClientRect();
    const bR2 = r2.getBoundingClientRect();
    const bR3 = r3.getBoundingClientRect();
    const bR4 = r4 ? r4.getBoundingClientRect() : null;
    return {
      gapR1R2: bR2.top - bR1.bottom,
      gapR2R3: bR3.top - bR2.bottom,
      gapR3R4: bR4 ? bR4.top - bR3.bottom : null
    };
  });

  // 2. Prototype Pesanan
  await page.goto('http://localhost:3001/merchant/prototype-pesanan', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));

  const protoMetrics = await page.evaluate(() => {
    const header = document.querySelector('#topbar-wrapper');
    const r1 = header.querySelector('.topbar-main-row');
    const r2 = header.querySelector('.operational-switches-row');
    const r3 = header.querySelector('.pesanan-nav-tabs');
    const r4 = header.querySelector('.stage-subfilter-bar');
    const bR1 = r1.getBoundingClientRect();
    const bR2 = r2.getBoundingClientRect();
    const bR3 = r3.getBoundingClientRect();
    const bR4 = r4 ? r4.getBoundingClientRect() : null;
    return {
      gapR1R2: bR2.top - bR1.bottom,
      gapR2R3: bR3.top - bR2.bottom,
      gapR3R4: bR4 ? bR4.top - bR3.bottom : null
    };
  });

  console.log('MERCHANT APP METRICS:', JSON.stringify(appMetrics, null, 2));
  console.log('PROTOTYPE METRICS:', JSON.stringify(protoMetrics, null, 2));

  const brainDir = '/home/ubuntu/.gemini/antigravity-cli/brain/94088972-0469-40e6-91d4-b6cc5603e3ff';
  await page.screenshot({ path: `${brainDir}/screenshot_prototype_header_real.png` });

  await page.goto('http://localhost:3001/merchant/#pesanan', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: `${brainDir}/screenshot_pesanan_header_real.png` });

  await browser.close();
})();
