/**
 * DeliveryCalculator — Legacy adapter delegating to Domain Delivery Single Source of Truth.
 */
const { DeliveryCalculatorService } = require('../../domains/delivery');

class DeliveryCalculator {
  static calculate(params) {
    return DeliveryCalculatorService.calculate(params);
  }
}

module.exports = DeliveryCalculator;
