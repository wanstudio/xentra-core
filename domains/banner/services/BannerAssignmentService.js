'use strict';

const crypto = require('crypto');
const BannerAssignment = require('../domain/BannerAssignment');
const BannerDateTime = require('./BannerDateTime');
const BannerAssignmentRepository = require('../../../core/data/repositories/BannerAssignmentRepository');

class BannerAssignmentService {
  constructor({ repository = new BannerAssignmentRepository() } = {}) {
    this.repository = repository;
  }

  static createId() {
    return 'bna_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
  }

  actorBranchId(actor) {
    return actor ? String(actor.branch_id || actor.branchId || actor.branch_id) || null : null;
  }

  assertActorBranchScope(actor, branchId) {
    if (!actor || !actor.role) {
      const err = new Error('Authenticated actor is required.');
      err.code = 'ACTOR_REQUIRED';
      throw err;
    }

    if (actor.role === 'branch_manager') {
      const actorBranch = this.actorBranchId(actor);
      if (!actorBranch || String(actorBranch) !== String(branchId)) {
        const err = new Error('Branch Manager hanya dapat mengelola Banner Assignment pada cabangnya sendiri.');
        err.code = 'FORBIDDEN_BRANCH_SCOPE';
        throw err;
      }
    }
  }

  assertAuthorizedBranch(brandId, branchId, actor) {
    if (!branchId) {
      const err = new Error('branch_id wajib diisi.');
      err.code = 'BRANCH_REQUIRED';
      throw err;
    }

    this.assertActorBranchScope(actor, branchId);
    const branch = this.repository.findBranch(brandId, branchId);
    if (!branch || branch.is_active !== 1 || branch.is_archived === 1) {
      const err = new Error('Branch tidak ditemukan atau tidak aktif.');
      err.code = 'BRANCH_NOT_FOUND';
      throw err;
    }
    return branch;
  }

  normalizePlacement(placement) {
    const value = String(placement || BannerAssignment.DEFAULT_PLACEMENT).toUpperCase();
    if (value !== BannerAssignment.DEFAULT_PLACEMENT) {
      const err = new Error('Placement banner tidak didukung.');
      err.code = 'INVALID_PLACEMENT';
      throw err;
    }
    return value;
  }

  normalizePosition(position) {
    const n = Number(position);
    if (!Number.isInteger(n) || n < 1) {
      const err = new Error('Position banner harus berupa bilangan bulat >= 1.');
      err.code = 'INVALID_POSITION';
      throw err;
    }
    return n;
  }

  normalizeWindow({ startsAtLocal = null, endsAtLocal = null, timezone }) {
    if (endsAtLocal && !startsAtLocal) {
      const err = new Error('ends_at hanya boleh diisi jika schedule memiliki starts_at.');
      err.code = 'SCHEDULE_START_REQUIRED';
      throw err;
    }

    if (!startsAtLocal && !endsAtLocal) {
      return {
        startsAt: null,
        endsAt: null,
        timezone: BannerDateTime.assertValidTimeZone(timezone)
      };
    }

    const tz = BannerDateTime.assertValidTimeZone(timezone);
    const startsAt = startsAtLocal ? BannerDateTime.localToUtcIso(startsAtLocal, tz) : null;
    const endsAt = endsAtLocal ? BannerDateTime.localToUtcIso(endsAtLocal, tz) : null;

    if (endsAt && startsAt && BannerDateTime.compareUtc(endsAt, startsAt) <= 0) {
      const err = new Error('ends_at harus lebih besar dari starts_at.');
      err.code = 'INVALID_SCHEDULE_WINDOW';
      throw err;
    }

    return { startsAt, endsAt, timezone: tz };
  }

  assertPublishedConflict({
    brandId,
    branchId,
    placement,
    position,
    startsAt,
    endsAt,
    excludeAssignmentId = null,
    bannerIsPublished = true
  }) {
    if (!bannerIsPublished) return null;

    const conflict = this.repository.findConflict({
      brandId,
      branchId,
      placement,
      position,
      startsAt,
      endsAt,
      excludeAssignmentId,
      requirePublished: true
    });

    if (conflict) {
      const err = new Error('Posisi banner pada Branch tersebut bentrok dengan Banner lain pada visibility window yang overlap.');
      err.code = 'BANNER_POSITION_CONFLICT';
      err.assignment_id = conflict.id;
      err.conflict = conflict;
      throw err;
    }

    return null;
  }

  getBannerAssignment(brandId, assignmentId) {
    const result = this.repository.findById(brandId, assignmentId);
    if (!result) {
      const err = new Error('Banner Assignment tidak ditemukan.');
      err.code = 'ASSIGNMENT_NOT_FOUND';
      throw err;
    }
    return result;
  }

  createAssignment({
    brandId,
    bannerId,
    actor,
    branchId,
    placement = BannerAssignment.DEFAULT_PLACEMENT,
    position = 1,
    active = true,
    startsAtLocal = null,
    endsAtLocal = null,
    governanceLocked = false
  }) {
    const branch = this.assertAuthorizedBranch(brandId, branchId, actor);
    const normalizedPlacement = this.normalizePlacement(placement);
    const normalizedPosition = this.normalizePosition(position);
    const window = this.normalizeWindow({
      startsAtLocal,
      endsAtLocal,
      timezone: branch.timezone || 'Asia/Jakarta'
    });

    const assignmentId = BannerAssignmentService.createId();
    const createdBy = actor && (actor.userId || actor.id);
    const effectiveGovernanceLocked = actor && actor.role === 'branch_manager'
      ? false
      : Boolean(governanceLocked);

    const bannerPublished = this.repository.db.queryOne(
      `SELECT sb.publication_status, EXISTS (
        SELECT 1 FROM storefront_banner_revisions r
        WHERE r.banner_id = sb.id AND r.revision_status = 'PUBLISHED'
      ) AS has_published_revision
       FROM storefront_banners sb
       WHERE sb.id = ? AND sb.brand_id = ? LIMIT 1`,
      [bannerId, brandId]
    );
    if (!bannerPublished) {
      const err = new Error('Banner tidak ditemukan.');
      err.code = 'BANNER_NOT_FOUND';
      throw err;
    }

    const isPublished = bannerPublished.publication_status === 'PUBLISHED' && Number(bannerPublished.has_published_revision) === 1;
    this.repository.beginTransaction();
    try {
      if (active && isPublished) {
        this.assertPublishedConflict({
          brandId,
          branchId,
          placement: normalizedPlacement,
          position: normalizedPosition,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          bannerIsPublished: true
        });
      }

      this.repository.createAssignment({
        id: assignmentId,
        bannerId,
        brandId,
        branchId,
        placement: normalizedPlacement,
        position: normalizedPosition,
        active,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        timezone: branch.timezone || 'Asia/Jakarta',
        governanceLocked: effectiveGovernanceLocked,
        createdBy,
        updatedBy: createdBy
      });
      this.writeOperationalAudit({
        brandId,
        branch,
        actor,
        assignmentId,
        action: 'banner_assignment.create',
        previousValue: null,
        newValue: {
          banner_id: bannerId,
          placement: normalizedPlacement,
          position: normalizedPosition,
          active: Boolean(active),
          starts_at: window.startsAt,
          ends_at: window.endsAt,
          governance_locked: effectiveGovernanceLocked
        }
      });

      this.repository.commitTransaction();
    } catch (err) {
      try { this.repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    return this.getBannerAssignment(brandId, assignmentId);
  }

  createAssignmentsBulk({
    brandId,
    bannerId,
    actor,
    branchIds,
    placement = BannerAssignment.DEFAULT_PLACEMENT,
    position = 1,
    active = true,
    startsAtLocal = null,
    endsAtLocal = null,
    governanceLocked = false
  }) {
    if (!Array.isArray(branchIds) || branchIds.length === 0) {
      const err = new Error('Minimal satu Branch harus dipilih.');
      err.code = 'BRANCH_REQUIRED';
      throw err;
    }

    const uniqueBranchIds = [...new Set(branchIds.map(id => String(id).trim()).filter(Boolean))];
    if (uniqueBranchIds.length === 0) {
      const err = new Error('Branch selection tidak valid.');
      err.code = 'BRANCH_REQUIRED';
      throw err;
    }

    const normalizedPlacement = this.normalizePlacement(placement);
    const normalizedPosition = this.normalizePosition(position);
    const createdBy = actor && (actor.userId || actor.id);
    const assignments = [];

    this.repository.beginTransaction();
    try {
      for (const branchId of uniqueBranchIds) {
        const branch = this.assertAuthorizedBranch(brandId, branchId, actor);
        const window = this.normalizeWindow({
          startsAtLocal,
          endsAtLocal,
          timezone: branch.timezone || 'Asia/Jakarta'
        });

        const bannerPublished = this.repository.db.queryOne(
          `SELECT sb.publication_status, EXISTS (
            SELECT 1 FROM storefront_banner_revisions r
            WHERE r.banner_id = sb.id AND r.revision_status = 'PUBLISHED'
          ) AS has_published_revision
           FROM storefront_banners sb
           WHERE sb.id = ? AND sb.brand_id = ? LIMIT 1`,
          [bannerId, brandId]
        );
        if (!bannerPublished) {
          const err = new Error('Banner tidak ditemukan.');
          err.code = 'BANNER_NOT_FOUND';
          throw err;
        }

        const isPublished = bannerPublished.publication_status === 'PUBLISHED' && Number(bannerPublished.has_published_revision) === 1;
        if (active && isPublished) {
          this.assertPublishedConflict({
            brandId,
            branchId,
            placement: normalizedPlacement,
            position: normalizedPosition,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            bannerIsPublished: true
          });
        }

        const assignmentId = BannerAssignmentService.createId();
        this.repository.createAssignment({
          id: assignmentId,
          bannerId,
          brandId,
          branchId,
          placement: normalizedPlacement,
          position: normalizedPosition,
          active,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          timezone: branch.timezone || 'Asia/Jakarta',
            governanceLocked: Boolean(governanceLocked),
          createdBy,
          updatedBy: createdBy
        });
        this.writeOperationalAudit({
          brandId,
          branch,
          actor,
          assignmentId,
          action: 'banner_assignment.create',
          previousValue: null,
          newValue: { banner_id: bannerId, placement: normalizedPlacement, position: normalizedPosition, active: Boolean(active), starts_at: window.startsAt, ends_at: window.endsAt, governance_locked: Boolean(governanceLocked) }
        });
        assignments.push(this.getBannerAssignment(brandId, assignmentId));
      }

      this.repository.commitTransaction();
    } catch (err) {
      try { this.repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    return assignments;
  }

  updateAssignment({
    brandId,
    assignmentId,
    actor,
    position = null,
    active = null,
    startsAtLocal,
    endsAtLocal,
    governanceLocked = null
  }) {
    const current = this.getBannerAssignment(brandId, assignmentId);
    this.assertActorBranchScope(actor, current.branch_id);

    if (actor.role === 'branch_manager' && Number(current.governance_locked) === 1) {
      const err = new Error('Banner Assignment dikunci Owner dan tidak dapat diubah oleh Branch Manager.');
      err.code = 'ASSIGNMENT_GOVERNANCE_LOCKED';
      throw err;
    }

    const branch = this.assertAuthorizedBranch(brandId, current.branch_id, actor);
    const normalizedPosition = position === null || position === undefined
      ? Number(current.position)
      : this.normalizePosition(position);

    const useExistingWindow = startsAtLocal === undefined && endsAtLocal === undefined;
    let window;
    if (useExistingWindow) {
      window = { startsAt: current.starts_at, endsAt: current.ends_at, timezone: branch.timezone || 'Asia/Jakarta' };
    } else {
      window = this.normalizeWindow({
        startsAtLocal: startsAtLocal || null,
        endsAtLocal: endsAtLocal || null,
        timezone: branch.timezone || 'Asia/Jakarta'
      });
    }

    const effectiveActive = active === null || active === undefined ? Boolean(current.active) : Boolean(active);
    const bannerPublished = this.repository.db.queryOne(
      `SELECT publication_status, EXISTS (
        SELECT 1 FROM storefront_banner_revisions r
        WHERE r.banner_id = ? AND r.revision_status = 'PUBLISHED'
      ) AS has_published_revision
       FROM storefront_banners
       WHERE id = ? AND brand_id = ? LIMIT 1`,
      [current.banner_id, current.banner_id, brandId]
    );
    const isPublished = bannerPublished && bannerPublished.publication_status === 'PUBLISHED' && Number(bannerPublished.has_published_revision) === 1;

    const updaterId = actor && (actor.userId || actor.id);
    let nextLocked = governanceLocked;
    if (actor.role === 'branch_manager') {
      nextLocked = null;
    }

    const previousValue = {
      position: Number(current.position),
      active: Number(current.active) === 1,
      starts_at: current.starts_at,
      ends_at: current.ends_at,
      governance_locked: Number(current.governance_locked) === 1
    };

    this.repository.beginTransaction();
    try {
      if (effectiveActive && isPublished) {
        this.assertPublishedConflict({
          brandId,
          branchId: current.branch_id,
          placement: current.placement,
          position: normalizedPosition,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          excludeAssignmentId: assignmentId,
          bannerIsPublished: true
        });
      }

      this.repository.updateAssignment({
        brandId,
        assignmentId,
        position: normalizedPosition,
        active: effectiveActive,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        timezone: branch.timezone || 'Asia/Jakarta',
        governanceLocked: nextLocked,
        updatedBy: updaterId
      });

      const updatedAssignment = this.getBannerAssignment(brandId, assignmentId);
      this.writeOperationalAudit({
        brandId,
        branch,
        actor,
        assignmentId,
        action: 'banner_assignment.update',
        previousValue,
        newValue: {
          position: Number(updatedAssignment.position),
          active: Number(updatedAssignment.active) === 1,
          starts_at: updatedAssignment.starts_at,
          ends_at: updatedAssignment.ends_at,
          governance_locked: Number(updatedAssignment.governance_locked) === 1
        }
      });

      this.repository.commitTransaction();
      return updatedAssignment;
    } catch (err) {
      try { this.repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }
  }

  deleteAssignment({ brandId, assignmentId, actor }) {
    const current = this.getBannerAssignment(brandId, assignmentId);
    this.assertActorBranchScope(actor, current.branch_id);
    if (actor.role === 'branch_manager' && Number(current.governance_locked) === 1) {
      const err = new Error('Banner Assignment dikunci Owner dan tidak dapat dihapus oleh Branch Manager.');
      err.code = 'ASSIGNMENT_GOVERNANCE_LOCKED';
      throw err;
    }

    const branch = this.repository.findBranch(brandId, current.branch_id);
    this.repository.beginTransaction();
    try {
      this.repository.deleteAssignment(brandId, assignmentId);
      this.writeOperationalAudit({
        brandId,
        branch,
        actor,
        assignmentId,
        action: 'banner_assignment.delete',
        previousValue: {
          banner_id: current.banner_id,
          position: Number(current.position),
          active: Number(current.active) === 1,
          starts_at: current.starts_at,
          ends_at: current.ends_at,
          governance_locked: Number(current.governance_locked) === 1
        },
        newValue: null
      });
      this.repository.commitTransaction();
    } catch (err) {
      try { this.repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }
    return { success: true, assignment_id: assignmentId };
  }

  listAssignments({ brandId, branchId = null, actor }) {
    let effectiveBranchId = branchId || null;
    if (actor && actor.role === 'branch_manager') {
      effectiveBranchId = this.actorBranchId(actor);
    }

    if (effectiveBranchId) {
      this.assertAuthorizedBranch(brandId, effectiveBranchId, actor);
    }

    return this.repository.listForBrand(brandId, { branchId: effectiveBranchId });
  }

  listCustomerBanners({ brandId, branchId }) {
    const branch = this.repository.findBranch(brandId, branchId);
    if (!branch || branch.is_active !== 1 || branch.is_archived === 1) return [];

    const rows = this.repository.listByBranchForCustomer(brandId, branchId);
    return rows.map(row => ({
      id: row.banner_id,
      assignment_id: row.assignment_id,
      branch_id: row.branch_id,
      placement: row.placement,
      position: row.position,
      active: Boolean(row.active),
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      timezone: branch.timezone || row.timezone || 'Asia/Jakarta',
      publication_status: row.publication_status,
      revision_id: row.revision_id,
      title: row.title || '',
      alt_text: row.alt_text || '',
      media_id: row.media_id,
      cta_type: row.cta_type,
      cta_target_id: row.cta_target_id || null,
      cta_url: row.cta_url || null,
      promotion_id: row.promotion_id || null,
      effective_status: BannerDateTime.effectiveStatus({
        published: row.publication_status === 'PUBLISHED',
        active: Boolean(row.active),
        startsAt: row.starts_at,
        endsAt: row.ends_at
      })
    }));
  }
}

module.exports = BannerAssignmentService;
