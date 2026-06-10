const {
  computePaidUntil,
  resolveEffectiveTier,
  buildActivationPayloadFromPayment,
  planHasFeature
} = require('../services/planEntitlementService');

describe('planEntitlementService', () => {
  test('computePaidUntil adds one month by default', () => {
    const paidAt = new Date('2026-01-15T10:00:00.000Z');
    const paidUntil = computePaidUntil(paidAt, 'monthly');
    expect(paidUntil.getMonth()).toBe(1);
  });

  test('resolveEffectiveTier returns free when subscription expired', () => {
    const tier = resolveEffectiveTier({
      status: 'paid',
      selectedPlanId: 'msme_growth_monthly',
      paidUntil: new Date('2020-01-01T00:00:00.000Z')
    });
    expect(tier).toBe('free');
  });

  test('resolveEffectiveTier uses selected plan when active', () => {
    const tier = resolveEffectiveTier({
      status: 'paid',
      selectedPlanId: 'msme_growth_monthly',
      paidUntil: new Date('2099-01-01T00:00:00.000Z')
    });
    expect(tier).toBe('growth');
  });

  test('buildActivationPayloadFromPayment sets plan fields from fixed plan payment', () => {
    const payload = buildActivationPayloadFromPayment({
      msmeId: '507f1f77bcf86cd799439011',
      pricingModel: 'fixed_plan',
      planId: 'msme_core_monthly',
      planInterval: 'monthly',
      amount: 3499,
      razorpayPaymentId: 'pay_123'
    }, new Date('2026-05-01T00:00:00.000Z'));

    expect(payload.selectedPlanId).toBe('msme_core_monthly');
    expect(payload.planInterval).toBe('monthly');
    expect(payload.status).toBe('paid');
    expect(payload.paidUntil).toBeInstanceOf(Date);
  });

  test('buildActivationPayloadFromPayment resolves usage-based plan recommendation', () => {
    const payload = buildActivationPayloadFromPayment({
      pricingModel: 'usage_based',
      amount: 3200,
      notes: { recommendedPlanId: 'msme_starter_monthly' }
    });

    expect(payload.selectedPlanId).toBe('msme_starter_monthly');
    expect(payload.pricingModel).toBe('usage_based');
  });

  test('planHasFeature gates growth-only modules', () => {
    expect(planHasFeature('starter', 'complianceHub')).toBe(false);
    expect(planHasFeature('growth', 'complianceHub')).toBe(true);
  });
});
