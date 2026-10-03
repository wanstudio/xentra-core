'use strict';

/**
 * LEGACY MIGRATION CLI — DISABLED
 *
 * This entry point belonged to the superseded Product-centric
 * Master Menu Composition migration. The current locked architecture is
 * Product → Menu → Inventory (docs/proposals/xentra-taxonomy-composed-menu-v1.md).
 *
 * Keeping the file (rather than deleting it) makes historical references fail
 * deterministically instead of silently executing the wrong migration model.
 */
function main() {
  const err = new Error(
    'LEGACY_MASTER_MENU_MIGRATION_DISABLED: tools/migrate-master-menu.js belongs to the superseded Product-centric migration. Use the current Product → Menu → Inventory migration contract; do not apply this tool to production data.'
  );
  err.code = 'LEGACY_MASTER_MENU_MIGRATION_DISABLED';
  throw err;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(String((err && err.message) || err) + '\n');
    process.exitCode = 2;
  }
}

module.exports = { main };
