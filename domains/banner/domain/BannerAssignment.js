'use strict';

/**
 * Banner Placement / Assignment entity.
 *
 * The assignment owns branch targeting, placement, order, visibility schedule
 * and governance state. Content/publication is intentionally external.
 */
class BannerAssignment {
  static PLACEMENTS = Object.freeze({
    HOME_BANNER_CAROUSEL: 'HOME_BANNER_CAROUSEL'
  });

  static DEFAULT_PLACEMENT = BannerAssignment.PLACEMENTS.HOME_BANNER_CAROUSEL;

  constructor({
    id,
    banner_id,
    brand_id,
    branch_id,
    placement = BannerAssignment.DEFAULT_PLACEMENT,
    position = 1,
    active = 1,
    starts_at = null,
    ends_at = null,
    timezone = 'Asia/Jakarta',
    governance_locked = 0
  }) {
    this.id = id;
    this.banner_id = banner_id;
    this.brand_id = brand_id;
    this.branch_id = branch_id;
    this.placement = placement;
    this.position = Number(position);
    this.active = active === 1 || active === true ? 1 : 0;
    this.starts_at = starts_at;
    this.ends_at = ends_at;
    this.timezone = timezone;
    this.governance_locked = governance_locked === 1 || governance_locked === true ? 1 : 0;
  }
}

module.exports = BannerAssignment;
