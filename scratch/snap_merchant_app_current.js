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
            branch_name: 'MyBangjo Pringsewu'
          },
          landing: '/merchant/'
        })
      });
    } else if (url.includes('/api/')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] })
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
      branch_name: 'MyBangjo Pringsewu'
    }));
  });

  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto('http://m.mybangjo.com/merchant/', { waitUntil: 'networkidle2' });

  // Hide splash if visible
  await page.evaluate(() => {
    const splash = document.getElementById('x-splash');
    if (splash) splash.style.display = 'none';
  });

  await new Promise(r => setTimeout(r, 1000));

  await page.screenshot({ path: '/home/ubuntu/xentra-core/scratch/merchant_beranda_current.png', fullPage: false });
  console.log('Page URL after wait:', page.url());

  const layout = await page.evaluate(() => {
    const topbar = document.querySelector('.x-home-topbar');
    const layout = document.querySelector('.x-dash-layout');
    const bottomNav = document.getElementById('x-merchant-mobile-nav');
    const anchors = Array.from(document.querySelectorAll('.x-home-status-anchor')).map(el => ({
      text: el.innerText.trim(),
      display: window.getComputedStyle(el).display,
      visibility: window.getComputedStyle(el).visibility,
      offsetWidth: el.offsetWidth,
      offsetHeight: el.offsetHeight
    }));

    const computedBody = window.getComputedStyle(document.body);
    const computedHtml = window.getComputedStyle(document.documentElement);

    return {
      bodyBg: computedBody.backgroundColor,
      bodyDisplay: computedBody.display,
      bodyJustifyContent: computedBody.justifyContent,
      layoutWidth: layout ? layout.offsetWidth : null,
      topbarDisplay: topbar ? window.getComputedStyle(topbar).display : null,
      topbarPosition: topbar ? window.getComputedStyle(topbar).position : null,
      topbarHeight: topbar ? topbar.offsetHeight : null,
      bottomNavDisplay: bottomNav ? window.getComputedStyle(bottomNav).display : null,
      bottomNavHeight: bottomNav ? bottomNav.offsetHeight : null,
      anchors: anchors
    };
  });

  console.log('Layout:', JSON.stringify(layout, null, 2));
  console.log('Console Logs (last 10):', consoleLogs.slice(-10));

  await browser.close();
}

run().catch(err => {
  console.error('Run error:', err);
  process.exit(1);
});
