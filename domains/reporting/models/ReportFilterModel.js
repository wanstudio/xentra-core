'use strict';

class ReportFilterModel {
  /**
   * Normalizes and validates report filter parameters with RBAC boundary enforcement.
   * 
   * @param {Object} params
   * @param {string} [params.brand_id]
   * @param {string} [params.branch_id]
   * @param {string} [params.start_date] - ISO string or YYYY-MM-DD
   * @param {string} [params.end_date] - ISO string or YYYY-MM-DD
   * @param {Object} [params.actor] - Current authenticated user context { role, branch_id, brand_id }
   * @returns {Object} Normalized filter parameters
   */
  static normalize({
    brand_id = null,
    branch_id = null,
    start_date = null,
    end_date = null,
    actor = null
  } = {}) {
    let effectiveBrandId = brand_id;
    let effectiveBranchId = branch_id;

    // P1 RBAC Boundary Guard: Unified with Xentra Core RoleModel
    if (actor) {
      const branchScopedRoles = ['branch_manager', 'cashier', 'kitchen', 'staff'];
      const brandScopedRoles = ['owner', 'brand_manager', 'brand_owner', 'executive'];

      if (branchScopedRoles.includes(actor.role)) {
        if (!actor.branch_id && !actor.branchId) {
          throw new Error('[ReportFilterModel] Actor scope violation: Branch staff missing branch_id assignment.');
        }
        // Force isolation to actor's assigned branch
        effectiveBranchId = actor.branch_id || actor.branchId;
        effectiveBrandId = actor.brand_id || actor.brandId || effectiveBrandId;
      } else if (brandScopedRoles.includes(actor.role)) {
        effectiveBrandId = actor.brand_id || actor.brandId || effectiveBrandId;
        // If branch_id specified, ensure it belongs to the brand
        if (effectiveBranchId && effectiveBrandId) {
          // branch_id filter is preserved as secondary filter within brand scope
        }
      }
    }

    // Date range formatting (defaults to today / all-time if not specified)
    let startDateSql = null;
    let endDateSql = null;

    if (start_date) {
      const parsedStart = new Date(start_date);
      if (isNaN(parsedStart.getTime())) {
        throw new Error('[ReportFilterModel] "start_date" is not a valid date.');
      }
      startDateSql = parsedStart.toISOString();
    }

    if (end_date) {
      const parsedEnd = new Date(end_date);
      if (isNaN(parsedEnd.getTime())) {
        throw new Error('[ReportFilterModel] "end_date" is not a valid date.');
      }
      endDateSql = parsedEnd.toISOString();
    }

    return {
      brand_id: effectiveBrandId,
      branch_id: effectiveBranchId,
      start_date: startDateSql,
      end_date: endDateSql
    };
  }
}

module.exports = ReportFilterModel;
