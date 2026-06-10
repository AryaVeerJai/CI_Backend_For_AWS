const { calculateMsmePayment } = require('../services/paymentPricingService');
const { STARTER_MONTHLY_INR, USAGE_PRICING } = require('../config/pricingCatalog');

describe('paymentPricingService', () => {
  it('floors low usage quotes at Starter monthly price', () => {
    const quote = calculateMsmePayment({
      msme: { businessDomain: 'services', business: {} },
      totalTransactions: 0,
      totalCO2Emissions: 0
    });

    expect(quote.rawUsageAmount).toBeLessThan(STARTER_MONTHLY_INR);
    expect(quote.paymentAmount).toBe(USAGE_PRICING.starterFloorInr);
    expect(quote.usageAdjustment.appliedFloor).toBe(true);
    expect(quote.recommendedPlanId).toBe('msme_starter_monthly');
  });

  it('recommends Growth for mid-range usage amounts', () => {
    const quote = calculateMsmePayment({
      msme: {
        businessDomain: 'manufacturing',
        business: {
          manufacturingWorkflow: {
            units: [
              {
                processes: [
                  {
                    rawMaterials: [{}, {}, {}],
                    machineries: [{ quantity: 2 }, { quantity: 1 }]
                  },
                  {
                    rawMaterials: [{}, {}],
                    machineries: [{ quantity: 1 }]
                  }
                ]
              }
            ]
          }
        }
      },
      totalTransactions: 120,
      totalCO2Emissions: 4500
    });

    expect(quote.paymentAmount).toBeGreaterThan(STARTER_MONTHLY_INR);
    expect(quote.recommendedPlanId).toBeTruthy();
  });

  it('includes document overage in usage quotes', () => {
    const quote = calculateMsmePayment({
      msme: { businessDomain: 'services', business: {} },
      totalTransactions: 0,
      totalCO2Emissions: 0,
      documentsThisMonth: 40
    });

    expect(quote.breakdown.documentOverageCharge).toBe(180);
    expect(quote.factors.documentOverageCount).toBe(15);
  });

  it('caps very high usage at scale ceiling', () => {
    const quote = calculateMsmePayment({
      msme: {
        businessDomain: 'manufacturing',
        business: {
          manufacturingWorkflow: {
            units: Array.from({ length: 20 }, () => ({
              processes: Array.from({ length: 10 }, () => ({
                rawMaterials: Array.from({ length: 5 }, () => ({})),
                machineries: [{ quantity: 5 }]
              }))
            }))
          }
        }
      },
      totalTransactions: 5000,
      totalCO2Emissions: 500000,
      documentsThisMonth: 500
    });

    expect(quote.paymentAmount).toBe(USAGE_PRICING.scaleCeilingInr);
    expect(quote.usageAdjustment.appliedCeiling).toBe(true);
  });
});
