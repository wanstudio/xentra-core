const puppeteer = require('/home/ubuntu/xentra-core/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--host-rules=MAP app.mybangjo.com 127.0.0.1'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });

  console.log('Navigating to app.mybangjo.com...');
  await page.goto('http://app.mybangjo.com:3001/', { waitUntil: 'networkidle2', timeout: 15000 });

  await page.waitForSelector('#x-menu-search-input', { timeout: 5000 });
  await page.waitForSelector('.x-product', { timeout: 10000 });

  console.log('Page loaded. Testing search: "ayam geprek"...');
  const searchInput = await page.$('#x-menu-search-input');
  await searchInput.type('ayam geprek', { delay: 30 });

  await new Promise(r => setTimeout(r, 600));

  const visibleProducts1 = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.x-products .x-product'));
    const info = document.querySelector('.x-search-results-info');
    return {
      count: cards.length,
      infoText: info ? info.innerText.replace(/\n/g, ' ') : null,
      titles: cards.map(c => {
        const titleEl = c.querySelector('.x-product-name');
        return titleEl ? titleEl.innerText.trim() : c.innerText.slice(0, 30);
      })
    };
  });

  console.log('Results for "ayam geprek":', JSON.stringify(visibleProducts1, null, 2));

  // Test Enter key on search input (mobile keyboard search button)
  console.log('Pressing Enter on search input...');
  const activeBefore = await page.evaluate(() => document.activeElement ? document.activeElement.id : null);
  console.log('Active element before Enter:', activeBefore);

  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 500));

  const stateAfter = await page.evaluate(() => {
    return {
      activeId: document.activeElement ? document.activeElement.id : null,
      scrollY: window.pageYOffset || document.documentElement.scrollTop
    };
  });
  console.log('State after Enter (blur & scroll):', stateAfter);

  await page.screenshot({ path: '/home/ubuntu/verify_smart_search_ayam_geprek.png' });
  console.log('Saved screenshot 1 to /home/ubuntu/verify_smart_search_ayam_geprek.png');

  // Test "ayam negeri geprek"
  await page.evaluate(() => {
    const clearBtn = document.getElementById('x-menu-search-clear');
    if (clearBtn) clearBtn.click();
  });
  await new Promise(r => setTimeout(r, 300));

  await searchInput.type('ayam negeri geprek', { delay: 30 });
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 500));

  const visibleProducts2 = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.x-products .x-product'));
    const info = document.querySelector('.x-search-results-info');
    return {
      count: cards.length,
      infoText: info ? info.innerText.replace(/\n/g, ' ') : null,
      titles: cards.map(c => {
        const titleEl = c.querySelector('.x-product-name');
        return titleEl ? titleEl.innerText.trim() : c.innerText.slice(0, 30);
      })
    };
  });
  console.log('Results for "ayam negeri geprek":', JSON.stringify(visibleProducts2, null, 2));

  await page.screenshot({ path: '/home/ubuntu/verify_smart_search_ayam_negeri.png' });
  console.log('Saved screenshot 2 to /home/ubuntu/verify_smart_search_ayam_negeri.png');

  await browser.close();
  console.log('Verification finished successfully!');
})();
