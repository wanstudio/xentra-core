/**
 * XENTRA CORE — ADMIN MARKETING PROMOTION ROUTES
 *
 * Promotion CRUD, presentation/scoping, branch activation and redemption
 * reporting. Promotion business rules remain in the promotion repository/service.
 */
module.exports = function registerAdminMarketingPromotionRoutes(router, deps) {
  const {
    db,
    crypto,
    requireAuth,
    corePromotionRepo
  } = deps;

  function logPromotionSecurityEvent({
    actor_id,
    actor_role,
    action,
    brand_id,
    organization_id = null,
    branch_id = null,
    result,
    metadata
  }) {
    try {
      const id = 'sal_' + crypto.randomBytes(16).toString('hex');
      const safeMetadata = metadata ? JSON.stringify(metadata) : null;
      db.prepare(`
        INSERT INTO security_audit_log (id, actor_id, actor_role, action, target_user_id, target_role, brand_id, organization_id, branch_id, result, metadata, created_at)
        VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        id,
        actor_id || null,
        actor_role || null,
        action,
        brand_id || null,
        organization_id || null,
        branch_id || null,
        result,
        safeMetadata
      );
    } catch (e) {
      console.warn('[Promotion Audit Log Error]:', e.message);
    }
  }


};
