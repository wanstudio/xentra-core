'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'apps/merchant-shared/js/presentation-shells.js'), 'utf8');
const INLINE = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/assets/js/owner-master-menu-inline.js'), 'utf8');

test('Presentation shell forwards onClose so inline sheets can settle cancellation', () => {
  assert.ok(SHELL.includes('onClose: options.onClose'));
  assert.ok(SHELL.includes("if (typeof entry.onClose === 'function') entry.onClose(entry);"));
  assert.ok(INLINE.includes('onClose: function()'));
});
