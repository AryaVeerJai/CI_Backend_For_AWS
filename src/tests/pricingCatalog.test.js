const {
  applyUsageQuoteAdjustment,
  computeDocumentOverage,
  resolveCanonicalPlanId,
  resolvePlanTier,
  USAGE_PRICING
} = require('../config/pricingCatalog');

describe('pricingCatalog', () => {
  it('caps usage quotes at scale ceiling', () => {
    const result = applyUsageQuoteAdjustment(50000);
    expect(result.paymentAmount).toBe(USAGE_PRICING.scaleCeilingInr);
    expect(result.adjustment.appliedCeiling).toBe(true);
  });

  it('resolves legacy enterprise plan alias to scale tier', () => {
    expect(resolveCanonicalPlanId('msme_enterprise_yearly')).toBe('msme_scale_yearly');
    expect(resolvePlanTier('msme_enterprise_yearly')).toBe('scale');
  });

  it('charges document overage above free tier limit', () => {
    const overage = computeDocumentOverage({
      documentsThisMonth: 40,
      billingStatus: 'none',
      selectedPlanId: null
    });
    expect(overage.tier).toBe('free');
    expect(overage.overageDocuments).toBe(15);
    expect(overage.overageChargeInr).toBe(15 * USAGE_PRICING.overagePerDocumentInr);
  });

  it('uses paid plan limits for document overage', () => {
    const overage = computeDocumentOverage({
      documentsThisMonth: 60,
      billingStatus: 'paid',
      selectedPlanId: 'msme_starter_monthly'
    });
    expect(overage.tier).toBe('starter');
    expect(overage.overageDocuments).toBe(10);
    expect(overage.overageChargeInr).toBe(120);
  });
});
