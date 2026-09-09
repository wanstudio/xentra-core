'use strict';

const { ReportingRepository } = require('../../../core/data/repositories');
const ReportFilterModel = require('../models/ReportFilterModel');

const reportingRepository = new ReportingRepository();

class BranchCompareService {
  /**
   * Generates comparative performance metrics across branches for Owner/Executive scope.
   * 
   * @param {Object} filterParams
   * @returns {Object} Branch comparison report summary
   */
  static getBranchComparisonReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);
    const branchesComparison = reportingRepository.getBranchComparison(filter);

    return {
      report_type: 'branch_comparison',
      filter,
      branches: branchesComparison
    };
  }
}

module.exports = BranchCompareService;
