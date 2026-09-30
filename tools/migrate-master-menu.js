'use strict';

const DataAccess = require('../core/data/DataAccess');
const { ProductMenuMigrationService } = require('../domains/catalog/services/ProductMenuMigrationService');

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

  if (!brandId) {
    throw new Error(
      'Usage: node tools/migrate-master-menu.js --brand <brand-id> [--product <product-id>] [--verify] [--apply]'
    );
  }

  const result = productId
    ? (verify
      ? ProductMenuMigrationService.verifyProduct({ brandId, productId })
      : ProductMenuMigrationService.reconcileProduct({ brandId, productId, apply, persistReport: apply }))
    : ProductMenuMigrationService.reconcileBrand({ brandId, verify, apply, persistReport: apply });

  process.stdout.write(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', verify, result }, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(String((err && err.stack) || err) + '\n');
  process.exitCode = 1;
});
