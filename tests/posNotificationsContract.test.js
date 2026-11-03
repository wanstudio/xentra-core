'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('POS Topbar Bell Icon & Notifications Center Contract', async (t) => {
  const posAppJs = fs.readFileSync(path.join(__dirname, '../apps/pos-app/assets/js/pos-app.js'), 'utf8');
  const posCss = fs.readFileSync(path.join(__dirname, '../apps/pos-app/assets/css/pos.css'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../apps/pos-app/index.html'), 'utf8');

  await t.test('1. index.html defines topbar bell button with accessible label and dynamic badge dot', () => {
    assert.ok(indexHtml.includes('id="btn-pos-notif"'), 'Must define btn-pos-notif button');
    assert.ok(indexHtml.includes('id="pos-notif-badge-dot"'), 'Must define pos-notif-badge-dot span');
  });

  await t.test('2. pos-app.js binds btn-pos-notif click to openPosNotificationsModal', () => {
    assert.match(posAppJs, /\$\('btn-pos-notif'\)\.onclick\s*=\s*openPosNotificationsModal/,
      'btn-pos-notif must be wired to openPosNotificationsModal in bind()');
  });

  await t.test('3. pos-app.js defines openPosNotificationsModal and consumes /notifications API', () => {
    assert.match(posAppJs, /async\s+function\s+openPosNotificationsModal\s*\(\s*\)/,
      'openPosNotificationsModal function must be declared');
    assert.ok(posAppJs.includes('/notifications?limit=30'),
      'Must fetch notifications list with limit=30');
    assert.ok(posAppJs.includes('/notifications/read-all'),
      'Must support mark all read endpoint');
    assert.ok(posAppJs.includes('/notifications/\' + encodeURIComponent(nId) + \'/read'),
      'Must support single notification mark as read');
  });

  await t.test('4. pos-app.js defines updatePosNotificationBadge and consumes /notifications/unread-count', () => {
    assert.match(posAppJs, /async\s+function\s+updatePosNotificationBadge\s*\(\s*\)/,
      'updatePosNotificationBadge function must be declared');
    assert.ok(posAppJs.includes('/notifications/unread-count'),
      'Must query /notifications/unread-count');
    assert.ok(posAppJs.includes('pos-notif-badge-dot'),
      'Must toggle dot display based on unread count');
  });

  await t.test('5. pos.css defines styling for pos-modal-notifications, notif cards, unread state, and badges', () => {
    assert.ok(posCss.includes('.pos-modal-notifications'), 'Must define .pos-modal-notifications');
    assert.ok(posCss.includes('.pos-notif-card'), 'Must define .pos-notif-card');
    assert.ok(posCss.includes('.pos-notif-card.unread'), 'Must define .pos-notif-card.unread');
    assert.ok(posCss.includes('.pos-notif-badge-pill'), 'Must define .pos-notif-badge-pill');
    assert.ok(posCss.includes('.pos-notif-dot'), 'Must define .pos-notif-dot');
  });
});
