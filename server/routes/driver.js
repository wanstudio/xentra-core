
'use strict';

/**
 * XENTRA CORE — DRIVER PWA ROUTES
 *
 * Driver-facing API surface. The Driver is a branch-scoped workforce actor.
 * Delivery lifecycle authority remains inside DeliveryDispatchService.
 */
const DeliveryDispatchService = require('../../domains/delivery/services/DeliveryDispatchService');
const DeliveryModel = require('../../domains/delivery/models/DeliveryModel');

function registerDriverRoutes(router, deps = {}) {
  const { db, requireAuth } = deps;
  const driverAuth = requireAuth(['driver']);

  function actorId(req) {
    return req.user.userId || req.user.id;
  }

  function getBranchName(id) {
    if (!id) return null;
    const row = db.prepare('SELECT name FROM branches WHERE id = ?').get(id);
    return row ? row.name : null;
  }

  function getTask(orderId, driverId, brandId, driverBranchId) {
    const task = db.prepare(
      'SELECT ' +
      'd.id AS delivery_id, d.order_id, d.driver_id, d.driver_name, d.driver_phone, ' +
      'd.status AS delivery_status, d.driver_assignment_status, d.driver_assignment_responded_at, ' +
      'd.driver_assignment_rejection_reason, d.destination_address, d.destination_latitude, ' +
      'd.destination_longitude, d.actual_road_distance_meters, d.actual_duration_seconds, ' +
      'd.cod_collection_status, d.cod_cash_custody, d.cod_collected_amount, d.cod_amount_tendered, ' +
      'd.cod_change_given, d.cod_handed_over_at, d.cod_handed_over_to, ' +
      'd.created_at AS delivery_created_at, d.updated_at AS delivery_updated_at, ' +
      'o.order_number, o.status AS order_status, o.order_type, o.customer_id, o.customer_name, ' +
      'o.customer_phone, o.recipient_name, o.recipient_phone, o.grand_total, o.payment_method, ' +
      'o.branch_id, b.name AS branch_name ' +
      'FROM order_deliveries d ' +
      'JOIN orders o ON o.id = d.order_id ' +
      'LEFT JOIN branches b ON b.id = o.branch_id ' +
      'WHERE d.order_id = ? AND d.driver_id = ? AND o.brand_id = ? AND o.order_type = ? AND o.branch_id = ? ' +
      'LIMIT 1'
    ).get(orderId, driverId, brandId, 'delivery', driverBranchId);

    if (!task) return null;

    task.items = db.prepare(
      'SELECT id, product_name, quantity, unit_price, item_subtotal, note ' +
      'FROM order_items WHERE order_id = ? ORDER BY rowid ASC'
    ).all(orderId);

    task.item_count = task.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    task.customer_display_name = task.recipient_name || task.customer_name || 'Pelanggan';
    task.customer_display_phone = task.recipient_phone || task.customer_phone || '';

    return task;
  }

  function shapeTask(task) {
    if (!task) return null;
    return {
      delivery_id: task.delivery_id,
      order_id: task.order_id,
      order_number: task.order_number,
      delivery_status: task.delivery_status,
      assignment_status: task.driver_assignment_status || 'pending',
      order_status: task.order_status,
      customer: {
        id: task.customer_id || null,
        name: task.customer_display_name,
        phone: task.customer_display_phone
      },
      destination: {
        address: task.destination_address || '',
        latitude: task.destination_latitude !== null ? Number(task.destination_latitude) : null,
        longitude: task.destination_longitude !== null ? Number(task.destination_longitude) : null
      },
      pickup: {
        branch_id: task.branch_id,
        branch_name: task.branch_name || null
      },
      payment: {
        method: task.payment_method,
        is_cod: task.payment_method === 'cash',
        amount: Number(task.grand_total || 0),
        collection_status: task.cod_collection_status || 'pending',
        cash_custody: task.cod_cash_custody || null,
        collected_amount: task.cod_collected_amount !== null ? Number(task.cod_collected_amount) : null,
        amount_tendered: task.cod_amount_tendered !== null ? Number(task.cod_amount_tendered) : null,
        change_given: task.cod_change_given !== null ? Number(task.cod_change_given) : null,
        handed_over_at: task.cod_handed_over_at || null,
        handed_over_to: task.cod_handed_over_to || null
      },
      items: task.items,
      item_count: task.item_count,
      distance_meters: task.actual_road_distance_meters !== null ? Number(task.actual_road_distance_meters) : null,
      duration_seconds: task.actual_duration_seconds !== null ? Number(task.actual_duration_seconds) : null,
      created_at: task.delivery_created_at,
      updated_at: task.delivery_updated_at
    };
  }

  router.get('/driver/me', driverAuth, (req, res) => {
    try {
      const userId = actorId(req);
      const user = db.prepare(
        'SELECT id, username, email, full_name, role, status, brand_id, organization_id, branch_id, ' +
        'created_at, updated_at, last_login_at ' +
        'FROM users WHERE id = ? AND brand_id = ? AND role = ? LIMIT 1'
      ).get(userId, req.brand_id, 'driver');

      if (!user) {
        return res.status(404).json({
          success: false,
          code: 'DRIVER_NOT_FOUND',
          error: 'Data Driver tidak ditemukan untuk tenant ini.'
        });
      }

      if (!user.branch_id) {
        return res.status(403).json({
          success: false,
          code: 'DRIVER_BRANCH_REQUIRED',
          error: 'Akun Driver belum ditugaskan ke cabang.'
        });
      }

      const brand = db.prepare('SELECT id, name, logo_url FROM brands WHERE id = ?').get(req.brand_id);
      res.json({
        success: true,
        driver: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name || user.username,
          role: user.role,
          status: user.status,
          brand_id: user.brand_id,
          organization_id: user.organization_id,
          branch_id: user.branch_id,
          branch_name: getBranchName(user.branch_id)
        },
        brand: brand || null
      });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, code: err.code || 'DRIVER_PROFILE_ERROR', error: err.message });
    }
  });

  router.get('/driver/tasks', driverAuth, (req, res) => {
    try {
      const driverId = actorId(req);
      const rows = db.prepare(
        'SELECT d.order_id ' +
        'FROM order_deliveries d ' +
        'JOIN orders o ON o.id = d.order_id ' +
        'WHERE d.driver_id = ? AND o.brand_id = ? AND o.order_type = ? AND o.branch_id = ? ' +
        'AND d.status IN (?, ?, ?) ' +
        'ORDER BY CASE WHEN d.status = ? THEN 0 WHEN d.status = ? THEN 1 ELSE 2 END, ' +
        'datetime(d.updated_at) DESC, d.rowid DESC'
      ).all(
        driverId,
        req.brand_id,
        'delivery',
        req.user.branchId || req.user.branch_id,
        DeliveryModel.STATUS.ASSIGNED,
        DeliveryModel.STATUS.PICKED_UP,
        DeliveryModel.STATUS.ON_DELIVERY,
        DeliveryModel.STATUS.ON_DELIVERY,
        DeliveryModel.STATUS.PICKED_UP
      );

      const tasks = rows.map(row => shapeTask(getTask(row.order_id, driverId, req.brand_id))).filter(Boolean);
      res.json({
        success: true,
        tasks,
        counts: {
          active: tasks.filter(t => [DeliveryModel.STATUS.PICKED_UP, DeliveryModel.STATUS.ON_DELIVERY].includes(t.delivery_status)).length,
          new: tasks.filter(t => t.delivery_status === DeliveryModel.STATUS.ASSIGNED && t.assignment_status === DeliveryModel.ASSIGNMENT_RESPONSES.PENDING).length,
          accepted: tasks.filter(t => t.delivery_status === DeliveryModel.STATUS.ASSIGNED && t.assignment_status === DeliveryModel.ASSIGNMENT_RESPONSES.ACCEPTED).length
        }
      });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, code: err.code || 'DRIVER_TASKS_ERROR', error: err.message });
    }
  });

  router.get('/driver/tasks/:orderId', driverAuth, (req, res) => {
    try {
      const task = getTask(req.params.orderId, actorId(req), req.brand_id, req.user.branchId || req.user.branch_id);
      if (!task) {
        return res.status(404).json({
          success: false,
          code: 'DRIVER_TASK_NOT_FOUND',
          error: 'Tugas pengantaran tidak ditemukan atau bukan milik Driver ini.'
        });
      }
      res.json({ success: true, task: shapeTask(task) });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, code: err.code || 'DRIVER_TASK_ERROR', error: err.message });
    }
  });

  router.post('/driver/tasks/:orderId/accept', driverAuth, (req, res) => {
    try {
      const result = DeliveryDispatchService.acceptAssignment({
        order_id: req.params.orderId,
        actor_id: actorId(req)
      });
      const task = getTask(req.params.orderId, actorId(req), req.brand_id);
      res.json({ success: true, ...result, task: shapeTask(task) });
    } catch (err) {
      const status = err.status || 409;
      res.status(status).json({
        success: false,
        code: err.code || 'DRIVER_ASSIGNMENT_ACCEPT_FAILED',
        error: err.message
      });
    }
  });

  router.post('/driver/tasks/:orderId/reject', driverAuth, (req, res) => {
    try {
      const reason = String((req.body && req.body.reason) || '').trim();
      const result = DeliveryDispatchService.rejectAssignment({
        order_id: req.params.orderId,
        actor_id: actorId(req),
        reason
      });
      res.json({ success: true, ...result });
    } catch (err) {
      const status = err.status || 409;
      res.status(status).json({
        success: false,
        code: err.code || 'DRIVER_ASSIGNMENT_REJECT_FAILED',
        error: err.message
      });
    }
  });

  function executeDeliveryTransition(req, res, targetStatus, extra) {
    try {
      const task = getTask(req.params.orderId, actorId(req), req.brand_id, req.user.branchId || req.user.branch_id);
      if (!task) {
        return res.status(404).json({
          success: false,
          code: 'DRIVER_TASK_NOT_FOUND',
          error: 'Tugas pengantaran tidak ditemukan atau bukan milik Driver ini.'
        });
      }

      const result = DeliveryDispatchService.updateStatus(Object.assign({
        order_id: req.params.orderId,
        status: targetStatus,
        actor_id: actorId(req)
      }, extra || {}));

      const refreshed = getTask(req.params.orderId, actorId(req), req.brand_id, req.user.branchId || req.user.branch_id);
      res.json({ success: true, ...result, task: shapeTask(refreshed) });
    } catch (err) {
      const status = err.status || 409;
      res.status(status).json({
        success: false,
        code: err.code || 'DRIVER_DELIVERY_TRANSITION_FAILED',
        error: err.message
      });
    }
  }

  router.post('/driver/tasks/:orderId/pickup', driverAuth, (req, res) => {
    executeDeliveryTransition(req, res, DeliveryModel.STATUS.PICKED_UP);
  });

  router.post('/driver/tasks/:orderId/start', driverAuth, (req, res) => {
    executeDeliveryTransition(req, res, DeliveryModel.STATUS.ON_DELIVERY);
  });

  router.post('/driver/tasks/:orderId/complete', driverAuth, (req, res) => {
    const rawTendered = req.body && req.body.cod_amount_tendered;
    const hasTendered = rawTendered !== undefined && rawTendered !== null && rawTendered !== '';
    executeDeliveryTransition(
      req,
      res,
      DeliveryModel.STATUS.DELIVERED,
      hasTendered ? { cod_amount_tendered: Number(rawTendered) } : {}
    );
  });
}

module.exports = registerDriverRoutes;
