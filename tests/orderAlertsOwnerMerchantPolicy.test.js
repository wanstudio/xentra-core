const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('ORDER ALERTS POLICY: Owner vs Merchant App', async (t) => {
  const audioAlertsJs = fs.readFileSync(path.join(__dirname, '../apps/merchant-shared/js/audio-alerts.js'), 'utf8');
  const ownerAlertsJs = fs.readFileSync(path.join(__dirname, '../apps/merchant-shared/js/owner-order-alerts.js'), 'utf8');
  const merchantOrdersJs = fs.readFileSync(path.join(__dirname, '../apps/merchant-app/assets/js/orders.js'), 'utf8');
  const ownerIndexHtml = fs.readFileSync(path.join(__dirname, '../apps/owner-app/index.html'), 'utf8');
  const dashboardIndexHtml = fs.readFileSync(path.join(__dirname, '../apps/merchant-dashboard/index.html'), 'utf8');

  await t.test('1. audio-alerts.js default max repeats is strictly 5 for loop and 1 for single', () => {
    // Check default loop repeat count is 5
    assert.match(audioAlertsJs, /_orderAlertMaxRepeats\s*=\s*5/, 'Default _orderAlertMaxRepeats must be 5');
    assert.match(audioAlertsJs, /\(isSingle\s*\?\s*1\s*:\s*5\)/, 'Single must be 1, loop must be 5');
  });

  await t.test('2. Merchant App playNewOrderAudibleChime specifies maxRepeats: 5', () => {
    assert.match(merchantOrdersJs, /maxRepeats:\s*5/, 'Merchant order sound alert must specify maxRepeats: 5');
  });

  await t.test('3. Merchant App immediately stops order alert when user taps Terima or Batal', () => {
    // In confirmBMAcceptOrderSubmit
    const confirmAcceptSnippet = merchantOrdersJs.slice(merchantOrdersJs.indexOf('function confirmBMAcceptOrderSubmit'), merchantOrdersJs.indexOf('function confirmBMAcceptOrderSubmit') + 400);
    assert.match(confirmAcceptSnippet, /stopOrderAlert/, 'confirmBMAcceptOrderSubmit must halt order alert immediately');

    // In quickAcceptBMOrder
    const quickAcceptSnippet = merchantOrdersJs.slice(merchantOrdersJs.indexOf('function quickAcceptBMOrder'), merchantOrdersJs.indexOf('function quickAcceptBMOrder') + 250);
    assert.match(quickAcceptSnippet, /stopOrderAlert/, 'quickAcceptBMOrder must halt order alert immediately');

    // In closeBMAcceptOrderModal (Batal)
    const closeAcceptSnippet = merchantOrdersJs.slice(merchantOrdersJs.indexOf('function closeBMAcceptOrderModal'), merchantOrdersJs.indexOf('function closeBMAcceptOrderModal') + 500);
    assert.match(closeAcceptSnippet, /stopOrderAlert/, 'closeBMAcceptOrderModal must halt order alert immediately');

    // In advanceBMOrderStatus for pending
    const advanceSnippet = merchantOrdersJs.slice(merchantOrdersJs.indexOf('function advanceBMOrderStatus'), merchantOrdersJs.indexOf('function advanceBMOrderStatus') + 300);
    assert.match(advanceSnippet, /stopOrderAlert/, 'advanceBMOrderStatus must halt order alert immediately when entering accept modal');
  });

  await t.test('4. Owner App plays sound exactly 1 time (single: true, maxRepeats: 1)', () => {
    assert.match(ownerAlertsJs, /single:\s*true/, 'Owner alert must specify single: true');
    assert.match(ownerAlertsJs, /maxRepeats:\s*1/, 'Owner alert must specify maxRepeats: 1');
  });

  await t.test('5. Owner App renders a Floating Notification banner with order details and navigation', () => {
    assert.match(ownerAlertsJs, /x-owner-floating-banner/, 'Must create x-owner-floating-banner container');
    assert.match(ownerAlertsJs, /navigateToOwnerOrders/, 'Must provide navigation handler to orders');
    assert.match(ownerAlertsJs, /dismissOwnerFloatingNotification/, 'Must provide dismiss handler');
    assert.match(ownerAlertsJs, /xOwnerBannerProgress/, 'Must provide auto-dismiss progress bar');
  });

  await t.test('6. Both Owner surfaces include audio-alerts.js and owner-order-alerts.js', () => {
    assert.ok(ownerIndexHtml.includes('owner-order-alerts.js'), 'apps/owner-app/index.html must load owner-order-alerts.js');
    assert.ok(ownerIndexHtml.includes('audio-alerts.js'), 'apps/owner-app/index.html must load audio-alerts.js');
    assert.ok(dashboardIndexHtml.includes('owner-order-alerts.js'), 'apps/merchant-dashboard/index.html must load owner-order-alerts.js');
    assert.ok(dashboardIndexHtml.includes('audio-alerts.js'), 'apps/merchant-dashboard/index.html must load audio-alerts.js');
  });

  await t.test('7. audio-alerts.js suppresses native loop alarm when single/isSingle is true', () => {
    assert.match(audioAlertsJs, /!isSingle\s*&&\s*window\.XentraNative/, 'Native looping alarm must only be triggered when !isSingle');
    assert.match(audioAlertsJs, /audio\.loop\s*=\s*false/, 'Audio loop property must be explicitly set to false');
  });

  await t.test('8. owner-order-alerts.js implements persistent deduplication and alert throttle', () => {
    assert.match(ownerAlertsJs, /ALERTED_ORDERS_STORAGE_KEY/, 'Must define persistent storage key for alerted order IDs');
    assert.match(ownerAlertsJs, /sessionStorage\.getItem\(ALERTED_ORDERS_STORAGE_KEY\)/, 'Must retrieve seen orders from sessionStorage');
    assert.match(ownerAlertsJs, /_lastOwnerAlertTimestamp/, 'Must implement timestamp throttle guard');
  });

  await t.test('9. Native Owner APK OrderAlarmService is strictly single non-looping playback', () => {
    const orderAlarmJava = fs.readFileSync(path.join(__dirname, '../native/owner-android/app/src/main/java/com/mybangjo/owner/OrderAlarmService.java'), 'utf8');
    assert.match(orderAlarmJava, /mediaPlayer\.setLooping\(false\)/, 'Owner native mediaPlayer looping must be false');
    assert.match(orderAlarmJava, /setOnCompletionListener/, 'Must register onCompletion listener to auto stop');
    assert.match(orderAlarmJava, /vibrate\(pattern,\s*-1\)/, 'Vibration pattern repeat index must be -1 (no repeat)');
    assert.match(orderAlarmJava, /postDelayed\(autoStopRunnable,\s*6000L\)/, 'Must have safety auto-stop watchdog');
  });

  await t.test('10. Native Owner APK OrderMonitorService only alarms on genuine new orders', () => {
    const orderMonitorJava = fs.readFileSync(path.join(__dirname, '../native/owner-android/app/src/main/java/com/mybangjo/owner/OrderMonitorService.java'), 'utf8');
    assert.match(orderMonitorJava, /if\s*\(hasNewOrder\)/, 'Must only trigger native alarm if hasNewOrder is true');
    assert.doesNotMatch(orderMonitorJava, /if\s*\(hasNewOrder\s*\|\|\s*!isAlarmActive\)/, 'Must NOT trigger alarm on !isAlarmActive');
  });

  await t.test('11. Native Owner APK build.gradle is bumped to v1.0.3 (versionCode 4)', () => {
    const buildGradle = fs.readFileSync(path.join(__dirname, '../native/owner-android/app/build.gradle'), 'utf8');
    assert.match(buildGradle, /versionCode\s+4/, 'Owner APK versionCode must be 4');
    assert.match(buildGradle, /versionName\s+"1\.0\.3"/, 'Owner APK versionName must be 1.0.3');
  });
});
