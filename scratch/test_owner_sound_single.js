const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const page = await browser.newPage();

  // Intercept auth/me request so owner auth succeeds
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('/api/v1/auth/merchant/me')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          user: { id: 1, role: 'owner', branch_id: 1, full_name: 'Bapak Owner' }
        })
      });
    } else {
      req.continue();
    }
  });

  // Seed authenticated owner user and token
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('xentra_merchant_token', 'mock_owner_jwt_token_123');
    localStorage.setItem('xentra_merchant_user', JSON.stringify({
      id: 1,
      username: 'owner_test',
      role: 'owner',
      branch_id: 1,
      full_name: 'Bapak Owner'
    }));
  });

  // Navigate to owner app
  await page.goto('http://127.0.0.1:3001/owner/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1200));

  // Evaluate sound behavior in the page context
  const result = await page.evaluate(async () => {
    let playCount = 0;

    // Track audio play calls
    const originalPlay = Audio.prototype.play;
    Audio.prototype.play = function () {
      playCount++;
      return Promise.resolve();
    };

    // Test 1: Trigger alert for Order #1001
    const testOrder = {
      id: 1001,
      order_number: 'ORD-1001',
      total_amount: 55000,
      customer_name: 'Budi Santoso',
      order_type: 'delivery'
    };

    if (window.XentraOwnerOrderMonitor && typeof window.XentraOwnerOrderMonitor.triggerAlert === 'function') {
      window.XentraOwnerOrderMonitor.triggerAlert(testOrder);
    }

    const firstPlayCount = playCount;

    // Test 2: Trigger SAME Order #1001 again immediately (should be ignored by deduplication)
    window.XentraOwnerOrderMonitor.triggerAlert(testOrder);
    const secondPlayCount = playCount;

    // Test 3: Wait 2 seconds to check if any loop or timeout repeated the sound
    await new Promise((r) => setTimeout(r, 2000));
    const afterWaitPlayCount = playCount;

    const banner = document.getElementById('x-owner-floating-banner');
    const bannerText = banner ? banner.innerText : null;

    return {
      firstPlayCount,
      secondPlayCount,
      afterWaitPlayCount,
      bannerExists: !!banner,
      bannerText,
      sessionStorageData: sessionStorage.getItem('xentra_owner_alerted_orders_v1')
    };
  });

  console.log('Result from Owner Sound Verification:', JSON.stringify(result, null, 2));
  await browser.close();

  if (result.firstPlayCount === 1 && result.secondPlayCount === 1 && result.afterWaitPlayCount === 1 && result.bannerExists) {
    console.log('PASS: Owner alert played STRICTLY 1 time, prevented duplicates, and did NOT repeat!');
    process.exit(0);
  } else {
    console.error('FAIL: Owner alert did not meet single-sound criteria.');
    process.exit(1);
  }
})();
