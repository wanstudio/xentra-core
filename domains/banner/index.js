'use strict';

const { domain } = require('../../core');
const BannerContent = require('./domain/BannerContent');
const BannerAssignment = require('./domain/BannerAssignment');
const BannerContentService = require('./services/BannerContentService');
const BannerAssignmentService = require('./services/BannerAssignmentService');

const BANNER_IDENTITY = {
  name: 'banner',
  version: '1.0.0',
  display_name: 'Xentra Storefront Banner',
  description: 'Brand-scoped storefront banner content and placement/visibility lifecycle'
};

const BANNER_CAPABILITIES = {
  events_produced: [
    'banner.content.created',
    'banner.content.published',
    'banner.assignment.created',
    'banner.assignment.changed'
  ],
  events_consumed: [],
  permissions_required: [
    'banner:view',
    'banner:manage'
  ],
  features_provided: [
    'storefront_banner_content',
    'banner_branch_assignment',
    'draft_revision_workflow',
    'explicit_publish_boundary',
    'scheduled_visibility',
    'position_conflict_protection'
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
  BannerAssignment,
  BannerContentService,
  BannerAssignmentService
};
