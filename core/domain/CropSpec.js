'use strict';

/**
 * CropSpec - Canonical Domain Value Object for Media System M2 Crop Intent
 *
 * M2 produces user crop intent only; browser preview pixels are NOT canonical processed assets.
 * This model encapsulates, validates, and serializes the crop specification for consumption by M3.
 *
 * Coordinates are represented in source-image pixels:
 * - x: top-left X in source image pixels (>= 0)
 * - y: top-left Y in source image pixels (>= 0)
 * - width: crop window width in source image pixels (> 0)
 * - height: crop window height in source image pixels (> 0)
 * - source_width: natural source image width in pixels (> 0)
 * - source_height: natural source image height in pixels (> 0)
 * - aspect_ratio: target aspect ratio (number, e.g. 1.0 for square, ~1.944 for banner)
 * - zoom: display zoom level applied by user (>= 1.0)
 * - asset_type: 'product' | 'category' | 'logo' | 'avatar' | 'banner' | 'general'
 */

const VALID_ASSET_TYPES = ['logo', 'product', 'category', 'banner', 'avatar', 'general'];

const CANONICAL_ASPECT_RATIOS = {
  logo: 1.0,
  product: 1.0,
  category: 1.0,
  avatar: 1.0,
  banner: 350 / 180, // ~1.944
  general: null
};

class CropSpec {
  constructor({
    x = 0,
    y = 0,
    width,
    height,
    source_width,
    source_height,
    aspect_ratio = null,
    zoom = 1.0,
    asset_type = 'general'
  }) {
    this.x = Math.round(Number(x));
    this.y = Math.round(Number(y));
    this.width = Math.round(Number(width));
    this.height = Math.round(Number(height));
    this.source_width = Math.round(Number(source_width));
    this.source_height = Math.round(Number(source_height));
    this.aspect_ratio = aspect_ratio !== null && aspect_ratio !== undefined ? Number(Number(aspect_ratio).toFixed(4)) : null;
    this.zoom = Number(Number(zoom || 1.0).toFixed(2));
    this.asset_type = String(asset_type || 'general').toLowerCase();

    this.validate();
  }

  validate() {
    if (!Number.isFinite(this.source_width) || this.source_width <= 0) {
      throw new Error('source_width must be a positive integer.');
    }
    if (!Number.isFinite(this.source_height) || this.source_height <= 0) {
      throw new Error('source_height must be a positive integer.');
    }
    if (!Number.isFinite(this.width) || this.width <= 0) {
      throw new Error('width must be a positive integer.');
    }
    if (!Number.isFinite(this.height) || this.height <= 0) {
      throw new Error('height must be a positive integer.');
    }
    if (!Number.isFinite(this.x) || this.x < 0) {
      throw new Error('x coordinate must be a non-negative integer.');
    }
    if (!Number.isFinite(this.y) || this.y < 0) {
      throw new Error('y coordinate must be a non-negative integer.');
    }

    // Boundary check within source image
    if (this.x + this.width > this.source_width) {
      throw new Error(`Crop window exceeds source width: x (${this.x}) + width (${this.width}) > source_width (${this.source_width}).`);
    }
    if (this.y + this.height > this.source_height) {
      throw new Error(`Crop window exceeds source height: y (${this.y}) + height (${this.height}) > source_height (${this.source_height}).`);
    }

    if (this.zoom < 1.0) {
      throw new Error('zoom must be >= 1.0.');
    }

    if (!VALID_ASSET_TYPES.includes(this.asset_type)) {
      throw new Error(`Invalid asset_type: '${this.asset_type}'. Must be one of: ${VALID_ASSET_TYPES.join(', ')}.`);
    }
  }

  /**
   * Serialize clean crop intent object for API transmission and storage.
   */
  toJSON() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      source_width: this.source_width,
      source_height: this.source_height,
      aspect_ratio: this.aspect_ratio,
      zoom: this.zoom,
      asset_type: this.asset_type
    };
  }

  /**
   * Compute initial default centered crop for given source dimensions and target ratio.
   */
  static computeDefaultCrop({ sourceWidth, sourceHeight, assetType = 'general', targetRatio = null }) {
    const sw = Number(sourceWidth);
    const sh = Number(sourceHeight);
    if (!sw || !sh || sw <= 0 || sh <= 0) {
      throw new Error('Invalid source dimensions.');
    }

    let ratio = targetRatio;
    if (ratio === null || ratio === undefined) {
      ratio = CANONICAL_ASPECT_RATIOS[assetType] || (sw / sh);
    }

    let cropW, cropH;
    const sourceRatio = sw / sh;

    if (sourceRatio > ratio) {
      // Source is wider than crop box -> match height, center horizontally
      cropH = sh;
      cropW = Math.round(sh * ratio);
    } else {
      // Source is taller than crop box -> match width, center vertically
      cropW = sw;
      cropH = Math.round(sw / ratio);
    }

    // Ensure within source
    cropW = Math.min(cropW, sw);
    cropH = Math.min(cropH, sh);

    const x = Math.max(0, Math.round((sw - cropW) / 2));
    const y = Math.max(0, Math.round((sh - cropH) / 2));

    return new CropSpec({
      x,
      y,
      width: cropW,
      height: cropH,
      source_width: sw,
      source_height: sh,
      aspect_ratio: ratio,
      zoom: 1.0,
      asset_type: assetType
    });
  }

  static fromJSON(data) {
    if (!data) return null;
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return new CropSpec(parsed);
  }
}

module.exports = {
  CropSpec,
  VALID_ASSET_TYPES,
  CANONICAL_ASPECT_RATIOS
};
