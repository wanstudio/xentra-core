'use strict';

const { domain } = require('../../core');
const BannerContent = require('./domain/BannerContent');
const BannerContentService = require('./services/BannerContentService');

const BANNER_IDENTITY = {
  name: 'banner',
  version: '1.0.0',
  display_name: 'Xentra Storefront Banner',
  description: 'Brand-scoped storefront banner content and publication lifecycle'
};

const BANNER_CAPABILITIES = {
  events_produced: [
    'banner.content.created',
    'banner.content.published'
  ],
  events_consumed: [],
  permissions_required: [
    'banner:view',
    'banner:manage'
  ],
  features_provided: [
    'storefront_banner_content',
    'draft_revision_workflow',
    'explicit_publish_boundary'
  ]
};

let registration = null;
try {
  registration = domain.DomainRegistry.register({
    identity: BANNER_IDENTITY,
    capabilities: BANNER_CAPABILITIES
  });
} catch (e) {
  registration = domain.DomainRegistry.getDomain('banner');
}

module.exports = {
  identity: BANNER_IDENTITY,
  capabilities: BANNER_CAPABILITIES,
  registration,
  BannerContent,
  BannerContentService
};
