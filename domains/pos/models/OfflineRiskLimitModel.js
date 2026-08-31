/**
 * Xentra POS Offline Risk Limit Model
 * Strictly validates Branch Manager offline limits against Owner Global Safety Ceiling.
 * Fail-Fast Rule: Rejects with explicit error if branch exceeds ceiling. No auto-clamping.
 */
class OfflineRiskLimitModel {
  static DEFAULT_OWNER_CEILING = {
    max_offline_amount: 5000000, // Rp 5.000.000 max cumulative offline
    max_offline_duration_hours: 4  // 4 hours max offline duration
  };

  /**
   * Validates branch offline configuration against owner safety ceiling.
   * 
   * @param {Object} branchConfig
   * @param {number} [branchConfig.max_offline_amount]
   * @param {number} [branchConfig.max_offline_duration_hours]
   * @param {Object} [ownerCeiling]
   * @returns {{ is_valid: boolean, effective_config: Object }}
   * @throws {Error} If branch config exceeds owner safety ceiling
   */
  static validate({ branchConfig = {}, ownerCeiling = OfflineRiskLimitModel.DEFAULT_OWNER_CEILING }) {
    const ceilingAmount = Number(ownerCeiling.max_offline_amount) || OfflineRiskLimitModel.DEFAULT_OWNER_CEILING.max_offline_amount;
    const ceilingHours = Number(ownerCeiling.max_offline_duration_hours) || OfflineRiskLimitModel.DEFAULT_OWNER_CEILING.max_offline_duration_hours;

    const requestedAmount = branchConfig.max_offline_amount != null ? Number(branchConfig.max_offline_amount) : ceilingAmount;
    const requestedHours = branchConfig.max_offline_duration_hours != null ? Number(branchConfig.max_offline_duration_hours) : ceilingHours;

    if (requestedAmount > ceilingAmount) {
      throw new Error(`[OfflineRiskLimit] Batas nominal offline cabang (Rp ${requestedAmount.toLocaleString('id-ID')}) melebihi Safety Ceiling Owner (Maks: Rp ${ceilingAmount.toLocaleString('id-ID')}). Silakan ajukan eskalasi kebijakan jika membutuhkan limit lebih tinggi.`);
    }

    if (requestedHours > ceilingHours) {
      throw new Error(`[OfflineRiskLimit] Batas durasi offline cabang (${requestedHours} jam) melebihi Safety Ceiling Owner (Maks: ${ceilingHours} jam).`);
    }

    return {
      is_valid: true,
      effective_config: {
        max_offline_amount: requestedAmount,
        max_offline_duration_hours: requestedHours
      }
    };
  }
}

module.exports = OfflineRiskLimitModel;
