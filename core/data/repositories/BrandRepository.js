'use strict';

/**
 * Brand persistence adapter.
 *
 * Exposes tenant-resolution reads while keeping persistence details behind
 * the data boundary. Tenant authority and request security remain in the
 * resolver/control-plane layer.
 */
const DataAccess = require('../DataAccess');

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
    return this.db.queryOne(`
      SELECT *
      FROM brands
      WHERE lower(trim(custom_domain)) = ?
      LIMIT 1
    `, [clean]);
  }

  findById(brandId) {
    return this.db.queryOne('SELECT * FROM brands WHERE id = ? LIMIT 1', [brandId]);
  }

  updateBrandProfile(brandId, { name, logo_url, tagline, primary_color, banners }) {
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      throw new Error('Nama brand harus berupa teks yang valid.');
    }
    if (primary_color !== undefined && primary_color !== null && (typeof primary_color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(primary_color.trim()))) {
      throw new Error('Format warna tema (hex) tidak valid.');
    }
    let serializedBanners = null;
    if (banners !== undefined && banners !== null) {
      if (typeof banners === 'string') {
        try {
          const parsed = JSON.parse(banners);
          if (!Array.isArray(parsed)) throw new Error();
          serializedBanners = JSON.stringify(parsed);
        } catch (_) {
          throw new Error('Format banners JSON tidak valid, harus berupa JSON array.');
        }
      } else if (Array.isArray(banners)) {
        serializedBanners = JSON.stringify(banners);
      } else {
        throw new Error('Format banners tidak valid, harus berupa array atau JSON string.');
      }
    }

    return this.db.execute(`
      UPDATE brands
      SET name = COALESCE(?, name),
          logo_url = COALESCE(?, logo_url),
          tagline = COALESCE(?, tagline),
          primary_color = COALESCE(?, primary_color),
          banners = COALESCE(?, banners),
          updated_at = datetime('now')
      WHERE id = ?
    `, [
      name !== undefined ? name.trim() : null,
      logo_url !== undefined ? (typeof logo_url === 'string' ? logo_url.trim() : null) : null,
      tagline !== undefined ? (typeof tagline === 'string' ? tagline.trim() : '') : null,
      primary_color !== undefined ? (typeof primary_color === 'string' ? primary_color.trim() : null) : null,
      banners !== undefined ? serializedBanners : null,
      brandId
    ]);
  }

  updateBrandLogo(brandId, logoUrl) {
    return this.db.execute(`
      UPDATE brands
      SET logo_url = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, [logoUrl || null, brandId]);
  }

  removeBrandLogo(brandId) {
    return this.db.execute(`
      UPDATE brands
      SET logo_url = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `, [brandId]);
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
