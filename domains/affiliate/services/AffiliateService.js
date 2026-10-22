'use strict';

const crypto = require('crypto');
const AffiliateRepository = require('../repositories/AffiliateRepository');

function makeId(prefix) {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '');
}

function generateReferralCode(name) {
  const base = String(name || 'USER')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5) || 'FOOD';
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${base}${rand}`;
}

class AffiliateService {
  constructor(repository = new AffiliateRepository()) {
    this.repo = repository;
  }

  ensureSchema() {
    this.repo.ensureSchema();
  }

  async getProgram({ brandId }) {
    this.ensureSchema();
    if (!brandId) throw new Error('BRAND_ID_REQUIRED');
    let prog = this.repo.findProgram(brandId);
    if (!prog) {
      prog = this.repo.upsertProgram({ brandId });
    }
    return prog;
  }

  async updateProgram({ brandId, commissionType, commissionRate, commissionPerItem, cookieDays, minPayoutAmount, isActive }) {
    this.ensureSchema();
    if (!brandId) throw new Error('BRAND_ID_REQUIRED');
    return this.repo.upsertProgram({
      brandId,
      commissionType: commissionType || (commissionRate && commissionRate <= 50 ? 'PERCENTAGE' : 'FIXED_PER_ITEM'),
      commissionRate: commissionRate != null ? Number(commissionRate) : undefined,
      commissionPerItem: commissionPerItem != null ? Number(commissionPerItem) : (commissionRate != null ? Number(commissionRate) : undefined),
      cookieDays: cookieDays != null ? parseInt(cookieDays, 10) : undefined,
      minPayoutAmount: minPayoutAmount != null ? Number(minPayoutAmount) : undefined,
      isActive: isActive != null ? (isActive ? 1 : 0) : undefined
    });
  }

  async getOrCreateProfile({ brandId, customerId, customerName = null, customerPhone = null }) {
    this.ensureSchema();
    if (!brandId) throw new Error('BRAND_ID_REQUIRED');
    if (!customerId) throw new Error('CUSTOMER_ID_REQUIRED');

    let profile = this.repo.findProfileByCustomer({ brandId, customerId });
    if (!profile) {
      // Generate unique referral code
      let code = generateReferralCode(customerName);
      let attempts = 0;
      while (this.repo.findProfileByCode({ brandId, referralCode: code }) && attempts < 10) {
        code = generateReferralCode(customerName);
        attempts++;
      }

      const id = makeId('aff_prof');
      profile = this.repo.createProfile({
        id,
        brandId,
        customerId,
        referralCode: code
      });
    }

    return profile;
  }

  async updateBankDetails({ brandId, customerId, bankName, accountNumber, accountHolder }) {
    this.ensureSchema();
    if (!brandId) throw new Error('BRAND_ID_REQUIRED');
    if (!customerId) throw new Error('CUSTOMER_ID_REQUIRED');

    const profile = await this.getOrCreateProfile({ brandId, customerId });

    const cleanBank = String(bankName || '').trim();
    const cleanNumber = String(accountNumber || '').trim();
    const cleanHolder = String(accountHolder || '').trim();

    if (!cleanBank) throw new Error('BANK_NAME_REQUIRED');
    if (!cleanNumber) throw new Error('ACCOUNT_NUMBER_REQUIRED');
    if (!cleanHolder) throw new Error('ACCOUNT_HOLDER_REQUIRED');

    return this.repo.updateBankDetails({
      profileId: profile.id,
      bankName: cleanBank,
      accountNumber: cleanNumber,
      accountHolder: cleanHolder
    });
  }

  async recordAttribution({ brandId, referralCode, customerId = null, sessionId = null, menuId = null, source = 'whatsapp' }) {
    this.ensureSchema();
    if (!brandId) throw new Error('BRAND_ID_REQUIRED');
    if (!referralCode) return { success: false, reason: 'NO_REFERRAL_CODE' };

    const program = await this.getProgram({ brandId });
    if (!program || !program.is_active) {
      return { success: false, reason: 'PROGRAM_INACTIVE' };
    }

    const profile = this.repo.findProfileByCode({ brandId, referralCode: referralCode.trim() });
    if (!profile) {
      return { success: false, reason: 'REFERRAL_CODE_NOT_FOUND' };
    }

    if (profile.status && profile.status !== 'ACTIVE') {
      return { success: false, reason: 'AFFILIATE_NOT_ACTIVE' };
    }

    // Prevent self-referral attribution if authenticated customer is the affiliate owner
    if (customerId && String(profile.customer_id) === String(customerId)) {
      return { success: false, reason: 'SELF_REFERRAL_BLOCKED' };
    }

    const cookieDays = Number(program.cookie_days || 14);
    const expiresAt = new Date(Date.now() + cookieDays * 24 * 60 * 60 * 1000).toISOString();
    const id = makeId('aff_attr');

    this.repo.recordAttribution({
      id,
      brandId,
      profileId: profile.id,
      referralCode: profile.referral_code,
      customerId,
      sessionId,
      menuId,
      source,
      expiresAt
    });

    return {
      success: true,
      referral_code: profile.referral_code,
      affiliate_profile_id: profile.id,
      expires_at: expiresAt
    };
  }

  async evaluateOrderConversion({ brandId, orderId, referralCode = null, customerId = null, sessionId = null, subtotal = 0, discountAmount = 0, items = [], totalItems = null }) {
    this.ensureSchema();
    if (!brandId || !orderId) return null;

    // Check if already processed (Idempotency)
    const existing = this.repo.findConversionByOrder(orderId);
    if (existing) return existing;

    const program = await this.getProgram({ brandId });
    if (!program || !program.is_active) return null;

    let profile = null;

    // 1. Explicit referral code from checkout
    if (referralCode && String(referralCode).trim()) {
      profile = this.repo.findProfileByCode({ brandId, referralCode: String(referralCode).trim() });
    }

    // 2. Fallback to latest valid attribution
    if (!profile) {
      const attr = this.repo.findLatestValidAttribution({ brandId, customerId, sessionId });
      if (attr) {
        profile = this.repo.findProfileById(attr.affiliate_profile_id);
      }
    }

    if (!profile) return null;

    // Only approved/active affiliates can earn commission
    if (profile.status && profile.status !== 'ACTIVE') {
      return null;
    }

    // Self-referral prevention: Affiliate cannot earn from their own purchase
    if (customerId && String(profile.customer_id) === String(customerId)) {
      return null;
    }

    // Compute eligible net merchandise subtotal (subtotal - discount)
    const eligibleSubtotal = Math.max(0, Number(subtotal || 0) - Number(discountAmount || 0));
    if (eligibleSubtotal <= 0) return null;

    const commissionType = program.commission_type || (Number(program.commission_rate) <= 50 ? 'PERCENTAGE' : 'FIXED_PER_ITEM');
    let commissionAmount = 0;
    let commissionRate = 1000;
    let computedItemsCount = 1;

    if (commissionType === 'PERCENTAGE') {
      commissionRate = Number(program.commission_rate || 5.0);
      commissionAmount = Math.round(eligibleSubtotal * (commissionRate / 100));
    } else {
      // Default: FIXED_PER_ITEM (Rp1.000 per menu/item terjual)
      commissionRate = Number(program.commission_per_item || program.commission_rate || 1000);
      computedItemsCount = totalItems != null && Number(totalItems) > 0
        ? Number(totalItems)
        : (Array.isArray(items) && items.length > 0
            ? items.reduce((sum, it) => sum + Number(it.quantity || it.qty || 1), 0)
            : 1);
      commissionAmount = computedItemsCount * commissionRate;
    }

    if (commissionAmount <= 0) return null;

    const convId = makeId('aff_conv');
    return this.repo.recordConversion({
      id: convId,
      brandId,
      profileId: profile.id,
      orderId,
      customerId,
      eligibleSubtotal,
      totalItems: computedItemsCount,
      commissionRate,
      commissionAmount,
      status: 'PENDING'
    });
  }

  async approveOrderCommission({ orderId }) {
    this.ensureSchema();
    if (!orderId) return null;
    return this.repo.approvePendingConversion(orderId);
  }

  async voidOrderCommission({ orderId }) {
    this.ensureSchema();
    if (!orderId) return null;
    return this.repo.voidConversion(orderId);
  }

  async requestPayout({ brandId, customerId, amount, notes = null }) {
    this.ensureSchema();
    if (!brandId) throw new Error('BRAND_ID_REQUIRED');
    if (!customerId) throw new Error('CUSTOMER_ID_REQUIRED');

    const profile = await this.getOrCreateProfile({ brandId, customerId });
    const program = await this.getProgram({ brandId });

    if (!profile.bank_name || !profile.bank_account_number || !profile.bank_account_holder) {
      throw new Error('BANK_DETAILS_INCOMPLETE');
    }

    const withdrawAmount = Number(amount || 0);
    const minPayout = Number(program.min_payout_amount || 50000);

    if (withdrawAmount < minPayout) {
      throw new Error(`MINIMUM_PAYOUT_AMOUNT_NOT_MET: Rp${minPayout.toLocaleString('id-ID')}`);
    }

    if (withdrawAmount > Number(profile.balance_payable || 0)) {
      throw new Error('INSUFFICIENT_PAYABLE_BALANCE');
    }

    const payoutId = makeId('aff_pay');
    return this.repo.createPayout({
      id: payoutId,
      brandId,
      profileId: profile.id,
      amount: withdrawAmount,
      bankName: profile.bank_name,
      accountNumber: profile.bank_account_number,
      accountHolder: profile.bank_account_holder,
      notes
    });
  }

  async listPayoutsByCustomer({ brandId, customerId }) {
    this.ensureSchema();
    const profile = await this.getOrCreateProfile({ brandId, customerId });
    return this.repo.listPayoutsByProfile(profile.id);
  }

  async listPayoutsForAdmin({ brandId, status = null }) {
    this.ensureSchema();
    if (!brandId) throw new Error('BRAND_ID_REQUIRED');
    return this.repo.listPayoutsByBrand({ brandId, status });
  }

  async processAdminPayout({ brandId, payoutId, action, notes = null, receiptUrl = null, transferReference = null, rejectionReason = null }) {
    this.ensureSchema();
    if (!brandId) throw new Error('BRAND_ID_REQUIRED');
    if (!payoutId) throw new Error('PAYOUT_ID_REQUIRED');

    const payout = this.repo.findPayoutById(payoutId);
    if (!payout) throw new Error('PAYOUT_NOT_FOUND');
    if (String(payout.brand_id) !== String(brandId)) throw new Error('UNAUTHORIZED_BRAND');

    if (action === 'APPROVE') {
      const finalReceipt = transferReference || receiptUrl;
      const res = this.repo.markPayoutPaid({ payoutId, receiptUrl: finalReceipt, notes });
      if (!res) return null;
      return {
        ...res,
        transfer_reference: res.transfer_receipt_url
      };
    } else if (action === 'REJECT') {
      return this.repo.rejectPayout({ payoutId, rejectionReason: rejectionReason || notes || 'Ditolak oleh admin', notes });
    } else {
      throw new Error('INVALID_PAYOUT_ACTION');
    }
  }

  async getCustomerStatus({ brandId, customerId }) {
    this.ensureSchema();
    if (!brandId) throw new Error('BRAND_ID_REQUIRED');
    if (!customerId) throw new Error('CUSTOMER_ID_REQUIRED');

    const profile = this.repo.findProfileByCustomer({ brandId, customerId });
    if (!profile) {
      return { registered: false, status: 'NOT_REGISTERED', profile: null };
    }
    return {
      registered: true,
      status: profile.status || 'PENDING',
      profile: {
        id: profile.id,
        referral_code: profile.referral_code,
        status: profile.status || 'PENDING',
        bank_name: profile.bank_name,
        bank_account_number: profile.bank_account_number,
        bank_account_holder: profile.bank_account_holder,
        social_media: profile.social_media,
        notes: profile.notes,
        rejection_reason: profile.rejection_reason,
        approved_at: profile.approved_at,
        created_at: profile.created_at
      }
    };
  }

  async applyForAffiliate({ brandId, customerId, customerName = null, customerPhone = null, socialMedia, bankName, accountNumber, accountHolder, notes = null }) {
    this.ensureSchema();
    if (!brandId) throw new Error('BRAND_ID_REQUIRED');
    if (!customerId) throw new Error('CUSTOMER_ID_REQUIRED');

    const cleanBank = String(bankName || '').trim();
    const cleanNumber = String(accountNumber || '').trim();
    const cleanHolder = String(accountHolder || '').trim();
    const cleanSocial = String(socialMedia || '').trim();

    if (!cleanBank) throw new Error('BANK_NAME_REQUIRED');
    if (!cleanNumber) throw new Error('ACCOUNT_NUMBER_REQUIRED');
    if (!cleanHolder) throw new Error('ACCOUNT_HOLDER_REQUIRED');
    if (!cleanSocial) throw new Error('SOCIAL_MEDIA_REQUIRED');

    let profile = this.repo.findProfileByCustomer({ brandId, customerId });
    let code = profile ? profile.referral_code : generateReferralCode(customerName);
    if (!profile) {
      let attempts = 0;
      while (this.repo.findProfileByCode({ brandId, referralCode: code }) && attempts < 10) {
        code = generateReferralCode(customerName);
        attempts++;
      }
    }

    const id = profile ? profile.id : makeId('aff_prof');
    return this.repo.applyProfile({
      id,
      brandId,
      customerId,
      referralCode: code,
      bankName: cleanBank,
      accountNumber: cleanNumber,
      accountHolder: cleanHolder,
      socialMedia: cleanSocial,
      notes: notes ? String(notes).trim() : null
    });
  }

  async approveAffiliate({ brandId, profileId, approvedBy = null }) {
    this.ensureSchema();
    if (!brandId) throw new Error('BRAND_ID_REQUIRED');
    if (!profileId) throw new Error('PROFILE_ID_REQUIRED');

    const profile = this.repo.findProfileById(profileId);
    if (!profile) throw new Error('AFFILIATE_NOT_FOUND');
    if (String(profile.brand_id) !== String(brandId)) throw new Error('UNAUTHORIZED_BRAND');

    return this.repo.approveProfile({ profileId, approvedBy });
  }

  async rejectAffiliate({ brandId, profileId, rejectionReason = null }) {
    this.ensureSchema();
    if (!brandId) throw new Error('BRAND_ID_REQUIRED');
    if (!profileId) throw new Error('PROFILE_ID_REQUIRED');

    const profile = this.repo.findProfileById(profileId);
    if (!profile) throw new Error('AFFILIATE_NOT_FOUND');
    if (String(profile.brand_id) !== String(brandId)) throw new Error('UNAUTHORIZED_BRAND');

    return this.repo.rejectProfile({ profileId, rejectionReason: rejectionReason || 'Pengajuan belum memenuhi syarat' });
  }

  async listAffiliatesForAdmin({ brandId, status = null }) {
    this.ensureSchema();
    if (!brandId) throw new Error('BRAND_ID_REQUIRED');
    return this.repo.listProfilesByBrand({ brandId, status });
  }

  async getCustomerStats({ brandId, customerId }) {
    this.ensureSchema();
    const profile = await this.getOrCreateProfile({ brandId, customerId });
    const program = await this.getProgram({ brandId });
    const stats = this.repo.getStats(profile.id);
    const payouts = this.repo.listPayoutsByProfile(profile.id);

    return {
      ...stats,
      program: {
        commission_type: program.commission_type || 'FIXED_PER_ITEM',
        commission_rate: program.commission_rate,
        commission_per_item: program.commission_per_item || program.commission_rate || 1000,
        min_payout_amount: program.min_payout_amount,
        cookie_days: program.cookie_days
      },
      payouts: payouts || []
    };
  }
}

module.exports = AffiliateService;
