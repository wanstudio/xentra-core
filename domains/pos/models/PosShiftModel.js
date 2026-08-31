/**
 * Xentra POS Shift Model
 * Governs Cashier shift lifecycle, cash calculation, and variance tracking.
 */
class PosShiftModel {
  static STATUS = {
    OPEN: 'open',
    CLOSED: 'closed'
  };

  /**
   * Calculates expected cash in cash drawer based on starting float, cash sales, and manual cash movements.
   * 
   * @param {Object} params
   * @param {number} params.starting_float
   * @param {number} [params.total_cash_sales=0]
   * @param {number} [params.total_cash_in=0]
   * @param {number} [params.total_cash_out=0]
   * @returns {number}
   */
  static calculateExpectedCash({ starting_float, total_cash_sales = 0, total_cash_in = 0, total_cash_out = 0 }) {
    const float = Number(starting_float) || 0;
    const sales = Number(total_cash_sales) || 0;
    const cashIn = Number(total_cash_in) || 0;
    const cashOut = Number(total_cash_out) || 0;

    return float + sales + cashIn - cashOut;
  }

  /**
   * Calculates cash variance (Over / Short) upon closing shift.
   * Variance = Actual Cash Count - Expected Cash
   * 
   * @param {number} expectedCash
   * @param {number} actualCash
   * @returns {{ variance: number, is_balanced: boolean, is_over: boolean, is_short: boolean }}
   */
  static calculateVariance(expectedCash, actualCash) {
    const expected = Number(expectedCash) || 0;
    const actual = Number(actualCash) || 0;
    const variance = actual - expected;

    return {
      variance,
      is_balanced: variance === 0,
      is_over: variance > 0,
      is_short: variance < 0
    };
  }
}

module.exports = PosShiftModel;
