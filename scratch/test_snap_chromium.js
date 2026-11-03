const puppeteer = require('puppeteer-core');

async function test() {
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  console.log('Chromium launched successfully!');
  const page = await browser.newPage();
  await page.goto('http://localhost:3001/driver/prototype.html', { waitUntil: 'networkidle0' });
  console.log('Loaded prototype title:', await page.title());
  await browser.close();
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
