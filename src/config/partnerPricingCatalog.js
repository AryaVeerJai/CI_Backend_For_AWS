const PARTNER_PLAN_CATALOG = {
  api_starter: {
    label: 'API-only integrator',
    contractAnnualFeeInr: 99000,
    rateLimitTier: 'standard',
    usageLimits: {
      apiCallsPerMonth: 100000,
      webhookEventsPerMonth: 10000,
      reportPullsPerMonth: 2000,
      msmeMonitoredPerYear: 500
    },
    overageRates: {
      perApiCallInr: 0.15,
      perWebhookInr: 0.5,
      perReportPullInr: 5,
      perMsmeMonthInr: 25
    }
  },
  bank_platform: {
    label: 'Bank / NBFC platform',
    contractAnnualFeeInr: 500000,
    rateLimitTier: 'elevated',
    usageLimits: {
      apiCallsPerMonth: 500000,
      webhookEventsPerMonth: 50000,
      reportPullsPerMonth: 10000,
      msmeMonitoredPerYear: 5000
    },
    overageRates: {
      perApiCallInr: 0.12,
      perWebhookInr: 0.4,
      perReportPullInr: 4,
      perMsmeMonthInr: 20
    }
  },
  anchor_enterprise: {
    label: 'Anchor enterprise programme',
    contractAnnualFeeInr: 800000,
    rateLimitTier: 'elevated',
    usageLimits: {
      apiCallsPerMonth: 250000,
      webhookEventsPerMonth: 25000,
      reportPullsPerMonth: 5000,
      msmeMonitoredPerYear: 2000
    },
    overageRates: {
      perApiCallInr: 0.12,
      perWebhookInr: 0.45,
      perReportPullInr: 4.5,
      perMsmeMonthInr: 22
    }
  },
  auditor: {
    label: 'Accredited auditor',
    contractAnnualFeeInr: 200000,
    rateLimitTier: 'standard',
    usageLimits: {
      apiCallsPerMonth: 50000,
      webhookEventsPerMonth: 5000,
      reportPullsPerMonth: 3000,
      msmeMonitoredPerYear: 1000
    },
    overageRates: {
      perApiCallInr: 0.15,
      perWebhookInr: 0.5,
      perReportPullInr: 5,
      perMsmeMonthInr: 25
    }
  },
  verification_agency: {
    label: 'Verification agency',
    contractAnnualFeeInr: 150000,
    rateLimitTier: 'standard',
    usageLimits: {
      apiCallsPerMonth: 50000,
      webhookEventsPerMonth: 5000,
      reportPullsPerMonth: 3000,
      msmeMonitoredPerYear: 750
    },
    overageRates: {
      perApiCallInr: 0.15,
      perWebhookInr: 0.5,
      perReportPullInr: 5,
      perMsmeMonthInr: 25
    }
  },
  integration_partner: {
    label: 'ERP / accounting integrator',
    contractAnnualFeeInr: 300000,
    rateLimitTier: 'standard',
    usageLimits: {
      apiCallsPerMonth: 150000,
      webhookEventsPerMonth: 15000,
      reportPullsPerMonth: 4000,
      msmeMonitoredPerYear: 1000
    },
    overageRates: {
      perApiCallInr: 0.14,
      perWebhookInr: 0.48,
      perReportPullInr: 4.8,
      perMsmeMonthInr: 24
    }
  }
};

const resolvePartnerPlanDefaults = (billingPlanId = 'api_starter') => {
  const key = String(billingPlanId || 'api_starter').trim();
  return PARTNER_PLAN_CATALOG[key] || PARTNER_PLAN_CATALOG.api_starter;
};

const listPartnerPlanCatalog = () => Object.entries(PARTNER_PLAN_CATALOG).map(([planId, plan]) => ({
  planId,
  ...plan
}));

module.exports = {
  PARTNER_PLAN_CATALOG,
  resolvePartnerPlanDefaults,
  listPartnerPlanCatalog
};
