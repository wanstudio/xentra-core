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

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.toString()));

  await page.goto('http://m.mybangjo.com/merchant/', { waitUntil: 'networkidle2' });

  // Hide splash explicitly if still showing
  await page.evaluate(() => {
    const splash = document.getElementById('x-splash');
    if (splash) splash.style.display = 'none';
  });

  await page.screenshot({ path: '/home/ubuntu/xentra-core/scratch/merchant_beranda_rendered.png', fullPage: false });
  console.log('Errors:', errors);
  
  // Inspect some key elements
  const layout = await page.evaluate(() => {
    const topbar = document.querySelector('.x-home-topbar');
    const layout = document.querySelector('.x-dash-layout');
    const bottomNav = document.getElementById('x-merchant-mobile-nav');
    const anchors = Array.from(document.querySelectorAll('.x-home-status-anchor')).map(el => ({
      text: el.innerText.trim(),
      display: window.getComputedStyle(el).display,
      visibility: window.getComputedStyle(el).visibility
    }));

    return {
      topbarDisplay: topbar ? window.getComputedStyle(topbar).display : null,
      topbarPosition: topbar ? window.getComputedStyle(topbar).position : null,
      topbarHeight: topbar ? topbar.offsetHeight : null,
      layoutWidth: layout ? layout.offsetWidth : null,
      bottomNavDisplay: bottomNav ? window.getComputedStyle(bottomNav).display : null,
      bottomNavHeight: bottomNav ? bottomNav.offsetHeight : null,
      anchors: anchors
    };
  });

  console.log('Layout evaluation:', JSON.stringify(layout, null, 2));

  await browser.close();
}

run().catch(err => {
  console.error('Run failed:', err);
  process.exit(1);
});
