/**
 * Resolves pre-tax (GST-exclusive) amounts for carbon spend-proxy calculations.
 * Tally exports typically provide Amount (pre-tax), GST Amount, and Net Amount (inclusive).
 */

const toFinite = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const amountsClose = (left, right, tolerance = 0.02) => (
  Math.abs(toFinite(left) - toFinite(right)) <= tolerance
);

/**
 * @returns {{ amount: number, source: string, gstStripped: boolean, gstAmount: number|null }}
 */
const resolveTaxableAmountForCarbon = (transaction = {}) => {
  const amount = toFinite(transaction.amount, 0);
  const amountInr = toFinite(transaction.amountInr, 0);
  const taxableAmount = toFinite(transaction.taxableAmount, 0);
  const gstAmount = toFinite(transaction.gstAmount, 0);
  const netAmountInr = toFinite(transaction.netAmountInr, 0);
  const gstPercent = toFinite(transaction.gstPercent, 0);

  if (taxableAmount > 0) {
    return {
      amount: taxableAmount,
      source: 'taxableAmount',
      gstStripped: gstAmount > 0,
      gstAmount: gstAmount > 0 ? gstAmount : null
    };
  }

  if (amountInr > 0) {
    return {
      amount: amountInr,
      source: 'amountInr',
      gstStripped: gstAmount > 0 || (netAmountInr > amountInr),
      gstAmount: gstAmount > 0 ? gstAmount : (netAmountInr > amountInr ? netAmountInr - amountInr : null)
    };
  }

  if (netAmountInr > 0 && gstAmount > 0) {
    const preTaxFromNet = netAmountInr - gstAmount;
    if (preTaxFromNet > 0 && (amountsClose(amount, netAmountInr) || amount <= 0)) {
      return {
        amount: preTaxFromNet,
        source: 'net_minus_gst',
        gstStripped: true,
        gstAmount
      };
    }
  }

  if (gstAmount > 0 && amount > gstAmount) {
    const preTaxFromAmount = amount - gstAmount;
    if (netAmountInr > 0 && amountsClose(amount, netAmountInr)) {
      return {
        amount: preTaxFromAmount,
        source: 'amount_minus_gst',
        gstStripped: true,
        gstAmount
      };
    }
    if (gstPercent > 0 && amountsClose(preTaxFromAmount * (1 + gstPercent / 100), amount)) {
      return {
        amount: preTaxFromAmount,
        source: 'amount_minus_gst',
        gstStripped: true,
        gstAmount
      };
    }
  }

  if (gstPercent > 0 && amount > 0 && !gstAmount && !netAmountInr) {
    const inferredPreTax = amount / (1 + gstPercent / 100);
    if (inferredPreTax > 0 && inferredPreTax < amount) {
      return {
        amount: Math.round(inferredPreTax * 100) / 100,
        source: 'gst_percent_divisor',
        gstStripped: true,
        gstAmount: Math.round((amount - inferredPreTax) * 100) / 100
      };
    }
  }

  return {
    amount,
    source: 'amount',
    gstStripped: false,
    gstAmount: gstAmount > 0 ? gstAmount : null
  };
};

module.exports = {
  resolveTaxableAmountForCarbon
};
