'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test('F06 Database Production Runtime Hardening Suite', async (t) => {
  const rootDir = path.resolve(__dirname, '..');

  const makeProdEnv = (extra = {}) => {
    const env = { ...process.env, ...extra };
    delete env.npm_lifecycle_event;
    return env;
  };

  await t.test('F06-01: In production, invalid or unwriteable DB_PATH fails fast and exits with code 1', () => {
    // Point DB_PATH to an impossible/invalid path (non-existent dir that cannot be created)
    const invalidDbPath = '/dev/null/impossible/path/db.sqlite';
    const result = spawnSync('node', ['-e', "require('./server/database/db')"], {
      cwd: rootDir,
      env: makeProdEnv({
        NODE_ENV: 'production',
        DB_PATH: invalidDbPath
      }),
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
        env: makeProdEnv({
          NODE_ENV: 'production',
          DB_PATH: corruptDbFile
        }),
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
      env: makeProdEnv({
        NODE_ENV: 'production'
      }),
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
        env: makeProdEnv({
          NODE_ENV: 'production',
          DB_PATH: validDbFile
        }),
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
        env: makeProdEnv({
          NODE_ENV: 'production',
          DB_PATH: unreadableDbFile,
          XENTRA_FORCE_SQLJS: '1'
        }),
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
        env: makeProdEnv({
          NODE_ENV: 'production',
          DB_PATH: corruptDbFile,
          XENTRA_FORCE_SQLJS: '1'
        }),
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
        env: makeProdEnv({
          NODE_ENV: 'production',
          DB_PATH: newDbFile,
          XENTRA_FORCE_SQLJS: '1'
        }),
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
      env: makeProdEnv({
        NODE_ENV: 'production',
        XENTRA_FORCE_SQLJS: '1'
      }),
      encoding: 'utf8'
    });

    assert.strictEqual(result.status, 1, `Process should exit with code 1 when sql.js cannot load, got ${result.status}`);
    assert.match(
      result.stderr,
      /\[Database Fatal Error\]/i,
      'Should log [Database Fatal Error] on stderr before exiting'
    );
  });

  await t.test('F06-SQLJS-05: sql.js disk write failure fails fast and prevents silent mutation success (deterministic failure injection)', () => {
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
        env: makeProdEnv({
          NODE_ENV: 'production',
          DB_PATH: writeFailDbFile,
          XENTRA_FORCE_SQLJS: '1'
        }),
        encoding: 'utf8'
      });
      assert.strictEqual(initRes.status, 0, `Init step must succeed, got ${initRes.status}`);

      // Step 2: In a subprocess, deterministically intercept fs.writeFileSync at the persistence boundary
      // (targeting the .tmp.* file created during saveSqlJsToDisk)
      const mutateScript = `
        const fs = require('fs');
        const origWriteFileSync = fs.writeFileSync;
        let failInjected = false;

        // Intercept writes to temp db files
        fs.writeFileSync = function(filePath, data, options) {
          if (typeof filePath === 'string' && filePath.includes('.tmp.')) {
            failInjected = true;
            throw new Error('EIO: deterministic disk persistence write failure simulation');
          }
          return origWriteFileSync.apply(this, arguments);
        };

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
        env: makeProdEnv({
          NODE_ENV: 'production',
          DB_PATH: writeFailDbFile,
          XENTRA_FORCE_SQLJS: '1'
        }),
        encoding: 'utf8'
      });

      // Must NOT output UNEXPECTED_MUTATION_SUCCESS and must exit with code 1 (production exit)
      assert.strictEqual(mutateRes.stdout.includes('UNEXPECTED_MUTATION_SUCCESS'), false, 'Mutation must not silently succeed when disk write fails');
      assert.strictEqual(mutateRes.status, 1, `Disk write failure must exit with code 1 in production, got ${mutateRes.status}. Stderr: ${mutateRes.stderr}`);
      assert.match(mutateRes.stderr, /\[Database Fatal Error\] Failed to persist sql.js to disk/i);
    } finally {
      try {
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
        env: makeProdEnv({
          NODE_ENV: 'production',
          DB_PATH: successDbFile,
          XENTRA_FORCE_SQLJS: '1'
        }),
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

  await t.test('F06-SQLJS-07: COMMIT triggers persistence and committed data survives process restart', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-f06-sqljs-commit-'));
    const commitDbFile = path.join(tmpDir, 'commit.db');

    try {
      // Step 1: Execute transaction with COMMIT
      const commitScript = `
        const db = require('./server/database/db');
        const DataAccess = require('./core/data/DataAccess');
        DataAccess.ready().then(() => {
          db.exec('BEGIN IMMEDIATE;');
          db.prepare("INSERT INTO organizations (id, name, slug) VALUES ('org_committed', 'Committed Org', 'committed-org')").run();
          db.exec('COMMIT;');
          process.exit(0);
        }).catch(err => {
          console.error(err);
          process.exit(1);
        });
      `;

      const commitRes = spawnSync('node', ['-e', commitScript], {
        cwd: rootDir,
        env: makeProdEnv({
          NODE_ENV: 'production',
          DB_PATH: commitDbFile,
          XENTRA_FORCE_SQLJS: '1'
        }),
        encoding: 'utf8'
      });

      assert.strictEqual(commitRes.status, 0, `Commit script should exit 0, got ${commitRes.status}. Stderr: ${commitRes.stderr}`);

      // Step 2: In a brand new process, reopen DB from disk and verify committed row exists
      const verifyScript = `
        const db = require('./server/database/db');
        const DataAccess = require('./core/data/DataAccess');
        DataAccess.ready().then(() => {
          const row = db.prepare("SELECT * FROM organizations WHERE id = 'org_committed'").get();
          if (row && row.name === 'Committed Org') {
            process.exit(0);
          }
          console.error('Row not found or mismatched:', row);
          process.exit(2);
        }).catch(err => {
          console.error(err);
          process.exit(1);
        });
      `;

      const verifyRes = spawnSync('node', ['-e', verifyScript], {
        cwd: rootDir,
        env: makeProdEnv({
          NODE_ENV: 'production',
          DB_PATH: commitDbFile,
          XENTRA_FORCE_SQLJS: '1'
        }),
        encoding: 'utf8'
      });

      assert.strictEqual(verifyRes.status, 0, `Committed row must persist to disk across process restart. Stderr: ${verifyRes.stderr}`);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  await t.test('F06-SQLJS-08: ROLLBACK does NOT trigger persistence and rolled-back data is not on disk', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xentra-f06-sqljs-rollback-'));
    const rollbackDbFile = path.join(tmpDir, 'rollback.db');

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
        env: makeProdEnv({
          NODE_ENV: 'production',
          DB_PATH: rollbackDbFile,
          XENTRA_FORCE_SQLJS: '1'
        }),
        encoding: 'utf8'
      });
      assert.strictEqual(initRes.status, 0, `Init step must succeed, got ${initRes.status}. Stderr: ${initRes.stderr}`);

      // Step 2: Execute transaction with ROLLBACK while tracking file modification and disk writes
      const rollbackScript = `
        const fs = require('fs');
        let persistenceWriterInvoked = false;

        // Monitor writes to temp or db file during/after transaction
        const origWrite = fs.writeFileSync;
        fs.writeFileSync = function(p, data, opts) {
          if (typeof p === 'string' && (p.includes('.tmp.') || p === '${rollbackDbFile}')) {
            persistenceWriterInvoked = true;
          }
          return origWrite.apply(this, arguments);
        };

        const db = require('./server/database/db');
        const DataAccess = require('./core/data/DataAccess');
        DataAccess.ready().then(() => {
          // Reset tracker after schema initialization completes
          persistenceWriterInvoked = false;

          db.exec('BEGIN IMMEDIATE;');
          db.prepare("INSERT INTO organizations (id, name, slug) VALUES ('org_rolled_back', 'Rolled Back Org', 'rolled-back-org')").run();
          db.exec('ROLLBACK;');

          if (persistenceWriterInvoked) {
            console.error('PERSISTENCE_WRITER_UNEXPECTEDLY_INVOKED_ON_ROLLBACK');
            process.exit(3);
          }
          process.exit(0);
        }).catch(err => {
          console.error(err);
          process.exit(1);
        });
      `;

      const rollbackRes = spawnSync('node', ['-e', rollbackScript], {
        cwd: rootDir,
        env: makeProdEnv({
          NODE_ENV: 'production',
          DB_PATH: rollbackDbFile,
          XENTRA_FORCE_SQLJS: '1'
        }),
        encoding: 'utf8'
      });

      assert.strictEqual(rollbackRes.status, 0, `Rollback should not invoke persistence writer. Stderr: ${rollbackRes.stderr}`);
      assert.strictEqual(rollbackRes.stderr.includes('PERSISTENCE_WRITER_UNEXPECTEDLY_INVOKED_ON_ROLLBACK'), false);

      // Step 3: In a fresh process, reopen DB from disk and verify rolled-back row definitely does not exist
      const verifyScript = `
        const db = require('./server/database/db');
        const DataAccess = require('./core/data/DataAccess');
        DataAccess.ready().then(() => {
          const row = db.prepare("SELECT * FROM organizations WHERE id = 'org_rolled_back'").get();
          if (row) {
            console.error('Rolled back row unexpectedly persisted to disk:', row);
            process.exit(2);
          }
          process.exit(0);
        }).catch(err => {
          console.error(err);
          process.exit(1);
        });
      `;

      const verifyRes = spawnSync('node', ['-e', verifyScript], {
        cwd: rootDir,
        env: makeProdEnv({
          NODE_ENV: 'production',
          DB_PATH: rollbackDbFile,
          XENTRA_FORCE_SQLJS: '1'
        }),
        encoding: 'utf8'
      });

      assert.strictEqual(verifyRes.status, 0, `Rolled back data must not exist in persistent database. Stderr: ${verifyRes.stderr}`);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });
});
