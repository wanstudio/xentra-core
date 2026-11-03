'use strict';

/**
 * Migrate legacy Menu-owned image files through the canonical Media Engine.
 * Originals and old Menu URLs are recorded and retained so the change can be
 * rolled back without asking the merchant to upload the photos again.
 *
 * Usage:
 *   node tools/optimize-menu-media.js --dry-run [--brand <brand-id>]
 *   node tools/optimize-menu-media.js --apply --brand <brand-id> [--limit <n>]
 *   node tools/optimize-menu-media.js --rollback --brand <brand-id>
 */

const fs = require('fs');
const path = require('path');
const DataAccess = require('../core/data/DataAccess');
const MediaService = require('../core/media/MediaService');

const mediaService = new MediaService();
const appRoot = path.resolve(__dirname, '../apps/customer-pwa');
const uploadsRoot = path.resolve(appRoot, 'assets/uploads');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sourceFileFor(url) {
  if (!url || typeof url !== 'string') return null;
  let pathname;
  try {
    pathname = new URL(url, 'http://xentra.local').pathname;
    pathname = decodeURIComponent(pathname);
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

function ensureJournal() {
  DataAccess.exec(`
    CREATE TABLE IF NOT EXISTS menu_media_optimization_migrations (
      menu_id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      old_media_id TEXT,
      old_image_url TEXT,
      old_image TEXT,
      new_media_id TEXT,
      original_bytes INTEGER NOT NULL DEFAULT 0,
      derivative_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_menu_media_optimization_brand_status
      ON menu_media_optimization_migrations(brand_id, status);
  `);
}

function listMenus(brandId, limit) {
  const params = [];
  let sql = `
    SELECT id, brand_id, menu_type, media_id, image_url, image
    FROM menus
    WHERE COALESCE(image_url, image, '') <> ''`;
  if (brandId) {
    sql += ' AND brand_id = ?';
    params.push(brandId);
  }
  sql += ' ORDER BY brand_id, id';
  if (limit) {
    sql += ' LIMIT ?';
    params.push(limit);
  }
  return DataAccess.queryMany(sql, params);
}

function beginJournal(menu, sourceUrl, originalBytes) {
  DataAccess.prepare(`
    INSERT INTO menu_media_optimization_migrations (
      menu_id, brand_id, source_url, old_media_id, old_image_url, old_image,
      original_bytes, status, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSING', NULL, datetime('now'), datetime('now'))
    ON CONFLICT(menu_id) DO UPDATE SET
      source_url = excluded.source_url,
      old_media_id = excluded.old_media_id,
      old_image_url = excluded.old_image_url,
      old_image = excluded.old_image,
      original_bytes = excluded.original_bytes,
      status = 'PROCESSING',
      error_message = NULL,
      updated_at = datetime('now')
    WHERE menu_media_optimization_migrations.status <> 'COMPLETED'
  `).run(menu.id, menu.brand_id, sourceUrl, menu.media_id || null,
    menu.image_url || null, menu.image || null, originalBytes);
}

async function processMenu(menu, filePath, sourceUrl) {
  const source = await fs.promises.readFile(filePath);
  const imageMeta = await mediaService.processor.inspect(source);
  const mimeType = imageMeta.format === 'jpeg' ? 'image/jpeg' : `image/${imageMeta.format}`;
  const staged = await mediaService.stageUpload({
    brandId: menu.brand_id,
    imageBase64: source.toString('base64'),
    mimeType,
    declaredFilename: path.basename(filePath),
    assetType: 'menu'
  });

  let published;
  try {
    published = await mediaService.processMedia({ mediaId: staged.media_id, brandId: menu.brand_id });
    const variants = (published.variants || []).slice().sort((a, b) => a.width - b.width);
    if (!variants.length) throw new Error('Media Engine tidak menghasilkan derivative.');
    const preferred = variants.find(variant => variant.width >= 320) || variants[variants.length - 1];
    const derivativeBytes = variants.reduce((sum, variant) => sum + Number(variant.size_bytes || 0), 0);

    DataAccess.exec('BEGIN IMMEDIATE');
    try {
      await mediaService.attachToEntity({
        mediaId: published.media_id,
        brandId: menu.brand_id,
        entityType: 'menu',
        entityId: String(menu.id),
        manageTransaction: false
      });
      const updated = DataAccess.prepare(`
        UPDATE menus
        SET media_id = ?, image_url = ?, image = ?, updated_at = datetime('now')
        WHERE id = ? AND brand_id = ? AND media_id IS NULL AND COALESCE(image_url, image, '') = ?
      `).run(published.media_id, preferred.url, preferred.url, menu.id, menu.brand_id, sourceUrl);
      if (!updated || updated.changes !== 1) {
        throw new Error('Menu berubah saat diproses; perubahan dibatalkan agar data terbaru tidak tertimpa.');
      }
      DataAccess.prepare(`
        UPDATE menu_media_optimization_migrations
        SET new_media_id = ?, derivative_bytes = ?, status = 'COMPLETED',
            error_message = NULL, updated_at = datetime('now')
        WHERE menu_id = ? AND brand_id = ?
      `).run(published.media_id, derivativeBytes, menu.id, menu.brand_id);
      DataAccess.exec('COMMIT');
    } catch (err) {
      DataAccess.exec('ROLLBACK');
      throw err;
    }

    return { originalBytes: source.length, derivativeBytes, mediaId: published.media_id };
  } catch (err) {
    // If publication failed before the Menu reference committed, remove only
    // this new asset. The original Menu fields and image file remain untouched.
    if (staged && staged.media_id) {
      try { await mediaService.hardDeleteMedia({ mediaId: staged.media_id, brandId: menu.brand_id }); } catch (_) {}
    }
    throw err;
  }
}

async function applyMigration(brandId, limit) {
  if (!brandId) throw new Error('--brand wajib diisi bersama --apply.');
  ensureJournal();
  const rows = listMenus(brandId, limit);
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let originalBytes = 0;
  let derivativeBytes = 0;

  for (const menu of rows) {
    const sourceUrl = menu.image_url || menu.image;
    const filePath = sourceFileFor(sourceUrl);
    if (menu.media_id || !filePath) {
      skipped++;
      continue;
    }

    const size = fs.statSync(filePath).size;
    beginJournal(menu, sourceUrl, size);
    try {
      const result = await processMenu(menu, filePath, sourceUrl);
      processed++;
      originalBytes += result.originalBytes;
      derivativeBytes += result.derivativeBytes;
      console.log(`[optimized] ${menu.id}: ${result.originalBytes} -> ${result.derivativeBytes} bytes`);
    } catch (err) {
      failed++;
      DataAccess.prepare(`
        UPDATE menu_media_optimization_migrations
        SET status = 'FAILED', error_message = ?, updated_at = datetime('now')
        WHERE menu_id = ? AND brand_id = ?
      `).run(String(err.message || err).slice(0, 500), menu.id, menu.brand_id);
      console.error(`[failed] ${menu.id}: ${err.message}`);
    }
  }

  console.log(JSON.stringify({
    mode: 'APPLY', brandId, inspected: rows.length, processed, skipped, failed,
    originalMiB: +(originalBytes / 1048576).toFixed(2),
    derivativeMiB: +(derivativeBytes / 1048576).toFixed(2),
    reducedMiB: +((originalBytes - derivativeBytes) / 1048576).toFixed(2)
  }, null, 2));
  if (failed) process.exitCode = 1;
}

async function rollback(brandId) {
  if (!brandId) throw new Error('--brand wajib diisi bersama --rollback.');
  ensureJournal();
  const rows = DataAccess.queryMany(`
    SELECT * FROM menu_media_optimization_migrations
    WHERE brand_id = ? AND status = 'COMPLETED' ORDER BY menu_id
  `, [brandId]);
  let restored = 0;
  let skipped = 0;

  for (const row of rows) {
    DataAccess.exec('BEGIN IMMEDIATE');
    try {
      const current = DataAccess.queryOne('SELECT media_id FROM menus WHERE id = ? AND brand_id = ?', [row.menu_id, brandId]);
      if (!current || current.media_id !== row.new_media_id) {
        DataAccess.exec('ROLLBACK');
        skipped++;
        continue;
      }
      DataAccess.prepare(`
        UPDATE menus SET media_id = ?, image_url = ?, image = ?, updated_at = datetime('now')
        WHERE id = ? AND brand_id = ? AND media_id = ?
      `).run(row.old_media_id, row.old_image_url, row.old_image, row.menu_id, brandId, row.new_media_id);
      mediaService.mediaRepo.unlinkAndOrphan(row.new_media_id, brandId);
      DataAccess.prepare(`
        UPDATE menu_media_optimization_migrations
        SET status = 'ROLLED_BACK', updated_at = datetime('now')
        WHERE menu_id = ? AND brand_id = ?
      `).run(row.menu_id, brandId);
      DataAccess.exec('COMMIT');
      restored++;
    } catch (err) {
      DataAccess.exec('ROLLBACK');
      throw err;
    }
  }
  console.log(JSON.stringify({ mode: 'ROLLBACK', brandId, restored, skipped }, null, 2));
}

async function main() {
  await DataAccess.ready();
  const brandId = arg('--brand');
  const limitValue = Number(arg('--limit'));
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? Math.floor(limitValue) : null;
  if (process.argv.includes('--rollback')) return rollback(brandId);
  if (process.argv.includes('--apply')) return applyMigration(brandId, limit);

  const rows = listMenus(brandId, limit);
  const candidates = rows.filter(menu => !menu.media_id && sourceFileFor(menu.image_url || menu.image));
  const bytes = candidates.reduce((sum, menu) => sum + fs.statSync(sourceFileFor(menu.image_url || menu.image)).size, 0);
  console.log(JSON.stringify({ mode: 'DRY-RUN', brandId: brandId || 'all', inspected: rows.length,
    candidates: candidates.length, originalMiB: +(bytes / 1048576).toFixed(2),
    originalsPreserved: true, wouldUseCanonicalMediaEngine: true }, null, 2));
}

main().catch(err => {
  console.error('[optimize-menu-media] FATAL:', err.message);
  process.exitCode = 1;
});
