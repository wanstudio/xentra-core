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

  page.on('console', msg => console.log('LOG:', msg.text()));

  await page.goto('http://localhost:3001/merchant/#belanja', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  const info = await page.evaluate(() => {
    const splash = document.getElementById('x-splash');
    if (splash) splash.style.display = 'none';

    const belanjaTab = document.getElementById('tab-bm-belanja');
    const topbar = document.getElementById('purchasing-mobile-topbar');
    const bottomNav = document.getElementById('x-merchant-mobile-nav');
    const purchasingBottomNav = document.getElementById('purchasing-bottom-nav');
    const purchasingBottomBar = document.getElementById('purchasing-bottom-bar');
    const items = document.querySelectorAll('.purchasing-item-card');
    const checklist = document.getElementById('purchasing-checklist-container');

    return {
      url: window.location.href,
      tabActive: belanjaTab ? belanjaTab.classList.contains('active') : false,
      bodyClasses: document.body.className,
      topbarDisplay: topbar ? window.getComputedStyle(topbar).display : 'null',
      topbarVisibility: topbar ? window.getComputedStyle(topbar).visibility : 'null',
      bottomNavDisplay: bottomNav ? window.getComputedStyle(bottomNav).display : 'null',
      purchasingBottomNavDisplay: purchasingBottomNav ? window.getComputedStyle(purchasingBottomNav).display : 'null',
      purchasingBottomBarDisplay: purchasingBottomBar ? window.getComputedStyle(purchasingBottomBar).display : 'null',
      itemsCount: items.length,
      checklistPreview: checklist ? checklist.innerText.substring(0, 200) : 'null'
    };
  });

  console.log('Belanja State:', JSON.stringify(info, null, 2));

  const buf = await page.screenshot({ fullPage: false });
  fs.writeFileSync('/home/ubuntu/scratch_belanja_real.png', buf);
  fs.writeFileSync('/home/ubuntu/.gemini/antigravity-cli/brain/40a5b28d-65cf-4784-8e66-2c09a8668206/current_belanja_view.png', buf);
  console.log('Screenshot saved to current_belanja_view.png!');

  await browser.close();
})();
