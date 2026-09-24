/**
 * XENTRA CORE — BANNER ROUTE HELPERS
 *
 * Shared legacy banner parsing and delivery-safe media resolution.
 */
'use strict';

function createBannerHelpers(mediaService) {
  function bannerMediaDelivery(brandId, mediaId) {
    if (!mediaId) {
      return { media_id: null, preview_url: null, srcset_variants: [] };
    }

    try {
      const asset = mediaService.getMedia({ mediaId, brandId });
      const variants = Array.isArray(asset.variants) ? asset.variants : [];
      const preview = variants.find(v => Number(v.width) >= 640) || variants[variants.length - 1] || null;
      return {
        media_id: mediaId,
        preview_url: preview ? preview.url : asset.url,
        srcset_variants: variants.map(v => ({
          url: v.url,
          width: v.width,
          height: v.height,
          name: v.name
        }))
      };
    } catch (_) {
      return { media_id: mediaId, preview_url: null, srcset_variants: [] };
    }
  }

  function parseLegacyBrandBanners(brand) {
    if (!brand || brand.banners === null || brand.banners === undefined || brand.banners === '') return [];
    try {
      const parsed = typeof brand.banners === 'string' ? JSON.parse(brand.banners) : brand.banners;
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  return { bannerMediaDelivery, parseLegacyBrandBanners };
}

module.exports = { createBannerHelpers };
