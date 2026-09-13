'use strict';

/**
 * StorageProvider Interface & Local Filesystem Implementation
 *
 * Keeps storage provider abstract so local VPS storage can later transition
 * to object storage (S3 / Cloud Storage / MinIO) without changing domain contracts.
 * Public URLs are immutable/versioned references, not raw filesystem leaks.
 */
const fs = require('fs');
const path = require('path');

class StorageProvider {
  async write(storageKey, buffer) {
    throw new Error('Method write() must be implemented.');
  }

  async read(storageKey) {
    throw new Error('Method read() must be implemented.');
  }

  async delete(storageKey) {
    throw new Error('Method delete() must be implemented.');
  }

  async exists(storageKey) {
    throw new Error('Method exists() must be implemented.');
  }

  resolveUrl(storageKey) {
    throw new Error('Method resolveUrl() must be implemented.');
  }
}

class LocalStorageProvider extends StorageProvider {
  /**
   * @param {Object} options
   * @param {string} options.baseDir - Root storage directory on disk
   * @param {string} options.publicPrefix - Public URL prefix mapped in web server
   */
  constructor({ baseDir, publicPrefix = '/assets/uploads' } = {}) {
    super();
    this.baseDir = baseDir || path.join(__dirname, '../../apps/customer-pwa/assets/uploads');
    this.publicPrefix = publicPrefix;
  }

  _resolvePath(storageKey) {
    // Sanitize storageKey to prevent path traversal
    const safeKey = storageKey.replace(/\.\./g, '').replace(/^[/\\]+/, '');
    return path.join(this.baseDir, safeKey);
  }

  async write(storageKey, buffer) {
    const fullPath = this._resolvePath(storageKey);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(fullPath, buffer);
    return { storageKey, bytesWritten: buffer.length };
  }

  async read(storageKey) {
    const fullPath = this._resolvePath(storageKey);
    return fs.promises.readFile(fullPath);
  }

  async delete(storageKey) {
    const fullPath = this._resolvePath(storageKey);
    try {
      if (fs.existsSync(fullPath)) {
        await fs.promises.unlink(fullPath);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async exists(storageKey) {
    const fullPath = this._resolvePath(storageKey);
    return fs.existsSync(fullPath);
  }

  resolveUrl(storageKey) {
    const cleanKey = storageKey.replace(/\.\./g, '').replace(/^[/\\]+/, '').replace(/\\/g, '/');
    return `${this.publicPrefix}/${cleanKey}`;
  }
}


module.exports = {
  StorageProvider,
  LocalStorageProvider
};
