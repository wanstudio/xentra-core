'use strict';

/**
 * ImageValidator - Authoritative Server-Side Image Security & Format Inspection
 *
 * Implements strict magic byte verification, dimension extraction, aspect ratio check,
 * file size boundaries, and pixel count / megapixel safety limits for Xentra merchant uploads.
 *
 * Supported formats:
 * - JPEG / JPG
 * - PNG
 * - WebP
 *
 * Explicitly rejects:
 * - HEIC / HEIF (with clear machine-readable UNSUPPORTED_FORMAT error)
 * - Executables / script injection disguised as images (including unsanitized SVG, HTML, PHP, scripts)
 * - Spoofed MIME types / extensions
 * - Malformed images / truncated headers
 * - Oversized files / dimensions / megapixel limits
 */

const IMAGE_RULES = {
  logo: {
    maxBytes: 10 * 1024 * 1024, // 10MB (M0 locked policy)
    maxWidth: 4096,
    maxHeight: 4096,
    maxMegaPixels: 20,
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    targetRatio: 1.0,
    ratioTolerance: 0.15, // approximately square: 0.85 to 1.15
    label: 'Brand Logo',
    specsText: 'JPG, PNG, atau WebP · Maks. 10 MB · Rasio 1:1'
  },
  product: {
    maxBytes: 20 * 1024 * 1024, // 20MB (M0 locked policy)
    maxWidth: 4096,
    maxHeight: 4096,
    maxMegaPixels: 20,
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    targetRatio: 1.0,
    ratioTolerance: 0.15,
    label: 'Foto Menu / Produk',
    specsText: 'JPG, PNG, atau WebP · Maks. 20 MB · Rasio 1:1'
  },
  category: {
    maxBytes: 15 * 1024 * 1024, // 15MB (M0 locked policy)
    maxWidth: 4096,
    maxHeight: 4096,
    maxMegaPixels: 20,
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    targetRatio: 1.0,
    ratioTolerance: 0.15,
    label: 'Gambar Kategori',
    specsText: 'JPG, PNG, atau WebP · Maks. 15 MB · Rasio 1:1'
  },
  banner: {
    maxBytes: 20 * 1024 * 1024, // 20MB (M0 locked policy)
    maxWidth: 4096,
    maxHeight: 4096,
    maxMegaPixels: 20,
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    targetRatio: 350 / 180, // ~1.944
    ratioTolerance: 0.35, // range approx 1.60:1 to 2.30:1
    label: 'Banner Promo',
    specsText: 'JPG, PNG, atau WebP · Maks. 20 MB · Rasio ±1.94:1 · Rekomendasi 350 × 180 px'
  },
  avatar: {
    maxBytes: 10 * 1024 * 1024, // 10MB (M0 locked policy)
    maxWidth: 4096,
    maxHeight: 4096,
    maxMegaPixels: 20,
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    targetRatio: 1.0,
    ratioTolerance: 0.15,
    label: 'Avatar / Profile Image',
    specsText: 'JPG, PNG, atau WebP · Maks. 10 MB · Rasio 1:1'
  },
  general: {
    maxBytes: 20 * 1024 * 1024, // 20MB general boundary
    maxWidth: 4096,
    maxHeight: 4096,
    maxMegaPixels: 20,
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    targetRatio: null, // Any aspect ratio allowed
    ratioTolerance: null,
    label: 'Media Umum',
    specsText: 'JPG, PNG, atau WebP · Maks. 20 MB'
  }
};

/**
 * Inspect image buffer magic bytes and extract intrinsic dimensions.
 * Rejects SVG, executables, HTML, HEIC (explicit error), and corrupt buffers.
 */
function inspectImageBuffer(buf) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 12) {
    return { valid: false, error: 'Data gambar terlalu kecil atau kosong.', code: 'DATA_TOO_SMALL' };
  }

  // Detect HEIC / HEIF container: ISOBMFF ftyp box
  // Box header: [4 bytes length][4 bytes 'ftyp'][4 bytes major brand: heic, heix, mif1, msf1, etc.]
  if (buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii').toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) {
      return {
        valid: false,
        error: 'Format HEIC/HEIF saat ini belum didukung untuk server-side processing. Gunakan format JPG, PNG, atau WebP.',
        code: 'UNSUPPORTED_FORMAT',
        detectedFormat: 'heic'
      };
    }
  }

  // Reject SVG, HTML, PHP, shell scripts
  const headStr = buf.slice(0, 100).toString('utf8').toLowerCase();
  if (headStr.includes('<svg') || headStr.includes('<?xml') || headStr.includes('<html') || headStr.includes('<?php') || headStr.startsWith('#!')) {
    return { valid: false, error: 'Format file tidak diizinkan. Gunakan format gambar biner JPG, PNG, atau WebP.', code: 'UNSUPPORTED_FORMAT' };
  }

  // 1. PNG Signature: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) {
    if (buf.length < 24) {
      return { valid: false, error: 'File PNG rusak atau terpotong.', code: 'INVALID_IMAGE_FORMAT' };
    }
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width <= 0 || height <= 0) {
      return { valid: false, error: 'Dimensi file PNG tidak valid.', code: 'INVALID_DIMENSIONS' };
    }
    return { valid: true, format: 'png', mime: 'image/png', ext: 'png', width, height };
  }

  // 2. JPEG Signature: FF D8
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let offset = 2;
    let width = 0;
    let height = 0;
    while (offset < buf.length) {
      if (buf[offset] !== 0xFF) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1];
      if (marker === 0xD9 || marker === 0xDA) { // EOI or SOS (start of scan)
        break;
      }
      if (offset + 4 > buf.length) break;
      const len = buf.readUInt16BE(offset + 2);
      if (marker >= 0xC0 && marker <= 0xC3) { // SOF0, SOF1, SOF2 frames
        if (offset + 9 > buf.length) break;
        height = buf.readUInt16BE(offset + 5);
        width = buf.readUInt16BE(offset + 7);
        break;
      }
      offset += 2 + len;
    }
    if (width > 0 && height > 0) {
      return { valid: true, format: 'jpg', mime: 'image/jpeg', ext: 'jpg', width, height };
    }
    return { valid: false, error: 'File JPEG rusak atau informasi dimensi tidak ditemukan.', code: 'INVALID_IMAGE_FORMAT' };
  }

  // 3. WebP Signature: RIFF....WEBP
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    const chunkHeader = buf.slice(12, 16).toString('ascii');
    if (chunkHeader === 'VP8 ') {
      if (buf.length < 30) {
        return { valid: false, error: 'File WebP VP8 rusak atau terpotong.', code: 'INVALID_IMAGE_FORMAT' };
      }
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      if (width > 0 && height > 0) {
        return { valid: true, format: 'webp', mime: 'image/webp', ext: 'webp', width, height };
      }
    } else if (chunkHeader === 'VP8L') {
      if (buf.length < 25) {
        return { valid: false, error: 'File WebP VP8L rusak atau terpotong.', code: 'INVALID_IMAGE_FORMAT' };
      }
      const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
      const width = 1 + (((b1 & 0x3F) << 8) | b0);
      const height = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6));
      if (width > 0 && height > 0) {
        return { valid: true, format: 'webp', mime: 'image/webp', ext: 'webp', width, height };
      }
    } else if (chunkHeader === 'VP8X') {
      if (buf.length < 30) {
        return { valid: false, error: 'File WebP VP8X rusak atau terpotong.', code: 'INVALID_IMAGE_FORMAT' };
      }
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      if (width > 0 && height > 0) {
        return { valid: true, format: 'webp', mime: 'image/webp', ext: 'webp', width, height };
      }
    }
    return { valid: false, error: 'Format WebP tidak didukung atau rusak.', code: 'INVALID_IMAGE_FORMAT' };
  }

  return { valid: false, error: 'Format file tidak didukung atau signature biner tidak valid. Gunakan format JPG, PNG, atau WebP.', code: 'UNSUPPORTED_FORMAT' };
}

/**
 * Validates an upload payload for a specific asset type (logo, product, category, banner, general).
 * Returns { valid: true, buffer, info } or { valid: false, error, code }.
 */
function validateImageUpload({ imageBase64, mimeType, declaredFilename, assetType = 'general', enforceAspectRatio = true }) {
  const rule = IMAGE_RULES[assetType];
  if (!rule) {
    return { valid: false, error: `Tipe aset gambar '${assetType}' tidak dikenal.`, code: 'INVALID_ASSET_TYPE' };
  }

  if (!imageBase64 || typeof imageBase64 !== 'string' || !imageBase64.trim()) {
    return { valid: false, error: 'Data gambar wajib diunggah.', code: 'MISSING_IMAGE_DATA' };
  }

  // 1. Decode base64 securely
  const rawBase64 = imageBase64.includes(',') ? imageBase64.split(',').pop() : imageBase64;
  let buffer;
  try {
    buffer = Buffer.from(rawBase64, 'base64');
  } catch (err) {
    return { valid: false, error: 'Format base64 tidak valid.', code: 'DECODE_ERROR' };
  }

  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'File gambar kosong.', code: 'EMPTY_FILE' };
  }

  // 2. File size limit
  if (buffer.length > rule.maxBytes) {
    const maxMB = Math.round(rule.maxBytes / (1024 * 1024));
    return { valid: false, error: `Ukuran file melebihi batas maksimal ${maxMB} MB untuk ${rule.label}.`, code: 'FILE_TOO_LARGE' };
  }

  // 3. Binary signature detection & dimension decoding (do NOT trust user mime/ext)
  const inspection = inspectImageBuffer(buffer);
  if (!inspection.valid) {
    return { valid: false, error: inspection.error || 'Gambar tidak valid atau format tidak didukung.', code: inspection.code || 'INVALID_IMAGE_FORMAT' };
  }

  // 4. Dimension limits
  if (rule.maxWidth && inspection.width > rule.maxWidth) {
    return {
      valid: false,
      error: `Lebar gambar (${inspection.width}px) melebihi batas maksimal ${rule.maxWidth}px.`,
      code: 'DIMENSIONS_TOO_LARGE',
      dimensions: { width: inspection.width, height: inspection.height }
    };
  }
  if (rule.maxHeight && inspection.height > rule.maxHeight) {
    return {
      valid: false,
      error: `Tinggi gambar (${inspection.height}px) melebihi batas maksimal ${rule.maxHeight}px.`,
      code: 'DIMENSIONS_TOO_LARGE',
      dimensions: { width: inspection.width, height: inspection.height }
    };
  }

  // 5. Pixel count / Megapixel safety limit
  const megaPixels = (inspection.width * inspection.height) / (1000 * 1000);
  if (rule.maxMegaPixels && megaPixels > rule.maxMegaPixels) {
    return {
      valid: false,
      error: `Jumlah pixel gambar (${megaPixels.toFixed(1)} MP) melebihi batas keamanan ${rule.maxMegaPixels} MP.`,
      code: 'PIXEL_COUNT_TOO_LARGE',
      dimensions: { width: inspection.width, height: inspection.height, megaPixels: Number(megaPixels.toFixed(2)) }
    };
  }

  // 6. Validate aspect ratio (if rule specifies targetRatio and enforceAspectRatio is true)
  if (enforceAspectRatio && rule.targetRatio !== null && rule.targetRatio !== undefined) {
    const ratio = inspection.width / inspection.height;
    const targetRatio = rule.targetRatio;
    const tolerance = rule.ratioTolerance;

    const minRatio = targetRatio - tolerance;
    const maxRatio = targetRatio + tolerance;

    if (ratio < minRatio || ratio > maxRatio) {
      if (assetType === 'banner') {
        return {
          valid: false,
          error: `Rasio gambar banner tidak sesuai (~${ratio.toFixed(2)}:1). Gunakan rasio mendekati 1.94:1 (rekomendasi 350 × 180 px).`,
          code: 'INVALID_ASPECT_RATIO',
          dimensions: { width: inspection.width, height: inspection.height, ratio: Number(ratio.toFixed(2)) }
        };
      } else {
        return {
          valid: false,
          error: `Gambar ${rule.label} harus berasio persegi (1:1). Rasio terdeteksi: ${ratio.toFixed(2)}:1 (${inspection.width} × ${inspection.height} px).`,
          code: 'INVALID_ASPECT_RATIO',
          dimensions: { width: inspection.width, height: inspection.height, ratio: Number(ratio.toFixed(2)) }
        };
      }
    }
  }

  return {
    valid: true,
    buffer,
    info: {
      format: inspection.format,
      mime: inspection.mime,
      ext: inspection.ext,
      width: inspection.width,
      height: inspection.height,
      sizeBytes: buffer.length,
      assetType
    }
  };
}

module.exports = {
  IMAGE_RULES,
  inspectImageBuffer,
  validateImageUpload
};
