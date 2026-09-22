'use strict';

/**
 * Router view initialisation on direct page load.
 *
 * The customer PWA is multi-page: the browser loads /checkout, /order-received,
 * /history ... directly (refresh, deep link, cold PWA start), and in that path
 * nothing calls Router.navigate() or fires hashchange. The router previously
 * kept its `home` default, so every subscriber guarding on the current view was
 * silently inert — checkout's store subscription did not react to a claimed
 * reward or a removed line until the page was reloaded again.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROUTER_PATH = path.join(__dirname, '../../apps/customer-pwa/assets/js/core/router.js');
const ROUTER_SRC = fs.readFileSync(ROUTER_PATH, 'utf8');

function loadAt(urlPath) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://app.mybangjo.com' + urlPath,
    runScripts: 'dangerously'
  });
  const win = dom.window;
  win.eval(ROUTER_SRC);
  return win;
}

test('ROUTER — current view is derived from the URL on a direct page load', async (t) => {

  await t.test('1. /checkout reports the checkout view (no navigate() required)', () => {
    const win = loadAt('/checkout');
    assert.equal(win.Xentra.Router.getCurrentView(), 'checkout');
    win.close();
  });

  await t.test('2. /checkout/ reports the checkout view', () => {
    const win = loadAt('/checkout/');
    assert.equal(win.Xentra.Router.getCurrentView(), 'checkout');
    win.close();
  });

  await t.test('3. other entry points report their own view, not a home default', () => {
    const cases = [
      ['/', 'home'],
      ['/order-received/ord_1', 'order-received'],
      ['/history', 'history'],
      ['/profile', 'profile']
    ];
    cases.forEach(([urlPath, expected]) => {
      const win = loadAt(urlPath);
      assert.equal(win.Xentra.Router.getCurrentView(), expected, urlPath + ' must report ' + expected);
      win.close();
    });
  });

  await t.test('4. navigating still updates the current view', () => {
    const win = loadAt('/');
    assert.equal(win.Xentra.Router.getCurrentView(), 'home');
    win.Xentra.Router.navigate('checkout');
    assert.equal(win.Xentra.Router.getCurrentView(), 'checkout');
    win.close();
  });
});
