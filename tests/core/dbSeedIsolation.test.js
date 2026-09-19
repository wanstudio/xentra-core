'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '../..');
const prodDbPath = path.resolve(rootDir, 'server/database/xentra.db');

test('Database Seed & Test Isolation Suite', async (t) => {

  await t.test('1. Fresh test DB (NODE_ENV=test) initializes schema without creating demo branches, products, or promotions', () => {
    const script = `
      process.env.NODE_ENV = 'test';
      const db = require('./server/database/db');
      const branches = db.prepare('SELECT count(*) as c FROM branches').get().c;
      const products = db.prepare('SELECT count(*) as c FROM products').get().c;
      const promos = db.prepare('SELECT count(*) as c FROM promotions').get().c;
      console.log(JSON.stringify({ branches, products, promos }));
    `;
    const res = spawnSync('node', ['-e', script], { cwd: rootDir, encoding: 'utf8' });
    assert.strictEqual(res.status, 0, `Script failed: ${res.stderr}`);
    const counts = JSON.parse(res.stdout.trim().split('\n').pop());
    assert.strictEqual(counts.branches, 0, 'Fresh test DB must have 0 branches');
    assert.strictEqual(counts.products, 0, 'Fresh test DB must have 0 products');
    assert.strictEqual(counts.promos, 0, 'Fresh test DB must have 0 promotions');
  });

  await t.test('2. Production startup on fresh DB initializes schema/tenant but DOES NOT execute demo seeding', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-prod-seed-test-'));
    const testDbFile = path.join(tmpDir, 'test-prod.db');

    try {
      const script = `
        const db = require('./server/database/db');
        const orgs = db.prepare('SELECT count(*) as c FROM organizations').get().c;
        const brands = db.prepare('SELECT count(*) as c FROM brands').get().c;
        const users = db.prepare('SELECT count(*) as c FROM users').get().c;
        const branches = db.prepare('SELECT count(*) as c FROM branches').get().c;
        const products = db.prepare('SELECT count(*) as c FROM products').get().c;
        const promos = db.prepare('SELECT count(*) as c FROM promotions').get().c;
        console.log(JSON.stringify({ orgs, brands, users, branches, products, promos }));
      `;
      const env = { ...process.env, NODE_ENV: 'production', DB_PATH: testDbFile };
      delete env.npm_lifecycle_event;

      const res = spawnSync('node', ['-e', script], { cwd: rootDir, env, encoding: 'utf8' });
      assert.strictEqual(res.status, 0, `Script failed: ${res.stderr}`);
      const data = JSON.parse(res.stdout.trim().split('\n').pop());

      // Essential tenant bootstrap must be present
      assert.strictEqual(data.orgs, 1, 'Essential organization must be created');
      assert.strictEqual(data.brands, 1, 'Essential brand must be created');
      assert.strictEqual(data.users, 1, 'Initial admin user must be created');

      // Demo fixtures MUST NOT be seeded
      assert.strictEqual(data.branches, 0, 'Production boot must NOT seed demo branches');
      assert.strictEqual(data.products, 0, 'Production boot must NOT seed demo products');
      assert.strictEqual(data.promos, 0, 'Production boot must NOT seed demo promotions');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  await t.test('3. Deliberately empty production state (0 branches, 0 products) remains empty across restarts', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-prod-restart-empty-'));
    const testDbFile = path.join(tmpDir, 'restart-empty.db');

    try {
      // Step 1: Start production, seed custom branch, then delete all branches and products (empty client state)
      const setupScript = `
        const db = require('./server/database/db');
        // Delete any branches or products if any existed
        db.prepare('DELETE FROM branch_products').run();
        db.prepare('DELETE FROM branches').run();
        db.prepare('DELETE FROM products').run();
        db.prepare('DELETE FROM categories').run();
        // Clear metadata as well to simulate no seed marker
        db.prepare("DELETE FROM system_metadata WHERE key = 'seed_demo_data_completed'").run();
      `;
      const env = { ...process.env, NODE_ENV: 'production', DB_PATH: testDbFile };
      delete env.npm_lifecycle_event;

      const setupRes = spawnSync('node', ['-e', setupScript], { cwd: rootDir, env, encoding: 'utf8' });
      assert.strictEqual(setupRes.status, 0, `Setup failed: ${setupRes.stderr}`);

      // Step 2: Restart process in production mode against the same DB file
      const restartScript = `
        const db = require('./server/database/db');
        const branches = db.prepare('SELECT count(*) as c FROM branches').get().c;
        const products = db.prepare('SELECT count(*) as c FROM products').get().c;
        console.log(JSON.stringify({ branches, products }));
      `;
      const restartRes = spawnSync('node', ['-e', restartScript], { cwd: rootDir, env, encoding: 'utf8' });
      assert.strictEqual(restartRes.status, 0, `Restart failed: ${restartRes.stderr}`);
      const after = JSON.parse(restartRes.stdout.trim().split('\n').pop());

      assert.strictEqual(after.branches, 0, 'Empty branches must remain 0 after restart — no resurrection!');
      assert.strictEqual(after.products, 0, 'Empty products must remain 0 after restart — no resurrection!');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  await t.test('4. Existing production state (client branches/products) survives restart untouched without demo duplicates', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-prod-restart-custom-'));
    const testDbFile = path.join(tmpDir, 'restart-custom.db');

    try {
      const setupScript = `
        const db = require('./server/database/db');
        db.prepare("INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active) VALUES ('branch_client_1', 'brand_bangjo', 'Warung Pringsewu', 'warung-pringsewu', 'Jl. Utama', -5.35, 104.98, 1)").run();
        db.prepare("INSERT INTO products (id, brand_id, name, slug, price, is_active) VALUES ('prod_client_1', 'brand_bangjo', 'Menu Spesial', 'menu-spesial', 35000, 1)").run();
      `;
      const env = { ...process.env, NODE_ENV: 'production', DB_PATH: testDbFile };
      delete env.npm_lifecycle_event;

      const setupRes = spawnSync('node', ['-e', setupScript], { cwd: rootDir, env, encoding: 'utf8' });
      assert.strictEqual(setupRes.status, 0, `Setup failed: ${setupRes.stderr}`);

      // Re-start
      const verifyScript = `
        const db = require('./server/database/db');
        const branches = db.prepare('SELECT id, name FROM branches').all();
        const products = db.prepare('SELECT id, name FROM products').all();
        console.log(JSON.stringify({ branches, products }));
      `;
      const verifyRes = spawnSync('node', ['-e', verifyScript], { cwd: rootDir, env, encoding: 'utf8' });
      assert.strictEqual(verifyRes.status, 0, `Verify failed: ${verifyRes.stderr}`);
      const verified = JSON.parse(verifyRes.stdout.trim().split('\n').pop());

      assert.strictEqual(verified.branches.length, 1);
      assert.strictEqual(verified.branches[0].id, 'branch_client_1');
      assert.strictEqual(verified.products.length, 1);
      assert.strictEqual(verified.products[0].id, 'prod_client_1');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  await t.test('5. npm test blocks execution against production DB_PATH (fail-closed defense)', () => {
    const res = spawnSync('node', [
      '-e',
      `process.env.NODE_ENV='test'; process.env.DB_PATH='${prodDbPath}'; require('./server/database/db.js');`
    ], { cwd: rootDir, encoding: 'utf8' });

    assert.notStrictEqual(res.status, 0, 'Must fail when pointing to production DB in test mode');
    assert.match(res.stderr, /Refusing to run tests against the production database path/);
  });

  await t.test('6. Subprocess / test invocation with npm_lifecycle_event=test without NODE_ENV=test fails fast', () => {
    const res = spawnSync('node', [
      '-e',
      "delete process.env.NODE_ENV; process.env.npm_lifecycle_event='test'; require('./server/database/db.js');"
    ], { cwd: rootDir, encoding: 'utf8' });

    assert.notStrictEqual(res.status, 0, 'Must fail when test lifecycle detected without NODE_ENV=test');
    assert.match(res.stderr, /Running tests without NODE_ENV=test is strictly prohibited/);
  });

  await t.test('7. Explicit demo seed works when intentionally called (db.seedDemoData)', () => {
    const script = `
      process.env.NODE_ENV = 'test';
      const db = require('./server/database/db');
      db.seedDemoData(db);
      const branches = db.prepare('SELECT count(*) as c FROM branches').get().c;
      const products = db.prepare('SELECT count(*) as c FROM products').get().c;
      const promos = db.prepare('SELECT count(*) as c FROM promotions').get().c;
      console.log(JSON.stringify({ branches, products, promos }));
    `;
    const res = spawnSync('node', ['-e', script], { cwd: rootDir, encoding: 'utf8' });
    assert.strictEqual(res.status, 0, `Script failed: ${res.stderr}`);
    const data = JSON.parse(res.stdout.trim().split('\n').pop());

    assert.strictEqual(data.branches, 5, 'Demo seed must create 5 demo branches');
    assert.strictEqual(data.products, 8, 'Demo seed must create 8 demo products');
    assert.strictEqual(data.promos, 1, 'Demo seed must create 1 demo install promo');
  });

  await t.test('8. Explicit demo seed is BLOCKED in production without ALLOW_PRODUCTION_DEMO_SEED=1', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-prod-seed-block-'));
    const testDbFile = path.join(tmpDir, 'block.db');

    try {
      const script = `
        const db = require('./server/database/db');
        db.seedDemoData(db);
      `;
      const env = { ...process.env, NODE_ENV: 'production', DB_PATH: testDbFile };
      delete env.npm_lifecycle_event;
      delete env.ALLOW_PRODUCTION_DEMO_SEED;

      const res = spawnSync('node', ['-e', script], { cwd: rootDir, env, encoding: 'utf8' });
      assert.notStrictEqual(res.status, 0, 'Must throw error when trying to seed demo data in production');
      assert.match(res.stderr, /Refusing to seed demo fixtures into production database/);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  await t.test('9. Standalone script tools/seed-demo.js works with ALLOW_PRODUCTION_DEMO_SEED=1', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-prod-seed-allow-'));
    const testDbFile = path.join(tmpDir, 'allow.db');

    try {
      const env = {
        ...process.env,
        NODE_ENV: 'production',
        DB_PATH: testDbFile,
        ALLOW_PRODUCTION_DEMO_SEED: '1'
      };
      delete env.npm_lifecycle_event;

      const res = spawnSync('node', ['tools/seed-demo.js'], { cwd: rootDir, env, encoding: 'utf8' });
      assert.strictEqual(res.status, 0, `Seed tool failed: ${res.stderr}`);
      assert.match(res.stdout, /Successfully seeded demo fixtures/);

      // Verify branches
      const verifyScript = `
        const db = require('./server/database/db');
        const branches = db.prepare('SELECT count(*) as c FROM branches').get().c;
        console.log('BRANCH_COUNT:' + branches);
      `;
      const verifyRes = spawnSync('node', ['-e', verifyScript], { cwd: rootDir, env, encoding: 'utf8' });
      assert.strictEqual(verifyRes.status, 0);
      assert.match(verifyRes.stdout, /BRANCH_COUNT:5/);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  await t.test('10. Banners and promotions do not resurrect demo versions when cleared', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-prod-banners-'));
    const testDbFile = path.join(tmpDir, 'banners.db');

    try {
      const script1 = `
        const db = require('./server/database/db');
        // Custom banners set to empty array []
        db.prepare("UPDATE brands SET banners = '[]' WHERE id = 'brand_bangjo'").run();
        // Delete all promotions
        db.prepare('DELETE FROM promotion_rewards').run();
        db.prepare('DELETE FROM promotion_rules').run();
        db.prepare('DELETE FROM promotion_branch_scope').run();
        db.prepare('DELETE FROM promotions').run();
      `;
      const env = { ...process.env, NODE_ENV: 'production', DB_PATH: testDbFile };
      delete env.npm_lifecycle_event;

      const res1 = spawnSync('node', ['-e', script1], { cwd: rootDir, env, encoding: 'utf8' });
      assert.strictEqual(res1.status, 0, `Script 1 failed: ${res1.stderr}`);

      // Restart process
      const script2 = `
        const db = require('./server/database/db');
        const brand = db.prepare("SELECT banners FROM brands WHERE id = 'brand_bangjo'").get();
        const promoCount = db.prepare('SELECT count(*) as c FROM promotions').get().c;
        console.log(JSON.stringify({ banners: brand.banners, promoCount }));
      `;
      const res2 = spawnSync('node', ['-e', script2], { cwd: rootDir, env, encoding: 'utf8' });
      assert.strictEqual(res2.status, 0, `Script 2 failed: ${res2.stderr}`);
      const data = JSON.parse(res2.stdout.trim().split('\n').pop());

      assert.strictEqual(data.banners, '[]', 'Banners must stay empty array and not be overwritten');
      assert.strictEqual(data.promoCount, 0, 'Promotions must stay 0 and not be resurrected');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

});
