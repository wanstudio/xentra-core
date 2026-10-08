'use strict';

const DataAccess = require('../DataAccess');

class UomRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findById(id) {
    return this.db.queryOne(
      'SELECT id, category_id, code, name, conversion_factor, allows_fraction, quantity_precision, is_active FROM uoms WHERE id = ?',
      [id]
    );
  }

  findCategoryById(id) {
    return this.db.queryOne(
      'SELECT id, code, name, reference_uom_id, is_active FROM uom_categories WHERE id = ?',
      [id]
    );
  }

  findCategoryWithReferenceByUomId(uomId) {
    return this.db.queryOne(
      'SELECT c.id, c.code, c.name, c.reference_uom_id, c.is_active FROM uom_categories c JOIN uoms u ON u.category_id = c.id WHERE u.id = ?',
      [uomId]
    );
  }

  listActive() {
    return this.db.queryMany(
      'SELECT id, category_id, code, name, conversion_factor, allows_fraction, quantity_precision FROM uoms WHERE is_active = 1 ORDER BY category_id, conversion_factor, code',
      []
    );
  }
}

module.exports = UomRepository;
