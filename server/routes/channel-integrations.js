/**
 * XENTRA CORE — EXTERNAL CHANNELS API
 *
 * Exposes endpoints for:
 * 1. POST /api/v1/integrations/channel-order (Ingest order from GoFood/GrabFood/ShopeeFood)
 * 2. GET /api/v1/integrations/channel-summary (Financial & bookkeeping breakdown by channel)
 */
'use strict';

const ChannelOrderService = require('../../domains/commerce/services/ChannelOrderService');

module.exports = function registerChannelIntegrationRoutes(router, deps) {
  const { db, requireAuth } = deps;
  const channelService = new ChannelOrderService(db);

  /**
   * Ingest order from external food delivery app (via Notification Listener or Webhook)
   */
  router.post('/integrations/channel-order', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
    try {
      const {
        channel,
        external_order_id,
        branch_id,
        customer_name,
        customer_phone,
        driver_name,
        driver_phone,
        gross_amount,
        commission_rate,
        items,
        order_note,
        raw_payload
      } = req.body;

      const effectiveBrandId = req.brand_id || (req.user && req.user.brand_id);
      const effectiveBranchId = branch_id || (req.user && req.user.branchId) || (req.user && req.user.branch_id);

      if (!effectiveBranchId) {
        return res.status(400).json({
          success: false,
          error: 'Cabang (branch_id) tidak terdeteksi. Silakan tentukan cabang tujuan pesanan.'
        });
      }

      const result = channelService.ingestChannelOrder({
        channel,
        external_order_id,
        brand_id: effectiveBrandId,
        branch_id: effectiveBranchId,
        customer_name,
        customer_phone,
        driver_name,
        driver_phone,
        gross_amount,
        commission_rate,
        items,
        order_note,
        raw_payload
      });

      res.status(result.is_duplicate ? 200 : 201).json(result);
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err.message || 'Gagal memproses pesanan saluran eksternal.'
      });
    }
  });

  /**
   * Financial summary of orders per channel (GoFood, GrabFood, ShopeeFood)
   */
  router.get('/integrations/channel-summary', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
    try {
      const { branch_id, start_date, end_date } = req.query;
      const effectiveBrandId = req.brand_id || (req.user && req.user.brand_id);
      const effectiveBranchId = (req.user && ['branch_manager'].includes(req.user.role))
        ? (req.user.branchId || req.user.branch_id)
        : branch_id;

      const summary = channelService.getChannelFinancialSummary({
        brand_id: effectiveBrandId,
        branch_id: effectiveBranchId,
        start_date,
        end_date
      });

      res.json({
        success: true,
        data: summary
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

  /**
   * Get channel configuration (active status, commission rates, handling fees)
   */
  router.get('/integrations/channel-settings', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
    try {
      const { branch_id } = req.query;
      const effectiveBranchId = (req.user && ['branch_manager'].includes(req.user.role))
        ? (req.user.branchId || req.user.branch_id)
        : (branch_id || (req.user && (req.user.branchId || req.user.branch_id)));

      if (!effectiveBranchId) {
        return res.status(400).json({
          success: false,
          error: 'Parameter branch_id wajib disertakan.'
        });
      }

      const settings = channelService.getChannelSettings(effectiveBranchId);
      res.json({
        success: true,
        data: settings
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

  /**
   * Save channel configuration for a branch
   */
  router.post('/integrations/channel-settings', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
    try {
      const { branch_id, settings } = req.body;
      const effectiveBranchId = (req.user && ['branch_manager'].includes(req.user.role))
        ? (req.user.branchId || req.user.branch_id)
        : (branch_id || (req.user && (req.user.branchId || req.user.branch_id)));

      if (!effectiveBranchId) {
        return res.status(400).json({
          success: false,
          error: 'Cabang (branch_id) wajib ditentukan.'
        });
      }

      const updated = channelService.saveChannelSettings(effectiveBranchId, settings || []);
      res.json({
        success: true,
        message: 'Pengaturan saluran ojol berhasil disimpan.',
        data: updated
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err.message
      });
    }
  });

  /**
   * Detailed orders list for channel reconciliation table
   */
  router.get('/integrations/channel-orders', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
    try {
      const { branch_id, channel, start_date, end_date, limit, offset } = req.query;
      const effectiveBrandId = req.brand_id || (req.user && req.user.brand_id);
      const effectiveBranchId = (req.user && ['branch_manager'].includes(req.user.role))
        ? (req.user.branchId || req.user.branch_id)
        : branch_id;

      const orders = channelService.getChannelOrders({
        brand_id: effectiveBrandId,
        branch_id: effectiveBranchId,
        channel,
        start_date,
        end_date,
        limit,
        offset
      });

      res.json({
        success: true,
        data: orders
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });
};
