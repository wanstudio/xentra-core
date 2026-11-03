const puppeteer = require('puppeteer-core');
(async () => {
  const exe = require('child_process').execSync('which google-chrome chromium chromium-browser 2>/dev/null | head -1').toString().trim();
  const b = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await p.goto('http://127.0.0.1:3001/merchant/login.html');
  await p.evaluate(() => { localStorage.setItem('xentra_merchant_token', 'xnt_auth_wan_bm_testing_token_2026'); document.cookie='xentra_merchant_token=xnt_auth_wan_bm_testing_token_2026; path=/;'; });
  await p.goto('http://127.0.0.1:3001/merchant/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 6000));
  console.log(p.url(), await p.evaluate(() => ({ nav: typeof window.navigateTo, bce: typeof window.openBCESubpageCreate, scripts: [...document.scripts].map(s => s.src).filter(s => /merchant-app|catalog/.test(s)) })));
  console.log((await p.evaluate(()=>document.body.innerText)).slice(0,300)); console.log(errs.join('\n'));
  await b.close();
})();
