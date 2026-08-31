/**
 * Xentra Core Base Adapter (D2)
 * Abstract interface ensuring provider-specific code remains isolated.
 */
class BaseAdapter {
  constructor(name) {
    if (!name || typeof name !== 'string') {
      throw new Error('[BaseAdapter] Adapter must have a valid name.');
    }
    this.name = name.trim();
  }

  /**
   * Executes an integration request through this adapter.
   * @param {Object} request - Normalized IntegrationContract request
   * @returns {Promise<Object>} Normalized IntegrationContract response
   */
  async execute(request) {
    throw new Error(`[BaseAdapter] execute() must be implemented by adapter "${this.name}".`);
  }
}

module.exports = BaseAdapter;
