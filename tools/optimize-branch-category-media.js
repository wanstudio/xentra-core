'use strict';

/**
 * Migrate legacy branch-category photos through the canonical Media Engine.
 * Original PNG/JPEG files are retained; only branch_categories.media_id and
 * image_url are updated. The journal supports a compare-and-restore rollback.
 *
 * Usage:
 *   node tools/optimize-branch-category-media.js --dry-run [--brand <id>] [--branch <id>]
 *   node tools/optimize-branch-category-media.js --apply --brand <id> [--branch <id>]
 *   node tools/optimize-branch-category-media.js --rollback --brand <id> [--branch <id>]
 */

const fs = require('fs');
const path = require('path');
const DataAccess = require('../core/data/DataAccess');
const MediaService = require('../core/media/MediaService');

const mediaService = new MediaService();
const appRoot = path.resolve(__dirname, '../apps/customer-pwa');
const uploadsRoot = path.resolve(appRoot, 'assets/uploads');
const JOURNAL = 'branch_category_media_optimization_migrations';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sourceFileFor(url) {
  if (!url || typeof url !== 'string') return null;
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://xentra.local').pathname);
  } catch (_) {
    return null;
  }
  if (!pathname.startsWith('/assets/uploads/')) return null;
  const filePath = path.resolve(appRoot, `.${pathname}`);
  if (!filePath.startsWith(`${uploadsRoot}${path.sep}`)) return null;
  try {
    return fs.statSync(filePath).isFile() ? filePath : null;
  } catch (_) {
    return null;
  }
}

function scopeSql({ brandId, branchId }, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  let where = `WHERE ${prefix}COALESCE(${prefix}image_url, '') <> ''`;
  const params = [];
  if (brandId) {
    where += ` AND ${prefix}brand_id = ?`;
    params.push(brandId);
  }
  if (branchId) {
    where += ` AND ${prefix}branch_id = ?`;
    params.push(branchId);
  }
  return { where, params };
}

function listCategories(scope) {
  const { where, params } = scopeSql(scope);
  return DataAccess.queryMany(`
    SELECT id, brand_id, branch_id, name, image_url, media_id
    FROM branch_categories ${where}
    ORDER BY brand_id, branch_id, sort_order, name
  `, params);
}

function ensureJournal() {
  DataAccess.exec(`
    CREATE TABLE IF NOT EXISTS ${JOURNAL} (
      category_id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      old_media_id TEXT,
      new_media_id TEXT,
      original_bytes INTEGER NOT NULL DEFAULT 0,
      derivative_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_branch_category_media_migration_scope
      ON ${JOURNAL}(brand_id, branch_id, status);
  `);
}

function beginJournal(category, originalBytes) {
  DataAccess.prepare(`
    INSERT INTO ${JOURNAL} (
      category_id, brand_id, branch_id, source_url, old_media_id,
      original_bytes, status, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'PROCESSING', NULL, datetime('now'), datetime('now'))
    ON CONFLICT(category_id) DO UPDATE SET
      brand_id = excluded.brand_id,
      branch_id = excluded.branch_id,
      source_url = excluded.source_url,
      old_media_id = excluded.old_media_id,
      original_bytes = excluded.original_bytes,
      status = 'PROCESSING',
      error_message = NULL,
      updated_at = datetime('now')
    WHERE ${JOURNAL}.status <> 'COMPLETED'
  `).run(category.id, category.brand_id, category.branch_id, category.image_url,
    category.media_id || null, originalBytes);
}

async function processCategory(category, filePath) {
  const source = await fs.promises.readFile(filePath);
  const imageMeta = await mediaService.processor.inspect(source);
  const mimeType = imageMeta.format === 'jpeg' ? 'image/jpeg' : `image/${imageMeta.format}`;
  let staged;

  try {
    staged = await mediaService.stageUpload({
      brandId: category.brand_id,
      imageBase64: source.toString('base64'),
      mimeType,
      declaredFilename: path.basename(filePath),
      assetType: 'category'
    });
    const published = await mediaService.processMedia({ mediaId: staged.media_id, brandId: category.brand_id });
    const variants = (published.variants || []).slice().sort((a, b) => a.width - b.width);
    if (!variants.length) throw new Error('Media Engine tidak menghasilkan derivative.');
    const preferred = variants.find(variant => variant.width >= 320) || variants[variants.length - 1];
    const derivativeBytes = variants.reduce((sum, variant) => sum + Number(variant.size_bytes || 0), 0);

    DataAccess.exec('BEGIN IMMEDIATE');
    try {
      await mediaService.attachToEntity({
        mediaId: published.media_id,
        brandId: category.brand_id,
        entityType: 'branch_category',
        entityId: String(category.id),
        manageTransaction: false
      });
      const updated = DataAccess.prepare(`
        UPDATE branch_categories
        SET media_id = ?, image_url = ?, updated_at = datetime('now')
        WHERE id = ? AND brand_id = ? AND branch_id = ?
          AND COALESCE(media_id, '') = ? AND image_url = ?
      `).run(published.media_id, preferred.url, category.id, category.brand_id,
        category.branch_id, category.media_id || '', category.image_url);
      if (!updated || updated.changes !== 1) {
        throw new Error('Kategori berubah saat diproses; data terbaru tidak ditimpa.');
      }
      DataAccess.prepare(`
        UPDATE ${JOURNAL}
        SET new_media_id = ?, derivative_bytes = ?, status = 'COMPLETED',
            error_message = NULL, updated_at = datetime('now')
        WHERE category_id = ? AND brand_id = ? AND branch_id = ?
      `).run(published.media_id, derivativeBytes, category.id, category.brand_id, category.branch_id);
      DataAccess.exec('COMMIT');
    } catch (err) {
      DataAccess.exec('ROLLBACK');
      throw err;
    }

    return { originalBytes: source.length, derivativeBytes, mediaId: published.media_id, url: preferred.url };
  } catch (err) {
    if (staged && staged.media_id) {
      try { await mediaService.hardDeleteMedia({ mediaId: staged.media_id, brandId: category.brand_id }); } catch (_) {}
    }
    throw err;
  }
}

async function applyMigration(scope) {
  if (!scope.brandId) throw new Error('--brand wajib diisi bersama --apply.');
  ensureJournal();
  const rows = listCategories(scope);
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let originalBytes = 0;
  let derivativeBytes = 0;

  for (const category of rows) {
    const filePath = sourceFileFor(category.image_url);
    if (category.media_id || !filePath) {
      skipped++;
      continue;
    }
    const size = fs.statSync(filePath).size;
    beginJournal(category, size);
    try {
      const result = await processCategory(category, filePath);
      processed++;
      originalBytes += result.originalBytes;
      derivativeBytes += result.derivativeBytes;
      console.log(`[optimized] ${category.branch_id}/${category.name}: ${result.originalBytes} -> ${result.derivativeBytes} bytes`);
    } catch (err) {
      failed++;
      DataAccess.prepare(`
        UPDATE ${JOURNAL}
        SET status = 'FAILED', error_message = ?, updated_at = datetime('now')
        WHERE category_id = ? AND brand_id = ? AND branch_id = ?
      `).run(String(err.message || err).slice(0, 500), category.id, category.brand_id, category.branch_id);
      console.error(`[failed] ${category.branch_id}/${category.name}: ${err.message}`);
    }
  }
  console.log(JSON.stringify({
    mode: 'APPLY', ...scope, inspected: rows.length, processed, skipped, failed,
    originalMiB: +(originalBytes / 1048576).toFixed(2),
    derivativeMiB: +(derivativeBytes / 1048576).toFixed(2),
    reducedMiB: +((originalBytes - derivativeBytes) / 1048576).toFixed(2),
    originalsPreserved: true
  }, null, 2));
  if (failed) process.exitCode = 1;
}

async function rollbackMigration(scope) {
  if (!scope.brandId) throw new Error('--brand wajib diisi bersama --rollback.');
  ensureJournal();
  let where = "WHERE j.status = 'COMPLETED' AND j.brand_id = ?";
  const params = [scope.brandId];
  if (scope.branchId) {
    where += ' AND j.branch_id = ?';
    params.push(scope.branchId);
  }
  const rows = DataAccess.queryMany(`
    SELECT j.* FROM ${JOURNAL} j ${where}
    ORDER BY j.branch_id, j.category_id
  `, params);
  let restored = 0;
  let skipped = 0;
  for (const row of rows) {
    DataAccess.exec('BEGIN IMMEDIATE');
    try {
      const current = DataAccess.queryOne(`
        SELECT media_id FROM branch_categories
        WHERE id = ? AND brand_id = ? AND branch_id = ?
      `, [row.category_id, row.brand_id, row.branch_id]);
      if (!current || current.media_id !== row.new_media_id) {
        DataAccess.exec('ROLLBACK');
        skipped++;
        continue;
      }
      DataAccess.prepare(`
        UPDATE branch_categories SET media_id = ?, image_url = ?, updated_at = datetime('now')
        WHERE id = ? AND brand_id = ? AND branch_id = ? AND media_id = ?
      `).run(row.old_media_id, row.source_url, row.category_id, row.brand_id, row.branch_id, row.new_media_id);
      mediaService.mediaRepo.unlinkAndOrphan(row.new_media_id, row.brand_id);
      DataAccess.prepare(`
        UPDATE ${JOURNAL} SET status = 'ROLLED_BACK', updated_at = datetime('now')
        WHERE category_id = ? AND brand_id = ? AND branch_id = ?
      `).run(row.category_id, row.brand_id, row.branch_id);
      DataAccess.exec('COMMIT');
      restored++;
    } catch (err) {
      DataAccess.exec('ROLLBACK');
      throw err;
    }
  }
  console.log(JSON.stringify({ mode: 'ROLLBACK', ...scope, restored, skipped, originalsPreserved: true }, null, 2));
}

async function main() {
  await DataAccess.ready();
  const scope = { brandId: arg('--brand'), branchId: arg('--branch') };
  if (process.argv.includes('--rollback')) return rollbackMigration(scope);
  if (process.argv.includes('--apply')) return applyMigration(scope);

  const rows = listCategories(scope);
  const candidates = rows.map(category => ({ category, file: sourceFileFor(category.image_url) }))
    .filter(item => !item.category.media_id && item.file);
  const originalBytes = candidates.reduce((sum, item) => sum + fs.statSync(item.file).size, 0);
  console.log(JSON.stringify({
    mode: 'DRY-RUN', brandId: scope.brandId || 'all', branchId: scope.branchId || 'all',
    inspected: rows.length, candidates: candidates.length,
    originalMiB: +(originalBytes / 1048576).toFixed(2),
    originalsPreserved: true, wouldUseCanonicalMediaEngine: true
  }, null, 2));
}

main().catch(err => {
  console.error('[optimize-branch-category-media] FATAL:', err.message);
  process.exitCode = 1;
});
