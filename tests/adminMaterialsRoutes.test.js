'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const db = require('../server/database/db');
const registerAdminMaterialRoutes = require('../server/routes/admin-materials');

const app = express();
app.use(express.json());
// Mock authenticated user context
app.use((req, res, next) => {
  req.user = { id: 'usr_test_owner', organization_id: 'org_test_routes', role: 'owner' };
  next();
});
const router = express.Router();
registerAdminMaterialRoutes(router);
app.use('/api', router);

const ORG = 'org_test_routes';
let server;
let baseUrl;

test.before(async () => {
  await db.readyPromise;
  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(
    ORG, 'Routes Test Org', 'routes-test-org'
  );

  await new Promise(resolve => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise(res => server.close(res));
  db.prepare('DELETE FROM materials WHERE organization_id = ?').run(ORG);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});

test('GET /api/admin/uoms returns seeded canonical active UOM list', async () => {
  const res = await fetch(`${baseUrl}/api/admin/uoms`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.uoms));
  const kg = body.uoms.find(u => u.id === 'uom_kg');
  assert.ok(kg);
  assert.equal(kg.name, 'Kilogram');
});

test('POST /api/admin/materials creates an Organization-scoped Material', async () => {
  const payload = {
    material_code: 'MAT-API-CHICKEN',
    name: 'Daging Ayam Fillet',
    description: 'Bahan baku ayam fillet',
    base_uom_id: 'uom_kg',
    status: 'ACTIVE'
  };

  const res = await fetch(`${baseUrl}/api/admin/materials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.material.name, 'Daging Ayam Fillet');
  assert.equal(body.material.material_code, 'MAT-API-CHICKEN');
  assert.equal(body.material.organization_id, ORG);
});

test('GET /api/admin/materials lists materials for the authenticated organization', async () => {
  const res = await fetch(`${baseUrl}/api/admin/materials`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.ok(body.materials.length >= 1);
  const found = body.materials.find(m => m.material_code === 'MAT-API-CHICKEN');
  assert.ok(found);
});

test('PUT /api/admin/materials/:id/archive archives the material', async () => {
  const listRes = await fetch(`${baseUrl}/api/admin/materials`);
  const listBody = await listRes.json();
  const material = listBody.materials.find(m => m.material_code === 'MAT-API-CHICKEN');

  const res = await fetch(`${baseUrl}/api/admin/materials/${material.id}/archive`, {
    method: 'PUT'
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.material.status, 'ARCHIVED');
});

