'use strict';

const { ReportingRepository } = require('../../../core/data/repositories');
const ReportFilterModel = require('../models/ReportFilterModel');

const reportingRepository = new ReportingRepository();

class ProductReportService {
  /**
   * Generates product / menu performance report (top sellers and category contribution).
   * 
   * @param {Object} filterParams
   * @returns {Object} Product report summary
   */
  static getProductReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);

    // Top selling items from order_items
    const topProducts = reportingRepository.getTopProducts(filter);

    // Category Contribution
    const categoryContribution = reportingRepository.getCategoryContribution(filter);

    return {
      report_type: 'products',
      filter,
      top_products: topProducts,
      category_contribution: categoryContribution
    };
  }
}

module.exports = ProductReportService;
