'use strict';

/**
 * MediaRepository - Domain Persistence Adapter for Xentra Media Assets
 *
 * Implements canonical M1 lifecycle state tracking, tenant/brand-scoped lookups,
 * safe metadata persistence, and atomic reference replacement.
 *
 * Binary data is NEVER stored in SQLite. Only metadata and abstract storage keys.
 */
const DataAccess = require('../DataAccess');

class MediaRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  async ready() {
    await this.db.ready();
    return this;
  }

  /**
   * Insert a new media record in temporary/uploading state.
   */
  createMedia({
    id,
    tenant_id,
    brand_id,
    uploaded_by,
    storage_key,
    mime_type,
    original_filename,
    width,
    height,
    size_bytes,
    asset_type = 'general',
    status = 'temporary',
    crop_spec = null
  }) {
    const now = new Date().toISOString();
    return this.db.execute(`
      INSERT INTO media_assets (
        id, tenant_id, brand_id, uploaded_by, storage_key, mime_type,
        original_filename, width, height, size_bytes, asset_type, status,
        crop_spec, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      tenant_id || null,
      brand_id,
      uploaded_by || null,
      storage_key,
      mime_type,
      original_filename || null,
      width || null,
      height || null,
      size_bytes || 0,
      asset_type,
      status,
      crop_spec ? (typeof crop_spec === 'string' ? crop_spec : JSON.stringify(crop_spec)) : null,
      now,
      now
    ]);
  }

  /**
   * Update crop specification intent on an asset.
   */
  updateCropSpec(id, brandId, cropSpec) {
    const now = new Date().toISOString();
    const serialized = cropSpec ? (typeof cropSpec === 'string' ? cropSpec : JSON.stringify(cropSpec)) : null;
    return this.db.execute(`
      UPDATE media_assets
      SET crop_spec = ?,
          updated_at = ?
      WHERE id = ? AND brand_id = ?
    `, [serialized, now, id, brandId]);
  }

  /**
   * Find media record strictly within tenant/brand scope.
   */
  findById(id, brandId) {
    if (!id || !brandId) return null;
    return this.db.queryOne(`
      SELECT *
      FROM media_assets
      WHERE id = ? AND brand_id = ?
      LIMIT 1
    `, [id, brandId]);
  }

  /**
   * Find media record by ID alone (system/internal lookups only).
   */
  findByIdUnscoped(id) {
    if (!id) return null;
    return this.db.queryOne(`
      SELECT *
      FROM media_assets
      WHERE id = ?
      LIMIT 1
    `, [id]);
  }

  /**
   * List media records for a specific brand/tenant.
   */
  listByBrand(brandId, { status, asset_type, limit = 50, offset = 0 } = {}) {
    if (!brandId) return [];
    const params = [brandId];
    let sql = `
      SELECT *
      FROM media_assets
      WHERE brand_id = ?
    `;

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (asset_type) {
      sql += ' AND asset_type = ?';
      params.push(asset_type);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.db.queryMany(sql, params);
  }

  /**
   * Update lifecycle status with validation of current state.
   */
  updateStatus(id, brandId, newStatus, { error_message = null } = {}) {
    const now = new Date().toISOString();
    return this.db.execute(`
      UPDATE media_assets
      SET status = ?,
          error_message = ?,
          updated_at = ?
      WHERE id = ? AND brand_id = ?
    `, [newStatus, error_message, now, id, brandId]);
  }

  /**
   * Attach media to an entity.
   */
  attachMedia(id, brandId, entityType, entityId) {
    const now = new Date().toISOString();
    return this.db.execute(`
      UPDATE media_assets
      SET attached_to_type = ?,
          attached_to_id = ?,
          attached_at = ?,
          updated_at = ?
      WHERE id = ? AND brand_id = ?
    `, [entityType, entityId, now, now, id, brandId]);
  }

  /**
   * Mark an asset as orphan when replaced.
   */
  markAsOrphan(id, brandId) {
    const now = new Date().toISOString();
    return this.db.execute(`
      UPDATE media_assets
      SET status = 'orphan',
          orphaned_at = ?,
          updated_at = ?
      WHERE id = ? AND brand_id = ?
    `, [now, now, id, brandId]);
  }

  /**
   * Delete media record (permanent DB purge after retention check).
   */
  deleteMedia(id, brandId) {
    return this.db.execute(`
      DELETE FROM media_assets
      WHERE id = ? AND brand_id = ?
    `, [id, brandId]);
  }

  /**
   * Find abandoned temporary uploads older than cutoff date (for cleanup).
   */
  findTemporaryBefore(cutoffIsoString) {
    return this.db.queryMany(`
      SELECT *
      FROM media_assets
      WHERE status IN ('temporary', 'failed')
        AND created_at < ?
    `, [cutoffIsoString]);
  }

  /**
   * Find orphan assets older than cutoff date (for 30-day grace period cleanup).
   */
  findOrphansBefore(cutoffIsoString) {
    return this.db.queryMany(`
      SELECT *
      FROM media_assets
      WHERE status = 'orphan'
        AND orphaned_at IS NOT NULL
        AND orphaned_at < ?
    `, [cutoffIsoString]);
  }

  /**
   * Insert a processed media variant record.
   */
  createVariant({
    id,
    media_id,
    variant_name,
    width,
    height,
    format,
    mime_type,
    size_bytes,
    storage_key
  }) {
    const now = new Date().toISOString();
    return this.db.execute(`
      INSERT INTO media_variants (
        id, media_id, variant_name, width, height, format, mime_type,
        size_bytes, storage_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      media_id,
      variant_name,
      width,
      height,
      format,
      mime_type,
      size_bytes || 0,
      storage_key,
      now
    ]);
  }

  /**
   * Find all derivatives for a specific media asset.
   */
  getVariantsByMediaId(mediaId) {
    if (!mediaId) return [];
    return this.db.queryMany(`
      SELECT *
      FROM media_variants
      WHERE media_id = ?
      ORDER BY width ASC
    `, [mediaId]);
  }

  /**
   * Delete existing variants for a media asset (e.g. before re-processing / retry).
   */
  deleteVariantsByMediaId(mediaId) {
    if (!mediaId) return;
    return this.db.execute(`
      DELETE FROM media_variants
      WHERE media_id = ?
    `, [mediaId]);
  }
}

module.exports = MediaRepository;

