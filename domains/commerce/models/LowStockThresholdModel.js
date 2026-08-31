/**
 * Xentra Commerce Low-Stock Threshold Model
 * Represents branch-configurable threshold for triggering automatic low-stock alerts.
 */
class LowStockThresholdModel {
  static DEFAULT_THRESHOLD = 5;

  /**
   * Evaluates if a given remaining stock level warrants a low-stock alert.
   * 
   * @param {number} currentStock - Available quantity in branch
   * @param {number} [customThreshold=5] - Threshold configured by Branch Manager
   * @returns {{ is_low: boolean, is_out_of_stock: boolean, remaining: number, threshold: number }}
   */
  static evaluate(currentStock, customThreshold = LowStockThresholdModel.DEFAULT_THRESHOLD) {
    const stock = Number(currentStock) || 0;
    const threshold = Number(customThreshold) || LowStockThresholdModel.DEFAULT_THRESHOLD;

    return {
      is_low: stock <= threshold && stock > 0,
      is_out_of_stock: stock <= 0,
      remaining: stock,
      threshold
    };
  }
}

module.exports = LowStockThresholdModel;
