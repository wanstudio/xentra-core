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

  await page.goto('http://localhost:3001/merchant/#hari-ini', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));

  const berandaMetrics = await page.evaluate(() => {
    const header = document.querySelector('.x-home-topbar');
    const r1 = header.querySelector('.x-mobile-topbar-main');
    const r2 = header.querySelector('.x-mobile-operational-row');
    const bHeader = header.getBoundingClientRect();
    const bR1 = r1.getBoundingClientRect();
    const bR2 = r2.getBoundingClientRect();
    const sR1 = window.getComputedStyle(r1);
    const sR2 = window.getComputedStyle(r2);
    return {
      header: { top: bHeader.top, height: bHeader.height, paddingTop: window.getComputedStyle(header).paddingTop, paddingBottom: window.getComputedStyle(header).paddingBottom },
      r1: { top: bR1.top, bottom: bR1.bottom, height: bR1.height, marginBottom: sR1.marginBottom },
      r2: { top: bR2.top, bottom: bR2.bottom, height: bR2.height, marginTop: sR2.marginTop },
      gap: bR2.top - bR1.bottom
    };
  });

  await page.goto('http://localhost:3001/merchant/#pesanan', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));

  const pesananMetrics = await page.evaluate(() => {
    const header = document.querySelector('#bm-pesanan-topbar');
    const r1 = header.querySelector('.x-mobile-topbar-main');
    const r2 = header.querySelector('.x-mobile-operational-row');
    const r3 = header.querySelector('.bm-pesanan-nav-tabs');
    const r4 = header.querySelector('.stage-subfilter-bar');
    const bHeader = header.getBoundingClientRect();
    const bR1 = r1.getBoundingClientRect();
    const bR2 = r2.getBoundingClientRect();
    const bR3 = r3.getBoundingClientRect();
    const bR4 = r4 ? r4.getBoundingClientRect() : null;
    const sR1 = window.getComputedStyle(r1);
    const sR2 = window.getComputedStyle(r2);
    const sR3 = window.getComputedStyle(r3);
    return {
      header: { top: bHeader.top, height: bHeader.height, paddingTop: window.getComputedStyle(header).paddingTop, paddingBottom: window.getComputedStyle(header).paddingBottom },
      r1: { top: bR1.top, bottom: bR1.bottom, height: bR1.height, marginBottom: sR1.marginBottom },
      r2: { top: bR2.top, bottom: bR2.bottom, height: bR2.height, marginTop: sR2.marginTop, marginBottom: sR2.marginBottom },
      r3: { top: bR3.top, bottom: bR3.bottom, height: bR3.height, marginTop: sR3.marginTop, marginBottom: sR3.marginBottom },
      r4: bR4 ? { top: bR4.top, bottom: bR4.bottom, height: bR4.height } : null,
      gapR1R2: bR2.top - bR1.bottom,
      gapR2R3: bR3.top - bR2.bottom,
      gapR3R4: bR4 ? bR4.top - bR3.bottom : null
    };
  });

  console.log('BERANDA:', JSON.stringify(berandaMetrics, null, 2));
  console.log('PESANAN:', JSON.stringify(pesananMetrics, null, 2));

  await browser.close();
})();
