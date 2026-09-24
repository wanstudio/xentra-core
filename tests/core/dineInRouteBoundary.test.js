'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('DINE-IN ROUTES — HTTP boundary is isolated', () => {
  const apiSource = fs.readFileSync(require.resolve('../../server/routes/api'), 'utf8');
  const dineInSource = fs.readFileSync(require.resolve('../../server/routes/dine-in'), 'utf8');

  const routes = [
    "router.get('/dine-in/layout'",
    "router.post('/dine-in/recommend-tables'",
    "router.get('/dine-in/qr/:token'",
    "router.get('/dine-in/tables/:id/qr'",
    "router.post('/dine-in/tables/:id/regenerate-qr'",
    "router.post('/dine-in/tables/:id/block'",
    "router.post('/pos/reservations/:id/check-in'",
    "router.post('/pos/reservations/:id/no-show'",
    "router.post('/dine-in/sessions/:id/complete'",
    "router.post('/dine-in/sessions/:id/reassign-tables'",
    "router.put('/dine-in/layout/:branch_id'"
  ];

  for (const route of routes) {
    assert.equal(apiSource.includes(route), false, route + ' must not remain inline in api.js');
    assert.equal(dineInSource.includes(route), true, route + ' must live in dine-in.js');
  }

  assert.equal((apiSource.match(/registerDineInRoutes\(router,/g) || []).length, 1);
});
