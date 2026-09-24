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

test('Commerce dine-in flow delegates table/session validation to Dining boundary', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../domains/commerce/services/OrderPlacementService.js'),
    'utf8'
  );

  assert.match(source, /DiningTableService\.prepareDineInOrderContext/);
  assert.doesNotMatch(source, /new DiningTableRepository/);
  assert.doesNotMatch(source, /diningTableRepo\.findActiveHoldByCustomer/);
  assert.doesNotMatch(source, /diningTableRepo\.findActiveSessionByCustomer/);
  assert.doesNotMatch(source, /diningTableRepo\.findCurrentSessionForTable/);

  const dining = require('../../domains/dining');
  assert.equal(typeof dining.DiningTableService.prepareDineInOrderContext, 'function');
});


test('Reservation semantics are delegated to Dining boundary', () => {
  const fs = require('fs');
  const path = require('path');
  const commerceSource = fs.readFileSync(path.resolve(__dirname, '../../domains/commerce/services/OrderPlacementService.js'), 'utf8');
  const posSource = fs.readFileSync(path.resolve(__dirname, '../../domains/pos/services/PosOrderService.js'), 'utf8');
  assert.match(commerceSource, /DiningTableService\.createReservation/);
  assert.doesNotMatch(commerceSource, /findActiveReservation\(/);
  assert.doesNotMatch(commerceSource, /countActiveReservations\(/);
  assert.doesNotMatch(commerceSource, /insertReservation\(/);
  assert.match(posSource, /DiningTableService\.checkInReservation/);
  assert.match(posSource, /DiningTableService\.cancelNoShowReservation/);
  assert.doesNotMatch(posSource, /convertReservationToDineIn\(/);
  assert.doesNotMatch(posSource, /cancelReservationNoShow\(/);
  const dining = require('../../domains/dining');
  assert.equal(typeof dining.DiningTableService.createReservation, 'function');
  assert.equal(typeof dining.DiningTableService.checkInReservation, 'function');
  assert.equal(typeof dining.DiningTableService.cancelNoShowReservation, 'function');
});
