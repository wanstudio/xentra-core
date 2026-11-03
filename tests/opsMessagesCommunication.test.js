'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const db = require('../server/database/db');
const registerOpsMessageRoutes = require('../server/routes/ops-messages');

test('Ops Messages Communication & F&B SaaS Standard Suite', async (t) => {
  const brandId = 'brand_ops_test';
  const orgId = 'org_ops_test';
  const branchId = 'branch_ops_test_1';
  const branch2Id = 'branch_ops_test_2';

  // Seed baseline organizations, brands, branches
  db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)`).run(orgId, 'Org Ops Test', 'org-ops-test');
  db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)`).run(brandId, orgId, 'Brand Ops Test', 'brand-ops-test');
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    branchId, brandId, 'Cabang Utama', 'cabang-utama', 'Jl. Test 1', -7.25, 112.75
  );
  db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    branch2Id, brandId, 'Cabang Dua', 'cabang-dua', 'Jl. Test 2', -7.26, 112.76
  );

  // Seed users
  const ownerUser = { id: 'user_ops_owner', role: 'owner', branchId: null, brandId, name: 'Pak Bos' };
  const bmUser = { id: 'user_ops_bm', role: 'branch_manager', branchId: branchId, brandId, name: 'Pak Manager' };
  const cashierUser = { id: 'user_ops_cashier', role: 'cashier', branchId: branchId, brandId, name: 'Mbak Kasir' };
  const driverUser = { id: 'user_ops_driver', role: 'driver', branchId: branchId, brandId, name: 'Mas Kurir' };
  const purchasingUser = { id: 'user_ops_purchasing', role: 'purchasing', branchId: branchId, brandId, name: 'Pak Pasar' };

  [ownerUser, bmUser, cashierUser, driverUser, purchasingUser].forEach(u => {
    db.prepare(`INSERT OR REPLACE INTO users (id, username, full_name, role, status, brand_id, organization_id, branch_id) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`).run(
      u.id, u.id, u.name, u.role, brandId, orgId, u.branchId
    );
  });

  // Setup express test app
  let currentUser = ownerUser;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.brand_id = brandId;
    req.brand = { id: brandId, organization_id: orgId };
    req.currentBrand = { id: brandId };
    req.currentBranch = { id: currentUser.branchId || branchId };
    next();
  });

  const mockRequireAuth = (allowedRoles) => (req, res, next) => {
    req.user = currentUser;
    if (allowedRoles && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Unauthorized role' });
    }
    next();
  };

  const NotificationService = require('../core/notification/NotificationService');
  const notificationService = new NotificationService(db);

  const apiRouter = express.Router();
  registerOpsMessageRoutes(apiRouter, {
    db,
    requireAuth: mockRequireAuth,
    notificationService
  });
  app.use('/api/v1', apiRouter);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  t.after(() => {
    server.close();
  });

  await t.test('1. Role Authorization: Driver is blocked from BM and Purchasing channels', async () => {
    currentUser = driverUser;

    // Driver tries to read BM channel -> must be 403 Forbidden
    const bmRes = await makeRequest('GET', `/api/v1/messages?thread_type=channel&ref_id=branch_manager&branch_id=${branchId}`);
    assert.strictEqual(bmRes.status, 403, 'Driver must not be allowed to access Branch Manager channel');

    // Driver tries to read Purchasing channel -> must be 403 Forbidden
    const purRes = await makeRequest('GET', `/api/v1/messages?thread_type=channel&ref_id=purchasing&branch_id=${branchId}`);
    assert.strictEqual(purRes.status, 403, 'Driver must not be allowed to access Purchasing channel');

    // Driver reads Driver channel -> must be 200 OK
    const driverChanRes = await makeRequest('GET', `/api/v1/messages?thread_type=channel&ref_id=driver&branch_id=${branchId}`);
    assert.strictEqual(driverChanRes.status, 200, 'Driver can access Driver channel');
  });

  let messageAId = null;
  let receiptMessageId = null;

  await t.test('2. Owner & BM can post messages to Division Channels', async () => {
    currentUser = ownerUser;

    // Owner sends an operational instruction to cashier channel
    const sendRes = await makeRequest('POST', '/api/v1/messages', {
      thread_type: 'channel',
      thread_ref_id: 'cashier',
      branch_id: branchId,
      body: 'Mohon pastikan stok uang kembalian pecahan 2rb dan 5rb cukup ya.'
    });

    assert.strictEqual(sendRes.status, 201);
    assert.strictEqual(sendRes.body.success, true);
    assert.ok(sendRes.body.message.id);
    messageAId = sendRes.body.message.id;
  });

  await t.test('3. WhatsApp-style "Clear Chat for Me" per-user isolation', async () => {
    // Both Owner and BM see messageAId
    currentUser = bmUser;
    let bmMsgRes = await makeRequest('GET', `/api/v1/messages?thread_type=channel&ref_id=cashier&branch_id=${branchId}`);
    assert.strictEqual(bmMsgRes.status, 200);
    let foundInBm = bmMsgRes.body.messages.some(m => m.id === messageAId);
    assert.strictEqual(foundInBm, true, 'BM sees the message initially');

    // BM clears chat for themselves
    const clearRes = await makeRequest('DELETE', '/api/v1/messages/thread', {
      thread_type: 'channel',
      thread_ref_id: 'cashier',
      branch_id: branchId
    });
    assert.strictEqual(clearRes.status, 200);
    assert.strictEqual(clearRes.body.success, true);

    // BM checks again -> messageAId is now HIDDEN for BM
    bmMsgRes = await makeRequest('GET', `/api/v1/messages?thread_type=channel&ref_id=cashier&branch_id=${branchId}`);
    foundInBm = bmMsgRes.body.messages.some(m => m.id === messageAId);
    assert.strictEqual(foundInBm, false, 'BM must NOT see the message after clearing chat for themselves');

    // But Owner checks -> messageAId MUST STILL EXIST for Owner (Not deleted globally!)
    currentUser = ownerUser;
    const ownerMsgRes = await makeRequest('GET', `/api/v1/messages?thread_type=channel&ref_id=cashier&branch_id=${branchId}`);
    const foundInOwner = ownerMsgRes.body.messages.some(m => m.id === messageAId);
    assert.strictEqual(foundInOwner, true, 'Owner still retains full history despite BM clearing their local chat');
  });

  await t.test('4. Sender Unsend / Retract Rules & Security Guardrails', async () => {
    // Other user (Cashier) tries to retract Owner's message -> must be 403 Forbidden
    currentUser = cashierUser;
    const hackRes = await makeRequest('DELETE', `/api/v1/messages/${messageAId}`);
    assert.strictEqual(hackRes.status, 403, 'Non-sender cannot retract someone else message');

    // Owner (the sender) retracts their own message -> 200 OK
    currentUser = ownerUser;
    const retractRes = await makeRequest('DELETE', `/api/v1/messages/${messageAId}`);
    assert.strictEqual(retractRes.status, 200);
    assert.strictEqual(retractRes.body.success, true);

    // Check message body is now replaced with placeholder
    const checkRes = await makeRequest('GET', `/api/v1/messages?thread_type=channel&ref_id=cashier&branch_id=${branchId}`);
    const retractedMsg = checkRes.body.messages.find(m => m.id === messageAId);
    assert.ok(retractedMsg);
    assert.strictEqual(retractedMsg.body, '🚫 Pesan ini telah ditarik');
  });

  await t.test('5. F&B Audit Compliance: Financial Receipts (is_receipt = 1) CANNOT be retracted', async () => {
    currentUser = purchasingUser;

    // Purchasing staff posts a receipt photo
    const receiptRes = await makeRequest('POST', '/api/v1/messages', {
      thread_type: 'channel',
      thread_ref_id: 'purchasing',
      branch_id: branchId,
      body: 'Struk pembelian ayam karkas 20kg di Pasar Keputran',
      is_receipt: 1
    });

    assert.strictEqual(receiptRes.status, 201);
    receiptMessageId = receiptRes.body.message.id;

    // Purchasing staff tries to retract the receipt photo -> MUST FAIL (409 Conflict)
    const retractReceiptRes = await makeRequest('DELETE', `/api/v1/messages/${receiptMessageId}`);
    assert.strictEqual(retractReceiptRes.status, 409, 'Financial receipt must be immutable and cannot be retracted');
    assert.ok(retractReceiptRes.body.error.includes('audit'));
  });

  await t.test('6. Read Receipts (POST /read) updates delivery_status', async () => {
    currentUser = cashierUser;

    // Cashier sends a message to cashier channel
    const msgRes = await makeRequest('POST', '/api/v1/messages', {
      thread_type: 'channel',
      thread_ref_id: 'cashier',
      branch_id: branchId,
      body: 'Laporan shift pagi selesai direkap.'
    });
    assert.strictEqual(msgRes.status, 201);
    const msgId = msgRes.body.message.id;

    // Cashier checks status -> delivery_status is 'sent' (single checkmark)
    let getRes = await makeRequest('GET', `/api/v1/messages?thread_type=channel&ref_id=cashier&branch_id=${branchId}`);
    let target = getRes.body.messages.find(m => m.id === msgId);
    assert.strictEqual(target.delivery_status, 'sent');

    // BM opens the room and marks read
    currentUser = bmUser;
    const readRes = await makeRequest('POST', '/api/v1/messages/read', {
      thread_type: 'channel',
      thread_ref_id: 'cashier',
      branch_id: branchId
    });
    assert.strictEqual(readRes.status, 200);

    // Cashier checks again -> delivery_status is now 'read' (double checkmark)
    currentUser = cashierUser;
    getRes = await makeRequest('GET', `/api/v1/messages?thread_type=channel&ref_id=cashier&branch_id=${branchId}`);
    target = getRes.body.messages.find(m => m.id === msgId);
    assert.strictEqual(target.delivery_status, 'read');
  });
});
