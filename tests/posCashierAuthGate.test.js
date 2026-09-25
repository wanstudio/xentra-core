const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'apps/pos-app/index.html'), 'utf8');
const posJs = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/js/pos-app.js'), 'utf8');
const posCss = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/css/pos.css'), 'utf8');
const loginHtml = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/login.html'), 'utf8');

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

test('POS account fallback preserves the two different auth intents', () => {
  assert.match(posJs, /sessionStorage\.setItem\('xentra_pos_terminal_setup_requested','1'\)/);
  assert.match(posJs, /window\.location\.replace\('\/login\?pos_terminal_setup=1'\)/);
  assert.match(posJs, /window\.location\.replace\('\/login'\)/);
});

test('POS cashier logout returns to the POS PIN gate', () => {
  assert.match(posJs, /function clearPosSessionAndReturnToPin\(\)/);
  assert.match(posJs, /localStorage\.removeItem\(TOKEN_KEY\);/);
  assert.match(posJs, /localStorage\.removeItem\(USER_KEY\);/);
  assert.match(posJs, /window\.location\.replace\('\/pos\/'\)/);
  assert.ok(posJs.includes("$('btn-pos-logout').onclick=function(){clearPosSessionAndReturnToPin();};"));
  assert.doesNotMatch(posJs, /\$\('btn-pos-logout'\)\.onclick=function\(\)\{[^\n]*window\.location\.replace\('\/login'\)/);
});

test('POS terminal bootstrap is manager-authorized and persists terminal identity', () => {
  assert.match(posJs, /isTerminalManagerRole/);
  assert.match(posJs, /getTerminalBranchesForManager/);
  assert.match(posJs, /\/admin\/branches/);
  assert.match(posJs, /\/pos\/terminal\/current\?branch_id=/);
  assert.match(posJs, /\/pos\/terminal\/register/);
  assert.match(posJs, /xentra_pos_terminal_id/);
  assert.match(posJs, /xentra_pos_branch_id/);
  assert.match(posJs, /openPinUnlockGate\(false,false\)/);
});

test('Unified login preserves the explicit POS terminal setup handoff for managers', () => {
  assert.match(loginHtml, /posTerminalSetupRequested/);
  assert.match(loginHtml, /postLoginTarget/);
  assert.match(loginHtml, /return '\/pos\/\?terminal_setup=1';/);
  assert.match(loginHtml, /pos_terminal_setup=1/);
});

test('POS auth assets use a cache-busted revision', () => {
  assert.match(indexHtml, /\/pos\/assets\/css\/pos\.css\?v=1\.0\.9/);
  assert.match(indexHtml, /\/pos\/assets\/js\/pos-app\.js\?v=1\.0\.9/);
  assert.match(posCss, /\.pos-google-login-btn/);
});
