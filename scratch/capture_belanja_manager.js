const puppeteer = require('/home/ubuntu/xentra-core/node_modules/puppeteer-core');
const fs = require('fs');

const ARTIFACT_DIR = '/home/ubuntu/.gemini/antigravity-cli/brain/40a5b28d-65cf-4784-8e66-2c09a8668206';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  // Set session before document loads
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('xentra_merchant_token', 'xnt_auth_wan_bm_testing_token_2026');
    localStorage.setItem('xentra_merchant_user', JSON.stringify({
      id: 'usr_28eab1592cdcbee82cb03cf0c6aa4549',
      username: 'wan',
      full_name: 'Ikhwan',
      role: 'branch_manager',
      branch_id: 'branch_1789606246242_08knv',
      branch_name: 'MyBangjo Pringsewu',
      brand_name: 'MyBangjo'
    }));
  });

  // Navigate to #belanja
  await page.goto('http://127.0.0.1:3001/merchant-app/#belanja', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  // 1. Screenshot: Belanja Berlangsung
  await page.screenshot({
    path: `${ARTIFACT_DIR}/belanja_manager_active.png`,
    fullPage: false
  });
  console.log('Captured: belanja_manager_active.png');

  // 2. Screenshot: Belanja Selesai
  await page.evaluate(() => {
    if (typeof switchBelanjaSegment === 'function') switchBelanjaSegment('done');
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({
    path: `${ARTIFACT_DIR}/belanja_manager_done.png`,
    fullPage: false
  });
  console.log('Captured: belanja_manager_done.png');

  // Switch back to active
  await page.evaluate(() => {
    if (typeof switchBelanjaSegment === 'function') switchBelanjaSegment('active');
  });
  await new Promise(r => setTimeout(r, 300));

  // 3. Screenshot: Modal Tugaskan Mandat Belanja Baru
  await page.evaluate(() => {
    if (typeof openCreateMandateModal === 'function') openCreateMandateModal();
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({
    path: `${ARTIFACT_DIR}/belanja_modal_create.png`,
    fullPage: false
  });
  console.log('Captured: belanja_modal_create.png');

  // Close modal create
  await page.evaluate(() => {
    if (typeof closeCreateMandateModal === 'function') closeCreateMandateModal();
  });
  await new Promise(r => setTimeout(r, 300));

  // 4. Screenshot: Subview Verifikasi Belanjaan
  await page.evaluate(() => {
    if (typeof openVerifyPage === 'function') openVerifyPage('MND-082');
  });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({
    path: `${ARTIFACT_DIR}/belanja_subview_verify.png`,
    fullPage: false
  });
  console.log('Captured: belanja_subview_verify.png');

  // 5. Screenshot: Modal Bukti Nota Pasar Lightbox
  await page.evaluate(() => {
    if (typeof openReceiptByIndex === 'function') openReceiptByIndex(0);
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({
    path: `${ARTIFACT_DIR}/belanja_modal_receipt.png`,
    fullPage: false
  });
  console.log('Captured: belanja_modal_receipt.png');

  await browser.close();
  console.log('All screenshots captured successfully!');
})();
