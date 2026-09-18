'use strict';

const crypto = require('crypto');
const BannerContent = require('../domain/BannerContent');
const BannerContentRepository = require('../../../core/data/repositories/BannerContentRepository');
const { MediaService } = require('../../../core/media');
const BannerAssignmentRepository = require('../../../core/data/repositories/BannerAssignmentRepository');
const WorkforceService = require('../../../core/identity/WorkforceService');

const mediaService = new MediaService();

class BannerContentService {
  constructor({
    repository = new BannerContentRepository(),
    media = mediaService,
    assignmentRepository = new BannerAssignmentRepository()
  } = {}) {
    this.repository = repository;
    this.media = media;
    this.assignmentRepository = assignmentRepository;
    this.workforce = new WorkforceService();
  }

  static createId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  }

  validatePayload({ brandId, mediaId, title = '', altText = '', ctaType = 'NONE', ctaTargetId = null, ctaUrl = null, promotionId = null }) {
    if (!brandId) {
      const err = new Error('brand_id is required.');
      err.code = 'BRAND_REQUIRED';
      throw err;
    }

    if (!mediaId || typeof mediaId !== 'string') {
      const err = new Error('media_id wajib diisi.');
      err.code = 'MEDIA_REQUIRED';
      throw err;
    }

    if (typeof title !== 'string' || typeof altText !== 'string') {
      const err = new Error('title dan alt_text harus berupa teks.');
      err.code = 'INVALID_CONTENT';
      throw err;
    }

    const normalizedCtaType = String(ctaType || 'NONE').toUpperCase();
    if (!Object.values(BannerContent.CTA_TYPES).includes(normalizedCtaType)) {
      const err = new Error(`CTA type tidak didukung: ${normalizedCtaType}`);
      err.code = 'INVALID_CTA_TYPE';
      throw err;
    }

    if (normalizedCtaType === 'NONE' && (ctaTargetId || ctaUrl || promotionId)) {
      const err = new Error('CTA NONE tidak boleh memiliki target.');
      err.code = 'INVALID_CTA_TARGET';
      throw err;
    }

    if (normalizedCtaType === 'PROMOTION') {
      if (!promotionId) {
        const err = new Error('CTA PROMOTION wajib memiliki promotion_id.');
        err.code = 'CTA_TARGET_REQUIRED';
        throw err;
      }
      if (ctaTargetId || ctaUrl) {
        const err = new Error('CTA PROMOTION hanya menggunakan promotion_id.');
        err.code = 'INVALID_CTA_TARGET';
        throw err;
      }
    }

    if (normalizedCtaType === 'PRODUCT' || normalizedCtaType === 'CATEGORY') {
      if (!ctaTargetId) {
        const err = new Error(`CTA ${normalizedCtaType} wajib memiliki target id.`);
        err.code = 'CTA_TARGET_REQUIRED';
        throw err;
      }
      if (ctaUrl || promotionId) {
        const err = new Error(`CTA ${normalizedCtaType} tidak boleh memiliki field target lain.`);
        err.code = 'INVALID_CTA_TARGET';
        throw err;
      }
    }

    if (normalizedCtaType === 'URL') {
      if (!ctaUrl || typeof ctaUrl !== 'string' || !ctaUrl.trim()) {
        const err = new Error('CTA URL wajib memiliki URL.');
        err.code = 'CTA_TARGET_REQUIRED';
        throw err;
      }
      if (ctaTargetId || promotionId) {
        const err = new Error('CTA URL tidak boleh memiliki target id atau promotion_id.');
        err.code = 'INVALID_CTA_TARGET';
        throw err;
      }
    }

    return {
      mediaId,
      title: title.trim(),
      altText: altText.trim(),
      ctaType: normalizedCtaType,
      ctaTargetId: ctaTargetId || null,
      ctaUrl: ctaUrl ? ctaUrl.trim() : null,
      promotionId: promotionId || null
    };
  }

  assertMediaReady(brandId, mediaId) {
    const asset = this.media.getMedia({ mediaId, brandId });
    if (asset.status !== 'ready') {
      const err = new Error(`Media banner belum READY (status: ${asset.status}).`);
      err.code = 'ASSET_NOT_READY';
      throw err;
    }
    if (asset.asset_type !== 'banner') {
      const err = new Error(`Media ${mediaId} bukan asset_type banner.`);
      err.code = 'INVALID_MEDIA_TYPE';
      throw err;
    }
    return asset;
  }

  assertTargetReference(brandId, { ctaType, ctaTargetId, promotionId }) {
    if (ctaType === 'PROMOTION') {
      const row = this.repository.db.queryOne(
        'SELECT id FROM promotions WHERE id = ? AND brand_id = ? LIMIT 1',
        [promotionId, brandId]
      );
      if (!row) {
        const err = new Error('Promotion CTA tidak ditemukan pada brand ini.');
        err.code = 'INVALID_PROMOTION_REFERENCE';
        throw err;
      }
    }

    if (ctaType === 'PRODUCT') {
      const row = this.repository.db.queryOne(
        'SELECT id FROM products WHERE id = ? AND brand_id = ? LIMIT 1',
        [ctaTargetId, brandId]
      );
      if (!row) {
        const err = new Error('Product CTA tidak ditemukan pada brand ini.');
        err.code = 'INVALID_PRODUCT_REFERENCE';
        throw err;
      }
    }

    if (ctaType === 'CATEGORY') {
      const row = this.repository.db.queryOne(
        'SELECT id FROM categories WHERE id = ? AND brand_id = ? LIMIT 1',
        [ctaTargetId, brandId]
      );
      if (!row) {
        const err = new Error('Category CTA tidak ditemukan pada brand ini.');
        err.code = 'INVALID_CATEGORY_REFERENCE';
        throw err;
      }
    }
  }

  async createDraft({
    brandId,
    actorId = null,
    actorRole = null,
    mediaId,
    title = '',
    altText = '',
    ctaType = 'NONE',
    ctaTargetId = null,
    ctaUrl = null,
    promotionId = null
  }) {
    const content = this.validatePayload({
      brandId, mediaId, title, altText, ctaType, ctaTargetId, ctaUrl, promotionId
    });

    this.assertMediaReady(brandId, content.mediaId);
    this.assertTargetReference(brandId, content);

    const bannerId = BannerContentService.createId('bnr');
    const revisionId = BannerContentService.createId('bnrr');
    this.repository.beginTransaction();
    try {
      this.repository.createBanner({
        id: bannerId,
        brandId,
        createdBy: actorId,
        updatedBy: actorId
      });
      this.repository.createRevision({
        id: revisionId,
        bannerId,
        revisionNumber: 1,
        title: content.title,
        altText: content.altText,
        mediaId: content.mediaId,
        ctaType: content.ctaType,
        ctaTargetId: content.ctaTargetId,
        ctaUrl: content.ctaUrl,
        promotionId: content.promotionId,
        createdBy: actorId
      });

      await this.media.attachToEntity({
        mediaId: content.mediaId,
        brandId,
        entityType: 'banner_content_revision',
        entityId: revisionId
      });

      this.repository.commitTransaction();
    } catch (err) {
      try { this.repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    this.writeSecurityAudit({
      brandId,
      actorId,
      actorRole,
      action: 'BANNER_CONTENT_CREATED',
      metadata: { banner_id: bannerId, revision_id: revisionId, publication_status: 'DRAFT' }
    });
    return this.repository.getBannerAggregate(brandId, bannerId);
  }

  async updateDraft({
    brandId,
    bannerId,
    actorId = null,
    actorRole = null,
    mediaId,
    title = '',
    altText = '',
    ctaType = 'NONE',
    ctaTargetId = null,
    ctaUrl = null,
    promotionId = null
  }) {
    const current = this.repository.findBannerById(brandId, bannerId);
    if (!current) {
      const err = new Error('Banner tidak ditemukan.');
      err.code = 'BANNER_NOT_FOUND';
      throw err;
    }

    const content = this.validatePayload({
      brandId, mediaId, title, altText, ctaType, ctaTargetId, ctaUrl, promotionId
    });

    this.assertMediaReady(brandId, content.mediaId);
    this.assertTargetReference(brandId, content);

    const existingDraft = this.repository.findDraftRevision(brandId, bannerId);
    const published = this.repository.findCurrentPublishedRevision(brandId, bannerId);

    this.repository.beginTransaction();
    try {
      let draft = existingDraft;

      if (!draft) {
        if (!published) {
          const err = new Error('Banner draft revision tidak ditemukan.');
          err.code = 'DRAFT_NOT_FOUND';
          throw err;
        }

        const revisionId = BannerContentService.createId('bnrr');
        const revisionNumber = this.repository.getNextRevisionNumber(bannerId);
        this.repository.createRevision({
          id: revisionId,
          bannerId,
          revisionNumber,
          title: content.title,
          altText: content.altText,
          mediaId: content.mediaId,
          ctaType: content.ctaType,
          ctaTargetId: content.ctaTargetId,
          ctaUrl: content.ctaUrl,
          promotionId: content.promotionId,
          createdBy: actorId
        });

        await this.media.attachToEntity({
          mediaId: content.mediaId,
          brandId,
          entityType: 'banner_content_revision',
          entityId: revisionId
        });
      } else {
        if (draft.media_id !== content.mediaId) {
          await this.media.replaceEntityMedia({
            newMediaId: content.mediaId,
            oldMediaId: draft.media_id,
            brandId,
            entityType: 'banner_content_revision',
            entityId: draft.id
          });
        }

        this.repository.updateDraftRevision({
          brandId,
          revisionId: draft.id,
          title: content.title,
          altText: content.altText,
          mediaId: content.mediaId,
          ctaType: content.ctaType,
          ctaTargetId: content.ctaTargetId,
          ctaUrl: content.ctaUrl,
          promotionId: content.promotionId
        });
      }

      this.repository.touchBanner({ brandId, bannerId, updatedBy: actorId });
      this.repository.commitTransaction();
    } catch (err) {
      try { this.repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    this.writeSecurityAudit({
      brandId,
      actorId,
      actorRole,
      action: 'BANNER_CONTENT_DRAFT_UPDATED',
      metadata: {
        banner_id: bannerId,
        draft_revision_id: this.repository.findDraftRevision(brandId, bannerId)?.id || null
      }
    });


    return this.repository.getBannerAggregate(brandId, bannerId);
  }

  async publishDraft({ brandId, bannerId, actorId = null, actorRole = null }) {
    const banner = this.repository.findBannerById(brandId, bannerId);
    if (!banner) {
      const err = new Error('Banner tidak ditemukan.');
      err.code = 'BANNER_NOT_FOUND';
      throw err;
    }

    const draft = this.repository.findDraftRevision(brandId, bannerId);
    if (!draft) {
      const err = new Error('Tidak ada Draft Revision yang siap dipublish.');
      err.code = 'DRAFT_NOT_FOUND';
      throw err;
    }

    this.assertMediaReady(brandId, draft.media_id);
    // Publishing can make existing active assignments customer-visible, so
    // every affected Branch/Placement/Position must pass the visibility overlap guard.
    this.assertPublishPlacementConflicts(brandId, bannerId);

    this.repository.beginTransaction();
    try {
      const revision = this.repository.findRevisionById(brandId, draft.id);
      if (!revision || revision.revision_status !== 'DRAFT') {
        const err = new Error('Draft revision tidak lagi tersedia untuk dipublish.');
        err.code = 'DRAFT_NOT_FOUND';
        throw err;
      }

      this.repository.publishRevision({ brandId, revisionId: draft.id });
      this.repository.touchBanner({
        brandId,
        bannerId,
        updatedBy: actorId,
        publicationStatus: BannerContent.PUBLICATION_STATUS.PUBLISHED
      });
      this.repository.commitTransaction();
    } catch (err) {
      try { this.repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    this.writeSecurityAudit({
      brandId,
      actorId,
      actorRole,
      action: 'BANNER_CONTENT_PUBLISHED',
      metadata: {
        banner_id: bannerId,
        published_revision_id: draft.id
      }
    });


    return this.repository.getBannerAggregate(brandId, bannerId);
  }

  async deleteDraft({ brandId, bannerId, actorId = null, actorRole = null }) {
    const banner = this.repository.getBannerAggregate(brandId, bannerId);
    if (!banner) {
      const err = new Error('Banner tidak ditemukan.');
      err.code = 'BANNER_NOT_FOUND';
      throw err;
    }

    if (banner.published_revision) {
      const err = new Error('Banner yang sudah pernah dipublish tidak dapat dihapus. Buat Draft baru atau kelola Assignment-nya.');
      err.code = 'PUBLISHED_BANNER_DELETE_FORBIDDEN';
      throw err;
    }

    const assignments = this.assignmentRepository.listByBanner(brandId, bannerId);
    if (assignments.length > 0) {
      const err = new Error('Hapus Assignment terlebih dahulu sebelum menghapus Draft Banner.');
      err.code = 'BANNER_ASSIGNMENTS_EXIST';
      throw err;
    }

    const draftMediaId = banner.draft_revision ? banner.draft_revision.media_id : null;

    this.repository.beginTransaction();
    try {
      if (draftMediaId) {
        await this.media.unlinkMedia({ mediaId: draftMediaId, brandId });
      }
      this.repository.deleteBanner(brandId, bannerId);
      this.repository.commitTransaction();
    } catch (err) {
      try { this.repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    try {
      this.workforce.logSecurityEvent({
        actor_id: actorId,
        actor_role: actorRole || 'owner',
        action: 'BANNER_CONTENT_DELETED',
        target_user_id: null,
        target_role: null,
        brand_id: brandId,
        organization_id: null,
        branch_id: null,
        result: 'success',
        metadata: { banner_id: bannerId }
      });
    } catch (_) {}

    return { success: true, banner_id: bannerId };
  }

  writeSecurityAudit({ brandId, actorId = null, actorRole = null, action, branchId = null, metadata = {} }) {
    try {
      const brand = this.repository.db.queryOne(
        'SELECT organization_id FROM brands WHERE id = ? LIMIT 1',
        [brandId]
      );
      this.workforce.logSecurityEvent({
        actor_id: actorId,
        actor_role: actorRole,
        action,
        target_user_id: null,
        target_role: null,
        brand_id: brandId,
        organization_id: brand ? brand.organization_id : null,
        branch_id: branchId,
        result: 'success',
        metadata
      });
    } catch (_) {}
  }

  getBanner({ brandId, bannerId }) {
    const result = this.repository.getBannerAggregate(brandId, bannerId);
    if (!result) {
      const err = new Error('Banner tidak ditemukan.');
      err.code = 'BANNER_NOT_FOUND';
      throw err;
    }
    return result;
  }

  listBanners({ brandId }) {
    if (!brandId) {
      const err = new Error('brand_id is required.');
      err.code = 'BRAND_REQUIRED';
      throw err;
    }
    return this.repository.listBanners(brandId);
  }
}

module.exports = BannerContentService;
