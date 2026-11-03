'use strict';

const { events } = require('../../../core');
const { OrderRepository } = require('../../../core/data/repositories');
const OrderStateMachine = require('../../../server/services/OrderStateMachine');
const DeliveryModel = require('../models/DeliveryModel');
const BranchDriverProvider = require('../providers/BranchDriverProvider');

const orderRepository = new OrderRepository();

const DELIVERY_TRANSITIONS = Object.freeze({
  unassigned: Object.freeze(['assigned']),
  assigned: Object.freeze(['picked_up', 'failed', 'cancelled']),
  picked_up: Object.freeze(['on_delivery', 'failed', 'cancelled']),
  on_delivery: Object.freeze(['delivered', 'failed', 'cancelled']),
  delivered: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([])
});

class DeliveryDispatchService {
  static canTransition(currentStatus, targetStatus) {
    const allowed = DELIVERY_TRANSITIONS[String(currentStatus || '')] || [];
    return allowed.includes(String(targetStatus || ''));
  }

  static _assertDriverActor(delivery, actorId) {
    if (!actorId) {
      throw new Error('[DeliveryDispatchService] Driver action membutuhkan actor_id.');
    }
    if (delivery && delivery.driver_id && String(delivery.driver_id) !== String(actorId)) {
      throw new Error('[DeliveryDispatchService] Driver tidak berwenang menjalankan delivery job ini.');
    }
    if (delivery && delivery.driver_id && delivery.driver_assignment_status && delivery.driver_assignment_status !== DeliveryModel.ASSIGNMENT_RESPONSES.ACCEPTED) {
      throw new Error('[DeliveryDispatchService] Delivery job harus diterima Driver sebelum dapat dijalankan.');
    }
  }

  static assign({
    order_id,
    provider_type = DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER,
    driver_id = null,
    driver_name,
    driver_phone,
    assigned_by = null
  }) {
    const order = orderRepository.findById(order_id);
    if (!order) {
      throw new Error('[DeliveryDispatchService] Order "' + order_id + '" tidak ditemukan.');
    }
    if (order.order_type !== 'delivery') {
      throw new Error('[DeliveryDispatchService] Hanya Order Fulfillment Environment delivery yang dapat diberi driver.');
    }
    if (!['confirmed', 'preparing', 'ready'].includes(order.status)) {
      throw new Error('[DeliveryDispatchService] Driver hanya dapat di-assign saat pesanan berstatus confirmed, preparing, atau ready.');
    }
    if (provider_type === DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER) {
      return BranchDriverProvider.assignDriver({
        order_id,
        driver_id: driver_id || null,
        driver_name,
        driver_phone,
        assigned_by
      });
    }

    throw new Error('[DeliveryDispatchService] Provider type "' + provider_type + '" belum didukung pada MVP.');
  }

  static acceptAssignment({ order_id, actor_id }) {
    const order = orderRepository.findById(order_id);
    if (!order) throw new Error('[DeliveryDispatchService] Order "' + order_id + '" tidak ditemukan.');
    const delivery = orderRepository.findDeliveryByOrderId(order_id);
    if (!delivery) {
      throw new Error('[DeliveryDispatchService] Delivery job tidak ditemukan.');
    }
    this._assertAssignedDriver(delivery, actor_id);
    if (
      delivery.driver_assignment_status === DeliveryModel.ASSIGNMENT_RESPONSES.ACCEPTED ||
      [DeliveryModel.STATUS.PICKED_UP, DeliveryModel.STATUS.ON_DELIVERY, DeliveryModel.STATUS.DELIVERED].includes(delivery.status)
    ) {
      return {
        success: true,
        order_id,
        status: delivery.status || 'assigned',
        assignment_status: 'accepted',
        idempotent: true
      };
    }
    if (delivery.driver_assignment_status === DeliveryModel.ASSIGNMENT_RESPONSES.REJECTED) {
      throw new Error('[DeliveryDispatchService] Delivery job sudah ditolak dan harus di-assign ulang oleh Manager.');
    }
    if (delivery.status !== DeliveryModel.STATUS.ASSIGNED) {
      throw new Error('[DeliveryDispatchService] Delivery job tidak sedang menunggu penerimaan Driver.');
    }
    if (!['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(order.status)) {
      throw new Error('[DeliveryDispatchService] Driver assignment hanya dapat diterima/ditolak saat pesanan masih dalam proses aktif.');
    }
    const now = new Date().toISOString();
    const result = orderRepository.respondToDriverAssignment({
      orderId: order_id,
      response: DeliveryModel.ASSIGNMENT_RESPONSES.ACCEPTED,
      respondedBy: actor_id,
      updatedAt: now
    });
    if (!result || result.changes !== 1) throw new Error('[DeliveryDispatchService] Assignment Driver gagal diperbarui karena konflik state.');
    events.EventBus.publish({
      type: 'delivery.driver.accepted',
      producer: 'delivery',
      payload: { order_id, branch_id: order.branch_id, driver_id: delivery.driver_id || null, actor_id, accepted_at: now }
    }).catch(() => {});
    return { success: true, order_id, status: 'assigned', assignment_status: 'accepted', responded_at: now };
  }

  static rejectAssignment({ order_id, actor_id, reason = '' }) {
    const order = orderRepository.findById(order_id);
    if (!order) throw new Error('[DeliveryDispatchService] Order "' + order_id + '" tidak ditemukan.');
    const delivery = orderRepository.findDeliveryByOrderId(order_id);
    if (!delivery) {
      throw new Error('[DeliveryDispatchService] Delivery job tidak ditemukan.');
    }
    if (delivery.driver_assignment_status === DeliveryModel.ASSIGNMENT_RESPONSES.REJECTED && delivery.status === DeliveryModel.STATUS.UNASSIGNED) {
      return { success: true, order_id, status: 'unassigned', assignment_status: 'rejected', idempotent: true };
    }
    this._assertAssignedDriver(delivery, actor_id);
    if (delivery.status !== DeliveryModel.STATUS.ASSIGNED) {
      throw new Error('[DeliveryDispatchService] Delivery job tidak sedang menunggu penerimaan Driver.');
    }
    if (!['pending', 'confirmed', 'preparing', 'ready'].includes(order.status)) {
      throw new Error('[DeliveryDispatchService] Driver assignment hanya dapat diterima/ditolak saat pesanan masih dalam proses aktif.');
    }
    const rejectionReason = String(reason || '').trim();
    if (!rejectionReason) throw new Error('[DeliveryDispatchService] Alasan penolakan Driver wajib diisi.');
    const now = new Date().toISOString();
    const result = orderRepository.respondToDriverAssignment({
      orderId: order_id,
      response: DeliveryModel.ASSIGNMENT_RESPONSES.REJECTED,
      respondedBy: actor_id,
      rejectionReason,
      updatedAt: now
    });
    if (!result || result.changes !== 1) throw new Error('[DeliveryDispatchService] Penolakan Driver gagal diperbarui karena konflik state.');
    events.EventBus.publish({
      type: 'delivery.driver.rejected',
      producer: 'delivery',
      payload: { order_id, branch_id: order.branch_id, driver_id: delivery.driver_id || null, actor_id, reason: rejectionReason, rejected_at: now }
    }).catch(() => {});

    try {
      const db = orderRepository.db;
      if (db && db.prepare) {
        const bds = db.prepare('SELECT dispatch_mode FROM branch_delivery_settings WHERE branch_id = ?').get(order.branch_id);
        if (bds && bds.dispatch_mode === 'hybrid') {
          events.EventBus.publish({
            type: 'delivery.dispatch.fallback_to_manual',
            producer: 'delivery',
            payload: {
              order_id,
              order_number: order.order_number,
              branch_id: order.branch_id,
              driver_id: delivery.driver_id || null,
              reason: 'DRIVER_REJECTED',
              rejection_reason: rejectionReason,
              message: `Kurir menolak tugas (alasan: ${rejectionReason}). Penugasan dialihkan ke Manual BM.`
            }
          }).catch(() => {});
        }
      }
    } catch (_) {}

    return { success: true, order_id, status: 'unassigned', assignment_status: 'rejected', rejected_at: now };
  }

  static _assertAssignedDriver(delivery, actorId) {
    if (!actorId) throw new Error('[DeliveryDispatchService] Driver action membutuhkan actor_id.');
    if (delivery.driver_id && String(delivery.driver_id) !== String(actorId)) {
      throw new Error('[DeliveryDispatchService] Driver tidak berwenang menjalankan delivery job ini.');
    }
  }

  static updateStatus({
    order_id,
    status,
    notes = '',
    actor_id = null,
    cod_amount_tendered = null,
    pod_photo_url = null,
    pod_bypass_reason = null,
    pod_note = null
  }) {
    if (!DeliveryModel.isValidStatus(status)) {
      throw new Error('[DeliveryDispatchService] Delivery status "' + status + '" tidak valid.');
    }
    const order = orderRepository.findById(order_id);
    if (!order) throw new Error('[DeliveryDispatchService] Order "' + order_id + '" tidak ditemukan.');
    if (order.order_type !== 'delivery') throw new Error('[DeliveryDispatchService] Order "' + order_id + '" bukan Fulfillment Environment delivery.');
    const currentDelivery = orderRepository.findDeliveryByOrderId(order_id);
    const currentDeliveryStatus = currentDelivery ? String(currentDelivery.status || 'unassigned') : 'unassigned';

    if ([DeliveryModel.STATUS.PICKED_UP, DeliveryModel.STATUS.ON_DELIVERY, DeliveryModel.STATUS.DELIVERED, DeliveryModel.STATUS.FAILED, DeliveryModel.STATUS.CANCELLED].includes(status)) {
      this._assertDriverActor(currentDelivery, actor_id);
    }

    // Idempotency is allowed only after actor authorization has passed.
    if (currentDeliveryStatus === status) {
      return { success: true, order_id, status, updated_at: currentDelivery.updated_at || new Date().toISOString(), idempotent: true };
    }
    if (!this.canTransition(currentDeliveryStatus, status)) {
      throw new Error('[DeliveryDispatchService] Perubahan Delivery Job tidak valid: dari "' + currentDeliveryStatus + '" ke "' + status + '".');
    }
    const now = new Date().toISOString();
    orderRepository.beginTransaction();
    try {
      const latestOrder = orderRepository.findById(order_id);
      const latestDelivery = orderRepository.findDeliveryByOrderId(order_id);
      if (!latestOrder || !latestDelivery) throw new Error('[DeliveryDispatchService] Order/delivery state hilang saat transaksi.');
      if (latestDelivery.status !== currentDeliveryStatus) throw new Error('[DeliveryDispatchService] Konflik konkurensi: Delivery job telah berubah.');

      if (status === DeliveryModel.STATUS.PICKED_UP) {
        if (latestOrder.status !== 'ready') throw new Error('[DeliveryDispatchService] Pickup hanya dapat dilakukan setelah pesanan ready.');
        orderRepository.updateDeliveryStatus({ orderId: order_id, status, updatedAt: now });
      } else if (status === DeliveryModel.STATUS.ON_DELIVERY) {
        if (latestOrder.status !== 'ready') throw new Error('[DeliveryDispatchService] Driver hanya dapat memulai pengantaran setelah pesanan berstatus ready.');
        OrderStateMachine.transition({
          order_id, target_status: 'out_for_delivery', actor_type: 'driver', actor_id,
          note: notes || 'Driver memulai pengantaran'
        }, { dbTransactionProvided: true });
        orderRepository.updateDeliveryStatus({ orderId: order_id, status, updatedAt: now });
      } else if (status === DeliveryModel.STATUS.DELIVERED) {
        if (latestOrder.status !== 'out_for_delivery') {
          throw new Error('[DeliveryDispatchService] Delivery hanya dapat diselesaikan setelah status pengantaran dimulai.');
        }

        // Gatekeeper: Wajib Foto Bukti POD ATAU Sertakan Alasan Bypass Resmi
        const cleanPodPhoto = pod_photo_url ? String(pod_photo_url).trim() : null;
        const cleanBypassReason = pod_bypass_reason ? String(pod_bypass_reason).trim() : null;
        const cleanPodNote = pod_note ? String(pod_note).trim() : null;

        if (!cleanPodPhoto && !cleanBypassReason) {
          throw new Error('[POD_PHOTO_OR_BYPASS_REQUIRED]: Foto bukti pengantaran wajib diambil atau sertakan alasan bypass kendala.');
        }

        if (latestOrder.payment_method === 'cash') {
          const tendered = Number(cod_amount_tendered != null ? cod_amount_tendered : latestOrder.grand_total);
          const expected = Number(latestOrder.grand_total);
          if (!Number.isFinite(tendered) || tendered <= 0) {
            throw new Error('[COD_CASH_TENDER_REQUIRED]: Driver wajib mencatat nominal cash yang diterima dari customer.');
          }
          if (tendered < expected) {
            throw new Error('[COD_CASH_SHORT]: Uang yang diterima Driver kurang dari total tagihan. Gunakan alur variance COD.');
          }
          const change = tendered - expected;
          orderRepository.updateDeliveryStatus({
            orderId: order_id, status, updatedAt: now,
            codCollectionStatus: DeliveryModel.COD_COLLECTION_STATUS.COLLECTED,
            codCashCustody: DeliveryModel.COD_CASH_CUSTODY.DRIVER,
            codCollectedAmount: expected,
            codAmountTendered: tendered,
            codChangeGiven: change,
            podPhotoUrl: cleanPodPhoto,
            podBypassReason: cleanBypassReason,
            podNote: cleanPodNote
          });
        } else {
          orderRepository.updateDeliveryStatus({
            orderId: order_id, status, updatedAt: now,
            podPhotoUrl: cleanPodPhoto,
            podBypassReason: cleanBypassReason,
            podNote: cleanPodNote
          });
        }
        OrderStateMachine.transition({
          order_id, target_status: 'completed', actor_type: 'driver', actor_id,
          note: notes || 'Driver menyelesaikan pengantaran'
        }, { dbTransactionProvided: true });
      } else if (status === DeliveryModel.STATUS.FAILED || status === DeliveryModel.STATUS.CANCELLED) {
        const settledPayment = orderRepository.findPaymentSettlement(order_id);
        if (!settledPayment) {
          OrderStateMachine.transition({
            order_id,
            target_status: 'cancelled',
            actor_type: 'driver',
            actor_id,
            note: notes || 'Pengantaran gagal / Return to Store'
          }, { dbTransactionProvided: true });
        } else {
          const crypto = require('crypto');
          const logId = 'log_' + crypto.randomBytes(8).toString('hex');
          orderRepository.insertStatusLog({
            logId,
            orderId: order_id,
            previousStatus: latestOrder.status,
            newStatus: latestOrder.status,
            actorType: 'driver',
            actorId: actor_id,
            note: '[DELIVERY_FAILED]: ' + (notes || 'Pengantaran gagal / Return to Store')
          });
        }
        orderRepository.updateDeliveryStatus({
          orderId: order_id,
          status,
          updatedAt: now,
          codCollectionStatus: 'cancelled',
          codCashCustody: 'none',
          codCollectedAmount: 0,
          podNote: notes || 'Gagal antar / Return to store'
        });
      } else {
        orderRepository.updateDeliveryStatus({ orderId: order_id, status, updatedAt: now });
      }

      orderRepository.commitTransaction();
    } catch (err) {
      try { orderRepository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    if (status === DeliveryModel.STATUS.DELIVERED) {
      events.EventBus.publish({
        type: 'delivery.completed', producer: 'delivery',
        payload: { order_id, order_number: order.order_number, branch_id: order.branch_id, completed_at: now, actor_id }
      }).catch(() => {});
    } else if (status === DeliveryModel.STATUS.FAILED || status === DeliveryModel.STATUS.CANCELLED) {
      events.EventBus.publish({
        type: 'delivery.failed', producer: 'delivery',
        payload: { order_id, order_number: order.order_number, branch_id: order.branch_id, failed_at: now, actor_id, reason: notes }
      }).catch(() => {});
    }
    return { success: true, order_id, status, updated_at: now };
  }

  static getDelivery(order_id) { return orderRepository.findDeliveryByOrderId(order_id); }

  static recordCodHandover({ order_id, cashier_id = null, branch_id = null, received_amount = null }) {
    if (!cashier_id) throw new Error('[DeliveryDispatchService] Cash handover membutuhkan cashier_id.');
    const order = orderRepository.findById(order_id);
    if (!order) throw new Error('[DeliveryDispatchService] Order "' + order_id + '" tidak ditemukan.');
    if (order.order_type !== 'delivery' || order.payment_method !== 'cash') throw new Error('[DeliveryDispatchService] Cash handover hanya berlaku untuk delivery COD.');
    if (branch_id && order.branch_id !== branch_id) throw new Error('[DeliveryDispatchService] Pesanan berada di luar kewenangan cabang kasir.');
    const delivery = orderRepository.findDeliveryByOrderId(order_id);
    if (!delivery) throw new Error('[DeliveryDispatchService] Data delivery untuk pesanan "' + order_id + '" tidak ditemukan.');
    if (delivery.status !== DeliveryModel.STATUS.DELIVERED) throw new Error('[DeliveryDispatchService] Handover kas COD hanya dapat dilakukan setelah delivery berstatus delivered.');
    if (delivery.cod_collection_status === DeliveryModel.COD_COLLECTION_STATUS.HANDED_OVER && delivery.cod_cash_custody === DeliveryModel.COD_CASH_CUSTODY.CASHIER) {
      if (!delivery.cod_handed_over_to || String(delivery.cod_handed_over_to) === String(cashier_id)) {
        return { success: true, order_id, cod_collection_status: 'handed_over', cod_cash_custody: 'cashier', cod_handed_over_to: delivery.cod_handed_over_to || cashier_id, idempotent: true };
      }
      throw new Error('[DeliveryDispatchService] COD sudah diterima oleh Cashier lain.');
    }
    if (delivery.cod_collection_status !== DeliveryModel.COD_COLLECTION_STATUS.COLLECTED || delivery.cod_cash_custody !== DeliveryModel.COD_CASH_CUSTODY.DRIVER) {
      throw new Error('[DeliveryDispatchService] COD cash belum tercatat sebagai uang yang masih dipegang Driver.');
    }
    const expected = Number(order.grand_total);
    const collected = Number(delivery.cod_collected_amount);
    const received = Number(received_amount);
    if (collected !== expected) throw new Error('[COD_CASH_VARIANCE_REQUIRES_EXCEPTION_FLOW]: Nominal COD yang dikumpulkan tidak sama dengan tagihan.');
    if (!Number.isFinite(received) || received !== collected) throw new Error('[COD_HANDOVER_AMOUNT_MISMATCH]: Nominal cash yang diterima Cashier tidak sesuai nominal COD yang dibawa Driver.');
    const now = new Date().toISOString();
    const result = orderRepository.recordDeliveryCodHandover({ orderId: order_id, codHandedOverTo: cashier_id, updatedAt: now });
    if (!result || result.changes !== 1) throw new Error('[DeliveryDispatchService] Handover gagal karena state COD berubah bersamaan.');
    events.EventBus.publish({
      type: 'delivery.cod.handed_over', producer: 'delivery',
      payload: { order_id, branch_id: order.branch_id, cashier_id, amount: collected, handed_over_at: now }
    }).catch(() => {});
    return { success: true, order_id, cod_collection_status: 'handed_over', cod_cash_custody: 'cashier', cod_handed_over_at: now, cod_handed_over_to: cashier_id };
  }

  /**
   * Find the best online driver for a given branch
   * Ranked by lowest number of currently active delivery jobs, then most recently active
   */
  static findBestAvailableDriver(branchId) {
    if (!branchId) return null;
    const db = orderRepository.db;
    if (!db || !db.prepare) return null;

    const sql = `
      SELECT u.id, u.full_name, u.phone,
        COALESCE(dl.is_online, 0) AS is_online,
        COALESCE(active_tasks.count, 0) AS active_task_count
      FROM users u
      LEFT JOIN driver_locations dl ON dl.driver_id = u.id
      LEFT JOIN (
        SELECT od.driver_id, COUNT(*) AS count
        FROM order_deliveries od
        WHERE od.status IN ('assigned', 'picked_up', 'on_delivery')
          AND od.driver_id IS NOT NULL
        GROUP BY od.driver_id
      ) active_tasks ON active_tasks.driver_id = u.id
      WHERE u.role = 'driver'
        AND u.status = 'active'
        AND u.branch_id = ?
        AND COALESCE(dl.is_online, 0) = 1
      ORDER BY active_task_count ASC, COALESCE(dl.updated_at, u.created_at) DESC
      LIMIT 1
    `;
    return db.prepare(sql).get(branchId) || null;
  }

  /**
   * Automatically assigns a delivery order according to branch settings (automatic or hybrid)
   */
  static autoAssign({ order_id, branch_id = null }) {
    const order = orderRepository.findById(order_id);
    if (!order) throw new Error('[DeliveryDispatchService] Order "' + order_id + '" tidak ditemukan.');
    const targetBranchId = branch_id || order.branch_id;

    const db = orderRepository.db;
    let settings = null;
    try {
      settings = db.prepare('SELECT dispatch_mode, auto_dispatch_timeout_seconds FROM branch_delivery_settings WHERE branch_id = ?').get(targetBranchId);
    } catch (_) {}

    const dispatchMode = (settings && settings.dispatch_mode) || 'hybrid';
    const timeoutSeconds = (settings && settings.auto_dispatch_timeout_seconds) || 120;

    if (dispatchMode === 'manual') {
      return { success: false, mode: 'manual', message: 'Cabang dikonfigurasi menggunakan mode penugasan manual.' };
    }

    const bestDriver = this.findBestAvailableDriver(targetBranchId);
    if (!bestDriver) {
      if (dispatchMode === 'hybrid') {
        events.EventBus.publish({
          type: 'delivery.dispatch.fallback_to_manual',
          producer: 'delivery',
          payload: {
            order_id,
            order_number: order.order_number,
            branch_id: targetBranchId,
            reason: 'NO_ONLINE_DRIVER_AVAILABLE',
            message: 'Tidak ada kurir online yang tersedia di cabang ini. Penugasan dialihkan ke Manual BM.'
          }
        }).catch(() => {});
      }
      return {
        success: false,
        mode: dispatchMode,
        driver_found: false,
        message: 'Tidak ada driver online yang tersedia di cabang ini.'
      };
    }

    const assignResult = this.assign({
      order_id,
      driver_id: bestDriver.id,
      driver_name: bestDriver.full_name,
      driver_phone: bestDriver.phone,
      assigned_by: 'system:auto_dispatch'
    });

    events.EventBus.publish({
      type: 'delivery.dispatch.auto_assigned',
      producer: 'delivery',
      payload: {
        order_id,
        order_number: order.order_number,
        branch_id: targetBranchId,
        driver_id: bestDriver.id,
        driver_name: bestDriver.full_name,
        dispatch_mode: dispatchMode,
        timeout_seconds: timeoutSeconds
      }
    }).catch(() => {});

    return {
      success: true,
      mode: dispatchMode,
      timeout_seconds: timeoutSeconds,
      driver: {
        id: bestDriver.id,
        name: bestDriver.full_name,
        phone: bestDriver.phone,
        active_tasks: bestDriver.active_task_count
      },
      assignment: assignResult
    };
  }

  /**
   * Check orders assigned via hybrid dispatch that exceeded timeout seconds
   */
  static checkHybridTimeouts({ branch_id = null } = {}) {
    const db = orderRepository.db;
    if (!db || !db.prepare) return [];

    let sql = `
      SELECT od.id as delivery_id, od.order_id, od.driver_id, od.driver_name, od.created_at, od.updated_at,
             o.order_number, o.branch_id,
             COALESCE(bds.dispatch_mode, 'hybrid') as dispatch_mode,
             COALESCE(bds.auto_dispatch_timeout_seconds, 120) as timeout_seconds
      FROM order_deliveries od
      JOIN orders o ON o.id = od.order_id
      LEFT JOIN branch_delivery_settings bds ON bds.branch_id = o.branch_id
      WHERE od.status = 'assigned'
        AND od.driver_assignment_status = 'pending'
        AND COALESCE(bds.dispatch_mode, 'hybrid') = 'hybrid'
    `;
    const params = [];
    if (branch_id) {
      sql += ' AND o.branch_id = ?';
      params.push(branch_id);
    }

    const pendingDeliveries = db.prepare(sql).all(...params);
    const timedOut = [];
    const now = Date.now();

    for (const d of pendingDeliveries) {
      const assignedTime = new Date(d.updated_at || d.created_at).getTime();
      const elapsedSeconds = Math.floor((now - assignedTime) / 1000);
      if (elapsedSeconds >= d.timeout_seconds) {
        db.prepare(`
          UPDATE order_deliveries
          SET status = 'unassigned',
              driver_assignment_status = 'timed_out',
              driver_assignment_rejection_reason = 'AUTO_DISPATCH_TIMEOUT',
              updated_at = datetime('now')
          WHERE id = ?
        `).run(d.delivery_id);

        events.EventBus.publish({
          type: 'delivery.dispatch.fallback_to_manual',
          producer: 'delivery',
          payload: {
            order_id: d.order_id,
            order_number: d.order_number,
            branch_id: d.branch_id,
            driver_id: d.driver_id,
            driver_name: d.driver_name,
            reason: 'AUTO_DISPATCH_TIMEOUT',
            elapsed_seconds: elapsedSeconds,
            message: `Kurir ${d.driver_name || ''} tidak merespons dalam ${elapsedSeconds} detik. Penugasan dialihkan ke Manual BM.`
          }
        }).catch(() => {});

        timedOut.push({
          order_id: d.order_id,
          order_number: d.order_number,
          driver_name: d.driver_name,
          elapsed_seconds: elapsedSeconds
        });
      }
    }

    return timedOut;
  }
}
module.exports = DeliveryDispatchService;
