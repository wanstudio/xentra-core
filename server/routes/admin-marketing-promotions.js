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
    corePromotionRepo,
    mediaService,
    bannerMediaDelivery
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

  // 6. Marketing Promotions List API
  router.get('/admin/marketing/promotions', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
    try {
      const isBM = req.user.role === 'branch_manager';
      const effectiveBranchId = isBM ? (req.user.branch_id || req.user.branchId) : null;
      const promotions = corePromotionRepo.findAllPromotions(req.brand_id, effectiveBranchId);
      const enrichedPromotions = promotions.map(p => {
        const rewards = (p.rewards || []).map(r => {
          let pres = {};
          if (r.presentation_payload) {
            try {
              pres = typeof r.presentation_payload === 'string'
                ? JSON.parse(r.presentation_payload)
                : r.presentation_payload;
            } catch (_) {}
          }
          let delivery = null;
          if (pres.media_id) {
            delivery = bannerMediaDelivery(req.brand_id, pres.media_id);
          }
          return {
            ...r,
            presentation: pres,
            presentation_delivery: delivery
          };
        });
        return {
          ...p,
          rewards
        };
      });
      res.json({
        success: true,
        promotions: enrichedPromotions,
        total: enrichedPromotions.length
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

router.post('/admin/marketing/promotions', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const {
      id,
      name,
      code,
      capability_type,
      stacking_policy,
      priority_weight,
      max_redemptions_total,
      max_redemptions_per_customer,
      start_at,
      end_at,
      is_active,
      rules,
      rewards,
      branch_ids
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Nama promosi wajib diisi.' });
    }

    if (start_at && end_at) {
      const sTime = new Date(start_at).getTime();
      const eTime = new Date(end_at).getTime();
      if (eTime < sTime) {
        return res.status(400).json({ success: false, error: 'Tanggal berakhir promosi tidak boleh lebih awal dari tanggal mulai.' });
      }
    }

    const safeBranchIds = Array.isArray(branch_ids) ? branch_ids : [];
    if (safeBranchIds.length > 0) {
      const placeholders = safeBranchIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT id FROM branches WHERE brand_id = ? AND id IN (${placeholders})`).all(req.brand_id, ...safeBranchIds);
      if (rows.length !== safeBranchIds.length) {
        return res.status(403).json({
          success: false,
          error: 'Satu atau lebih cabang tidak valid atau bukan milik brand ini.'
        });
      }
    }

    if (Array.isArray(rewards) && rewards.length > 0) {
      for (const rw of rewards) {
        if (rw.target_product_id) {
          const prod = db.prepare('SELECT id FROM products WHERE id = ? AND brand_id = ?').get(rw.target_product_id, req.brand_id);
          if (!prod) {
            return res.status(400).json({
              success: false,
              error: 'Produk reward tidak valid atau bukan milik brand ini.'
            });
          }
        }
      }
    }

    const created = corePromotionRepo.createPromotion({
      id,
      brandId: req.brand_id,
      name: name.trim(),
      code: code ? code.trim().toUpperCase() : null,
      capabilityType: capability_type || 'install_incentive',
      stackingPolicy: stacking_policy || 'exclusive',
      priorityWeight: priority_weight !== undefined ? Number(priority_weight) : 100,
      maxRedemptionsTotal: max_redemptions_total ? Number(max_redemptions_total) : null,
      maxRedemptionsPerCustomer: max_redemptions_per_customer !== undefined ? Number(max_redemptions_per_customer) : 1,
      startAt: start_at || null,
      endAt: end_at || null,
      isActive: is_active !== undefined ? (is_active ? 1 : 0) : 1,
      rules: Array.isArray(rules) ? rules : [],
      rewards: Array.isArray(rewards) ? rewards : [],
      branchIds: safeBranchIds
    });

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_CREATED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: {
        promotion_id: created.id,
        name: created.name,
        branch_ids: safeBranchIds
      }
    });

    res.status(201).json({
      success: true,
      promotion: created
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.02 Update Marketing Promotion (Owner / Brand Manager)
router.put('/admin/marketing/promotions/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const existing = corePromotionRepo.findPromotion(promotionId);
    if (!existing || existing.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    const {
      name,
      code,
      capability_type,
      stacking_policy,
      priority_weight,
      max_redemptions_total,
      max_redemptions_per_customer,
      start_at,
      end_at,
      is_active,
      rules,
      rewards,
      branch_ids
    } = req.body;

    const effectiveStartAt = start_at !== undefined ? start_at : existing.start_at;
    const effectiveEndAt = end_at !== undefined ? end_at : existing.end_at;
    if (effectiveStartAt && effectiveEndAt) {
      const sTime = new Date(effectiveStartAt).getTime();
      const eTime = new Date(effectiveEndAt).getTime();
      if (eTime < sTime) {
        return res.status(400).json({ success: false, error: 'Tanggal berakhir promosi tidak boleh lebih awal dari tanggal mulai.' });
      }
    }

    if (Array.isArray(branch_ids) && branch_ids.length > 0) {
      const placeholders = branch_ids.map(() => '?').join(',');
      const rows = db.prepare(`SELECT id FROM branches WHERE brand_id = ? AND id IN (${placeholders})`).all(req.brand_id, ...branch_ids);
      if (rows.length !== branch_ids.length) {
        return res.status(403).json({
          success: false,
          error: 'Satu atau lebih cabang tidak valid atau bukan milik brand ini.'
        });
      }
    }

    if (Array.isArray(rewards) && rewards.length > 0) {
      for (const rw of rewards) {
        if (rw.target_product_id) {
          const prod = db.prepare('SELECT id FROM products WHERE id = ? AND brand_id = ?').get(rw.target_product_id, req.brand_id);
          if (!prod) {
            return res.status(400).json({
              success: false,
              error: 'Produk reward tidak valid atau bukan milik brand ini.'
            });
          }
        }
      }
    }

    const updated = corePromotionRepo.updatePromotion(promotionId, req.brand_id, {
      name: name !== undefined ? name.trim() : undefined,
      code: code !== undefined ? (code ? code.trim().toUpperCase() : null) : undefined,
      stackingPolicy: stacking_policy,
      priorityWeight: priority_weight,
      maxRedemptionsTotal: max_redemptions_total !== undefined ? (max_redemptions_total ? Number(max_redemptions_total) : null) : undefined,
      maxRedemptionsPerCustomer: max_redemptions_per_customer !== undefined ? (max_redemptions_per_customer ? Number(max_redemptions_per_customer) : null) : undefined,
      startAt: start_at,
      endAt: end_at,
      isActive: is_active !== undefined ? (is_active ? 1 : 0) : undefined,
      rules,
      rewards,
      branchIds: branch_ids
    });

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_UPDATED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: {
        promotion_id: promotionId,
        is_active: is_active !== undefined ? (is_active ? 1 : 0) : undefined
      }
    });

    const enrichedUpdated = {
      ...updated,
      rewards: (updated.rewards || []).map(r => {
        let pres = {};
        if (r.presentation_payload) {
          try {
            pres = typeof r.presentation_payload === 'string'
              ? JSON.parse(r.presentation_payload)
              : r.presentation_payload;
          } catch (_) {}
        }
        let delivery = null;
        if (pres.media_id) {
          delivery = bannerMediaDelivery(req.brand_id, pres.media_id);
        }
        return {
          ...r,
          presentation: pres,
          presentation_delivery: delivery
        };
      })
    };

    res.json({
      success: true,
      promotion: enrichedUpdated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.02b Update Promotion Presentation Payload specifically (Owner / Brand Manager)
router.patch('/admin/marketing/promotions/:id/presentation', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const existing = corePromotionRepo.findPromotion(promotionId);
    if (!existing || existing.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    const {
      banner_title,
      banner_subtitle,
      reward_title,
      reward_badge_text,
      cta_text,
      media_id,
      icon_url
    } = req.body || {};

    const presentationUpdates = {};

    if (banner_title !== undefined) {
      presentationUpdates.banner_title = typeof banner_title === 'string' ? banner_title.trim() : '';
    }
    if (banner_subtitle !== undefined) {
      presentationUpdates.banner_subtitle = typeof banner_subtitle === 'string' ? banner_subtitle.trim() : '';
    }
    if (cta_text !== undefined) {
      presentationUpdates.cta_text = typeof cta_text === 'string' ? cta_text.trim() : '';
    }
    if (reward_title !== undefined) {
      presentationUpdates.reward_title = typeof reward_title === 'string' ? reward_title.trim() : '';
    }
    if (reward_badge_text !== undefined) {
      presentationUpdates.reward_badge_text = typeof reward_badge_text === 'string' ? reward_badge_text.trim() : '';
    }

    // Media verification if media_id is provided
    if (media_id !== undefined) {
      if (media_id) {
        let asset = null;
        try {
          asset = mediaService.getMedia({ mediaId: media_id, brandId: req.brand_id });
        } catch (mediaErr) {
          const status = mediaErr.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
          return res.status(status).json({
            success: false,
            error: mediaErr.message || 'Aset media tidak valid.',
            code: mediaErr.code || 'MEDIA_ERROR'
          });
        }

        if (asset.status !== 'ready') {
          return res.status(400).json({
            success: false,
            error: 'Aset media belum selesai diproses (status harus READY).',
            code: 'MEDIA_NOT_READY'
          });
        }

        presentationUpdates.media_id = media_id;
        presentationUpdates.icon_url = asset.url;
      } else {
        presentationUpdates.media_id = null;
        presentationUpdates.icon_url = icon_url || null;
      }
    } else if (icon_url !== undefined) {
      presentationUpdates.icon_url = icon_url;
    }

    const updated = corePromotionRepo.updatePresentationPayload(promotionId, req.brand_id, presentationUpdates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Gagal memperbarui presentasi promosi.' });
    }

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_PRESENTATION_UPDATED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: {
        promotion_id: promotionId,
        presentation_keys: Object.keys(presentationUpdates)
      }
    });

    const enrichedUpdated = {
      ...updated,
      rewards: (updated.rewards || []).map(r => {
        let pres = {};
        if (r.presentation_payload) {
          try {
            pres = typeof r.presentation_payload === 'string'
              ? JSON.parse(r.presentation_payload)
              : r.presentation_payload;
          } catch (_) {}
        }
        let delivery = null;
        if (pres.media_id) {
          delivery = bannerMediaDelivery(req.brand_id, pres.media_id);
        }
        return {
          ...r,
          presentation: pres,
          presentation_delivery: delivery
        };
      })
    };

    res.json({
      success: true,
      promotion: enrichedUpdated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.03 Delete / Deactivate Marketing Promotion (Owner / Brand Manager)
router.delete('/admin/marketing/promotions/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const existing = corePromotionRepo.findPromotion(promotionId);
    if (!existing || existing.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    // Safety Audit: block hard delete if redemptions exist to preserve immutable audit trail
    const redemptionRow = db.prepare('SELECT COUNT(*) as count FROM promotion_redemptions WHERE promotion_id = ?').get(promotionId);
    if (redemptionRow && Number(redemptionRow.count) > 0) {
      return res.status(409).json({
        success: false,
        error: 'Promosi tidak dapat dihapus karena memiliki riwayat penebusan pesanan. Silakan nonaktifkan promosi sebagai gantinya.'
      });
    }

    corePromotionRepo.deletePromotion(promotionId, req.brand_id);

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_DELETED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: { promotion_id: promotionId, name: existing.name }
    });

    res.json({
      success: true,
      message: 'Promosi berhasil dihapus.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.1 Assign/Update Branch Scopes for Promotion (Owner / Brand Manager only)
router.post('/admin/marketing/promotions/:id/scopes', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const { branch_ids, is_active = 1 } = req.body;

    if (!Array.isArray(branch_ids) || branch_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'branch_ids must be a non-empty array.' });
    }

    const promo = corePromotionRepo.findPromotion(promotionId);
    if (!promo || promo.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    // Strict validation: every branch_id must belong to req.brand_id
    const placeholders = branch_ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id FROM branches WHERE brand_id = ? AND id IN (${placeholders})`).all(req.brand_id, ...branch_ids);
    if (rows.length !== branch_ids.length) {
      return res.status(403).json({
        success: false,
        error: 'Satu atau lebih cabang tidak valid atau bukan milik brand ini.'
      });
    }

    for (const branchId of branch_ids) {
      corePromotionRepo.assignBranchScope({
        promotionId,
        brandId: req.brand_id,
        branchId,
        isActive: is_active
      });
    }

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_SCOPE_ASSIGNED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: { promotion_id: promotionId, branch_ids, is_active }
    });

    const scopes = corePromotionRepo.findBranchScopes(promotionId);
    res.json({
      success: true,
      promotion_id: promotionId,
      scopes
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.2 Toggle Promotion Branch Activation (BM can only modify their own assigned branch; Owner/Brand Manager can modify any branch)
router.patch('/admin/marketing/promotions/:id/branch-activation', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const { is_active } = req.body;
    let targetBranchId = req.body.branch_id;

    const promo = corePromotionRepo.findPromotion(promotionId);
    if (!promo || promo.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    if (req.user.role === 'branch_manager') {
      const userBranchId = req.user.branch_id || req.user.branchId;
      if (!userBranchId) {
        return res.status(403).json({ success: false, error: 'Branch Manager must be assigned to a branch.' });
      }
      if (targetBranchId && String(targetBranchId) !== String(userBranchId)) {
        return res.status(403).json({ success: false, error: 'Branch Manager cannot modify promotions for other branches.' });
      }
      targetBranchId = userBranchId;
    }

    if (!targetBranchId) {
      return res.status(400).json({ success: false, error: 'branch_id is required.' });
    }

    // Verify target branch belongs to caller's brand
    const branchRecord = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(targetBranchId, req.brand_id);
    if (!branchRecord) {
      return res.status(403).json({ success: false, error: 'Cabang bukan milik brand ini.' });
    }

    const existingScope = corePromotionRepo.findBranchScope(promotionId, targetBranchId);
    if (!existingScope) {
      return res.status(404).json({ success: false, error: 'Promotion is not scoped to this branch.' });
    }

    const newActiveState = (is_active === 1 || is_active === true) ? 1 : 0;

    // Prerequisite validation when activating: reward products must be available in target branch catalog
    if (newActiveState === 1) {
      const rewards = corePromotionRepo.findRewards(promotionId);
      for (const reward of rewards) {
        if (reward.reward_type === 'freebie_product' || reward.target_product_id) {
          const targetPid = reward.target_product_id;
          if (!targetPid) {
            return res.status(422).json({
              success: false,
              error: 'Promo belum dapat diaktifkan karena definisi produk hadiah tidak valid.'
            });
          }

          const product = db.prepare('SELECT id, name, brand_id, is_active FROM products WHERE id = ? AND brand_id = ?').get(targetPid, req.brand_id);
          if (!product || product.is_active === 0) {
            const prodName = product?.name || `ID ${targetPid}`;
            return res.status(422).json({
              success: false,
              error: `Promo belum dapat diaktifkan karena produk hadiah '${prodName}' belum tersedia di katalog brand ini.`
            });
          }

          const bp = db.prepare('SELECT is_available, stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(targetBranchId, targetPid);
          if (!bp) {
            return res.status(422).json({
              success: false,
              error: `Promo belum dapat diaktifkan karena produk hadiah '${product.name}' belum tersedia di katalog cabang ini.`
            });
          }

          if (bp.is_available !== 1) {
            return res.status(422).json({
              success: false,
              error: `Promo belum dapat diaktifkan karena produk hadiah '${product.name}' sedang dinonaktifkan di cabang ini.`
            });
          }
        }
      }
    }

    corePromotionRepo.setBranchScopeActivation({
      promotionId,
      branchId: targetBranchId,
      isActive: newActiveState
    });

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_BRANCH_ACTIVATED',
      brand_id: req.brand_id,
      branch_id: targetBranchId,
      result: 'SUCCESS',
      metadata: { promotion_id: promotionId, is_active: newActiveState }
    });

    res.json({
      success: true,
      promotion_id: promotionId,
      branch_id: targetBranchId,
      is_active: newActiveState
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Marketing Promotion Redemptions API
router.get('/admin/marketing/redemptions', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id, promotion_id, limit, offset } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const result = corePromotionRepo.findPromotionRedemptions({
      brandId: req.brand_id,
      branchId: effectiveBranchId,
      promotionId: promotion_id || null,
      limit,
      offset
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// DINE-IN TABLE FLOOR PLAN & OPERATIONAL DOMAIN APIS
// =========================================================================
const { DiningTableService, TableRecommendationService } = require('../../domains/dining');

// Customer / Public / Staff: Get Branch Floor Plan & Operational Table State
};
