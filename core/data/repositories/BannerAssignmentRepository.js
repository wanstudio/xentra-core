'use strict';

/**
 * Banner Placement / Assignment persistence adapter.
 *
 * Branch, placement, ordering, visibility controls and governance live here.
 * Banner content/publication remains owned by BannerContentRepository.
 */
const DataAccess = require('../DataAccess');

class BannerAssignmentRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  async ready() {
    await this.db.ready();
    return this;
  }

  beginTransaction() {
    return this.db.exec('BEGIN IMMEDIATE;');
  }

  commitTransaction() {
    return this.db.exec('COMMIT;');
  }

  rollbackTransaction() {
    return this.db.exec('ROLLBACK;');
  }

  findBranch(brandId, branchId) {
    return this.db.queryOne(`
      SELECT id, brand_id, name, timezone, is_active, is_archived
      FROM branches
      WHERE id = ? AND brand_id = ?
      LIMIT 1
    `, [branchId, brandId]);
  }

  listBranches(brandId) {
    return this.db.queryMany(`
      SELECT id, name, slug, timezone, is_active, is_archived
      FROM branches
      WHERE brand_id = ?
        AND is_active = 1
        AND (is_archived = 0 OR is_archived IS NULL)
      ORDER BY name ASC
    `, [brandId]);
  }

  findById(brandId, assignmentId) {
    return this.db.queryOne(`
      SELECT
        a.*,
        b.name AS branch_name,
        b.timezone AS branch_timezone,
        sb.publication_status AS banner_publication_status
      FROM storefront_banner_assignments a
      JOIN branches b ON b.id = a.branch_id AND b.brand_id = a.brand_id
      JOIN storefront_banners sb ON sb.id = a.banner_id AND sb.brand_id = a.brand_id
      WHERE a.id = ? AND a.brand_id = ?
      LIMIT 1
    `, [assignmentId, brandId]);
  }

  listByBanner(brandId, bannerId) {
    return this.db.queryMany(`
      SELECT
        a.*,
        b.name AS branch_name,
        b.slug AS branch_slug,
        b.timezone AS branch_timezone,
        sb.publication_status AS banner_publication_status
      FROM storefront_banner_assignments a
      JOIN branches b ON b.id = a.branch_id AND b.brand_id = a.brand_id
      JOIN storefront_banners sb ON sb.id = a.banner_id AND sb.brand_id = a.brand_id
      WHERE a.banner_id = ? AND a.brand_id = ?
      ORDER BY b.name ASC, a.position ASC, a.created_at ASC
    `, [bannerId, brandId]);
  }

  listForBrand(brandId, { branchId = null } = {}) {
    const params = [brandId];
    let sql = `
      SELECT
        a.*,
        b.name AS branch_name,
        b.slug AS branch_slug,
        b.timezone AS branch_timezone,
        sb.publication_status AS banner_publication_status,
        pub.id AS published_revision_id,
        pub.revision_number AS published_revision_number,
        pub.title AS published_title,
        pub.alt_text AS published_alt_text,
        pub.media_id AS published_media_id,
        pub.cta_type AS published_cta_type,
        pub.cta_target_id AS published_cta_target_id,
        pub.cta_url AS published_cta_url,
        pub.promotion_id AS published_promotion_id,
        draft.id AS draft_revision_id,
        draft.revision_number AS draft_revision_number,
        draft.title AS draft_title,
        draft.alt_text AS draft_alt_text,
        draft.media_id AS draft_media_id,
        draft.cta_type AS draft_cta_type,
        draft.cta_target_id AS draft_cta_target_id,
        draft.cta_url AS draft_cta_url,
        draft.promotion_id AS draft_promotion_id
      FROM storefront_banner_assignments a
      JOIN branches b ON b.id = a.branch_id AND b.brand_id = a.brand_id
      JOIN storefront_banners sb ON sb.id = a.banner_id AND sb.brand_id = a.brand_id
      LEFT JOIN storefront_banner_revisions pub
        ON pub.id = (
          SELECT r.id
          FROM storefront_banner_revisions r
          WHERE r.banner_id = a.banner_id AND r.revision_status = 'PUBLISHED'
          ORDER BY r.revision_number DESC
          LIMIT 1
        )
      LEFT JOIN storefront_banner_revisions draft
        ON draft.id = (
          SELECT r.id
          FROM storefront_banner_revisions r
          WHERE r.banner_id = a.banner_id AND r.revision_status = 'DRAFT'
          ORDER BY r.revision_number DESC
          LIMIT 1
        )
      WHERE a.brand_id = ?
    `;

    if (branchId) {
      sql += ' AND a.branch_id = ?';
      params.push(branchId);
    }

    sql += ' ORDER BY b.name ASC, a.position ASC, a.updated_at DESC';
    return this.db.queryMany(sql, params);
  }

  listPublishedAssignmentsForBanner(brandId, bannerId) {
    return this.db.queryMany(`
      SELECT
        a.*,
        b.name AS branch_name,
        b.timezone AS branch_timezone
      FROM storefront_banner_assignments a
      JOIN branches b ON b.id = a.branch_id AND b.brand_id = a.brand_id
      WHERE a.brand_id = ?
        AND a.banner_id = ?
        AND a.active = 1
    `, [brandId, bannerId]);
  }

  findConflict({
    brandId,
    branchId,
    placement,
    position,
    startsAt = null,
    endsAt = null,
    excludeAssignmentId = null,
    requirePublished = true
  }) {
    const params = [brandId, branchId, placement, Number(position)];
    let sql = `
      SELECT
        a.id,
        a.banner_id,
        a.position,
        a.starts_at,
        a.ends_at,
        a.active,
        sb.publication_status
      FROM storefront_banner_assignments a
      JOIN storefront_banners sb
        ON sb.id = a.banner_id AND sb.brand_id = a.brand_id
      WHERE a.brand_id = ?
        AND a.branch_id = ?
        AND a.placement = ?
        AND a.position = ?
        AND a.active = 1
    `;

    if (requirePublished) {
      sql += ` AND sb.publication_status = 'PUBLISHED'
        AND EXISTS (
          SELECT 1
          FROM storefront_banner_revisions r
          WHERE r.banner_id = a.banner_id
            AND r.revision_status = 'PUBLISHED'
        )`;
    }

    if (excludeAssignmentId) {
      sql += ' AND a.id != ?';
      params.push(excludeAssignmentId);
    }

    sql += `
      AND (a.starts_at IS NULL OR ? IS NULL OR a.starts_at < ?)
      AND (a.ends_at IS NULL OR ? IS NULL OR ? < a.ends_at)
      ORDER BY a.position ASC, a.created_at ASC
      LIMIT 1
    `;

    params.push(endsAt, endsAt);
    params.push(startsAt, startsAt);

    return this.db.queryOne(sql, params);
  }

  createAssignment({
    id,
    bannerId,
    brandId,
    branchId,
    placement,
    position,
    active = 1,
    startsAt = null,
    endsAt = null,
    timezone,
    governanceLocked = 0,
    createdBy = null,
    updatedBy = null
  }) {
    const now = new Date().toISOString();
    return this.db.execute(`
      INSERT INTO storefront_banner_assignments (
        id, banner_id, brand_id, branch_id, placement, position, active,
        starts_at, ends_at, timezone, governance_locked,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, bannerId, brandId, branchId, placement, Number(position), active ? 1 : 0,
      startsAt, endsAt, timezone, governanceLocked ? 1 : 0,
      createdBy, updatedBy, now, now
    ]);
  }

  updateAssignment({
    brandId,
    assignmentId,
    position,
    active,
    startsAt,
    endsAt,
    timezone,
    governanceLocked,
    updatedBy
  }) {
    const now = new Date().toISOString();
    return this.db.execute(`
      UPDATE storefront_banner_assignments
      SET position = COALESCE(?, position),
          active = COALESCE(?, active),
          starts_at = ?,
          ends_at = ?,
          timezone = COALESCE(?, timezone),
          governance_locked = COALESCE(?, governance_locked),
          updated_by = COALESCE(?, updated_by),
          updated_at = ?
      WHERE id = ? AND brand_id = ?
    `, [
      position !== undefined && position !== null ? Number(position) : null,
      active === undefined || active === null ? null : (active ? 1 : 0),
      startsAt,
      endsAt,
      timezone || null,
      governanceLocked === undefined || governanceLocked === null ? null : (governanceLocked ? 1 : 0),
      updatedBy || null,
      now,
      assignmentId,
      brandId
    ]);
  }

  deleteAssignment(brandId, assignmentId) {
    return this.db.execute(
      'DELETE FROM storefront_banner_assignments WHERE id = ? AND brand_id = ?',
      [assignmentId, brandId]
    );
  }

  listByBranchForCustomer(brandId, branchId) {
    return this.db.queryMany(`
      SELECT
        a.id AS assignment_id,
        a.banner_id,
        a.branch_id,
        a.placement,
        a.position,
        a.active,
        a.starts_at,
        a.ends_at,
        a.timezone,
        sb.publication_status,
        r.id AS revision_id,
        r.revision_number,
        r.title,
        r.alt_text,
        r.media_id,
        r.cta_type,
        r.cta_target_id,
        r.cta_url,
        r.promotion_id
      FROM storefront_banner_assignments a
      JOIN storefront_banners sb
        ON sb.id = a.banner_id AND sb.brand_id = a.brand_id
      JOIN storefront_banner_revisions r
        ON r.banner_id = sb.id AND r.revision_status = 'PUBLISHED'
      WHERE a.brand_id = ?
        AND a.branch_id = ?
        AND a.placement = 'HOME_BANNER_CAROUSEL'
        AND a.active = 1
        AND (a.starts_at IS NULL OR datetime(a.starts_at) <= datetime('now'))
        AND (a.ends_at IS NULL OR datetime('now') < datetime(a.ends_at))
      ORDER BY a.position ASC, r.revision_number DESC, a.created_at ASC
    `, [brandId, branchId]);
  }
}

module.exports = BannerAssignmentRepository;
