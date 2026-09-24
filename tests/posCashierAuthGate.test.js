const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'apps/pos-app/index.html'), 'utf8');
const posJs = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/js/pos-app.js'), 'utf8');
const posCss = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/css/pos.css'), 'utf8');

test('POS cashier gate exposes PIN, direct Google, and account fallback', () => {
  assert.match(indexHtml, /id="pos-pin-login-form"/);
  assert.match(indexHtml, /id="btn-pos-google-login"/);
  assert.match(indexHtml, /Lanjutkan dengan Google/);
  assert.match(indexHtml, /id="btn-pos-account-login"/);
  assert.match(indexHtml, /Gunakan email \/ password/);
});

test('POS Google button uses centralized xentra.cloud broker and returns to POS', () => {
  assert.match(posJs, /https:\/\/xentra\.cloud\/auth\/broker\?return_to=/);
  assert.match(posJs, /window\.location\.origin \+ '\/pos\//);
  assert.match(posJs, /\/auth\/handoff\/exchange/);
  assert.match(posJs, /body:JSON\.stringify\(\{ticket:handoff\}\)/);
  assert.match(posJs, /localStorage\.setItem\(TOKEN_KEY,data\.token\)/);
});

test('POS account fallback remains the normal Xentra login surface', () => {
  assert.match(posJs, /accountBtn\.onclick=function\(\)\{ window\.location\.replace\('\/login'\); \};/);
});

test('POS auth assets use a cache-busted revision', () => {
  assert.match(indexHtml, /\/pos\/assets\/css\/pos\.css\?v=1\.0\.1/);
  assert.match(indexHtml, /\/pos\/assets\/js\/pos-app\.js\?v=1\.0\.1/);
  assert.match(posCss, /\.pos-google-login-btn/);
});
