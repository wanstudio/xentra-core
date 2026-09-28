'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP_PATH = path.join(__dirname, '../server/app.js');
const DASHBOARD_PATH = path.join(__dirname, '../apps/merchant-dashboard/index.html');
const ENTRY_PATH = path.join(__dirname, '../apps/merchant-dashboard/business-entry.html');
const TENANT_RESOLVER_PATH = path.join(__dirname, '../server/middleware/tenantResolver.js');

test('biz.xentra.cloud is a first-class Xentra Business Portal surface', () => {
  const app = fs.readFileSync(APP_PATH, 'utf8');
  const dashboard = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const entry = fs.readFileSync(ENTRY_PATH, 'utf8');
  const resolver = fs.readFileSync(TENANT_RESOLVER_PATH, 'utf8');

  assert.match(app, /host === 'biz\.xentra\.cloud'/, 'biz.xentra.cloud must be recognized by subtype/host logic');
  assert.match(
    app,
    /function isSaaSHost\(req\)[\s\S]*?host === 'biz\.xentra\.cloud'/,
    'biz.xentra.cloud must bypass tenant-domain HTML routing'
  );
  assert.match(
    app,
    /if \(host === 'biz\.xentra\.cloud'\)[\s\S]*?business-entry\.html/,
    'biz root must use the dedicated Business Portal entry'
  );
  assert.match(
    app,
    /if \(host === 'biz\.xentra\.cloud'\)[\s\S]*?Xentra Business Portal/,
    'biz manifest must identify itself as Xentra Business Portal'
  );
  assert.match(
    resolver,
    /cleanHost === 'xentra\.cloud' \|\| cleanHost === 'biz\.xentra\.cloud'/,
    'tenantResolver must treat biz.xentra.cloud as a SaaS portal, not a tenant custom domain'
  );

  assert.match(entry, /<link rel="manifest" href="\/manifest\.json">/);
  assert.match(entry, /navigator\.serviceWorker\.register\('\/service-worker\.js', \{ scope: '\/' \}\)/);
  assert.match(entry, /user\.role === 'owner' \|\| user\.role === 'brand_manager'/);
  assert.match(entry, /user\.role === 'branch_manager' \|\| user\.role === 'manager'/);

  assert.match(
    dashboard,
    /window\.location\.hostname === 'biz\.xentra\.cloud'[\s\S]*?manifestLink\.rel = 'manifest'/,
    'Owner dashboard must expose the dynamic Business Portal manifest on biz'
  );
  assert.match(
    dashboard,
    /window\.location\.hostname === 'biz\.xentra\.cloud'[\s\S]*?serviceWorker\.register\('\/service-worker\.js', \{ scope: '\/' \}\)/,
    'Owner dashboard must register a root-scoped SW on biz for direct installability'
  );
});
