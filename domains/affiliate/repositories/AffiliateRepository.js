'use strict';

const DataAccess = require('../../../core/data/DataAccess');

class AffiliateRepository {
  constructor(db = DataAccess) {
    this.db = db;
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS affiliate_programs (
        brand_id TEXT PRIMARY KEY,
        commission_type TEXT NOT NULL DEFAULT 'FIXED_PER_ITEM',
        commission_rate REAL NOT NULL DEFAULT 1000.0,
        commission_per_item REAL NOT NULL DEFAULT 1000.0,
        cookie_days INTEGER NOT NULL DEFAULT 14,
        min_payout_amount REAL NOT NULL DEFAULT 50000,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS affiliate_profiles (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        referral_code TEXT NOT NULL UNIQUE,
        bank_name TEXT,
        bank_account_number TEXT,
        bank_account_holder TEXT,
        social_media TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        rejection_reason TEXT,
        approved_at TEXT,
        approved_by TEXT,
        total_earnings REAL NOT NULL DEFAULT 0,
        balance_payable REAL NOT NULL DEFAULT 0,
        balance_pending REAL NOT NULL DEFAULT 0,
        total_withdrawn REAL NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(brand_id, customer_id)
      );
      CREATE INDEX IF NOT EXISTS idx_affiliate_profiles_brand_cust ON affiliate_profiles(brand_id, customer_id);
      CREATE INDEX IF NOT EXISTS idx_affiliate_profiles_ref_code ON affiliate_profiles(referral_code);

      CREATE TABLE IF NOT EXISTS affiliate_attributions (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        affiliate_profile_id TEXT NOT NULL,
        referral_code TEXT NOT NULL,
        customer_id TEXT,
        session_id TEXT,
        menu_id TEXT,
        source TEXT DEFAULT 'whatsapp',
        attributed_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_affiliate_attr_session ON affiliate_attributions(brand_id, session_id);
      CREATE INDEX IF NOT EXISTS idx_affiliate_attr_customer ON affiliate_attributions(brand_id, customer_id);

      CREATE TABLE IF NOT EXISTS affiliate_conversions (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        affiliate_profile_id TEXT NOT NULL,
        order_id TEXT NOT NULL UNIQUE,
        customer_id TEXT,
        eligible_subtotal REAL NOT NULL,
        commission_rate REAL NOT NULL,
        commission_amount REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_affiliate_conv_order ON affiliate_conversions(order_id);
      CREATE INDEX IF NOT EXISTS idx_affiliate_conv_profile ON affiliate_conversions(affiliate_profile_id);

      CREATE TABLE IF NOT EXISTS affiliate_payouts (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        affiliate_profile_id TEXT NOT NULL,
        amount REAL NOT NULL,
        bank_name TEXT NOT NULL,
        bank_account_number TEXT NOT NULL,
        bank_account_holder TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'REQUESTED',
        transfer_receipt_url TEXT,
        rejection_reason TEXT,
        notes TEXT,
        requested_at TEXT DEFAULT (datetime('now')),
        processed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_profile ON affiliate_payouts(affiliate_profile_id);
      CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_brand_status ON affiliate_payouts(brand_id, status);
    `);

    // Schema migrations for existing databases
    try { this.db.exec("ALTER TABLE affiliate_programs ADD COLUMN commission_type TEXT DEFAULT 'FIXED_PER_ITEM';"); } catch (_) {}
    try { this.db.exec("ALTER TABLE affiliate_programs ADD COLUMN commission_per_item REAL DEFAULT 1000.0;"); } catch (_) {}
    try { this.db.exec("ALTER TABLE affiliate_conversions ADD COLUMN total_items INTEGER DEFAULT 1;"); } catch (_) {}
    try { this.db.exec("ALTER TABLE affiliate_profiles ADD COLUMN status TEXT DEFAULT 'PENDING';"); } catch (_) {}
    try { this.db.exec("ALTER TABLE affiliate_profiles ADD COLUMN social_media TEXT;"); } catch (_) {}
    try { this.db.exec("ALTER TABLE affiliate_profiles ADD COLUMN notes TEXT;"); } catch (_) {}
    try { this.db.exec("ALTER TABLE affiliate_profiles ADD COLUMN rejection_reason TEXT;"); } catch (_) {}
    try { this.db.exec("ALTER TABLE affiliate_profiles ADD COLUMN approved_at TEXT;"); } catch (_) {}
    try { this.db.exec("ALTER TABLE affiliate_profiles ADD COLUMN approved_by TEXT;"); } catch (_) {}
    try { this.db.exec("CREATE INDEX IF NOT EXISTS idx_affiliate_profiles_status ON affiliate_profiles(brand_id, status);"); } catch (_) {}
  }

  // 1. Program methods
  findProgram(brandId) {
    return this.db.queryOne(
      "SELECT brand_id, commission_type, commission_rate, commission_per_item, cookie_days, min_payout_amount, is_active, created_at, updated_at " +
      "FROM affiliate_programs WHERE brand_id = ?",
      [brandId]
    );
  }

  upsertProgram({ brandId, commissionType = 'FIXED_PER_ITEM', commissionRate = 1000.0, commissionPerItem = 1000.0, cookieDays = 14, minPayoutAmount = 50000, isActive = 1 }) {
    this.db.execute(
      "INSERT INTO affiliate_programs (brand_id, commission_type, commission_rate, commission_per_item, cookie_days, min_payout_amount, is_active, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now')) " +
      "ON CONFLICT(brand_id) DO UPDATE SET " +
      "commission_type = excluded.commission_type, " +
      "commission_rate = excluded.commission_rate, " +
      "commission_per_item = excluded.commission_per_item, " +
      "cookie_days = excluded.cookie_days, " +
      "min_payout_amount = excluded.min_payout_amount, " +
      "is_active = excluded.is_active, " +
      "updated_at = datetime('now')",
      [brandId, commissionType, commissionRate, commissionPerItem, cookieDays, minPayoutAmount, isActive ? 1 : 0]
    );
    return this.findProgram(brandId);
  }

  // 2. Profile methods
  findProfileByCustomer({ brandId, customerId }) {
    return this.db.queryOne(
      "SELECT id, brand_id, customer_id, referral_code, bank_name, bank_account_number, bank_account_holder, " +
      "social_media, notes, status, rejection_reason, approved_at, approved_by, " +
      "total_earnings, balance_payable, balance_pending, total_withdrawn, created_at, updated_at " +
      "FROM affiliate_profiles WHERE brand_id = ? AND customer_id = ?",
      [brandId, customerId]
    );
  }

  findProfileByCode({ brandId, referralCode }) {
    return this.db.queryOne(
      "SELECT id, brand_id, customer_id, referral_code, bank_name, bank_account_number, bank_account_holder, " +
      "social_media, notes, status, rejection_reason, approved_at, approved_by, " +
      "total_earnings, balance_payable, balance_pending, total_withdrawn, created_at, updated_at " +
      "FROM affiliate_profiles WHERE brand_id = ? AND upper(referral_code) = upper(?)",
      [brandId, referralCode]
    );
  }

  findProfileById(id) {
    return this.db.queryOne(
      "SELECT id, brand_id, customer_id, referral_code, bank_name, bank_account_number, bank_account_holder, " +
      "social_media, notes, status, rejection_reason, approved_at, approved_by, " +
      "total_earnings, balance_payable, balance_pending, total_withdrawn, created_at, updated_at " +
      "FROM affiliate_profiles WHERE id = ?",
      [id]
    );
  }

  createProfile({ id, brandId, customerId, referralCode, status = 'ACTIVE' }) {
    this.db.execute(
      "INSERT INTO affiliate_profiles (id, brand_id, customer_id, referral_code, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, upper(?), ?, datetime('now'), datetime('now'))",
      [id, brandId, customerId, referralCode, status]
    );
    return this.findProfileById(id);
  }

  applyProfile({ id, brandId, customerId, referralCode, bankName, accountNumber, accountHolder, socialMedia = null, notes = null }) {
    const existing = this.findProfileByCustomer({ brandId, customerId });
    if (existing) {
      this.db.execute(
        "UPDATE affiliate_profiles SET bank_name = ?, bank_account_number = ?, bank_account_holder = ?, " +
        "social_media = ?, notes = ?, status = 'PENDING', rejection_reason = NULL, updated_at = datetime('now') " +
        "WHERE id = ?",
        [bankName, accountNumber, accountHolder, socialMedia, notes, existing.id]
      );
      return this.findProfileById(existing.id);
    }
    this.db.execute(
      "INSERT INTO affiliate_profiles (id, brand_id, customer_id, referral_code, bank_name, bank_account_number, bank_account_holder, social_media, notes, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, upper(?), ?, ?, ?, ?, ?, 'PENDING', datetime('now'), datetime('now'))",
      [id, brandId, customerId, referralCode, bankName, accountNumber, accountHolder, socialMedia, notes]
    );
    return this.findProfileById(id);
  }

  approveProfile({ profileId, approvedBy = null }) {
    this.db.execute(
      "UPDATE affiliate_profiles SET status = 'ACTIVE', approved_at = datetime('now'), approved_by = ?, rejection_reason = NULL, updated_at = datetime('now') " +
      "WHERE id = ?",
      [approvedBy, profileId]
    );
    return this.findProfileById(profileId);
  }

  rejectProfile({ profileId, rejectionReason = 'Pengajuan belum memenuhi syarat' }) {
    this.db.execute(
      "UPDATE affiliate_profiles SET status = 'REJECTED', rejection_reason = ?, updated_at = datetime('now') " +
      "WHERE id = ?",
      [rejectionReason, profileId]
    );
    return this.findProfileById(profileId);
  }

  listProfilesByBrand({ brandId, status = null }) {
    const clauses = ["p.brand_id = ?"];
    const params = [brandId];
    if (status && status !== 'ALL') {
      clauses.push("p.status = ?");
      params.push(status);
    }
    return this.db.queryMany(
      "SELECT p.*, " +
      "c.display_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email " +
      "FROM affiliate_profiles p " +
      "LEFT JOIN customers c ON c.id = p.customer_id " +
      "WHERE " + clauses.join(' AND ') + " " +
      "ORDER BY p.created_at DESC",
      params
    );
  }

  updateBankDetails({ profileId, bankName, accountNumber, accountHolder }) {
    this.db.execute(
      "UPDATE affiliate_profiles SET bank_name = ?, bank_account_number = ?, bank_account_holder = ?, updated_at = datetime('now') " +
      "WHERE id = ?",
      [bankName, accountNumber, accountHolder, profileId]
    );
    return this.findProfileById(profileId);
  }

  // 3. Attribution methods
  recordAttribution({ id, brandId, profileId, referralCode, customerId, sessionId, menuId, source, expiresAt }) {
    this.db.execute(
      "INSERT INTO affiliate_attributions (id, brand_id, affiliate_profile_id, referral_code, customer_id, session_id, menu_id, source, attributed_at, expires_at) " +
      "VALUES (?, ?, ?, upper(?), ?, ?, ?, ?, datetime('now'), ?)",
      [id, brandId, profileId, referralCode, customerId || null, sessionId || null, menuId || null, source || 'whatsapp', expiresAt]
    );
  }

  findLatestValidAttribution({ brandId, customerId, sessionId }) {
    if (customerId) {
      const byCust = this.db.queryOne(
        "SELECT a.*, p.customer_id AS affiliate_customer_id FROM affiliate_attributions a " +
        "JOIN affiliate_profiles p ON p.id = a.affiliate_profile_id " +
        "WHERE a.brand_id = ? AND a.customer_id = ? AND datetime(a.expires_at) > datetime('now') " +
        "ORDER BY a.attributed_at DESC LIMIT 1",
        [brandId, customerId]
      );
      if (byCust) return byCust;
    }
    if (sessionId) {
      return this.db.queryOne(
        "SELECT a.*, p.customer_id AS affiliate_customer_id FROM affiliate_attributions a " +
        "JOIN affiliate_profiles p ON p.id = a.affiliate_profile_id " +
        "WHERE a.brand_id = ? AND a.session_id = ? AND datetime(a.expires_at) > datetime('now') " +
        "ORDER BY a.attributed_at DESC LIMIT 1",
        [brandId, sessionId]
      );
    }
    return null;
  }

  // 4. Conversion & Commission methods
  recordConversion({ id, brandId, profileId, orderId, customerId, eligibleSubtotal, totalItems = 1, commissionRate, commissionAmount, status = 'PENDING' }) {
    this.db.execute(
      "INSERT INTO affiliate_conversions (id, brand_id, affiliate_profile_id, order_id, customer_id, eligible_subtotal, total_items, commission_rate, commission_amount, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
      [id, brandId, profileId, orderId, customerId || null, eligibleSubtotal, totalItems || 1, commissionRate, commissionAmount, status]
    );

    // Update balances on profile
    if (status === 'APPROVED' || status === 'PAYABLE') {
      this.db.execute(
        "UPDATE affiliate_profiles SET total_earnings = total_earnings + ?, balance_payable = balance_payable + ?, updated_at = datetime('now') WHERE id = ?",
        [commissionAmount, commissionAmount, profileId]
      );
    } else if (status === 'PENDING') {
      this.db.execute(
        "UPDATE affiliate_profiles SET total_earnings = total_earnings + ?, balance_pending = balance_pending + ?, updated_at = datetime('now') WHERE id = ?",
        [commissionAmount, commissionAmount, profileId]
      );
    }

    return this.findConversionByOrder(orderId);
  }

  findConversionByOrder(orderId) {
    return this.db.queryOne(
      "SELECT id, brand_id, affiliate_profile_id, order_id, customer_id, eligible_subtotal, total_items, commission_rate, commission_amount, status, created_at, updated_at " +
      "FROM affiliate_conversions WHERE order_id = ?",
      [orderId]
    );
  }

  approvePendingConversion(orderId) {
    const conv = this.findConversionByOrder(orderId);
    if (!conv || conv.status !== 'PENDING') return null;

    this.db.execute(
      "UPDATE affiliate_conversions SET status = 'APPROVED', updated_at = datetime('now') WHERE order_id = ?",
      [orderId]
    );

    this.db.execute(
      "UPDATE affiliate_profiles SET balance_pending = MAX(0, balance_pending - ?), balance_payable = balance_payable + ?, updated_at = datetime('now') WHERE id = ?",
      [conv.commission_amount, conv.commission_amount, conv.affiliate_profile_id]
    );

    return this.findConversionByOrder(orderId);
  }

  voidConversion(orderId) {
    const conv = this.findConversionByOrder(orderId);
    if (!conv || conv.status === 'VOIDED') return null;

    this.db.execute(
      "UPDATE affiliate_conversions SET status = 'VOIDED', updated_at = datetime('now') WHERE order_id = ?",
      [orderId]
    );

    if (conv.status === 'PENDING') {
      this.db.execute(
        "UPDATE affiliate_profiles SET total_earnings = MAX(0, total_earnings - ?), balance_pending = MAX(0, balance_pending - ?), updated_at = datetime('now') WHERE id = ?",
        [conv.commission_amount, conv.commission_amount, conv.affiliate_profile_id]
      );
    } else if (conv.status === 'APPROVED' || conv.status === 'PAYABLE') {
      this.db.execute(
        "UPDATE affiliate_profiles SET total_earnings = MAX(0, total_earnings - ?), balance_payable = MAX(0, balance_payable - ?), updated_at = datetime('now') WHERE id = ?",
        [conv.commission_amount, conv.commission_amount, conv.affiliate_profile_id]
      );
    }

    return this.findConversionByOrder(orderId);
  }

  // 5. Payout methods
  createPayout({ id, brandId, profileId, amount, bankName, accountNumber, accountHolder, notes = null }) {
    this.db.execute(
      "INSERT INTO affiliate_payouts (id, brand_id, affiliate_profile_id, amount, bank_name, bank_account_number, bank_account_holder, status, notes, requested_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, datetime('now'))",
      [id, brandId, profileId, amount, bankName, accountNumber, accountHolder, notes]
    );

    // Deduct immediately from balance_payable to prevent double withdrawal
    this.db.execute(
      "UPDATE affiliate_profiles SET balance_payable = MAX(0, balance_payable - ?), updated_at = datetime('now') WHERE id = ?",
      [amount, profileId]
    );

    return this.findPayoutById(id);
  }

  findPayoutById(id) {
    return this.db.queryOne(
      "SELECT id, brand_id, affiliate_profile_id, amount, bank_name, bank_account_number, bank_account_holder, " +
      "status, transfer_receipt_url, rejection_reason, notes, requested_at, processed_at " +
      "FROM affiliate_payouts WHERE id = ?",
      [id]
    );
  }

  listPayoutsByProfile(profileId) {
    return this.db.queryMany(
      "SELECT id, brand_id, affiliate_profile_id, amount, bank_name, bank_account_number, bank_account_holder, " +
      "status, transfer_receipt_url, rejection_reason, notes, requested_at, processed_at " +
      "FROM affiliate_payouts WHERE affiliate_profile_id = ? ORDER BY requested_at DESC",
      [profileId]
    );
  }

  listPayoutsByBrand({ brandId, status = null }) {
    const clauses = ["py.brand_id = ?"];
    const params = [brandId];
    if (status) {
      clauses.push("py.status = ?");
      params.push(status);
    }
    return this.db.queryMany(
      "SELECT py.*, pr.referral_code, c.display_name AS customer_name, c.phone AS customer_phone " +
      "FROM affiliate_payouts py " +
      "JOIN affiliate_profiles pr ON pr.id = py.affiliate_profile_id " +
      "LEFT JOIN customers c ON c.id = pr.customer_id " +
      "WHERE " + clauses.join(' AND ') + " " +
      "ORDER BY py.requested_at DESC",
      params
    );
  }

  markPayoutPaid({ payoutId, receiptUrl = null, notes = null }) {
    const payout = this.findPayoutById(payoutId);
    if (!payout || payout.status !== 'REQUESTED') return null;

    this.db.execute(
      "UPDATE affiliate_payouts SET status = 'PAID', transfer_receipt_url = ?, notes = COALESCE(?, notes), processed_at = datetime('now') WHERE id = ?",
      [receiptUrl, notes, payoutId]
    );

    this.db.execute(
      "UPDATE affiliate_profiles SET total_withdrawn = total_withdrawn + ?, updated_at = datetime('now') WHERE id = ?",
      [payout.amount, payout.affiliate_profile_id]
    );

    return this.findPayoutById(payoutId);
  }

  rejectPayout({ payoutId, rejectionReason = 'Permintaan ditolak', notes = null }) {
    const payout = this.findPayoutById(payoutId);
    if (!payout || payout.status !== 'REQUESTED') return null;

    this.db.execute(
      "UPDATE affiliate_payouts SET status = 'REJECTED', rejection_reason = ?, notes = COALESCE(?, notes), processed_at = datetime('now') WHERE id = ?",
      [rejectionReason, notes, payoutId]
    );

    // Restore balance_payable
    this.db.execute(
      "UPDATE affiliate_profiles SET balance_payable = balance_payable + ?, updated_at = datetime('now') WHERE id = ?",
      [payout.amount, payout.affiliate_profile_id]
    );

    return this.findPayoutById(payoutId);
  }

  // 6. Stats & counts
  getStats(profileId) {
    const profile = this.findProfileById(profileId);
    if (!profile) return null;

    const clicks = this.db.queryOne(
      "SELECT COUNT(*) AS total_clicks FROM affiliate_attributions WHERE affiliate_profile_id = ?",
      [profileId]
    );

    const orders = this.db.queryOne(
      "SELECT COUNT(*) AS total_orders, COALESCE(SUM(commission_amount), 0) AS total_commission " +
      "FROM affiliate_conversions WHERE affiliate_profile_id = ? AND status != 'VOIDED'",
      [profileId]
    );

    return {
      profile,
      total_clicks: clicks ? Number(clicks.total_clicks || 0) : 0,
      total_orders: orders ? Number(orders.total_orders || 0) : 0,
      total_commission: orders ? Number(orders.total_commission || 0) : 0
    };
  }
}

module.exports = AffiliateRepository;
