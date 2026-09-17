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
});
