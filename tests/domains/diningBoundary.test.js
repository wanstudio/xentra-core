'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Dining domain boundary exports authoritative services', () => {
  const dining = require('../../domains/dining');
  const legacyPos = require('../../domains/pos');

  assert.equal(dining.identity.name, 'dining');
  assert.equal(dining.registration.identity.name, 'dining');
  assert.equal(dining.registration.lifecycle.isActive(), true);

  assert.ok(dining.DiningTableService);
  assert.ok(dining.TableRecommendationService);

  // Legacy compatibility must point to the same authoritative implementations.
  assert.strictEqual(
    legacyPos.DiningTableService,
    dining.DiningTableService,
    'POS compatibility export must resolve to Dining authority'
  );
  assert.strictEqual(
    legacyPos.TableRecommendationService,
    dining.TableRecommendationService,
    'POS compatibility export must resolve to Dining authority'
  );

  const legacyTemplate = require('../../domains/pos/templates/Template01');
  const diningTemplate = require('../../domains/dining/templates/Template01');
  assert.strictEqual(
    legacyTemplate,
    diningTemplate,
    'Legacy Dining template path must resolve to the new Dining template'
  );
});

test('DiningTableService target module resolves its moved template boundary', () => {
  const Service = require('../../domains/dining/services/DiningTableService');
  const Template = require('../../domains/dining/templates/Template01');

  assert.ok(Service);
  assert.equal(Template.id, 'template_01');
  assert.ok(Array.isArray(Template.tables));
  assert.ok(Template.tables.length > 0);
});
