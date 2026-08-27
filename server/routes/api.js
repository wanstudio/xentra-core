const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');
const BranchMatcher = require('../services/BranchMatcher');
const DeliveryCalculator = require('../services/DeliveryCalculator');
const PaymentService = require('../services/PaymentService');
const OrderStateMachine = require('../services/OrderStateMachine');
const RouteService = require('../services/RouteService');

// 1. Get Brand Profile & Theme
router.get('/brand/info', (req, res) => {
  try {
    res.json({
      success: true,
      brand: {
        id: req.brand.id,
        name: req.brand.name,
        slug: req.brand.slug,
        logo_url: req.brand.logo_url,
        primary_color: req.brand.primary_color
      }
    });
  } catch (err) {
    console.error('[API Error /brand/info]:', err);
    res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
});

// 2. List Branches for Brand
router.get('/brand/branches', (req, res) => {
  try {
    const branches = db
      .prepare(`
        SELECT 
          b.id, b.name, b.slug, b.address_text, b.latitude, b.longitude, b.phone,
          b.is_active, b.is_open_override,
          s.is_delivery_active, s.is_pickup_active, s.free_delivery_km, s.price_per_km, s.max_radius_km
        FROM branches b
        LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
        WHERE b.brand_id = ? AND b.is_active = 1
      `)
      .all(req.brand_id);

    res.json({
      success: true,
      branches
    });
  } catch (err) {
    console.error('[API Error /brand/branches]:', err);
    res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
});

// 3. Match Nearest Eligible Branch
router.post('/delivery/match-branch', async (req, res) => {
  try {
    const { latitude, longitude, subtotal = 0 } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({
        success: false,
        error: 'Parameter latitude dan longitude wajib dikirim.'
      });
    }

    const match = await BranchMatcher.matchNearestBranch({
      brand_id: req.brand_id,
      customer_lat: Number(latitude),
      customer_lng: Number(longitude),
      subtotal: Number(subtotal)
    });

    res.json({
      success: true,
      ...match
    });
  } catch (err) {
    console.error('[API] match-branch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Address Search Suggestion (Nominatim)
router.get('/location/search', async (req, res) => {
  const q = req.query.q || '';
  const results = await RouteService.searchAddress(q);
  res.json({ success: true, results });
});

// 5. Menu Catalog
router.get('/catalog/menu', (req, res) => {
  try {
    let categories = [];
    let products = [];

    try {
      categories = db
        .prepare('SELECT * FROM categories WHERE brand_id = ? ORDER BY sort_order ASC')
        .all(req.brand_id);

      products = db
        .prepare('SELECT * FROM products WHERE brand_id = ? AND is_active = 1 ORDER BY sort_order ASC')
        .all(req.brand_id);
    } catch (dbErr) {
      console.warn('[Catalog Menu DB Warn]:', dbErr.message);
    }

    if (!categories || categories.length === 0) {
      categories = [
        { id: 'cat_makanan', name: 'Makanan Utama', slug: 'makanan-utama' },
        { id: 'cat_minuman', name: 'Minuman Segar', slug: 'minuman-segar' },
        { id: 'cat_snack', name: 'Camilan & Side', slug: 'camilan' }
      ];
    }

    if (!products || products.length === 0) {
      products = [
        { id: 'prod_1', category_id: 'cat_makanan', name: 'Ayam Bakar Madu Bangjo', price: 28000, description: 'Ayam bakar dengan lumuran madu asli rempah khas Bangjo.' },
        { id: 'prod_2', category_id: 'cat_makanan', name: 'Bebek Goreng Crispy', price: 34000, description: 'Bebek ungkep gurih digoreng renyah dengan sambal korek pedas.' },
        { id: 'prod_3', category_id: 'cat_makanan', name: 'Nasi Goreng Spesial Bangjo', price: 25000, description: 'Nasi goreng racikan istimewa telur mata sapi dan acar.' },
        { id: 'prod_4', category_id: 'cat_minuman', name: 'Es Teh Manis Jumbo', price: 6000, description: 'Teh melati seduh dingin segar porsi besar.' },
        { id: 'prod_5', category_id: 'cat_minuman', name: 'Es Jeruk Peras Asli', price: 10000, description: 'Jeruk peras murni tanpa pengawet.' }
      ];
    }

    const tree = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      products: products.filter((p) => p.category_id === cat.id)
    }));

    res.json({
      success: true,
      categories: tree,
      all_products: products
    });
  } catch (err) {
    console.error('[API Error /catalog/menu]:', err);
    res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
});

// 6. Create Order & Generate Snap Token
router.post('/checkout/create-order', async (req, res) => {
  try {
    const {
      branch_id,
      customer,
      order_type = 'delivery',
      schedule_type = 'asap',
      scheduled_slot_start,
      scheduled_slot_end,
      delivery,
      items,
      order_note = ''
    } = req.body;

    if (!branch_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Data keranjang atau cabang pesanan tidak valid.'
      });
    }

    if (!customer || !customer.phone) {
      return res.status(400).json({
        success: false,
        error: 'Nomor WhatsApp pemesan wajib diisi.'
      });
    }

    // 1. Validate Branch
    const branch = db.prepare(`
      SELECT 
        b.id, b.brand_id, b.name, b.latitude, b.longitude,
        s.free_delivery_km, s.price_per_km, s.max_delivery_radius_km, s.promo_config
      FROM branches b 
      LEFT JOIN branch_settings s ON s.branch_id = b.id 
      WHERE b.id = ?
    `).get(branch_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang restoran tidak ditemukan.' });
    }

    // 2. Validate Items & Prices from Database (Anti-Tampering)
    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const prod = db.prepare('SELECT * FROM products WHERE id = ? AND brand_id = ?').get(item.id, req.brand_id);
      if (!prod || !prod.is_active) {
        return res.status(400).json({
          success: false,
          error: `Menu "${item.name || item.id}" saat ini tidak tersedia.`
        });
      }

      const qty = Math.max(1, Number(item.quantity || item.qty) || 1);
      const unitPrice = Number(prod.price);
      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;

      validatedItems.push({
        id: 'item_' + crypto.randomBytes(6).toString('hex'),
        product_id: prod.id,
        product_name: prod.name,
        unit_price: unitPrice,
        quantity: qty,
        item_subtotal: lineTotal,
        item_note: item.note || ''
      });
    }

    // 3. Compute Delivery Fee
    let deliveryFee = 0;
    let discountAmount = 0;
    let deliveryRecord = null;

    if (order_type === 'delivery') {
      if (!delivery || delivery.latitude == null || delivery.longitude == null) {
        return res.status(400).json({
          success: false,
          error: 'Alamat pengantaran wajib disertakan untuk pesanan delivery.'
        });
      }

      const road = await RouteService.getRoadDistance(
        branch.latitude,
        branch.longitude,
        delivery.latitude,
        delivery.longitude
      );

      const promoConfig = branch.promo_config ? JSON.parse(branch.promo_config) : null;

      const feeCalc = DeliveryCalculator.calculate({
        distance_meters: road.distance_meters,
        free_km: branch.free_delivery_km,
        price_per_km: branch.price_per_km,
        max_radius_km: branch.max_delivery_radius_km,
        subtotal,
        promo_config: promoConfig
      });

      if (!feeCalc.eligible) {
        return res.status(400).json({
          success: false,
          error: feeCalc.reason || 'Alamat di luar radius pengantaran cabang ini.'
        });
      }

      deliveryFee = feeCalc.final_delivery_fee;
      discountAmount = feeCalc.discount_amount;

      deliveryRecord = {
        id: 'del_' + crypto.randomBytes(6).toString('hex'),
        destination_address: delivery.address || 'Alamat Customer',
        destination_latitude: delivery.latitude,
        destination_longitude: delivery.longitude,
        actual_road_distance_meters: feeCalc.distance_meters,
        actual_duration_seconds: road.duration_seconds,
        chargeable_distance_km: feeCalc.chargeable_distance_km,
        free_km_applied: feeCalc.free_km,
        rate_per_km_applied: feeCalc.price_per_km,
        delivery_fee_calculated: feeCalc.base_delivery_fee
      };
    }

    const grandTotal = Math.max(0, subtotal + deliveryFee - discountAmount);
    const orderId = 'ord_' + crypto.randomBytes(8).toString('hex');
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderNumber = `XN-${today}-${randSuffix}`;

    // 4. Save to Database
    db.prepare(`
      INSERT INTO orders (
        id, order_number, brand_id, branch_id, customer_phone, customer_name,
        order_type, fulfillment_schedule_type, scheduled_slot_start, scheduled_slot_end,
        status, subtotal, discount_amount, delivery_fee, grand_total, order_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(
      orderId,
      orderNumber,
      req.brand_id,
      branch.id,
      customer.phone,
      customer.name || '',
      order_type,
      schedule_type,
      scheduled_slot_start || null,
      scheduled_slot_end || null,
      subtotal,
      discountAmount,
      deliveryFee,
      grandTotal,
      order_note
    );

    // Save order items
    const insertItem = db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, item_subtotal, item_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const it of validatedItems) {
      insertItem.run(it.id, orderId, it.product_id, it.product_name, it.unit_price, it.quantity, it.item_subtotal, it.item_note);
    }

    // Save delivery record if delivery
    if (deliveryRecord) {
      db.prepare(`
        INSERT INTO order_deliveries (
          id, order_id, destination_address, destination_latitude, destination_longitude,
          actual_road_distance_meters, actual_duration_seconds, chargeable_distance_km,
          free_km_applied, rate_per_km_applied, delivery_fee_calculated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        deliveryRecord.id,
        orderId,
        deliveryRecord.destination_address,
        deliveryRecord.destination_latitude,
        deliveryRecord.destination_longitude,
        deliveryRecord.actual_road_distance_meters,
        deliveryRecord.actual_duration_seconds,
        deliveryRecord.chargeable_distance_km,
        deliveryRecord.free_km_applied,
        deliveryRecord.rate_per_km_applied,
        deliveryRecord.delivery_fee_calculated
      );
    }

    // 5. Generate Midtrans Snap Token
    const snapResult = await PaymentService.createSnapTransaction(
      { id: orderId, grand_total: grandTotal, branch_id: branch.id, brand_id: req.brand_id, delivery_fee: deliveryFee, discount_amount: discountAmount },
      validatedItems,
      customer
    );

    // Save Payment record
    const paymentId = 'pay_' + crypto.randomBytes(6).toString('hex');
    db.prepare(`
      INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
      VALUES (?, ?, 'midtrans', ?, ?, 'pending', ?)
    `).run(paymentId, orderId, snapResult.merchant_id, snapResult.snap_token, grandTotal);

    res.status(201).json({
      success: true,
      order_id: orderId,
      order_number: orderNumber,
      grand_total: grandTotal,
      subtotal,
      delivery_fee: deliveryFee,
      discount_amount: discountAmount,
      snap_token: snapResult.snap_token,
      redirect_url: snapResult.redirect_url
    });
  } catch (err) {
    console.error('[API] create-order error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Get Order Details & Live Status
router.get('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan.' });
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const delivery = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(order.id);
  const payment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order.id);
  const logs = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ? ORDER BY created_at ASC').all(order.id);

  res.json({
    success: true,
    order,
    items,
    delivery,
    payment,
    logs
  });
});

// 8. Kitchen Display Queue
router.get('/kitchen/queue', (req, res) => {
  const branch_id = req.query.branch_id;
  let sql = `
    SELECT o.*, b.name as branch_name 
    FROM orders o
    JOIN branches b ON b.id = o.branch_id
    WHERE o.status IN ('confirmed', 'preparing', 'ready')
  `;
  const params = [];

  if (branch_id) {
    sql += ' AND o.branch_id = ?';
    params.push(branch_id);
  }

  sql += ' ORDER BY o.created_at ASC';

  const orders = db.prepare(sql).all(...params);

  const enriched = orders.map((ord) => ({
    ...ord,
    items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id),
    delivery: db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(ord.id)
  }));

  res.json({ success: true, orders: enriched });
});

// 9. Update Order Status (Kitchen / Operator)
router.patch('/kitchen/orders/:id/status', (req, res) => {
  try {
    const { status, actor_type = 'kitchen', actor_id = 'staff_1', note = '' } = req.body;
    const result = OrderStateMachine.transition({
      order_id: req.params.id,
      target_status: status,
      actor_type,
      actor_id,
      note
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 10. Midtrans Webhook
router.post('/webhooks/midtrans', (req, res) => {
  try {
    const result = PaymentService.handleWebhook(req.body);
    res.json(result);
  } catch (err) {
    console.error('[Webhook] Midtrans error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
