const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const app = require('../../server/app');
const db = require('../../server/database/db');

describe('Workforce Handoff Redirect & Tenant Boundary (WH-01 to WH-04)', () => {
  let server;
  let baseUrl;

  const TEST_ORG_ID = 'org_wh_test';
  const TEST_BRAND_ID = 'brand_wh_test';
  const TEST_BRANCH_ID = 'branch_wh_test';
  const TEST_DOMAIN = 'wh-brand.mybangjo.com';

  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, slug, plan, created_at, updated_at)
      VALUES (?, 'WH Org', 'wh-org', 'pro', ?, ?)
    `).run(TEST_ORG_ID, now, now);

    db.prepare(`
      INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain, primary_color, created_at, updated_at)
      VALUES (?, ?, 'WH Brand', 'wh-brand', ?, '#b6ff00', ?, ?)
    `).run(TEST_BRAND_ID, TEST_ORG_ID, TEST_DOMAIN, now, now);

    db.prepare(`
      INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at)
      VALUES (?, ?, 'WH Cabang Pringsewu', 'wh-pringsewu', 'Jl. Utama No. 1', -7.25, 112.75, 1, ?, ?)
    `).run(TEST_BRANCH_ID, TEST_BRAND_ID, now, now);

    // Create a branch manager user
    db.prepare(`
      INSERT OR IGNORE INTO users (id, brand_id, organization_id, branch_id, username, password_hash, full_name, email, role, status, created_at, updated_at)
      VALUES ('usr_wh_bm', ?, ?, ?, 'bm_wh', '$2b$10$abcdef', 'Branch Manager WH', 'bm_wh@test.com', 'branch_manager', 'active', ?, ?)
    `).run(TEST_BRAND_ID, TEST_ORG_ID, TEST_BRANCH_ID, now, now);
  });

  after(() => {
    if (server) server.close();
  });

  function rawRequest(method, path, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const postData = body ? JSON.stringify(body) : null;
      const reqHeaders = { ...headers };
      if (postData) {
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(postData);
      }
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: reqHeaders
      }, (res) => {
        let resData = '';
        res.on('data', chunk => resData += chunk);
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(resData); } catch (_) { parsed = resData; }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      });
      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  it('WH-01: GET /api/v1/auth/merchant/me on xentra.cloud succeeds for branch_manager (no 403 FORBIDDEN_TENANT_ACCESS)', async () => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get('usr_wh_bm');
    const { token } = global.TokenSessionStore.createSession(user, user.brand_id);

    const res = await rawRequest('GET', '/api/v1/auth/merchant/me', {
      'Host': 'xentra.cloud',
      'Authorization': `Bearer ${token}`
    });

    assert.equal(res.status, 200, 'Must return 200 OK');
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.role, 'branch_manager');
    assert.equal(res.body.user.branch_id, TEST_BRANCH_ID);
  });

  it('WH-02: POST /api/v1/auth/handoff/create on xentra.cloud generates valid handoff ticket for branch_manager', async () => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get('usr_wh_bm');
    const { token } = global.TokenSessionStore.createSession(user, user.brand_id);

    const res = await rawRequest('POST', '/api/v1/auth/handoff/create', {
      'Host': 'xentra.cloud',
      'Authorization': `Bearer ${token}`
    }, { brand_id: TEST_BRAND_ID });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.handoff_ticket.startsWith('xnt_hdf_'));
    assert.equal(res.body.redirect_url, `https://${TEST_DOMAIN}/dashboard/?handoff=${res.body.handoff_ticket}`);
  });

  it('WH-03: POST /api/v1/auth/handoff/exchange on tenant domain consumes ticket and issues tenant session for branch_manager', async () => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get('usr_wh_bm');
    const { HandoffService } = require('../../core/identity');
    const handoffService = new HandoffService(db);
    const ticket = handoffService.createTicket({
      userId: user.id,
      brandId: TEST_BRAND_ID,
      ttlSeconds: 60
    });

    const res = await rawRequest('POST', '/api/v1/auth/handoff/exchange', {
      'Host': TEST_DOMAIN
    }, { ticket: ticket.ticket });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token);
    assert.equal(res.body.user.role, 'branch_manager');
    assert.equal(res.body.user.branch_id, TEST_BRANCH_ID);

    // Verify me on tenant domain with new token
    const meRes = await rawRequest('GET', '/api/v1/auth/merchant/me', {
      'Host': TEST_DOMAIN,
      'Authorization': `Bearer ${res.body.token}`
    });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.role, 'branch_manager');
    assert.equal(meRes.body.user.branch_id, TEST_BRANCH_ID);
  });

  it('WH-04: POST /api/v1/invitations/accept on xentra.cloud includes redirect_url with handoff ticket to brand custom_domain', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const invId = 'wiv_' + crypto.randomBytes(8).toString('hex');
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    db.prepare(`
      INSERT INTO workforce_invitations (
        id, organization_id, brand_id, branch_id, email, role,
        invited_by_user_id, status, token_hash, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'bm_invite_test@test.com', 'branch_manager', 'usr_wh_bm', 'pending', ?, ?, ?, ?)
    `).run(invId, TEST_ORG_ID, TEST_BRAND_ID, TEST_BRANCH_ID, tokenHash, expiresAt, now, now);

    // Create user for recipient
    db.prepare(`
      INSERT OR IGNORE INTO users (id, brand_id, organization_id, branch_id, username, password_hash, full_name, email, role, status, created_at, updated_at)
      VALUES ('usr_wh_invited', ?, ?, ?, 'bm_invited', '$2b$10$abcdef', 'Invited BM', 'bm_invite_test@test.com', 'branch_manager', 'active', ?, ?)
    `).run(TEST_BRAND_ID, TEST_ORG_ID, TEST_BRANCH_ID, now, now);

    const invitedUser = db.prepare('SELECT * FROM users WHERE id = ?').get('usr_wh_invited');
    const { token: sessionToken } = global.TokenSessionStore.createSession(invitedUser, TEST_BRAND_ID);

    const res = await rawRequest('POST', '/api/v1/invitations/accept', {
      'Host': 'xentra.cloud',
      'Authorization': `Bearer ${sessionToken}`
    }, { token: rawToken });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.redirect_url);
    assert.ok(res.body.redirect_url.startsWith(`https://${TEST_DOMAIN}/dashboard/?handoff=xnt_hdf_`));
  });
});
