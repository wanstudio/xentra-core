/**
 * XENTRA CORE — MERCHANT APP BRANCH CONTEXT
 *
 * Canonical branch context resolver shared by Branch Manager modules.
 */
(function () {
  'use strict';

  function getBMTargetBranchId() {
    var user = window.XentraShared && typeof window.XentraShared.getStoredUser === 'function'
      ? window.XentraShared.getStoredUser()
      : null;
    var branchCatalog = window.XentraMerchantBranchCatalog;
    var fromUser = user ? (user.branch_id || user.branchId || (user.branch && user.branch.id)) : null;
    var fromActive = branchCatalog && typeof branchCatalog.getActiveBranchId === 'function'
      ? branchCatalog.getActiveBranchId()
      : null;
    var fromManaging = branchCatalog && branchCatalog.state ? (branchCatalog.state.branchId || null) : null;
    var fromEffective = (typeof window.getEffectiveBranchId === 'function'
      ? window.getEffectiveBranchId()
      : null);
    var fromStorage = null;
    try {
      fromStorage = localStorage.getItem('xentra_branch_id') ||
                    localStorage.getItem('xentra_active_branch_id') ||
                    localStorage.getItem('selected_branch_id') ||
                    sessionStorage.getItem('xentra_branch_id');
    } catch (_) {}

    var branchId = fromUser || fromManaging || fromActive || fromEffective || fromStorage || null;
    if (branchId && branchCatalog && branchCatalog.state) {
      branchCatalog.state.branchId = branchId;
    }
    return branchId;
  }

  window.getBMTargetBranchId = getBMTargetBranchId;
})();
