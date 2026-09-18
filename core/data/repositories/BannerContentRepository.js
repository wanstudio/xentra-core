'use strict';

/**
 * Banner Content persistence adapter.
 *
 * Owns CRUD/query semantics for the Brand-scoped Banner Content domain.
 * Placement/Assignment concerns intentionally do not live here.
 */
const DataAccess = require('../DataAccess');

class BannerContentRepository {
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

  createBanner({ id, brandId, createdBy = null, updatedBy = null }) {
    const now = new Date().toISOString();
    return this.db.execute(`
      INSERT INTO storefront_banners (
        id, brand_id, publication_status, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, 'DRAFT', ?, ?, ?, ?)
    `, [id, brandId, createdBy, updatedBy, now, now]);
  }

  findBannerById(brandId, bannerId) {
    return this.db.queryOne(`
      SELECT id, brand_id, publication_status, created_by, updated_by, created_at, updated_at
      FROM storefront_banners
      WHERE id = ? AND brand_id = ?
      LIMIT 1
    `, [bannerId, brandId]);
  }

  listBanners(brandId) {
    return this.db.queryMany(`
      SELECT
        b.*,
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
      FROM storefront_banners b
      LEFT JOIN storefront_banner_revisions pub
        ON pub.id = (
          SELECT r.id
          FROM storefront_banner_revisions r
          WHERE r.banner_id = b.id AND r.revision_status = 'PUBLISHED'
          ORDER BY r.revision_number DESC
          LIMIT 1
        )
      LEFT JOIN storefront_banner_revisions draft
        ON draft.id = (
          SELECT r.id
          FROM storefront_banner_revisions r
          WHERE r.banner_id = b.id AND r.revision_status = 'DRAFT'
          ORDER BY r.revision_number DESC
          LIMIT 1
        )
      WHERE b.brand_id = ?
      ORDER BY b.updated_at DESC, b.created_at DESC
    `, [brandId]);
  }

  getBannerAggregate(brandId, bannerId) {
    const banner = this.findBannerById(brandId, bannerId);
    if (!banner) return null;
    return {
      ...banner,
      published_revision: this.findCurrentPublishedRevision(brandId, bannerId),
      draft_revision: this.findDraftRevision(brandId, bannerId),
      revisions: this.listRevisions(brandId, bannerId)
    };
  }

  findCurrentPublishedRevision(brandId, bannerId) {
    return this.db.queryOne(`
      SELECT r.*
      FROM storefront_banner_revisions r
      JOIN storefront_banners b ON b.id = r.banner_id
      WHERE r.banner_id = ? AND b.brand_id = ? AND r.revision_status = 'PUBLISHED'
      ORDER BY r.revision_number DESC
      LIMIT 1
    `, [bannerId, brandId]);
  }

  findDraftRevision(brandId, bannerId) {
    return this.db.queryOne(`
      SELECT r.*
      FROM storefront_banner_revisions r
      JOIN storefront_banners b ON b.id = r.banner_id
      WHERE r.banner_id = ? AND b.brand_id = ? AND r.revision_status = 'DRAFT'
      ORDER BY r.revision_number DESC
      LIMIT 1
    `, [bannerId, brandId]);
  }

  listRevisions(brandId, bannerId) {
    return this.db.queryMany(`
      SELECT r.*
      FROM storefront_banner_revisions r
      JOIN storefront_banners b ON b.id = r.banner_id
      WHERE r.banner_id = ? AND b.brand_id = ?
      ORDER BY r.revision_number DESC
    `, [bannerId, brandId]);
  }

  findRevisionById(brandId, revisionId) {
    return this.db.queryOne(`
      SELECT r.*
      FROM storefront_banner_revisions r
      JOIN storefront_banners b ON b.id = r.banner_id
      WHERE r.id = ? AND b.brand_id = ?
      LIMIT 1
    `, [revisionId, brandId]);
  }

  getNextRevisionNumber(bannerId) {
    const row = this.db.queryOne(`
      SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision
      FROM storefront_banner_revisions
      WHERE banner_id = ?
    `, [bannerId]);
    return Number(row?.next_revision || 1);
  }

  createRevision({
    id,
    bannerId,
    revisionNumber,
    title = '',
    altText = '',
    mediaId,
    ctaType,
    ctaTargetId = null,
    ctaUrl = null,
    promotionId = null,
    createdBy = null
  }) {
    const now = new Date().toISOString();
    return this.db.execute(`
      INSERT INTO storefront_banner_revisions (
        id, banner_id, revision_number, revision_status,
        title, alt_text, media_id, cta_type, cta_target_id, cta_url, promotion_id,
        created_by, created_at, updated_at, published_at
      ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `, [
      id, bannerId, revisionNumber,
      title, altText, mediaId, ctaType, ctaTargetId, ctaUrl, promotionId,
      createdBy, now, now
    ]);
  }

  updateDraftRevision({
    brandId,
    revisionId,
    title,
    altText,
    mediaId,
    ctaType,
    ctaTargetId = null,
    ctaUrl = null,
    promotionId = null
  }) {
    const now = new Date().toISOString();
    return this.db.execute(`
      UPDATE storefront_banner_revisions
      SET title = ?,
          alt_text = ?,
          media_id = ?,
          cta_type = ?,
          cta_target_id = ?,
          cta_url = ?,
          promotion_id = ?,
          updated_at = ?
      WHERE id = ?
        AND revision_status = 'DRAFT'
        AND EXISTS (
          SELECT 1
          FROM storefront_banners b
          WHERE b.id = storefront_banner_revisions.banner_id
            AND b.brand_id = ?
        )
    `, [
      title, altText, mediaId, ctaType, ctaTargetId, ctaUrl, promotionId,
      now, revisionId, brandId
    ]);
  }

  publishRevision({ brandId, revisionId }) {
    const now = new Date().toISOString();
    const result = this.db.execute(`
      UPDATE storefront_banner_revisions
      SET revision_status = 'PUBLISHED',
          published_at = ?,
          updated_at = ?
      WHERE id = ?
        AND revision_status = 'DRAFT'
        AND EXISTS (
          SELECT 1
          FROM storefront_banners b
          WHERE b.id = storefront_banner_revisions.banner_id
            AND b.brand_id = ?
        )
    `, [now, now, revisionId, brandId]);

    if (!result || Number(result.changes || 0) !== 1) {
      return result;
    }

    const revision = this.findRevisionById(brandId, revisionId);
    if (revision) {
      this.db.execute(`
        UPDATE storefront_banners
        SET publication_status = 'PUBLISHED',
            updated_by = ?,
            updated_at = ?
        WHERE id = ? AND brand_id = ?
      `, [revision.created_by || null, now, revision.banner_id, brandId]);
    }
    return result;
  }

  touchBanner({ brandId, bannerId, updatedBy = null, publicationStatus = null }) {
    const now = new Date().toISOString();
    return this.db.execute(`
      UPDATE storefront_banners
      SET publication_status = COALESCE(?, publication_status),
          updated_by = COALESCE(?, updated_by),
          updated_at = ?
      WHERE id = ? AND brand_id = ?
    `, [publicationStatus, updatedBy, now, bannerId, brandId]);
  }

  deleteBannerForTestOnly(brandId, bannerId) {
    return this.db.execute(
      'DELETE FROM storefront_banners WHERE id = ? AND brand_id = ?',
      [bannerId, brandId]
    );
  }
}

module.exports = BannerContentRepository;
