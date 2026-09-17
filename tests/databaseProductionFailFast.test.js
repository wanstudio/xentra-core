'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test('F06 Database Production Runtime Hardening Suite', async (t) => {
  const rootDir = path.resolve(__dirname, '..');

  await t.test('F06-01: In production, invalid or unwriteable DB_PATH fails fast and exits with code 1', () => {
    // Point DB_PATH to an impossible/invalid path (non-existent dir that cannot be created)
    const invalidDbPath = '/dev/null/impossible/path/db.sqlite';
    const result = spawnSync('node', ['-e', "require('./server/database/db')"], {
      cwd: rootDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DB_PATH: invalidDbPath
      },
      encoding: 'utf8'
    });

    assert.strictEqual(result.status, 1, `Process should exit with code 1, got status ${result.status}. Stderr: ${result.stderr}`);
    assert.match(
      result.stderr,
      /\[Database Fatal Error\]/i,
      'Should log [Database Fatal Error] on stderr before exiting'
    );
  });

  await t.test('F06-02: In production, corrupt DB file fails fast and exits with code 1 without memory fallback', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-f06-'));
    const corruptDbFile = path.join(tmpDir, 'corrupt.db');
    fs.writeFileSync(corruptDbFile, 'NOT A VALID SQLITE DATABASE HEADER AT ALL 12345');

    try {
      const result = spawnSync('node', ['-e', "require('./server/database/db')"], {
        cwd: rootDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DB_PATH: corruptDbFile
        },
        encoding: 'utf8'
      });

      assert.strictEqual(result.status, 1, `Process should exit with code 1 on corrupt DB, got status ${result.status}. Stderr: ${result.stderr}`);
      assert.match(
        result.stderr,
        /\[Database Fatal Error\]/i,
        'Should log [Database Fatal Error] on stderr before exiting'
      );
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  await t.test('F06-03: In production, server/app.js startup fails fast if database readyPromise fails', () => {
    // If DataAccess rejects in production, app.js must process.exit(1) and not start server
    const script = `
      const DataAccess = require('./core/data/DataAccess');
      // Force readyPromise to reject
      Object.defineProperty(DataAccess, 'readyPromise', {
        value: Promise.reject(new Error('Simulated DB init failure'))
      });
      // Set NODE_ENV=production
      process.env.NODE_ENV = 'production';
      // Execute app startup
      require('./server/app');
    `;

    const result = spawnSync('node', ['-e', script], {
      cwd: rootDir,
      env: {
        ...process.env,
        NODE_ENV: 'production'
      },
      encoding: 'utf8'
    });

    assert.strictEqual(result.status, 1, `Server startup should exit with code 1 on DB failure, got ${result.status}`);
    assert.match(
      result.stderr,
      /\[Xentra Core Fatal\] Refusing to start HTTP server/i,
      'Should refuse to start HTTP server and log fatal error'
    );
  });

  await t.test('F06-04: In production, normal persistent database initializes cleanly with WAL mode', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-f06-valid-'));
    const validDbFile = path.join(tmpDir, 'valid.db');

    try {
      const script = `
        const db = require('./server/database/db');
        const DataAccess = require('./core/data/DataAccess');
        const row = db.prepare('SELECT 1 as alive').get();
        if (!row || row.alive !== 1) {
          process.exit(2);
        }
        process.exit(0);
      `;

      const result = spawnSync('node', ['-e', script], {
        cwd: rootDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DB_PATH: validDbFile
        },
        encoding: 'utf8'
      });

      assert.strictEqual(result.status, 0, `Expected clean exit 0, got ${result.status}. Output: ${result.stdout} ${result.stderr}`);
      assert.match(
        result.stdout,
        /\[Database\] Native node:sqlite persistent storage initialized successfully \(Node .*, WAL mode\)\./,
        'Should log successful native WAL initialization'
      );
      assert.strictEqual(fs.existsSync(validDbFile), true, 'Persistent DB file must be created on disk');
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  await t.test('F06-05: In test environment (NODE_ENV=test), memory DB is isolated and permitted', () => {
    const db = require('../server/database/db');
    const row = db.prepare('SELECT 1 as alive').get();
    assert.strictEqual(row.alive, 1);
  });

  await t.test('F06-SQLJS-01: Existing persistent DB file is unreadable (force sql.js, NODE_ENV=production)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-f06-sqljs-unreadable-'));
    const unreadableDbFile = path.join(tmpDir, 'unreadable.db');
    // Create file and make it unreadable (chmod 000)
    fs.writeFileSync(unreadableDbFile, 'SQLITE DATA');
    fs.chmodSync(unreadableDbFile, 0o000);

    try {
      const result = spawnSync('node', ['-e', "require('./server/database/db')"], {
        cwd: rootDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DB_PATH: unreadableDbFile,
          XENTRA_FORCE_SQLJS: '1'
        },
        encoding: 'utf8'
      });

      assert.strictEqual(result.status, 1, `Process should exit with code 1 on unreadable DB, got ${result.status}. Stderr: ${result.stderr}`);
      assert.match(
        result.stderr,
        /\[Database Fatal Error\]/i,
        'Should log [Database Fatal Error] on stderr before exiting'
      );
    } finally {
      try {
        fs.chmodSync(unreadableDbFile, 0o666);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  await t.test('F06-SQLJS-02: Existing persistent DB contains corrupt SQLite data (force sql.js, NODE_ENV=production)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-f06-sqljs-corrupt-'));
    const corruptDbFile = path.join(tmpDir, 'corrupt.db');
    fs.writeFileSync(corruptDbFile, 'NOT A VALID SQLITE DATABASE FILE AT ALL 12345');

    try {
      const result = spawnSync('node', ['-e', "require('./server/database/db')"], {
        cwd: rootDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DB_PATH: corruptDbFile,
          XENTRA_FORCE_SQLJS: '1'
        },
        encoding: 'utf8'
      });

      assert.strictEqual(result.status, 1, `Process should exit with code 1 on corrupt DB, got ${result.status}. Stderr: ${result.stderr}`);
      assert.match(
        result.stderr,
        /\[Database Fatal Error\]/i,
        'Should log [Database Fatal Error] on stderr before exiting'
      );
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  await t.test('F06-SQLJS-03: Legitimate first-run missing DB creates new persistent DB (force sql.js)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-f06-sqljs-missing-'));
    const newDbFile = path.join(tmpDir, 'new_created.db');
    assert.strictEqual(fs.existsSync(newDbFile), false, 'DB must not exist before test');

    try {
      const script = `
        const db = require('./server/database/db');
        const DataAccess = require('./core/data/DataAccess');
        DataAccess.ready().then(() => {
          const row = db.prepare('SELECT 1 as alive').get();
          if (!row || row.alive !== 1) {
            process.exit(2);
          }
          process.exit(0);
        }).catch(err => {
          console.error('Failed ready:', err);
          process.exit(1);
        });
      `;

      const result = spawnSync('node', ['-e', script], {
        cwd: rootDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DB_PATH: newDbFile,
          XENTRA_FORCE_SQLJS: '1'
        },
        encoding: 'utf8'
      });

      assert.strictEqual(result.status, 0, `Expected clean exit 0 on first-run creation, got ${result.status}. Output: ${result.stdout} ${result.stderr}`);
      assert.strictEqual(fs.existsSync(newDbFile), true, 'Persistent DB file must be created on disk');
      assert.ok(fs.statSync(newDbFile).size > 0, 'Database file must have non-zero size');
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  await t.test('F06-SQLJS-04: sql.js module initialization failure fails fast in production', () => {
    // Simulate require('sql.js') throwing an error
    const script = `
      // Intercept Module._load for sql.js to simulate module init failure
      const Module = require('module');
      const originalLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        if (request === 'sql.js') {
          throw new Error('Simulated sql.js load failure (WASM missing)');
        }
        return originalLoad.apply(this, arguments);
      };
      require('./server/database/db');
    `;

    const result = spawnSync('node', ['-e', script], {
      cwd: rootDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        XENTRA_FORCE_SQLJS: '1'
      },
      encoding: 'utf8'
    });

    assert.strictEqual(result.status, 1, `Process should exit with code 1 when sql.js cannot load, got ${result.status}`);
    assert.match(
      result.stderr,
      /\[Database Fatal Error\]/i,
      'Should log [Database Fatal Error] on stderr before exiting'
    );
  });

  await t.test('F06-SQLJS-05: sql.js disk write failure fails fast and prevents silent mutation success', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-f06-sqljs-writefail-'));
    const writeFailDbFile = path.join(tmpDir, 'writefail.db');

    try {
      // Step 1: Initialize valid DB file first
      const initScript = `
        const db = require('./server/database/db');
        const DataAccess = require('./core/data/DataAccess');
        DataAccess.ready().then(() => {
          process.exit(0);
        });
      `;
      const initRes = spawnSync('node', ['-e', initScript], {
        cwd: rootDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DB_PATH: writeFailDbFile,
          XENTRA_FORCE_SQLJS: '1'
        },
        encoding: 'utf8'
      });
      assert.strictEqual(initRes.status, 0, `Init step must succeed, got ${initRes.status}`);

      // Step 2: Now make DB directory read-only so that writes fail
      fs.chmodSync(tmpDir, 0o555);

      const mutateScript = `
        const db = require('./server/database/db');
        const DataAccess = require('./core/data/DataAccess');
        DataAccess.ready().then(() => {
          try {
            // Attempt a mutating run() which triggers saveSqlJsToDisk(true)
            db.prepare("INSERT INTO organizations (id, name, slug) VALUES ('org_fail', 'Fail Org', 'fail-org')").run();
            console.log('UNEXPECTED_MUTATION_SUCCESS');
            process.exit(0);
          } catch (err) {
            console.error('CAUGHT_MUTATION_ERROR:', err.message);
            process.exit(3);
          }
        });
      `;

      const mutateRes = spawnSync('node', ['-e', mutateScript], {
        cwd: rootDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DB_PATH: writeFailDbFile,
          XENTRA_FORCE_SQLJS: '1'
        },
        encoding: 'utf8'
      });

      // Must NOT output UNEXPECTED_MUTATION_SUCCESS and must exit with code 1 (production exit)
      assert.strictEqual(mutateRes.stdout.includes('UNEXPECTED_MUTATION_SUCCESS'), false, 'Mutation must not silently succeed when disk write fails');
      assert.strictEqual(mutateRes.status, 1, `Disk write failure must exit with code 1 in production, got ${mutateRes.status}`);
      assert.match(mutateRes.stderr, /\[Database Fatal Error\] Failed to persist sql.js to disk/i);
    } finally {
      try {
        fs.chmodSync(tmpDir, 0o777);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  await t.test('F06-SQLJS-06: Successful sql.js persistent initialization & queries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-f06-sqljs-success-'));
    const successDbFile = path.join(tmpDir, 'success.db');

    try {
      const script = `
        const db = require('./server/database/db');
        const DataAccess = require('./core/data/DataAccess');
        DataAccess.ready().then(() => {
          const alive = db.prepare('SELECT 1 as alive').get();
          const orgs = db.prepare('SELECT * FROM organizations').all();
          if (alive && alive.alive === 1 && Array.isArray(orgs)) {
            process.exit(0);
          }
          process.exit(2);
        }).catch(err => {
          console.error(err);
          process.exit(1);
        });
      `;

      const result = spawnSync('node', ['-e', script], {
        cwd: rootDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DB_PATH: successDbFile,
          XENTRA_FORCE_SQLJS: '1'
        },
        encoding: 'utf8'
      });

      assert.strictEqual(result.status, 0, `Expected clean exit 0, got ${result.status}. Stderr: ${result.stderr}`);
      assert.strictEqual(fs.existsSync(successDbFile), true, 'Persistent DB file must exist on disk');
      assert.ok(fs.statSync(successDbFile).size > 0, 'Database file must have non-zero size');
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });
});
