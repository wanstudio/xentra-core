'use strict';

const { events } = require('../../../core');
const RecipeConsumptionService = require('../services/RecipeConsumptionService');
const DataAccess = require('../../../core/data/DataAccess');

let isInitialized = false;

class RecipeConsumptionWorker {
  /**
   * Initializes the subscriber to listen for completed / placed commerce orders.
   * Runs in the background with error boundaries to guarantee kasir is never impacted.
   */
  static init() {
    if (isInitialized) return;

    events.EventBus.subscribe('commerce.order.placed', async (event) => {
      try {
        const payload = event && event.payload;
        if (!payload || !payload.order_id) return;

        const { order_id, order_number, branch_id, items } = payload;

        RecipeConsumptionService.processOrderTheoreticalConsumption({
          order_id,
          order_number,
          branch_id,
          items: items || []
        }, DataAccess);
      } catch (err) {
        // Safe error boundary: Background theoretical calculation should never crash the process
        console.error('[RecipeConsumptionWorker] Error processing theoretical recipe consumption:', err && err.message);
      }
    });

    isInitialized = true;
  }

  static resetForTest() {
    isInitialized = false;
  }
}

module.exports = RecipeConsumptionWorker;
