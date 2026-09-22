const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const db = require('../server/database/db');

// Suites assert against demo branches/products/promotions, which are not auto-seeded.
require('./helpers/demoFixtures.js')();
const app = require('../server/app');

function request(server, options, data) {
  const addr = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: addr.port,
      ...options,
      headers: {
        'Host': 'app.mybangjo.com',
        ...(options.headers || {})
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

describe('END-TO-END: Primary Brand Color Propagation to Customer PWA', () => {
  let server;
  let ownerToken;

  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));

    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    assert.ok(ownerUser, 'Owner user must exist');
    const ownerSession = global.TokenSessionStore.createSession(ownerUser, 'brand_bangjo');
    ownerToken = ownerSession.token;
  });

  it('1. Updates brand primary color via PUT /api/v1/admin/settings/business/profile to #FF5500', async () => {
    const res = await request(server, {
      path: '/api/v1/admin/settings/business/profile',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ownerToken}`
      }
    }, {
      primary_color: '#FF5500'
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.profile.primary_color, '#FF5500');
  });

  it('2. Persists #FF5500 authoritatively in SQLite database', () => {
    const row = db.prepare(`SELECT primary_color FROM brands WHERE id = 'brand_bangjo'`).get();
    assert.ok(row);
    assert.equal(row.primary_color, '#FF5500');
  });

  it('3. Customer PWA endpoint GET /api/v1/brand/info returns #FF5500', async () => {
    const res = await request(server, {
      path: '/api/v1/brand/info',
      method: 'GET'
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.brand.primary_color, '#FF5500');
  });

  it('4. Rejects invalid HEX values on PUT /admin/settings/business/profile', async () => {
    const res = await request(server, {
      path: '/api/v1/admin/settings/business/profile',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ownerToken}`
      }
    }, {
      primary_color: 'invalid-color'
    });

    assert.equal(res.status, 500);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /Format warna tema/);
  });

  it('5. Accepts 3-digit hex and expands to canonical 6-digit hex', async () => {
    const res = await request(server, {
      path: '/api/v1/admin/settings/business/profile',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ownerToken}`
      }
    }, {
      primary_color: '#f00'
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.profile.primary_color, '#FF0000');

    const brandInfoRes = await request(server, {
      path: '/api/v1/brand/info',
      method: 'GET'
    });
    assert.equal(brandInfoRes.body.brand.primary_color, '#FF0000');
  });

  it('6. Reverts cleanly back to #059669', async () => {
    const res = await request(server, {
      path: '/api/v1/admin/settings/business/profile',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ownerToken}`
      }
    }, {
      primary_color: '#059669'
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.profile.primary_color, '#059669');

    const dbRow = db.prepare(`SELECT primary_color FROM brands WHERE id = 'brand_bangjo'`).get();
    assert.equal(dbRow.primary_color, '#059669');

    const brandInfoRes = await request(server, {
      path: '/api/v1/brand/info',
      method: 'GET'
    });
    assert.equal(brandInfoRes.body.brand.primary_color, '#059669');

    server.close();
  });
});
