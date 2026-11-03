const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  
  const token = 'xnt_auth_wan_bm_testing_token_2026';
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

  await page.goto('http://localhost:3001/merchant/#belanja', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));

  await page.evaluate(() => {
    const splash = document.getElementById('x-splash');
    if (splash) splash.style.display = 'none';
  });

  const baseDir = '/home/ubuntu/.gemini/antigravity-cli/brain/40a5b28d-65cf-4784-8e66-2c09a8668206';

  // 1. Capture Belanja Tasks View
  let buf = await page.screenshot({ fullPage: false });
  fs.writeFileSync(`${baseDir}/belanja_view_tasks.png`, buf);
  console.log('1. Captured Belanja Tasks view');

  // 2. Click PO Supplier Subnav
  await page.click('#btn-subnav-po');
  await new Promise(r => setTimeout(r, 600));
  buf = await page.screenshot({ fullPage: false });
  fs.writeFileSync(`${baseDir}/belanja_view_po.png`, buf);
  console.log('2. Captured PO Supplier view');

  // 3. Click Riwayat Subnav
  await page.click('#btn-subnav-history');
  await new Promise(r => setTimeout(r, 600));
  buf = await page.screenshot({ fullPage: false });
  fs.writeFileSync(`${baseDir}/belanja_view_history.png`, buf);
  console.log('3. Captured Riwayat view');

  // 4. Click Hitung Cepat / Kalkulator Subnav
  await page.click('#btn-subnav-calc');
  await new Promise(r => setTimeout(r, 600));
  buf = await page.screenshot({ fullPage: false });
  fs.writeFileSync(`${baseDir}/belanja_view_calc.png`, buf);
  console.log('4. Captured Kalkulator view');

  // 5. Click back to Belanja Tasks
  await page.click('#btn-subnav-tasks');
  await new Promise(r => setTimeout(r, 600));
  buf = await page.screenshot({ fullPage: false });
  fs.writeFileSync(`${baseDir}/current_belanja_view.png`, buf);
  console.log('5. Returned to Belanja Tasks view');

  const finalCheck = await page.evaluate(() => {
    return {
      title: document.getElementById('purchasing-topbar-title').textContent,
      bottomBarDisplay: window.getComputedStyle(document.getElementById('purchasing-bottom-bar')).display,
      activeSubnav: document.querySelector('.purchasing-subnav-btn.active').textContent.trim()
    };
  });
  console.log('Final check:', finalCheck);

  await browser.close();
})();
