'use strict';

/**
 * ImageProcessor - Canonical Server-Side Image Processing Engine (M3)
 *
 * Implements:
 * - Sharp / libvips pipeline execution
 * - CropSpec consumption with boundary clamping and fail-safe validation
 * - Derivative matrix generation (no upscaling, WebP default @ quality 82)
 * - Metadata stripping (EXIF/GPS/ICC/IPTC/XMP) for customer-facing delivery privacy
 * - Resource safety and memory-efficient streaming/buffer transforms
 * - Canonical output dimensions:
 *     Square assets (product, category, logo, avatar): 320, 640, 1024, 1600, 2048
 *     Banner assets (~1.94:1): 640x330, 1200x619, 1920x990
 */
const sharp = require('sharp');
const { CropSpec } = require('../domain/CropSpec');

// Canonical derivative matrix definitions (CLIENT_MEDIA_REQUIREMENTS.md Section 7 & 8)
const DERIVATIVE_PRESETS = {
  square: [
    { name: 'thumb', width: 320, height: 320 },
    { name: 'sm', width: 640, height: 640 },
    { name: 'md', width: 1024, height: 1024 },
    { name: 'lg', width: 1600, height: 1600 },
    { name: 'xl', width: 2048, height: 2048 }
  ],
  banner: [
    { name: 'sm', width: 640, height: 330 },
    { name: 'md', width: 1200, height: 619 },
    { name: 'lg', width: 1920, height: 990 }
  ]
};

// Benchmarked WebP delivery configuration: quality 82 delivers 50-60% size reduction with sharp fidelity
const DEFAULT_WEBP_OPTIONS = {
  quality: 82,
  effort: 4,
  lossless: false,
  force: true
};

class ImageProcessor {
  constructor({ webpOptions = DEFAULT_WEBP_OPTIONS } = {}) {
    this.webpOptions = { ...DEFAULT_WEBP_OPTIONS, ...webpOptions };
  }

  /**
   * Inspect source image buffer and retrieve intrinsic dimensions and format.
   * @param {Buffer} buffer
   */
  async inspect(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Invalid image buffer.');
    }
    const meta = await sharp(buffer).metadata();
    return {
      format: meta.format,
      width: meta.width,
      height: meta.height,
      hasExif: !!meta.exif,
      channels: meta.channels,
      size: buffer.length
    };
  }

  /**
   * Determine target derivative variants for asset type without upscaling.
   * @param {Object} params
   * @param {string} params.assetType
   * @param {number} params.croppedWidth
   * @param {number} params.croppedHeight
   * @returns {Array<{ name: string, width: number, height: number }>}
   */
  resolveTargetVariants({ assetType, croppedWidth, croppedHeight }) {
    const isBanner = String(assetType).toLowerCase() === 'banner';
    const presets = isBanner ? DERIVATIVE_PRESETS.banner : DERIVATIVE_PRESETS.square;

    // Filter variants so we NEVER upscale beyond cropped source dimensions
    const valid = presets.filter(preset => preset.width <= croppedWidth && preset.height <= croppedHeight);

    // If source is smaller than smallest preset, generate exactly one variant at cropped dimension
    if (valid.length === 0) {
      return [{
        name: 'original',
        width: croppedWidth,
        height: croppedHeight
      }];
    }

    return valid;
  }

  /**
   * Validate and clamp CropSpec against actual source image dimensions.
   * If cropSpec is not provided, computes default centered crop for the asset type.
   * @param {Object} params
   * @param {number} params.sourceWidth
   * @param {number} params.sourceHeight
   * @param {string} params.assetType
   * @param {Object|CropSpec} [params.cropSpec]
   */
  resolveCropSpec({ sourceWidth, sourceHeight, assetType, cropSpec }) {
    if (!cropSpec) {
      return CropSpec.computeDefaultCrop({
        sourceWidth,
        sourceHeight,
        assetType
      });
    }

    // Convert or validate CropSpec instance
    const raw = cropSpec instanceof CropSpec ? cropSpec.toJSON() : cropSpec;
    const x = Math.max(0, Math.round(Number(raw.x || 0)));
    const y = Math.max(0, Math.round(Number(raw.y || 0)));
    let width = Math.round(Number(raw.width));
    let height = Math.round(Number(raw.height));

    if (!width || width <= 0) width = sourceWidth;
    if (!height || height <= 0) height = sourceHeight;

    // Clamp coordinates safely within source boundaries
    const safeX = Math.min(x, Math.max(0, sourceWidth - 1));
    const safeY = Math.min(y, Math.max(0, sourceHeight - 1));
    const safeW = Math.min(width, sourceWidth - safeX);
    const safeH = Math.min(height, sourceHeight - safeY);

    return new CropSpec({
      x: safeX,
      y: safeY,
      width: safeW,
      height: safeH,
      source_width: sourceWidth,
      source_height: sourceHeight,
      aspect_ratio: raw.aspect_ratio || (safeW / safeH),
      zoom: raw.zoom || 1.0,
      asset_type: assetType
    });
  }

  /**
   * Process raw image buffer through M3 canonical pipeline:
   * 1. Validate source metadata
   * 2. Validate/clamp CropSpec
   * 3. Apply crop extract
   * 4. Generate optimized delivery derivatives in WebP format (no upscaling, metadata stripped)
   *
   * @param {Object} options
   * @param {Buffer} options.sourceBuffer - Raw source image binary
   * @param {string} options.assetType - 'product' | 'category' | 'logo' | 'avatar' | 'banner' | 'general'
   * @param {Object|CropSpec} [options.cropSpec] - M2 crop intent
   * @returns {Promise<{
   *   cropSpec: CropSpec,
   *   sourceMeta: { width: number, height: number, format: string },
   *   derivatives: Array<{
   *     name: string,
   *     width: number,
   *     height: number,
   *     format: 'webp',
   *     mimeType: 'image/webp',
   *     buffer: Buffer,
   *     sizeBytes: number
   *   }>
   * }>}
   */
  async process({ sourceBuffer, assetType = 'general', cropSpec = null }) {
    if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length === 0) {
      throw new Error('Valid source image buffer is required for processing.');
    }

    // 1. Inspect source
    const sourceMeta = await this.inspect(sourceBuffer);

    // 2. Resolve & clamp CropSpec
    const resolvedCrop = this.resolveCropSpec({
      sourceWidth: sourceMeta.width,
      sourceHeight: sourceMeta.height,
      assetType,
      cropSpec
    });

    // 3. Prepare base cropped sharp instance
    // Note: Do not call withMetadata(), ensuring EXIF/GPS/IPTC/XMP/ICC metadata is stripped from output
    const croppedPipeline = sharp(sourceBuffer, { failOnError: false })
      .extract({
        left: resolvedCrop.x,
        top: resolvedCrop.y,
        width: resolvedCrop.width,
        height: resolvedCrop.height
      });

    // Render cropped buffer once to avoid re-extracting for every derivative size
    const croppedBuffer = await croppedPipeline.toBuffer();

    // 4. Resolve target derivatives (no upscaling)
    const targetVariants = this.resolveTargetVariants({
      assetType,
      croppedWidth: resolvedCrop.width,
      croppedHeight: resolvedCrop.height
    });

    // 5. Generate each derivative in WebP
    const derivatives = [];
    for (const variant of targetVariants) {
      const variantBuffer = await sharp(croppedBuffer, { failOnError: false })
        .resize(variant.width, variant.height, {
          fit: 'fill',
          withoutEnlargement: true
        })
        .webp(this.webpOptions)
        .toBuffer();

      derivatives.push({
        name: variant.name,
        width: variant.width,
        height: variant.height,
        format: 'webp',
        mimeType: 'image/webp',
        buffer: variantBuffer,
        sizeBytes: variantBuffer.length
      });
    }

    return {
      cropSpec: resolvedCrop,
      sourceMeta,
      derivatives
    };
  }
}

module.exports = {
  ImageProcessor,
  DERIVATIVE_PRESETS,
  DEFAULT_WEBP_OPTIONS
};
