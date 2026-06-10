const {
  applyPartnerPlanDefaults,
  buildPartnerBillingActivation,
  checkPartnerBillingAccess,
  isPartnerBillingPeriodActive
} = require('../services/partnerBillingService');

describe('partnerBillingService', () => {
  test('applyPartnerPlanDefaults resolves api_starter catalog', () => {
    const payload = applyPartnerPlanDefaults({ billingPlanId: 'api_starter' });
    expect(payload.contractAnnualFeeInr).toBe(99000);
    expect(payload.usageLimits.apiCallsPerMonth).toBe(100000);
    expect(payload.billingStatus).toBe('active');
  });

  test('buildPartnerBillingActivation sets one-year contract by default', () => {
    const paidAt = new Date('2026-05-01T00:00:00.000Z');
    const activation = buildPartnerBillingActivation({ billingStatus: 'active', paidAt });
    expect(activation.billingStatus).toBe('active');
    expect(new Date(activation.contractPaidUntil).getFullYear()).toBe(2027);
  });

  test('isPartnerBillingPeriodActive rejects expired contracts', () => {
    const active = isPartnerBillingPeriodActive({
      isActive: true,
      billingStatus: 'active',
      contractPaidUntil: new Date('2099-01-01T00:00:00.000Z')
    });
    const expired = isPartnerBillingPeriodActive({
      isActive: true,
      billingStatus: 'active',
      contractPaidUntil: new Date('2020-01-01T00:00:00.000Z')
    });

    expect(active).toBe(true);
    expect(expired).toBe(false);
  });

  test('checkPartnerBillingAccess blocks inactive billing when enforcement enabled', () => {
    const previous = process.env.PARTNER_BILLING_ENFORCEMENT;
    process.env.PARTNER_BILLING_ENFORCEMENT = 'hard';

    const result = checkPartnerBillingAccess({
      isActive: true,
      billingStatus: 'expired',
      contractPaidUntil: new Date('2020-01-01T00:00:00.000Z')
    });

    expect(result.allowed).toBe(false);
    expect(result.denial.code).toBe('PARTNER_BILLING_INACTIVE');

    process.env.PARTNER_BILLING_ENFORCEMENT = previous;
  });
});
