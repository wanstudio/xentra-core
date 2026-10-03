#!/usr/bin/env node
'use strict';

/**
 * Read-only legacy data readiness report.
 *
 * Usage:
 *   node tools/audit-legacy-data.js
 *   node tools/audit-legacy-data.js --brand=<brand_id>
 *
 * This command never seeds, migrates, updates, or deletes data.
 */
const DataAccess = require('../core/data/DataAccess');
const {
  LegacyDataReadinessService
} = require('../domains/catalog/services/LegacyDataReadinessService');

async function main() {
  const brandArg = process.argv.find(arg => arg.startsWith('--brand='));
  const brandId = brandArg ? brandArg.slice('--brand='.length).trim() : null;

  await DataAccess.ready();

  const report = LegacyDataReadinessService.inspect({
    brandId: brandId || null,
    includeRows: true
  });

  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => {
  console.error('[LegacyDataAudit Error]', err);
  process.exitCode = 1;
});
