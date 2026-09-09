'use strict';

const { ReportingRepository } = require('../../../core/data/repositories');
const ReportFilterModel = require('../models/ReportFilterModel');

const reportingRepository = new ReportingRepository();

class PosShiftReportService {
  /**
   * Generates cashier shift performance and cash variance report.
   * 
   * @param {Object} filterParams
   * @returns {Object} POS shift report summary
   */
  static getShiftReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);

    // P1 MULTI-TENANT ISOLATION remains enforced inside the semantic
    // reporting repository queries.
    const summary = reportingRepository.getShiftSummary(filter);
    const shifts = reportingRepository.getShifts(filter);

    return {
      report_type: 'pos_shifts',
      filter,
      summary,
      shifts
    };
  }
}

module.exports = PosShiftReportService;
