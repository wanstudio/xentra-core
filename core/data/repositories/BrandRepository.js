'use strict';

/**
 * Brand persistence adapter.
 *
 * Exposes tenant-resolution reads while keeping persistence details behind
 * the data boundary. Tenant authority and request security remain in the
 * resolver/control-plane layer.
 */
const DataAccess = require('../DataAccess');

// ── Custom-domain → brand resolution cache (P1.2) ───────────────────────────
// Tenant resolution runs `findByCustomDomain` on every API request (CORS dynamic
// origin check + tenantResolver); same-origin requests that carry an `Origin`
// header resolve the same host twice. The mapping is global (one `brands` table)
// and only changes through an explicit brand write, so a short TTL is safe.
//
// Isolation guarantees:
//  - the key is the EXACT normalization the SQL predicate uses (trim+lowercase),
//    so a cached entry can never map a hostname to a different brand;
//  - only POSITIVE hits are cached — an unknown hostname always falls through to
//    the authoritative query (a newly registered domain resolves immediately);
//  - a copy is returned per call because callers mutate `req.brand`;
//  - the cache is cleared on every brand write (repository + profile route).
const DOMAIN_CACHE_TTL_MS = 60 * 1000;
const DOMAIN_CACHE_MAX_ENTRIES = 500;
const domainCache = new Map();

function clearDomainCache() {
  domainCache.clear();
}

function readDomainCache(key) {
  const hit = domainCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    domainCache.delete(key);
    return null;
  }
  return Object.assign({}, hit.brand);
}

function writeDomainCache(key, brand) {
  if (domainCache.size >= DOMAIN_CACHE_MAX_ENTRIES) domainCache.clear();
  domainCache.set(key, { brand: Object.assign({}, brand), expiresAt: Date.now() + DOMAIN_CACHE_TTL_MS });
}

class BrandRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  async ready() {
    await this.db.ready();
    return this;
  }

  findByCustomDomain(hostname) {
    const clean = typeof hostname === 'string' ? hostname.trim().toLowerCase() : hostname;
    const cacheable = typeof clean === 'string' && clean.length > 0;
    if (cacheable) {
      const cached = readDomainCache(clean);
      if (cached) return cached;
    }

    // Authoritative tenant/client domain registry is the primary source.
    // Application surface is returned as data (including `driver`).
    let brand = null;
    try {
      brand = this.db.queryOne(`
        SELECT b.*,
               td.hostname AS registered_hostname,
               td.surface_type AS surface_type
        FROM tenant_domains td
        JOIN brands b ON b.id = td.brand_id
        WHERE lower(trim(td.hostname)) = ?
          AND lower(trim(td.status)) = 'active'
          AND lower(trim(td.verification_status)) = 'verified'
        LIMIT 1
      `, [clean]);
    } catch (_) {
      // Legacy database compatibility: the registry table may not exist yet.
    }

    // Transitional compatibility for existing tests/tenants: exact custom_domain only.
    // Never infer tenant identity by hostname prefix.
    if (!brand) {
      brand = this.db.queryOne(`
        SELECT *
        FROM brands
        WHERE lower(trim(custom_domain)) = ?
        LIMIT 1
      `, [clean]);
    }

    if (cacheable && brand) writeDomainCache(clean, brand);
    return brand;
  }
  clearCustomDomainCache() {
    clearDomainCache();
  }

  static clearCustomDomainCache() {
    clearDomainCache();
  }

  findById(brandId) {
    return this.db.queryOne('SELECT * FROM brands WHERE id = ? LIMIT 1', [brandId]);
  }

  updateBrandProfile(brandId, { name, tagline, primary_color, merchant_pwa_name, pos_pwa_name, banners }) {
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      throw new Error('Nama brand harus berupa teks yang valid.');
    }

    let normalizedPrimaryColor = undefined;
    if (primary_color !== undefined && primary_color !== null) {
      if (typeof primary_color !== 'string') {
        throw new Error('Format warna tema (hex) tidak valid.');
      }
      let cleanHex = primary_color.trim();
      if (!cleanHex.startsWith('#')) cleanHex = '#' + cleanHex;
      if (/^#[0-9a-fA-F]{3}$/.test(cleanHex)) {
        cleanHex = '#' + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2] + cleanHex[3] + cleanHex[3];
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(cleanHex)) {
        throw new Error('Format warna tema (hex) tidak valid. Gunakan format #RRGGBB.');
      }
      normalizedPrimaryColor = cleanHex.toUpperCase();
    }

    if (banners !== undefined && banners !== null) {
      if (typeof banners === 'string') {
        try {
          const parsed = JSON.parse(banners);
          if (!Array.isArray(parsed)) throw new Error();
        } catch (_) {
          throw new Error('Format banners JSON tidak valid, harus berupa JSON array.');
        }
      } else if (!Array.isArray(banners)) {
        throw new Error('Format banners tidak valid, harus berupa array atau JSON string.');
      }
    }

    // Media references are intentionally excluded. Logo, PWA icons, and banners
    // must be created/replaced through the canonical Media System endpoints.
    clearDomainCache();
    return this.db.execute(
      "UPDATE brands SET name = COALESCE(?, name), tagline = COALESCE(?, tagline), primary_color = COALESCE(?, primary_color), merchant_pwa_name = CASE WHEN ? = 1 THEN ? ELSE merchant_pwa_name END, pos_pwa_name = CASE WHEN ? = 1 THEN ? ELSE pos_pwa_name END, updated_at = datetime('now') WHERE id = ?",
      [
        name !== undefined ? name.trim() : null,
        tagline !== undefined ? (typeof tagline === 'string' ? tagline.trim() : '') : null,
        normalizedPrimaryColor !== undefined ? normalizedPrimaryColor : null,
        merchant_pwa_name !== undefined ? 1 : 0,
        merchant_pwa_name !== undefined ? (typeof merchant_pwa_name === 'string' ? merchant_pwa_name.trim() || null : null) : null,
        pos_pwa_name !== undefined ? 1 : 0,
        pos_pwa_name !== undefined ? (typeof pos_pwa_name === 'string' ? pos_pwa_name.trim() || null : null) : null,
        brandId
      ]
    );
  }

  updateBrandLogo(brandId, logoUrl) {
    clearDomainCache();
    return this.db.execute(`
      UPDATE brands
      SET logo_url = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, [logoUrl || null, brandId]);
  }

  removeBrandLogo(brandId) {
    clearDomainCache();
    return this.db.execute(`
      UPDATE brands
      SET logo_url = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `, [brandId]);
  }

  /**
   * M5: Set canonical logo_media_id and also sync logo_url to the derivative URL.
   * Both fields are updated atomically so legacy consumers still work.
   */
  updateBrandLogoMedia(brandId, { mediaId, logoUrl }) {
    clearDomainCache();
    return this.db.execute(`
      UPDATE brands
      SET logo_media_id = ?,
          logo_url = COALESCE(?, logo_url),
          updated_at = datetime('now')
      WHERE id = ?
    `, [mediaId || null, logoUrl || null, brandId]);
  }

  /**
   * M5: Remove logo media reference (soft — retains logo_url fallback if present).
   */
  removeBrandLogoMedia(brandId) {
    clearDomainCache();
    return this.db.execute(`
      UPDATE brands
      SET logo_media_id = NULL,
          logo_url = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `, [brandId]);
  }

  // ── Installed PWA Identity Override ─────────────────────────────────────────
  // These affect only the PWA launcher icon after install. They do not change
  // branding, RBAC, routing, or Customer PWA behavior.

  updateMerchantPwaIcon(brandId, { iconUrl, mediaId }) {
    clearDomainCache();
    this.db.execute(
      'UPDATE brands SET merchant_pwa_icon_url = ?, merchant_pwa_icon_media_id = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [iconUrl || null, mediaId || null, brandId]
    );
  }

  removeMerchantPwaIcon(brandId) {
    clearDomainCache();
    this.db.execute('UPDATE brands SET merchant_pwa_icon_url = NULL, merchant_pwa_icon_media_id = NULL WHERE id = ?', [brandId]);
  }

  updatePosPwaIcon(brandId, { iconUrl, mediaId }) {
    clearDomainCache();
    this.db.execute(
      'UPDATE brands SET pos_pwa_icon_url = ?, pos_pwa_icon_media_id = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [iconUrl || null, mediaId || null, brandId]
    );
  }

  removePosPwaIcon(brandId) {
    clearDomainCache();
    this.db.execute('UPDATE brands SET pos_pwa_icon_url = NULL, pos_pwa_icon_media_id = NULL WHERE id = ?', [brandId]);
  }

  findBySlug(slug) {
    const clean = typeof slug === 'string' ? slug.trim().toLowerCase() : slug;
    return this.db.queryOne(`
      SELECT *
      FROM brands
      WHERE lower(trim(slug)) = ?
      LIMIT 1
    `, [clean]);
  }

  findFirstForLocalDevelopment() {
    return this.db.queryOne(
      'SELECT * FROM brands ORDER BY created_at ASC LIMIT 1'
    );
  }
}

module.exports = BrandRepository;
