'use strict';

const DataAccess = require('../core/data/DataAccess');
const { ComposedMenuMigrationService } = require('../domains/catalog/services/ComposedMenuMigrationService');

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  await DataAccess.ready();

  const brandId = readArg('--brand');
  const productId = readArg('--product');
  const verify = process.argv.includes('--verify');
  const apply = process.argv.includes('--apply');
  const persist = process.argv.includes('--persist');

  if (!brandId) {
    throw new Error(
      'Usage: node tools/migrate-composed-menu.js --brand <brand-id> [--product <product-id>] [--apply] [--verify] [--persist]'
    );
  }

  if (verify && apply) {
    throw new Error('VERIFY_APPLY_CONFLICT: --verify cannot be combined with --apply.');
  }

  const result = productId
    ? (verify
      ? ComposedMenuMigrationService.verifyProduct({ brandId, productId })
      : ComposedMenuMigrationService.reconcileProduct({
        brandId,
        productId,
        apply,
        persistReport: apply || persist
      }))
    : ComposedMenuMigrationService.reconcileBrand({
      brandId,
      verify,
      apply,
      persistReport: apply || persist
    });

  const mode = verify ? 'verify' : apply ? 'apply' : persist ? 'dry-run-persist' : 'dry-run';
  process.stdout.write(JSON.stringify({
    model: 'product-menu-inventory-v1',
    mode,
    brand_id: brandId,
    product_id: productId || null,
    result
  }, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(String((err && err.stack) || err) + '\n');
  process.exitCode = 1;
});
