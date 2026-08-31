/**
 * Xentra Core Hardware Integration Boundary (D7)
 * Abstract hardware printer adapter for ESC/POS receipt & KDS printing without locking vendor implementations.
 */
const BaseAdapter = require('../BaseAdapter');
const IntegrationContract = require('../IntegrationContract');
const FailureClassifier = require('../FailureClassifier');

class HardwarePrinterAdapter extends BaseAdapter {
  constructor({ driver = null } = {}) {
    super('hardware_printer');
    this.driver = driver; // Neutral ESC/POS driver injection
  }

  async execute(request) {
    const { action, payload, target_context } = request;

    if (action !== 'print_receipt' && action !== 'print_kitchen_ticket') {
      return IntegrationContract.createErrorResponse({
        code: FailureClassifier.ERROR_CODES.PROVIDER_REJECTED,
        message: `Unsupported hardware action "${action}".`
      });
    }

    if (!payload.raw_content && !payload.lines) {
      return IntegrationContract.createErrorResponse({
        code: FailureClassifier.ERROR_CODES.PROVIDER_REJECTED,
        message: 'Missing print content in payload.'
      });
    }

    try {
      if (this.driver) {
        await this.driver.print(payload);
      }
      return IntegrationContract.createSuccessResponse({
        data: { printed: true, lines_count: (payload.lines || []).length },
        metadata: { branch_id: target_context.branch_id }
      });
    } catch (err) {
      return IntegrationContract.createErrorResponse({
        code: FailureClassifier.classify(err),
        message: `Printer hardware error: ${err.message}`
      });
    }
  }
}

module.exports = HardwarePrinterAdapter;
