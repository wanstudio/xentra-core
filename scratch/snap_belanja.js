const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function run() {
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--host-rules=MAP m.mybangjo.com 127.0.0.1:3001'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 XentraNativeShell/1.0.0 (Mybangjo; Android)');

  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/auth/merchant/me')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          user: {
            id: 'u-bm-1',
            username: 'bm_pringsewu',
            name: 'Branch Manager Pringsewu',
            role: 'branch_manager',
            branch_id: 'branch_1',
            branch_name: 'MyBangjo Pringsewu',
            brand_name: 'MyBangjo'
          },
          landing: '/merchant/'
        })
      });
    } else {
      req.continue();
    }
  });

  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('xentra_merchant_token', 'mock-valid-token');
    localStorage.setItem('xentra_merchant_user', JSON.stringify({
      id: 'u-bm-1',
      username: 'bm_pringsewu',
      name: 'Branch Manager Pringsewu',
      role: 'branch_manager',
      branch_id: 'branch_1',
      branch_name: 'MyBangjo Pringsewu',
      brand_name: 'MyBangjo'
    }));
  });

  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto('http://m.mybangjo.com/merchant/#belanja', { waitUntil: 'networkidle2' });

  // Hide splash if visible
  await page.evaluate(() => {
    const splash = document.getElementById('x-splash');
    if (splash) splash.style.display = 'none';
  });

  await new Promise(r => setTimeout(r, 1200));

  const info = await page.evaluate(() => {
    const belanjaSection = document.getElementById('tab-bm-belanja');
    const topbar = document.getElementById('purchasing-mobile-topbar');
    const bottomNav = document.getElementById('x-merchant-mobile-nav');
    const purchasingBottomNav = document.getElementById('purchasing-bottom-nav');
    const purchasingBottomBar = document.getElementById('purchasing-bottom-bar');
    const checklist = document.getElementById('purchasing-checklist-container');
    const subviews = Array.from(document.querySelectorAll('#tab-bm-belanja .purchasing-subview')).map(el => ({
      id: el.id,
      display: window.getComputedStyle(el).display,
      active: el.classList.contains('active')
    }));

    return {
      hash: window.location.hash,
      bodyClass: document.body.className,
      belanjaActive: belanjaSection ? belanjaSection.classList.contains('active') : false,
      topbarDisplay: topbar ? window.getComputedStyle(topbar).display : 'null',
      topbarVisibility: topbar ? window.getComputedStyle(topbar).visibility : 'null',
      bottomNavDisplay: bottomNav ? window.getComputedStyle(bottomNav).display : 'null',
      purchasingBottomNavDisplay: purchasingBottomNav ? window.getComputedStyle(purchasingBottomNav).display : 'null',
      purchasingBottomBarDisplay: purchasingBottomBar ? window.getComputedStyle(purchasingBottomBar).display : 'null',
      subviews: subviews,
      cardsCount: document.querySelectorAll('.purchasing-item-card').length,
      checklistHtmlPreview: checklist ? checklist.innerHTML.substring(0, 300) : 'null'
    };
  });

  console.log('Evaluated Belanja Info:', JSON.stringify(info, null, 2));

  const buf = await page.screenshot({ fullPage: false });
  fs.writeFileSync('/home/ubuntu/scratch_belanja_live.png', buf);
  fs.writeFileSync('/home/ubuntu/.gemini/antigravity-cli/brain/40a5b28d-65cf-4784-8e66-2c09a8668206/current_belanja_view.png', buf);
  console.log('Saved screenshot successfully!');

  await browser.close();
}

run().catch(err => {
  console.error('Run error:', err);
  process.exit(1);
});
