'use strict';

/**
 * Storefront Banner Content domain entity.
 *
 * This entity deliberately contains content/publication concerns only.
 * Branch placement, schedule, active state and position belong to Assignment.
 */
class BannerContent {
  static PUBLICATION_STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    PUBLISHED: 'PUBLISHED'
  });

  static CTA_TYPES = Object.freeze({
    NONE: 'NONE',
    PROMOTION: 'PROMOTION',
    PRODUCT: 'PRODUCT',
    CATEGORY: 'CATEGORY',
    URL: 'URL'
  });

  constructor({
    id,
    brand_id,
    publication_status = BannerContent.PUBLICATION_STATUS.DRAFT,
    published_revision = null,
    draft_revision = null
  }) {
    this.id = id;
    this.brand_id = brand_id;
    this.publication_status = publication_status;
    this.published_revision = published_revision;
    this.draft_revision = draft_revision;
  }
}

module.exports = BannerContent;
