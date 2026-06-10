const {
  classifyUsageCategory,
  computeBillingEstimate,
  buildQuotaStatus,
  checkUsageQuotaExceeded,
  normalizeEndpointKey
} = require('../services/partnerUsageService');

describe('partnerUsageService billing', () => {
  const partner = {
    contractAnnualFeeInr: 120000,
    usageLimits: {
      apiCallsPerMonth: 1000,
      webhookEventsPerMonth: 100,
      reportPullsPerMonth: 50,
      msmeMonitoredPerYear: 500
    },
    overageRates: {
      perApiCallInr: 0.15,
      perWebhookInr: 0.5,
      perReportPullInr: 5,
      perMsmeMonthInr: 25
    }
  };

  test('computeBillingEstimate with no overage', () => {
    const billing = computeBillingEstimate(
      partner,
      {
        totalCalls: 500,
        apiCalls: 500,
        webhookCalls: 10,
        reportPullCalls: 5,
        distinctMsmeAccessed: 3
      },
      { distinctMsmeAccessed: 3 }
    );

    expect(billing.estimatedMonthlyPlatformFeeInr).toBe(10000);
    expect(billing.overage.estimatedOverageInr).toBe(0);
    expect(billing.estimatedTotalInr).toBe(10000);
    expect(billing.paymentGateway).toMatchObject({
      enabled: false,
      mode: 'contract_invoice'
    });
    expect(billing.settlementModel).toBe('partner_contract_invoice');
  });

  test('computeBillingEstimate with API overage', () => {
    const billing = computeBillingEstimate(
      partner,
      {
        totalCalls: 1500,
        apiCalls: 1500,
        webhookCalls: 10,
        reportPullCalls: 5,
        distinctMsmeAccessed: 0
      },
      { distinctMsmeAccessed: 0 }
    );

    expect(billing.overage.apiCalls).toBe(500);
    expect(billing.overage.estimatedOverageInr).toBe(75);
    expect(billing.estimatedTotalInr).toBe(10075);
  });

  test('computeBillingEstimate with MSME overage', () => {
    const billing = computeBillingEstimate(
      partner,
      {
        totalCalls: 100,
        apiCalls: 100,
        webhookCalls: 0,
        reportPullCalls: 0,
        distinctMsmeAccessed: 10
      },
      { distinctMsmeAccessed: 520 }
    );

    expect(billing.overage.msmeAccounts).toBe(20);
    expect(billing.overage.breakdownInr.msmeAccounts).toBe(500);
    expect(billing.overage.estimatedOverageInr).toBe(500);
  });
});

describe('partnerUsageService classification', () => {
  test('classifyUsageCategory for report pulls', () => {
    expect(classifyUsageCategory('GET', '/api/v1/partners/msmes/:id/reports/overview')).toBe('report_pull');
  });

  test('classifyUsageCategory for webhook config', () => {
    expect(classifyUsageCategory('PATCH', '/api/v1/partners/webhook')).toBe('webhook_config');
  });

  test('classifyUsageCategory defaults to api_call', () => {
    expect(classifyUsageCategory('GET', '/api/v1/partners/msmes')).toBe('api_call');
  });

  test('normalizeEndpointKey replaces path params', () => {
    expect(normalizeEndpointKey('GET', '/partners/msmes/:msmeId/carbon-summary')).toBe(
      'GET:partners/msmes/:id/carbon-summary'
    );
  });
});

describe('partnerUsageService quotas', () => {
  const partner = {
    usageLimits: {
      apiCallsPerMonth: 100,
      webhookEventsPerMonth: 10,
      reportPullsPerMonth: 5,
      msmeMonitoredPerYear: 50
    }
  };

  test('buildQuotaStatus marks exceeded metrics', () => {
    const quotas = buildQuotaStatus(
      partner,
      { apiCalls: 120, webhookCalls: 0, reportPullCalls: 0, distinctMsmeAccessed: 0 },
      { distinctMsmeAccessed: 55 }
    );

    const apiQuota = quotas.find((q) => q.metric === 'apiCallsPerMonth');
    const msmeQuota = quotas.find((q) => q.metric === 'msmeMonitoredPerYear');

    expect(apiQuota?.exceeded).toBe(true);
    expect(msmeQuota?.exceeded).toBe(true);
  });

  test('checkUsageQuotaExceeded returns exceeded items only', () => {
    const exceeded = checkUsageQuotaExceeded(
      partner,
      { apiCalls: 50, webhookCalls: 0, reportPullCalls: 0, distinctMsmeAccessed: 0 },
      { distinctMsmeAccessed: 50 }
    );

    expect(exceeded).toHaveLength(1);
    expect(exceeded[0].metric).toBe('msmeMonitoredPerYear');
  });
});
