const puppeteer = require('puppeteer-core');
const path = require('path');

const ARTIFACT_DIR = '/home/ubuntu/.gemini/antigravity-cli/brain/40a5b28d-65cf-4784-8e66-2c09a8668206';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });

  const token = 'xnt_auth_6f0b7ae2a60ba37dfc6d8d21f9166bd7d60e853f58c756f5';
  const user = {
    id: 'usr_6be4f9006983774837a0816248a69117',
    username: 'bangjokasir',
    email: 'bangjokasir@gmail.com',
    full_name: 'Kasir Bangjo',
    role: 'cashier',
    brand_id: 'brand_bangjo',
    branch_id: 'branch_1789606246242_08knv',
    branch_name: 'MyBangjo Pringsewu',
    brand_name: 'MyBangjo'
  };

  await page.evaluateOnNewDocument((tok, u) => {
    localStorage.setItem('xentra_merchant_token', tok);
    localStorage.setItem('xentra_merchant_user', JSON.stringify(u));
    localStorage.setItem('xentra_pos_branch_id', u.branch_id);
    localStorage.setItem('xentra_pos_terminal_id', 'term_test_123');
  }, token, user);

  console.log('Navigating to POS...');
  await page.goto('http://localhost:3001/pos/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1200));

  // Dismiss splash & open shift modal if present
  await page.evaluate(() => {
    if (window.Xentra && window.Xentra.hideSplash) window.Xentra.hideSplash();
    const splash = document.getElementById('x-splash');
    if (splash) splash.remove();
    const modal = document.getElementById('pos-modal');
    if (modal) modal.classList.add('hidden');
  });

  // Switch to Transaksi view
  console.log('Switching to Transaksi tab...');
  await page.evaluate(() => {
    const tabBtn = document.querySelector('button[data-view="transaksi"]');
    if (tabBtn) tabBtn.click();
  });

  await new Promise(r => setTimeout(r, 1200));

  const rowsCount = await page.evaluate(() => {
    return document.querySelectorAll('#pos-sales-list .pos-sale-row').length;
  });
  console.log('Number of sales rows rendered:', rowsCount);

  // Screenshot 1: Transaksi tab showing cards without [Detail] button
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'pos_transaksi_card_list.png'),
    fullPage: false
  });
  console.log('Saved pos_transaksi_card_list.png');

  // Click the first .pos-sale-row card to open detail modal
  console.log('Clicking first card in pos-sales-list...');
  const orderId = await page.evaluate(() => {
    const row = document.querySelector('#pos-sales-list .pos-sale-row');
    if (row) {
      row.click();
      return row.dataset.saleId;
    }
    return null;
  });
  console.log('Clicked row with order ID:', orderId);

  await new Promise(r => setTimeout(r, 1200));

  // Screenshot 2: Modal Detail Transaksi opened (Desktop)
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'pos_transaksi_detail_modal.png'),
    fullPage: false
  });
  console.log('Saved pos_transaksi_detail_modal.png');

  // Screenshot 3: Modal Detail Transaksi opened (Mobile)
  await page.setViewport({ width: 412, height: 860, deviceScaleFactor: 2 });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'pos_mobile_transaksi_detail_modal.png'),
    fullPage: false
  });
  console.log('Saved pos_mobile_transaksi_detail_modal.png');

  await browser.close();
  console.log('All screenshots captured successfully!');
})();
