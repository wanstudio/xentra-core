'use strict';

/**
 * MediaService - Canonical Domain Service for Xentra Media System (M1)
 *
 * Implements:
 * - Temporary upload staging
 * - Binary validation & security verification
 * - Explicit lifecycle state transitions (TEMPORARY -> UPLOADED -> PROCESSING -> READY -> ATTACH / ORPHAN)
 * - Strict tenant/brand authorization boundaries
 * - Atomic replacement semantics (process new -> attach new -> mark old as ORPHAN)
 * - Safe retry semantics for failed assets
 * - Normalized machine-readable error contracts
 */
const crypto = require('crypto');
const MediaLifecycle = require('./MediaLifecycle');
const { LocalStorageProvider } = require('./StorageProvider');
const ImageValidator = require('../domain/ImageValidator');
const MediaRepository = require('../data/repositories/MediaRepository');
const { ImageProcessor } = require('./ImageProcessor');
const { CropSpec } = require('../domain/CropSpec');
const MediaReferenceResolver = require('./MediaReferenceResolver');

class MediaService {
  constructor({
    mediaRepository = new MediaRepository(),
    storageProvider = new LocalStorageProvider(),
    validator = ImageValidator,
    imageProcessor = new ImageProcessor(),
    referenceResolver = new MediaReferenceResolver()
  } = {}) {
    this.mediaRepo = mediaRepository;
    this.storage = storageProvider;
    this.validator = validator;
    this.processor = imageProcessor;
    this.resolver = referenceResolver;
  }

  /**
   * Stage an initial upload into TEMPORARY status.
   *
   * Validates binary content, dimensions, size limits, and security rules.
   * If validation fails, throws a structured Error with machine-readable code.
   */
  async stageUpload({
    brandId,
    tenantId = null,
    userId = null,
    imageBase64,
    mimeType,
    declaredFilename = null,
    assetType = 'general',
    enforceAspectRatio = false
  }) {
    if (!brandId) {
      const err = new Error('brand_id is required for tenant isolation.');
      err.code = 'UNAUTHORIZED_TENANT';
      throw err;
    }

    // 1. Validate binary payload
    const validation = this.validator.validateImageUpload({
      imageBase64,
      mimeType,
      declaredFilename,
      assetType,
      enforceAspectRatio
    });

    if (!validation.valid) {
      const err = new Error(validation.error);
      err.code = validation.code || 'VALIDATION_ERROR';
      err.dimensions = validation.dimensions;
      throw err;
    }

    const { buffer, info } = validation;
    const mediaId = `med_${crypto.randomBytes(8).toString('hex')}_${Date.now()}`;
    const storageKey = `staging/${brandId}/${mediaId}.${info.ext}`;

    // 2. Persist binary to storage
    await this.storage.write(storageKey, buffer);

    // 3. Persist metadata record in 'temporary' status
    this.mediaRepo.createMedia({
      id: mediaId,
      tenant_id: tenantId,
      brand_id: brandId,
      uploaded_by: userId,
      storage_key: storageKey,
      mime_type: info.mime,
      original_filename: declaredFilename,
      width: info.width,
      height: info.height,
      size_bytes: info.sizeBytes,
      asset_type: assetType,
      status: MediaLifecycle.STATES.TEMPORARY
    });

    const asset = this.mediaRepo.findById(mediaId, brandId);
    return this._formatAssetResponse(asset);
  }

  /**
   * Transition asset from TEMPORARY to UPLOADED / PROCESSING / READY.
   */
  async transitionStatus({ mediaId, brandId, targetStatus, errorMessage = null }) {
    const asset = this.getMedia({ mediaId, brandId });

    MediaLifecycle.assertTransition(asset.status, targetStatus);

    this.mediaRepo.updateStatus(mediaId, brandId, targetStatus, { error_message: errorMessage });
    const updated = this.mediaRepo.findById(mediaId, brandId);
    return this._formatAssetResponse(updated);
  }

  /**
   * Mark asset as READY (pipeline completion).
   * Moves storage from staging to permanent brand directory if needed.
   */
  async markReady({ mediaId, brandId }) {
    const asset = this.getMedia({ mediaId, brandId });

    // In M1, asset can transition from temporary -> ready (or uploaded/processing -> ready)
    if (asset.status === MediaLifecycle.STATES.TEMPORARY) {
      MediaLifecycle.assertTransition(asset.status, MediaLifecycle.STATES.UPLOADED);
      this.mediaRepo.updateStatus(mediaId, brandId, MediaLifecycle.STATES.UPLOADED);
    }

    MediaLifecycle.assertTransition(asset.status === MediaLifecycle.STATES.TEMPORARY ? MediaLifecycle.STATES.UPLOADED : asset.status, MediaLifecycle.STATES.READY);

    // Move file to permanent location if in staging
    let finalKey = asset.storage_key;
    if (asset.storage_key.startsWith('staging/')) {
      const ext = asset.mime_type === 'image/jpeg' ? 'jpg' : (asset.mime_type === 'image/webp' ? 'webp' : 'png');
      const permKey = `${asset.asset_type || 'assets'}/${brandId}/${mediaId}.${ext}`;
      const data = await this.storage.read(asset.storage_key);
      await this.storage.write(permKey, data);
      await this.storage.delete(asset.storage_key);
      finalKey = permKey;

      // Update storage key in database
      this.mediaRepo.db.execute(
        'UPDATE media_assets SET storage_key = ? WHERE id = ? AND brand_id = ?',
        [finalKey, mediaId, brandId]
      );
    }

    this.mediaRepo.updateStatus(mediaId, brandId, MediaLifecycle.STATES.READY);
    const updated = this.mediaRepo.findById(mediaId, brandId);
    return this._formatAssetResponse(updated);
  }

  /**
   * Retry processing for a FAILED asset.
   */
  async retryFailed({ mediaId, brandId }) {
    const asset = this.getMedia({ mediaId, brandId });

    if (asset.status !== MediaLifecycle.STATES.FAILED) {
      const err = new Error(`Hanya aset berstatus 'failed' yang dapat di-retry. Status saat ini: '${asset.status}'.`);
      err.code = 'INVALID_LIFECYCLE_TRANSITION';
      throw err;
    }

    MediaLifecycle.assertTransition(asset.status, MediaLifecycle.STATES.PROCESSING);
    this.mediaRepo.updateStatus(mediaId, brandId, MediaLifecycle.STATES.PROCESSING);

    const updated = this.mediaRepo.findById(mediaId, brandId);
    return this._formatAssetResponse(updated);
  }

  /**
   * Attach a READY asset to an entity.
   */
  async attachToEntity({ mediaId, brandId, entityType, entityId }) {
    const asset = this.getMedia({ mediaId, brandId });

    if (!MediaLifecycle.canAttach(asset.status)) {
      const err = new Error(`Aset media belum dapat di-attach. Status saat ini '${asset.status}' (harus 'ready').`);
      err.code = 'ASSET_NOT_READY';
      throw err;
    }

    this.mediaRepo.attachMedia(mediaId, brandId, entityType, entityId);
    const updated = this.mediaRepo.findById(mediaId, brandId);
    return this._formatAssetResponse(updated);
  }

  /**
   * Atomic replacement:
   * 1. Validate new asset is READY
   * 2. Attach new asset to entity
   * 3. Mark old asset as ORPHAN (with 30-day grace period timestamp)
   */
  async replaceEntityMedia({ newMediaId, oldMediaId, brandId, entityType, entityId }) {
    const newAsset = this.getMedia({ mediaId: newMediaId, brandId });

    if (!MediaLifecycle.canAttach(newAsset.status)) {
      const err = new Error(`Media baru belum dalam status 'ready' (status: '${newAsset.status}'). Penggantian dibatalkan, media lama tetap aktif.`);
      err.code = 'ASSET_NOT_READY';
      throw err;
    }

    // Attach new media
    this.mediaRepo.attachMedia(newMediaId, brandId, entityType, entityId);

    // If oldMediaId is supplied and exists within same tenant, mark it as orphan
    if (oldMediaId) {
      const oldAsset = this.mediaRepo.findById(oldMediaId, brandId);
      if (oldAsset && oldAsset.id !== newMediaId) {
        this.mediaRepo.markAsOrphan(oldMediaId, brandId);
      }
    }

    const updated = this.mediaRepo.findById(newMediaId, brandId);
    return this._formatAssetResponse(updated);
  }

  /**
   * Get media metadata with strict tenant check.
   */
  getMedia({ mediaId, brandId }) {
    if (!mediaId || !brandId) {
      const err = new Error('mediaId and brandId are required.');
      err.code = 'UNAUTHORIZED_TENANT';
      throw err;
    }

    const asset = this.mediaRepo.findById(mediaId, brandId);
    if (!asset) {
      // If it exists unscoped, it belongs to another tenant -> throw UNAUTHORIZED_TENANT
      const unscoped = this.mediaRepo.findByIdUnscoped(mediaId);
      if (unscoped) {
        const err = new Error('Akses ditolak: Aset media ini milik brand/tenant lain.');
        err.code = 'UNAUTHORIZED_TENANT';
        throw err;
      }
      const err = new Error('Aset media tidak ditemukan.');
      err.code = 'MEDIA_NOT_FOUND';
      throw err;
    }

    return this._formatAssetResponse(asset);
  }

  /**
   * List media for brand.
   */
  listMedia({ brandId, status, assetType, limit = 50, offset = 0 }) {
    if (!brandId) {
      const err = new Error('brand_id is required.');
      err.code = 'UNAUTHORIZED_TENANT';
      throw err;
    }
    const assets = this.mediaRepo.listByBrand(brandId, { status, asset_type: assetType, limit, offset });
    return assets.map(a => this._formatAssetResponse(a));
  }

  /**
   * User-facing / soft delete:
   * Removes active entity references and transitions the asset to ORPHAN state
   * with a 30-day grace period. Never destroys binary immediately.
   */
  async unlinkMedia({ mediaId, brandId }) {
    const asset = this.getMedia({ mediaId, brandId });
    this.mediaRepo.unlinkAndOrphan(mediaId, brandId);
    const updated = this.mediaRepo.findById(mediaId, brandId);
    return this._formatAssetResponse(updated);
  }

  /**
   * Permanent hard deletion of a media asset and all its associated variants & binaries.
   * STRICT SAFETY RULE: Re-checks business entity references immediately before deletion.
   * If any active reference is detected, hard deletion is immediately ABORTED and asset is restored.
   */
  async hardDeleteMedia({ mediaId, brandId, force = false }) {
    const asset = this.getMedia({ mediaId, brandId });

    // 1. Final authoritative reference re-check
    const refCheck = await this.resolver.checkReference({ mediaId, brandId });
    if (refCheck.isReferenced && !force) {
      // Protect referenced asset: restore to ready
      const firstRef = refCheck.references[0];
      this.mediaRepo.restoreOrphanToReady(mediaId, brandId, firstRef.type, firstRef.id);
      const err = new Error(`Aset media tidak dapat dihapus permanen karena masih aktif direferensikan oleh '${firstRef.type}' (${firstRef.id}).`);
      err.code = 'ASSET_REFERENCED';
      err.references = refCheck.references;
      throw err;
    }

    // 2. Remove all associated variant binaries and DB records
    const variants = this.mediaRepo.getVariantsByMediaId(mediaId);
    for (const v of variants) {
      if (v.storage_key) {
        try {
          await this.storage.delete(v.storage_key);
        } catch (_) {}
      }
    }
    this.mediaRepo.deleteVariantsByMediaId(mediaId);

    // 3. Remove original binary file
    if (asset.storage_key) {
      try {
        await this.storage.delete(asset.storage_key);
      } catch (_) {}
    }

    // 4. Delete DB record
    this.mediaRepo.deleteMedia(mediaId, brandId);
    return { success: true, mediaId, deletedVariants: variants.length };
  }

  /**
   * Delete media: user-requested removal enters ORPHAN state (30-day grace).
   * If force=true, performs immediate reference-checked hard delete.
   */
  async deleteMedia({ mediaId, brandId, force = false }) {
    if (force) {
      return this.hardDeleteMedia({ mediaId, brandId, force: true });
    }
    return this.unlinkMedia({ mediaId, brandId });
  }

  /**
   * Clean up abandoned temporary or failed uploads older than cutoff (default 24h).
   * Re-checks references and state before permanent deletion.
   */
  async cleanupTemporary({ olderThanHours = 24, brandId = null } = {}) {
    const cutoffDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    const candidates = this.mediaRepo.findTemporaryBefore(cutoffDate.toISOString(), brandId);

    let cleanedCount = 0;
    let skippedCount = 0;
    const details = [];

    for (const asset of candidates) {
      // Verify still temporary or failed
      if (asset.status !== MediaLifecycle.STATES.TEMPORARY && asset.status !== MediaLifecycle.STATES.FAILED) {
        skippedCount++;
        continue;
      }

      // Check references
      const refCheck = await this.resolver.checkReference({ mediaId: asset.id, brandId: asset.brand_id });
      if (refCheck.isReferenced) {
        skippedCount++;
        continue;
      }

      // Perform clean hard deletion
      try {
        await this.hardDeleteMedia({ mediaId: asset.id, brandId: asset.brand_id, force: true });
        cleanedCount++;
        details.push({ mediaId: asset.id, status: asset.status, action: 'deleted' });
      } catch (_) {
        skippedCount++;
      }
    }

    return {
      cleanedCount,
      skippedCount,
      cutoff: cutoffDate.toISOString(),
      details
    };
  }

  /**
   * Reconcile orphan assets:
   * 1. If an orphan is discovered to be referenced by an active entity, restore to READY
   * 2. If an orphan is unreferenced and has passed the 30-day grace period, permanently delete
   */
  async reconcileOrphans({ gracePeriodDays = 30, brandId = null } = {}) {
    const cutoffDate = new Date(Date.now() - gracePeriodDays * 24 * 60 * 60 * 1000);
    const orphans = this.mediaRepo.findOrphans(brandId);

    let restoredCount = 0;
    let deletedCount = 0;
    let retainedCount = 0;
    const details = [];

    for (const orphan of orphans) {
      // 1. Authoritative reference check
      const refCheck = await this.resolver.checkReference({ mediaId: orphan.id, brandId: orphan.brand_id });

      if (refCheck.isReferenced) {
        // Re-referenced! Restore to READY
        const firstRef = refCheck.references[0];
        this.mediaRepo.restoreOrphanToReady(orphan.id, orphan.brand_id, firstRef.type, firstRef.id);
        restoredCount++;
        details.push({ mediaId: orphan.id, action: 'restored', references: refCheck.references });
        continue;
      }

      // 2. Check 30-day grace period
      const orphanedAtTime = orphan.orphaned_at ? new Date(orphan.orphaned_at).getTime() : 0;
      const isPastGracePeriod = orphanedAtTime > 0 && orphanedAtTime < cutoffDate.getTime();

      if (isPastGracePeriod) {
        // Safe to hard delete
        try {
          await this.hardDeleteMedia({ mediaId: orphan.id, brandId: orphan.brand_id, force: true });
          deletedCount++;
          details.push({ mediaId: orphan.id, action: 'hard_deleted' });
        } catch (_) {
          retainedCount++;
        }
      } else {
        // Still within grace period -> retain
        retainedCount++;
        details.push({ mediaId: orphan.id, action: 'retained_in_grace' });
      }
    }

    return {
      reconciledCount: orphans.length,
      restoredCount,
      deletedCount,
      retainedCount,
      graceCutoff: cutoffDate.toISOString(),
      details
    };
  }

  /**
   * Check consistency of media storage and database records:
   * Verifies that original binaries and derivative variants exist on disk.
   */
  async checkConsistency({ mediaId = null, brandId = null } = {}) {
    let assets = [];
    if (mediaId && brandId) {
      const a = this.mediaRepo.findById(mediaId, brandId);
      if (a) assets = [a];
    } else if (brandId) {
      assets = this.mediaRepo.listByBrand(brandId, { limit: 1000 });
    } else {
      assets = this.mediaRepo.db.queryMany('SELECT * FROM media_assets LIMIT 1000');
    }

    let healthyCount = 0;
    const issues = [];

    for (const a of assets) {
      let isHealthy = true;
      const originalExists = await this.storage.exists(a.storage_key);
      if (!originalExists) {
        isHealthy = false;
        issues.push({
          mediaId: a.id,
          brandId: a.brand_id,
          type: 'MISSING_ORIGINAL_BINARY',
          storageKey: a.storage_key
        });
      }

      const variants = this.mediaRepo.getVariantsByMediaId(a.id);
      for (const v of variants) {
        const varExists = await this.storage.exists(v.storage_key);
        if (!varExists) {
          isHealthy = false;
          issues.push({
            mediaId: a.id,
            variantId: v.id,
            variantName: v.variant_name,
            brandId: a.brand_id,
            type: 'MISSING_VARIANT_BINARY',
            storageKey: v.storage_key
          });
        }
      }

      if (isHealthy) healthyCount++;
    }

    return {
      totalAssetsChecked: assets.length,
      healthyCount,
      issuesCount: issues.length,
      issues
    };
  }

  /**
   * Media Garbage Collector (GC):
   * Runs complete safe maintenance cycle:
   * 1. Cleanup abandoned temporary/failed uploads (older than 24 hours)
   * 2. Reconcile orphan assets (restore referenced, delete unreferenced >= 30 days)
   * 3. Consistency inspection summary
   */
  async collectGarbage({ temporaryHours = 24, orphanGraceDays = 30, brandId = null } = {}) {
    const tempResult = await this.cleanupTemporary({ olderThanHours: temporaryHours, brandId });
    const orphanResult = await this.reconcileOrphans({ gracePeriodDays: orphanGraceDays, brandId });
    const consistency = await this.checkConsistency({ brandId });

    return {
      timestamp: new Date().toISOString(),
      brandId: brandId || 'all_tenants',
      temporary: tempResult,
      orphans: orphanResult,
      consistency: {
        healthy: consistency.healthyCount,
        issues: consistency.issuesCount
      }
    };
  }

  /**
   * Set or update crop specification intent on an asset (M2).
   * Strict tenant authorization is enforced.
   */
  async setCropSpec({ mediaId, brandId, cropSpec }) {
    const asset = this.getMedia({ mediaId, brandId });

    // Validate cropSpec against source dimensions
    const { CropSpec } = require('../domain/CropSpec');
    const validatedSpec = new CropSpec({
      ...cropSpec,
      source_width: cropSpec.source_width || asset.width,
      source_height: cropSpec.source_height || asset.height,
      asset_type: cropSpec.asset_type || asset.asset_type
    });

    this.mediaRepo.updateCropSpec(mediaId, brandId, validatedSpec.toJSON());
    const updated = this.mediaRepo.findById(mediaId, brandId);
    return this._formatAssetResponse(updated);
  }

  /**
   * Process media asset through canonical M3 pipeline:
   * 1. Check tenant authorization and valid lifecycle transition (TEMPORARY/UPLOADED/FAILED -> PROCESSING)
   * 2. Load source binary from storage
   * 3. Apply CropSpec (or compute default centered crop if omitted)
   * 4. Crop, resize, strip metadata, encode WebP derivatives without upscaling
   * 5. Write derivatives to storage: derivatives/<brandId>/<mediaId>/<variant>.webp
   * 6. Move source from staging to permanent original storage: originals/<brandId>/<mediaId>.<ext>
   * 7. Persist variant metadata in media_variants
   * 8. Transition asset to READY (or FAILED if error occurs)
   */
  async processMedia({ mediaId, brandId, cropSpec = null }) {
    const asset = this.getMedia({ mediaId, brandId });

    // Transition to PROCESSING
    MediaLifecycle.assertTransition(asset.status, MediaLifecycle.STATES.PROCESSING);
    this.mediaRepo.updateStatus(mediaId, brandId, MediaLifecycle.STATES.PROCESSING);

    try {
      // 1. Read source binary from storage
      const sourceBuffer = await this.storage.read(asset.storage_key);

      // 2. Consume provided cropSpec or existing cropSpec on asset, or fallback to centered default
      const effectiveCrop = cropSpec || asset.crop_spec;

      // 3. Run Sharp canonical processing pipeline
      const result = await this.processor.process({
        sourceBuffer,
        assetType: asset.asset_type || 'general',
        cropSpec: effectiveCrop
      });

      // 4. Clean up any previous variants if this was a retry
      this.mediaRepo.deleteVariantsByMediaId(mediaId);

      // 5. Store derivatives and record in media_variants
      const savedVariants = [];
      for (const derivative of result.derivatives) {
        const variantId = `var_${crypto.randomBytes(8).toString('hex')}_${Date.now()}`;
        const derivativeStorageKey = `derivatives/${brandId}/${mediaId}/${derivative.name}.webp`;

        await this.storage.write(derivativeStorageKey, derivative.buffer);

        this.mediaRepo.createVariant({
          id: variantId,
          media_id: mediaId,
          variant_name: derivative.name,
          width: derivative.width,
          height: derivative.height,
          format: derivative.format,
          mime_type: derivative.mimeType,
          size_bytes: derivative.sizeBytes,
          storage_key: derivativeStorageKey
        });

        savedVariants.push({
          id: variantId,
          name: derivative.name,
          width: derivative.width,
          height: derivative.height,
          format: derivative.format,
          mime_type: derivative.mimeType,
          size_bytes: derivative.sizeBytes,
          storage_key: derivativeStorageKey,
          url: this.storage.resolveUrl(derivativeStorageKey)
        });
      }

      // 6. Relocate original from staging to permanent brand originals location if applicable
      let finalKey = asset.storage_key;
      if (asset.storage_key.startsWith('staging/')) {
        const ext = asset.mime_type === 'image/jpeg' ? 'jpg' : (asset.mime_type === 'image/webp' ? 'webp' : 'png');
        const permKey = `originals/${brandId}/${mediaId}.${ext}`;
        await this.storage.write(permKey, sourceBuffer);
        await this.storage.delete(asset.storage_key);
        finalKey = permKey;

        this.mediaRepo.db.execute(
          'UPDATE media_assets SET storage_key = ? WHERE id = ? AND brand_id = ?',
          [finalKey, mediaId, brandId]
        );
      }

      // 7. Update crop spec record on asset
      this.mediaRepo.updateCropSpec(mediaId, brandId, result.cropSpec.toJSON());

      // 8. Transition asset to READY
      MediaLifecycle.assertTransition(MediaLifecycle.STATES.PROCESSING, MediaLifecycle.STATES.READY);
      this.mediaRepo.updateStatus(mediaId, brandId, MediaLifecycle.STATES.READY);

      const updated = this.mediaRepo.findById(mediaId, brandId);
      return this._formatAssetResponse(updated);

    } catch (err) {
      // Safe lifecycle failure transition
      this.mediaRepo.updateStatus(mediaId, brandId, MediaLifecycle.STATES.FAILED, {
        error_message: err.message || 'Image processing failed'
      });
      const failedAsset = this.mediaRepo.findById(mediaId, brandId);
      const formatted = this._formatAssetResponse(failedAsset);
      const wrappedError = new Error(`Media processing failed: ${err.message}`);
      wrappedError.code = err.code || 'PROCESSING_FAILED';
      wrappedError.asset = formatted;
      throw wrappedError;
    }
  }

  _formatAssetResponse(asset) {
    if (!asset) return null;
    let parsedCropSpec = null;
    if (asset.crop_spec) {
      try {
        parsedCropSpec = typeof asset.crop_spec === 'string' ? JSON.parse(asset.crop_spec) : asset.crop_spec;
      } catch (_) {
        parsedCropSpec = null;
      }
    }

    // Include variants if available
    let variants = [];
    try {
      const dbVariants = this.mediaRepo.getVariantsByMediaId(asset.id);
      variants = (dbVariants || []).map(v => ({
        id: v.id,
        name: v.variant_name,
        width: v.width,
        height: v.height,
        format: v.format,
        mime_type: v.mime_type,
        size_bytes: v.size_bytes,
        storage_key: v.storage_key,
        url: this.storage.resolveUrl(v.storage_key)
      }));
    } catch (_) {
      variants = [];
    }

    return {
      media_id: asset.id,
      tenant_id: asset.tenant_id,
      brand_id: asset.brand_id,
      uploaded_by: asset.uploaded_by,
      storage_key: asset.storage_key,
      url: this.storage.resolveUrl(asset.storage_key),
      mime_type: asset.mime_type,
      original_filename: asset.original_filename,
      width: asset.width,
      height: asset.height,
      size_bytes: asset.size_bytes,
      asset_type: asset.asset_type,
      status: asset.status,
      crop_spec: parsedCropSpec,
      variants,
      attached_to_type: asset.attached_to_type,
      attached_to_id: asset.attached_to_id,
      attached_at: asset.attached_at,
      orphaned_at: asset.orphaned_at,
      error_message: asset.error_message,
      created_at: asset.created_at,
      updated_at: asset.updated_at
    };
  }
}

module.exports = MediaService;
