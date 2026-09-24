/**
 * XENTRA CORE — ADMIN MARKETING BANNER ROUTES
 *
 * Banner content lifecycle and branch placement/assignment APIs. Shared media
 * delivery and legacy banner parsing use the centralized banner helper boundary.
 */
module.exports = function registerAdminMarketingBannerRoutes(router, deps) {
  const {
    db,
    requireAuth,
    bannerContentService,
    bannerAssignmentService,
    mediaService
  } = deps;

  const { bannerMediaDelivery, parseLegacyBrandBanners } = require('./banner-helpers').createBannerHelpers(mediaService);

function bannerActor(req) {
  return {
    id: req.user && (req.user.userId || req.user.id),
    userId: req.user && (req.user.userId || req.user.id),
    role: req.user && req.user.role,
    branch_id: req.user && (req.user.branch_id || req.user.branchId),
    branchId: req.user && (req.user.branch_id || req.user.branchId),
    organization_id: req.brand && req.brand.organization_id
  };
}





function bannerRowToAdminDto(row) {
  const published = row.published_revision_id ? {
    id: row.published_revision_id,
    revision_number: row.published_revision_number,
    title: row.published_title || '',
    alt_text: row.published_alt_text || '',
    media_id: row.published_media_id,
    cta_type: row.published_cta_type || 'NONE',
    cta_target_id: row.published_cta_target_id || null,
    cta_url: row.published_cta_url || null,
    promotion_id: row.published_promotion_id || null
  } : null;

  const draft = row.draft_revision_id ? {
    id: row.draft_revision_id,
    revision_number: row.draft_revision_number,
    title: row.draft_title || '',
    alt_text: row.draft_alt_text || '',
    media_id: row.draft_media_id,
    cta_type: row.draft_cta_type || 'NONE',
    cta_target_id: row.draft_cta_target_id || null,
    cta_url: row.draft_cta_url || null,
    promotion_id: row.draft_promotion_id || null
  } : null;

  const liveContent = published || draft;
  const media = bannerMediaDelivery(row.brand_id, liveContent ? liveContent.media_id : null);

  return {
    id: row.banner_id,
    banner_id: row.banner_id,
    title: liveContent ? liveContent.title : '',
    alt_text: liveContent ? liveContent.alt_text : '',
    publication_status: row.banner_publication_status || 'DRAFT',
    has_draft_changes: Boolean(draft && published),
    published_revision: published,
    draft_revision: draft,
    media,
    assignment: {
      id: row.id,
      branch_id: row.branch_id,
      branch_name: row.branch_name,
      branch_timezone: row.branch_timezone || 'Asia/Jakarta',
      placement: row.placement,
      position: Number(row.position),
      active: Number(row.active) === 1,
      starts_at: row.starts_at || null,
      ends_at: row.ends_at || null,
      timezone: row.branch_timezone || row.timezone || 'Asia/Jakarta',
      governance_locked: Number(row.governance_locked) === 1,
      effective_status: require('../../domains/banner/services/BannerDateTime').effectiveStatus({
        published: row.banner_publication_status === 'PUBLISHED' && Boolean(row.published_revision_id),
        active: Number(row.active) === 1,
        startsAt: row.starts_at,
        endsAt: row.ends_at
      })
    }
  };
}

router.get('/admin/marketing/banners', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const requestedBranchId = req.query.branch_id || null;
    const rows = bannerAssignmentService.listAssignments({
      brandId: req.brand_id,
      branchId: requestedBranchId,
      actor
    });

    const contentItems = bannerContentService.listBanners({ brandId: req.brand_id });
    const result = rows.map(bannerRowToAdminDto);
    const assignedBannerIds = new Set(result.map(item => item.banner_id));

    const includeUnassignedContent = actor.role !== 'branch_manager' && !requestedBranchId;

    for (const content of contentItems) {
      if (assignedBannerIds.has(content.id)) continue;
      if (!includeUnassignedContent) continue;
      const published = content.published_revision;
      const draft = content.draft_revision;
      const live = published || draft;
      const media = bannerMediaDelivery(req.brand_id, live ? live.media_id : null);
      result.push({
        id: content.id,
        banner_id: content.id,
        title: live ? live.title : '',
        alt_text: live ? live.alt_text : '',
        publication_status: content.publication_status,
        has_draft_changes: Boolean(draft && published),
        published_revision: published ? {
          id: published.id,
          revision_number: published.revision_number,
          title: published.title || '',
          alt_text: published.alt_text || '',
          media_id: published.media_id,
          cta_type: published.cta_type || 'NONE',
          cta_target_id: published.cta_target_id || null,
          cta_url: published.cta_url || null,
          promotion_id: published.promotion_id || null
        } : null,
        draft_revision: draft ? {
          id: draft.id,
          revision_number: draft.revision_number,
          title: draft.title || '',
          alt_text: draft.alt_text || '',
          media_id: draft.media_id,
          cta_type: draft.cta_type || 'NONE',
          cta_target_id: draft.cta_target_id || null,
          cta_url: draft.cta_url || null,
          promotion_id: draft.promotion_id || null
        } : null,
        media,
        assignment: null
      });
    }

    result.sort((a, b) => {
      const an = (a.assignment && a.assignment.branch_name) || '';
      const bn = (b.assignment && b.assignment.branch_name) || '';
      return an.localeCompare(bn) || Number(a.assignment?.position || 9999) - Number(b.assignment?.position || 9999);
    });

    var branches = bannerAssignmentService.repository.listBranches(req.brand_id);
    if (actor.role === 'branch_manager') {
      const ownBranchId = actor.branch_id || actor.branchId;
      branches = ownBranchId
        ? branches.filter(function (branch) { return String(branch.id) === String(ownBranchId); })
        : [];
    }

    const legacy = parseLegacyBrandBanners(req.brand);
    res.json({
      success: true,
      placement: 'HOME_BANNER_CAROUSEL',
      banners: result,
      branches,
      legacy: {
        available: legacy.length > 0,
        count: legacy.length,
        fallback_active: true
      }
    });
  } catch (err) {
    const status = ['FORBIDDEN_BRANCH_SCOPE', 'BRANCH_NOT_FOUND', 'ASSIGNMENT_GOVERNANCE_LOCKED'].includes(err.code) ? 403 : 500;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_LIST_ERROR' });
  }
});

router.get('/admin/marketing/banners/:bannerId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const content = bannerContentService.getBanner({
      brandId: req.brand_id,
      bannerId: req.params.bannerId
    });
    const assignments = bannerAssignmentService.listAssignments({
      brandId: req.brand_id,
      branchId: actor.role === 'branch_manager' ? actor.branch_id : null,
      actor
    }).filter(row => row.banner_id === req.params.bannerId);

    if (actor.role === 'branch_manager' && assignments.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_BRANCH_SCOPE',
        message: 'Banner tidak ditugaskan pada cabang Branch Manager.'
      });
    }

    res.json({
      success: true,
      banner: {
        id: content.id,
        brand_id: content.brand_id,
        publication_status: content.publication_status,
        published_revision: content.published_revision,
        draft_revision: content.draft_revision,
        revisions: content.revisions || [],
        assignments: assignments.map(bannerRowToAdminDto).map(item => item.assignment),
        media: bannerMediaDelivery(
          req.brand_id,
          content.draft_revision?.media_id || content.published_revision?.media_id || null
        )
      }
    });
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' || err.code === 'ASSIGNMENT_NOT_FOUND' ? 404 : (err.code ? 403 : 500);
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_DETAIL_ERROR' });
  }
});

router.post('/admin/marketing/banners', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const {
      media_id,
      title = '',
      alt_text = '',
      cta_type = 'NONE',
      cta_target_id = null,
      cta_url = null,
      promotion_id = null
    } = req.body || {};

    const banner = await bannerContentService.createDraft({
      brandId: req.brand_id,
      actorId: actor.id,
      actorRole: actor.role,
      mediaId: media_id,
      title,
      altText: alt_text,
      ctaType: cta_type,
      ctaTargetId: cta_target_id,
      ctaUrl: cta_url,
      promotionId: promotion_id
    });

    res.status(201).json({ success: true, banner });
  } catch (err) {
    const status = ['BANNER_NOT_FOUND', 'INVALID_PRODUCT_REFERENCE', 'INVALID_CATEGORY_REFERENCE', 'INVALID_PROMOTION_REFERENCE'].includes(err.code)
      ? 404
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_CREATE_ERROR' });
  }
});

router.patch('/admin/marketing/banners/:bannerId/draft', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const {
      media_id,
      title = '',
      alt_text = '',
      cta_type = 'NONE',
      cta_target_id = null,
      cta_url = null,
      promotion_id = null
    } = req.body || {};

    const banner = await bannerContentService.updateDraft({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actorId: actor.id,
      actorRole: actor.role,
      mediaId: media_id,
      title,
      altText: alt_text,
      ctaType: cta_type,
      ctaTargetId: cta_target_id,
      ctaUrl: cta_url,
      promotionId: promotion_id
    });

    res.json({ success: true, banner });
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' ? 404 : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_DRAFT_UPDATE_ERROR' });
  }
});

router.post('/admin/marketing/banners/:bannerId/publish', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const banner = await bannerContentService.publishDraft({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actorId: actor.id,
      actorRole: actor.role
    });
    res.json({ success: true, banner });
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' || err.code === 'DRAFT_NOT_FOUND' ? 404
      : err.code === 'BANNER_POSITION_CONFLICT' ? 409
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_PUBLISH_ERROR', conflict: err.conflict || null });
  }
});

router.post('/admin/marketing/banners/:bannerId/discard-draft', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const banner = await bannerContentService.discardDraft({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actorId: actor.id,
      actorRole: actor.role
    });
    res.json({ success: true, banner });
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' || err.code === 'DRAFT_NOT_FOUND' ? 404
      : err.code === 'DISCARD_REQUIRES_PUBLISHED' ? 409
      : 400;
    res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || 'BANNER_DISCARD_DRAFT_ERROR'
    });
  }
});

router.delete('/admin/marketing/banners/:bannerId', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const result = await bannerContentService.deleteDraft({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actorId: actor.id,
      actorRole: actor.role
    });
    res.json(result);
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' ? 404
      : ['BANNER_ASSIGNMENTS_EXIST', 'PUBLISHED_BANNER_DELETE_FORBIDDEN'].includes(err.code) ? 409
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_DELETE_ERROR' });
  }
});

router.post('/admin/marketing/banners/:bannerId/assignments', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const assignment = bannerAssignmentService.createAssignment({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actor,
      branchId: req.body && req.body.branch_id,
      placement: req.body && req.body.placement,
      position: req.body && req.body.position,
      active: req.body && req.body.active !== undefined ? req.body.active : true,
      startsAtLocal: req.body && (req.body.starts_at_local || req.body.startsAtLocal),
      endsAtLocal: req.body && (req.body.ends_at_local || req.body.endsAtLocal),
      governanceLocked: req.body && req.body.governance_locked
    });
    res.status(201).json({
      success: true,
      assignment: bannerAssignmentDtoForResponse(req.brand_id, assignment)
    });
  } catch (err) {
    const status = err.code === 'BANNER_POSITION_CONFLICT' ? 409
      : ['BRANCH_NOT_FOUND', 'BANNER_NOT_FOUND'].includes(err.code) ? 404
      : err.code && String(err.code).indexOf('FORBIDDEN') === 0 ? 403
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'ASSIGNMENT_CREATE_ERROR', conflict: err.conflict || null });
  }
});

router.post('/admin/marketing/banners/:bannerId/assignments/bulk', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const assignments = bannerAssignmentService.createAssignmentsBulk({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actor,
      branchIds: req.body && req.body.branch_ids,
      placement: req.body && req.body.placement,
      position: req.body && req.body.position,
      active: req.body && req.body.active !== undefined ? req.body.active : true,
      startsAtLocal: req.body && (req.body.starts_at_local || req.body.startsAtLocal),
      endsAtLocal: req.body && (req.body.ends_at_local || req.body.endsAtLocal),
      governanceLocked: req.body && req.body.governance_locked
    });

    res.status(201).json({
      success: true,
      assignments: assignments.map(item => bannerAssignmentDtoForResponse(req.brand_id, item))
    });
  } catch (err) {
    const status = err.code === 'BANNER_POSITION_CONFLICT' ? 409
      : ['BRANCH_NOT_FOUND', 'BANNER_NOT_FOUND'].includes(err.code) ? 404
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'ASSIGNMENT_BULK_ERROR', conflict: err.conflict || null });
  }
});

router.patch('/admin/marketing/banners/:bannerId/assignments/:assignmentId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const current = bannerAssignmentService.getBannerAssignment(req.brand_id, req.params.assignmentId);
    if (current.banner_id !== req.params.bannerId) {
      return res.status(404).json({ success: false, error: 'Banner Assignment tidak ditemukan.', code: 'ASSIGNMENT_NOT_FOUND' });
    }

    const assignment = bannerAssignmentService.updateAssignment({
      brandId: req.brand_id,
      assignmentId: req.params.assignmentId,
      actor,
      position: req.body && req.body.position !== undefined ? req.body.position : null,
      active: req.body && req.body.active !== undefined ? req.body.active : null,
      startsAtLocal: req.body && (req.body.starts_at_local !== undefined ? req.body.starts_at_local : undefined),
      endsAtLocal: req.body && (req.body.ends_at_local !== undefined ? req.body.ends_at_local : undefined),
      governanceLocked: req.body && req.body.governance_locked !== undefined ? req.body.governance_locked : null
    });
    res.json({ success: true, assignment: bannerAssignmentDtoForResponse(req.brand_id, assignment) });
  } catch (err) {
    const status = err.code === 'BANNER_POSITION_CONFLICT' ? 409
      : err.code === 'ASSIGNMENT_NOT_FOUND' ? 404
      : err.code === 'ASSIGNMENT_GOVERNANCE_LOCKED' ? 403
      : err.code && String(err.code).indexOf('FORBIDDEN') === 0 ? 403
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'ASSIGNMENT_UPDATE_ERROR', conflict: err.conflict || null });
  }
});

router.delete('/admin/marketing/banners/:bannerId/assignments/:assignmentId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const current = bannerAssignmentService.getBannerAssignment(req.brand_id, req.params.assignmentId);
    if (current.banner_id !== req.params.bannerId) {
      return res.status(404).json({ success: false, error: 'Banner Assignment tidak ditemukan.', code: 'ASSIGNMENT_NOT_FOUND' });
    }
    const result = bannerAssignmentService.deleteAssignment({
      brandId: req.brand_id,
      assignmentId: req.params.assignmentId,
      actor
    });
    res.json(result);
  } catch (err) {
    const status = err.code === 'ASSIGNMENT_NOT_FOUND' ? 404
      : err.code === 'ASSIGNMENT_GOVERNANCE_LOCKED' ? 403
      : err.code && String(err.code).indexOf('FORBIDDEN') === 0 ? 403
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'ASSIGNMENT_DELETE_ERROR' });
  }
});

// Helper kept local to the API boundary for response consistency.

function bannerAssignmentDtoForResponse(brandId, assignment) {
  const row = bannerAssignmentService.getBannerAssignment(brandId, assignment.id);
  const published = row.banner_publication_status === 'PUBLISHED';
  return {
    id: row.id,
    banner_id: row.banner_id,
    branch_id: row.branch_id,
    branch_name: row.branch_name,
    branch_timezone: row.branch_timezone || 'Asia/Jakarta',
    placement: row.placement,
    position: Number(row.position),
    active: Number(row.active) === 1,
    starts_at: row.starts_at || null,
    ends_at: row.ends_at || null,
    timezone: row.branch_timezone || row.timezone || 'Asia/Jakarta',
    governance_locked: Number(row.governance_locked) === 1,
    effective_status: require('../../domains/banner/services/BannerDateTime').effectiveStatus({
      published: published,
      active: Number(row.active) === 1,
      startsAt: row.starts_at,
      endsAt: row.ends_at
    })
  };
}
};
