'use strict';

/**
 * Xentra Core Media Module (M1)
 *
 * Exposes canonical media components:
 * - MediaLifecycle: State model & transition rules
 * - MediaService: Domain service for upload staging, verification, attachment & replacement
 * - StorageProvider: Storage abstraction & local provider
 */
const MediaLifecycle = require('./MediaLifecycle');
const MediaService = require('./MediaService');
const { StorageProvider, LocalStorageProvider } = require('./StorageProvider');
const { ImageProcessor, DERIVATIVE_PRESETS, DEFAULT_WEBP_OPTIONS } = require('./ImageProcessor');
const { CropSpec } = require('../domain/CropSpec');

module.exports = {
  MediaLifecycle,
  MediaService,
  StorageProvider,
  LocalStorageProvider,
  ImageProcessor,
  DERIVATIVE_PRESETS,
  DEFAULT_WEBP_OPTIONS,
  CropSpec,
  createMediaService: (opts) => new MediaService(opts)
};

