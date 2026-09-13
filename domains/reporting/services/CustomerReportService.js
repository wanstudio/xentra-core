'use strict';

const { ReportingRepository } = require('../../../core/data/repositories');
const ReportFilterModel = require('../models/ReportFilterModel');

const reportingRepository = new ReportingRepository();

class CustomerReportService {
  /**
   * Generates customer insights, unique customer counts, and top spending customers.
   * 
   * @param {Object} filterParams
   * @returns {Object} Customer report summary
   */
  static getCustomerReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);

    const overview = reportingRepository.getCustomerOverview(filter);
    const topCustomers = reportingRepository.getTopCustomers(filter);

    return {
      report_type: 'customers',
      filter,
      summary: {
        total_unique_customers: overview.total_unique_customers || 0,
        total_orders: overview.total_orders || 0,
        total_spend: overview.total_spend || 0,
        average_spend_per_customer: overview.total_unique_customers > 0 
          ? Math.round(overview.total_spend / overview.total_unique_customers) 
          : 0
      },
      top_customers: topCustomers
    };
  }
}

module.exports = CustomerReportService;
