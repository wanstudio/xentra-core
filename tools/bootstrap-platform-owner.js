#!/usr/bin/env node
'use strict';

/**
 * Xentra Platform Owner Secure Bootstrap CLI
 *
 * Operational utility for controlled deployment / operator environments.
 * Strictly bootstraps initial Platform Owner without exposing credentials.
 *
 * Usage:
 *   # Via environment variables (Recommended for CI/CD / container orchestrators):
 *   XENTRA_PLATFORM_OWNER_EMAIL="admin@xentra.cloud" \
 *   XENTRA_PLATFORM_OWNER_PASSWORD="SecurePassword123" \
 *   node tools/bootstrap-platform-owner.js
 *
 *   # Via CLI arguments:
 *   node tools/bootstrap-platform-owner.js --email admin@xentra.cloud --password SecurePassword123
 *
 *   # Forced reset of existing Platform Owner:
 *   node tools/bootstrap-platform-owner.js --force-reset
 */

require('dotenv').config();
const { PlatformBootstrapService } = require('../core/identity');
const db = require('../server/database/db');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    email: process.env.XENTRA_PLATFORM_OWNER_EMAIL || '',
    password: process.env.XENTRA_PLATFORM_OWNER_PASSWORD || '',
    fullName: process.env.XENTRA_PLATFORM_OWNER_NAME || 'Xentra Platform Owner',
    forceReset: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--email' && args[i + 1]) {
      options.email = args[++i];
    } else if (arg === '--password' && args[i + 1]) {
      options.password = args[++i];
    } else if (arg === '--name' && args[i + 1]) {
      options.fullName = args[++i];
    } else if (arg === '--force-reset') {
      options.forceReset = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Xentra Platform Owner Bootstrap Utility

Options:
  --email <email>        Email address for the Platform Owner
  --password <password>  Password (min 10 chars, upper, lower, digit)
  --name <full_name>     Display name (default: "Xentra Platform Owner")
  --force-reset          Explicitly rotate credentials for existing Platform Owner
  --help, -h             Show this help message

Environment Variables:
  XENTRA_PLATFORM_OWNER_EMAIL
  XENTRA_PLATFORM_OWNER_PASSWORD
  XENTRA_PLATFORM_OWNER_NAME
  `);
}

async function main() {
  const options = parseArgs();

  if (!options.email || !options.password) {
    console.error('[Error] Both email and password are required for Platform Owner bootstrap.');
    console.error('Provide them via CLI arguments (--email, --password) or environment variables.');
    process.exit(1);
  }

  try {
    const bootstrapService = new PlatformBootstrapService(db);
    const result = bootstrapService.bootstrapPlatformOwner({
      email: options.email,
      password: options.password,
      full_name: options.fullName,
      forceReset: options.forceReset
    });

    // Clear sensitive variables from memory
    options.password = null;
    if (process.env.XENTRA_PLATFORM_OWNER_PASSWORD) {
      delete process.env.XENTRA_PLATFORM_OWNER_PASSWORD;
    }

    if (result.created) {
      console.log(`[Success] Platform Owner bootstrapped successfully.`);
      console.log(`ID:        ${result.user.id}`);
      console.log(`Email:     ${result.user.email}`);
      console.log(`Role:      ${result.user.role}`);
      console.log(`MFA Ready: ${result.user.mfa_ready} (MFA enrollment pending)`);
      process.exit(0);
    } else if (result.updated) {
      console.log(`[Success] Platform Owner credentials rotated successfully.`);
      console.log(`ID:        ${result.user.id}`);
      console.log(`Email:     ${result.user.email}`);
      console.log(`Role:      ${result.user.role}`);
      process.exit(0);
    } else {
      console.log(`[Notice] ${result.message}`);
      console.log(`Existing Platform Owner ID: ${result.user.id} (${result.user.email})`);
      console.log(`No credentials were overwritten. To rotate credentials, run with --force-reset.`);
      process.exit(0);
    }
  } catch (err) {
    console.error(`[Error] Platform Owner bootstrap failed: ${err.message || err.code || err}`);
    process.exit(1);
  }
}

main();
