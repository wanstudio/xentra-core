/**
 * Xentra Core Channel Mapper (D6)
 * Resolves Branch -> External Channel/Device ID mapping with strict cross-branch isolation.
 */
class ChannelMapper {
  constructor() {
    this._branchMappings = new Map(); // branch_id -> { wablas_device_id, phone_number, ... }
  }

  /**
   * Registers a branch-to-channel mapping.
   */
  registerMapping(branchId, channelData) {
    if (!branchId || typeof branchId !== 'string') {
      throw new Error('[ChannelMapper] "branchId" is required.');
    }
    if (!channelData || !channelData.wablas_device_id) {
      throw new Error('[ChannelMapper] "wablas_device_id" is required for channel mapping.');
    }

    this._branchMappings.set(branchId.trim(), {
      wablas_device_id: String(channelData.wablas_device_id).trim(),
      phone_number: channelData.phone_number ? String(channelData.phone_number).trim() : null
    });
  }

  /**
   * Resolves channel mapping for a specific branch.
   * Negative assertion: Never fall back to Owner WhatsApp number or another branch's device.
   */
  resolveBranchChannel(branchId) {
    if (!branchId) {
      throw new Error('[ChannelMapper] Cannot resolve channel without target branch_id.');
    }

    const mapping = this._branchMappings.get(String(branchId).trim());
    if (!mapping) {
      throw new Error(`[ChannelMapper] Missing channel mapping for branch "${branchId}". No fallback allowed.`);
    }

    return mapping;
  }

  clear() {
    this._branchMappings.clear();
  }
}

module.exports = ChannelMapper;
