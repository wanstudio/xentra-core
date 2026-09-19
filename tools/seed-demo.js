#!/usr/bin/env node
'use strict';

/**
 * Explicit demo seed runner for development / staging / demo environments.
 * 
 * Usage:
 *   node tools/seed-demo.js
 *   npm run db:seed-demo
 * 
 * In production, demo seeding is blocked by default to prevent accidental pollution
 * of client data. An intentional override requires:
 *   ALLOW_PRODUCTION_DEMO_SEED=1 npm run db:seed-demo
 */

const path = require('path');
const db = require('../server/database/db');
const DataAccess = require('../core/data/DataAccess');

async function run() {
  console.log('[Seed Demo] Initializing database connection...');
  await DataAccess.ready();

  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && process.env.ALLOW_PRODUCTION_DEMO_SEED !== '1') {
    console.error('[Seed Demo Fatal] Refusing to seed demo fixtures into production environment without ALLOW_PRODUCTION_DEMO_SEED=1');
    process.exit(1);
  }

  console.log('[Seed Demo] Executing explicit demo seeding...');
  db.seedDemoData(db);
  console.log('[Seed Demo] Successfully seeded demo fixtures (branches, categories, products, promotions).');
}

run().catch((err) => {
  console.error('[Seed Demo Error]', err);
  process.exit(1);
});
