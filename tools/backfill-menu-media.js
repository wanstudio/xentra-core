'use strict';

/**
 * Menu Presentation Media backfill — explicit one-time migration.
 *
 * Contract: docs/decisions/xentra-menu-presentation-media-v1.md
 *
 * Menu owns its customer-facing photo. Before that contract existed, every "menu photo"
 * was resolved transitively from a component Product. Migration is therefore explicit:
 *
 *   - Menu SATUAN with no presentation media copies the media of its single component Product
 *     (a Satuan Menu *is* that Product sold) and records COPIED evidence.
 *   - Menu PAKET is NEVER auto-copied: picking one of several component Product photos is
 *     semantically invalid. It is recorded as SKIPPED_PACKAGE and shows the neutral placeholder
 *     until the Owner sets its own photo.
 *
 * Runtime fallback is not a migration mechanism, so nothing here runs on the request path.
 * The tool is idempotent (Menus that already have media are skipped) and never deletes
 * legacy data.
 *
 * Usage:
 *   node tools/backfill-menu-media.js [--dry-run] [--apply] [--brand <brand-id>] [--limit <n>]
 *
 *   --dry-run   Inventory only. No database changes (default).
 *   --apply     Perform the copy. --apply is required to write anything.
 *   --brand     Scope to one Brand.
 *   --limit     Process at most N Menus (resumable; run again for the next batch).
 */

const DataAccess = require('../core/data/DataAccess');
const { ensureComposedMenuSchema } = require('../domains/catalog/schema/ComposedMenuSchema');

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function classify(menu) {
  // Paket tidak pernah disalin otomatis — MEMILIH salah satu dari beberapa foto Product
  // justru masalah yang kontrak ini selesaikan.
  if (String(menu.menu_type).toUpperCase() === 'PACKAGE') return { status: 'SKIPPED_PACKAGE', source: null };
  // Idempotensi: media canonical ATAU foto legacy milik Menu sendiri sudah cukup.
  if (menu.media_id || menu.image_url || menu.image) return { status: 'SKIPPED_ALREADY_SET', source: null };

  const source = { media_id: menu.product_media_id, image_url: menu.product_image_url, image: menu.product_image };
  if (!source.media_id && !source.image_url && !source.image) {
    return { status: 'SKIPPED_NO_SOURCE', source: null };
  }
  return { status: 'COPIED', source };
}

function recordMigration(db, { menu, status, source, note }) {
  db.prepare(
    `INSERT INTO menu_media_migrations (menu_id, brand_id, source, source_product_id, media_id, status, notes, ran_at)
     VALUES (?, ?, 'component_product', ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(menu_id) DO UPDATE SET
       media_id = excluded.media_id,
       status = excluded.status,
       notes = excluded.notes,
       ran_at = excluded.ran_at
     -- Bukti COPIED bersifat final: run berikutnya (idempotent) tidak boleh menimpanya
     -- dengan SKIPPED_ALREADY_SET.
     WHERE menu_media_migrations.status <> 'COPIED'`
  ).run(
    menu.id,
    menu.brand_id,
    menu.source_product_id || null,
    (source && source.media_id) || null,
    status,
    note || null
  );
}

async function main() {
  await DataAccess.ready();
  ensureComposedMenuSchema(DataAccess);

  const apply = process.argv.includes('--apply');
  const dryRun = !apply;
  const brandId = readArg('--brand');
  const limit = Number(readArg('--limit')) > 0 ? Number(readArg('--limit')) : null;

  const params = [];
  let sql = `
    SELECT m.id, m.brand_id, m.menu_type, m.media_id, m.image_url, m.image,
           (SELECT mi.product_id FROM menu_items mi WHERE mi.menu_id = m.id ORDER BY mi.sort_order ASC, mi.product_id ASC LIMIT 1) AS source_product_id,
           (SELECT COUNT(*) FROM menu_items mi WHERE mi.menu_id = m.id) AS component_count,
           (SELECT p.media_id FROM menu_items mi JOIN products p ON p.id = mi.product_id WHERE mi.menu_id = m.id ORDER BY mi.sort_order ASC, mi.product_id ASC LIMIT 1) AS product_media_id,
           (SELECT p.image_url FROM menu_items mi JOIN products p ON p.id = mi.product_id WHERE mi.menu_id = m.id ORDER BY mi.sort_order ASC, mi.product_id ASC LIMIT 1) AS product_image_url,
           (SELECT p.image FROM menu_items mi JOIN products p ON p.id = mi.product_id WHERE mi.menu_id = m.id ORDER BY mi.sort_order ASC, mi.product_id ASC LIMIT 1) AS product_image
    FROM menus m
    WHERE 1 = 1`;
  if (brandId) {
    sql += ' AND m.brand_id = ?';
    params.push(brandId);
  }
  sql += ' ORDER BY m.id ASC';
  if (limit) {
    sql += ' LIMIT ?';
    params.push(limit);
  }

  const menus = DataAccess.queryMany(sql, params);
  const summary = { COPIED: 0, SKIPPED_PACKAGE: 0, SKIPPED_NO_SOURCE: 0, SKIPPED_ALREADY_SET: 0, FAILED: 0 };
  const rows = [];

  for (const menu of menus) {
    // A Satuan Menu must be backed by exactly one component; anything else is not auto-copied.
    const isPackage = String(menu.menu_type).toUpperCase() === 'PACKAGE';
    const componentCount = Number(menu.component_count || 0);
    const decision = (!isPackage && componentCount !== 1)
      ? { status: 'SKIPPED_NO_SOURCE', source: null }
      : classify(menu);

    summary[decision.status] = (summary[decision.status] || 0) + 1;
    rows.push({
      menu_id: menu.id,
      brand_id: menu.brand_id,
      menu_type: menu.menu_type,
      status: decision.status,
      source_product_id: menu.source_product_id || null,
      media_id: (decision.source && decision.source.media_id) || null
    });

    if (dryRun) continue;

    try {
      if (decision.status === 'COPIED') {
        // Per-menu transaction: one failing Menu must not stop the batch.
        DataAccess.exec('BEGIN');
        try {
          DataAccess.prepare(
            "UPDATE menus SET media_id = ?, image_url = ?, image = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?"
          ).run(
            decision.source.media_id || null,
            decision.source.image_url || null,
            decision.source.image || null,
            menu.id,
            menu.brand_id
          );
          recordMigration(DataAccess, { menu, status: 'COPIED', source: decision.source });
          DataAccess.exec('COMMIT');
        } catch (err) {
          try { DataAccess.exec('ROLLBACK'); } catch (_) {}
          throw err;
        }
      } else {
        recordMigration(DataAccess, { menu, status: decision.status, source: null });
      }
    } catch (err) {
      summary.FAILED += 1;
      summary[decision.status] = Math.max(0, summary[decision.status] - 1);
      rows[rows.length - 1].status = 'FAILED';
      rows[rows.length - 1].error = err.message;
      console.error(`[backfill-menu-media] FAILED menu=${menu.id}: ${err.message}`);
    }
  }

  console.log('');
  console.log('=== Menu Presentation Media backfill ===');
  console.log(`Mode            : ${dryRun ? 'DRY-RUN (tidak ada perubahan DB)' : 'APPLY'}`);
  console.log(`Brand scope     : ${brandId || 'semua brand'}`);
  console.log(`Limit           : ${limit || 'tanpa batas'}`);
  console.log(`Menu diperiksa  : ${menus.length}`);
  console.log(`COPIED                 : ${summary.COPIED}`);
  console.log(`SKIPPED_PACKAGE        : ${summary.SKIPPED_PACKAGE}`);
  console.log(`SKIPPED_NO_SOURCE      : ${summary.SKIPPED_NO_SOURCE}`);
  console.log(`SKIPPED_ALREADY_SET    : ${summary.SKIPPED_ALREADY_SET}`);
  console.log(`FAILED                 : ${summary.FAILED}`);
  console.log('');

  const reportPath = readArg('--report');
  if (reportPath) {
    require('fs').writeFileSync(reportPath, JSON.stringify({ summary, rows }, null, 2));
    console.log(`Laporan detail ditulis ke: ${reportPath}`);
  } else if (dryRun && rows.length) {
    console.log('Contoh 5 menu pertama:');
    rows.slice(0, 5).forEach((row) => {
      console.log(`  ${row.menu_type} ${row.menu_id} -> ${row.status}` +
        (row.media_id ? ` (media ${row.media_id})` : ''));
    });
    console.log('');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-menu-media] FATAL:', err.message);
    process.exit(1);
  });
