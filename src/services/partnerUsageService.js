const PartnerApiUsage = require('../models/PartnerApiUsage');
const PartnerApplication = require('../models/PartnerApplication');
const { resolvePartnerBillingAccess } = require('./partnerBillingService');

const USAGE_CATEGORIES = ['api_call', 'report_pull', 'webhook_config', 'webhook_delivery'];

const startOfMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), 1);

const startOfYear = (date = new Date()) => new Date(date.getFullYear(), 0, 1);

const endOfMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

const normalizeEndpointKey = (method, path = '') => {
  const cleaned = String(path)
    .replace(/:[^/]+/g, ':id')
    .replace(/^\/+/, '');
  return `${String(method || 'GET').toUpperCase()}:${cleaned || 'unknown'}`;
};

const classifyUsageCategory = (method, path = '') => {
  const normalized = String(path).toLowerCase();
  const verb = String(method || 'GET').toUpperCase();

  if (normalized.includes('/webhook') && verb === 'PATCH') {
    return 'webhook_config';
  }
  if (normalized.includes('/reports/')) {
    return 'report_pull';
  }
  return 'api_call';
};

const usageCountCache = new Map();
const USAGE_CACHE_TTL_MS = 60_000;

const getCachedUsageCounts = async (partnerId, since) => {
  const cacheKey = `${String(partnerId)}:${since.toISOString()}`;
  const cached = usageCountCache.get(cacheKey);
  if (cached && Date.now() - cached.at < USAGE_CACHE_TTL_MS) {
    return cached.value;
  }

  const value = await countUsageSince(partnerId, since, { skipCache: true });
  usageCountCache.set(cacheKey, { at: Date.now(), value });
  return value;
};

const invalidateUsageCache = (partnerId) => {
  const prefix = `${String(partnerId)}:`;
  for (const key of usageCountCache.keys()) {
    if (key.startsWith(prefix)) {
      usageCountCache.delete(key);
    }
  }
};

const recordPartnerApiEvent = async ({
  partnerApplicationId,
  method,
  path,
  statusCode,
  responseTimeMs,
  msmeId,
  usageCategory
}) => {
  if (!partnerApplicationId) {
    return;
  }

  const endpointKey = normalizeEndpointKey(method, path);
  const category = usageCategory || classifyUsageCategory(method, path);

  await Promise.all([
    PartnerApiUsage.create({
      partnerApplicationId,
      method,
      path,
      endpointKey,
      usageCategory: category,
      statusCode,
      responseTimeMs,
      msmeId: msmeId || null
    }),
    PartnerApplication.updateOne(
      { _id: partnerApplicationId },
      { $set: { lastUsedAt: new Date() } }
    )
  ]);

  invalidateUsageCache(partnerApplicationId);
};

const countUsageSince = async (partnerId, since, options = {}) => {
  const match = {
    partnerApplicationId: partnerId,
    occurredAt: { $gte: since }
  };

  const [totalCalls, byEndpoint, errorCalls, avgLatency, categoryCounts, distinctMsme] = await Promise.all([
    PartnerApiUsage.countDocuments(match),
    PartnerApiUsage.aggregate([
      { $match: match },
      { $group: { _id: '$endpointKey', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 12 }
    ]),
    PartnerApiUsage.countDocuments({
      ...match,
      statusCode: { $gte: 400 }
    }),
    PartnerApiUsage.aggregate([
      { $match: { ...match, responseTimeMs: { $ne: null } } },
      { $group: { _id: null, avgMs: { $avg: '$responseTimeMs' } } }
    ]),
    PartnerApiUsage.aggregate([
      { $match: match },
      { $group: { _id: '$usageCategory', count: { $sum: 1 } } }
    ]),
    PartnerApiUsage.distinct('msmeId', {
      ...match,
      msmeId: { $ne: null }
    })
  ]);

  const categoryMap = categoryCounts.reduce((acc, row) => {
    acc[row._id || 'api_call'] = row.count;
    return acc;
  }, {});

  const reportPullCalls = categoryMap.report_pull || 0;
  const webhookConfigCalls = categoryMap.webhook_config || 0;
  const webhookCalls = categoryMap.webhook_delivery || 0;
  const apiCalls = (categoryMap.api_call || 0) + webhookConfigCalls;

  const result = {
    totalCalls,
    apiCalls,
    errorCalls,
    successRate: totalCalls > 0 ? Math.round(((totalCalls - errorCalls) / totalCalls) * 1000) / 10 : 100,
    avgLatencyMs: avgLatency[0]?.avgMs ? Math.round(avgLatency[0].avgMs) : null,
    webhookCalls,
    webhookConfigCalls,
    reportPullCalls,
    distinctMsmeAccessed: distinctMsme.length,
    topEndpoints: byEndpoint.map((row) => ({
      endpointKey: row._id,
      count: row.count
    }))
  };

  if (options.skipCache) {
    return result;
  }

  return result;
};

const buildDailySeries = async (partnerId, days = 14) => {
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const rows = await PartnerApiUsage.aggregate([
    {
      $match: {
        partnerApplicationId: partnerId,
        occurredAt: { $gte: since }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' }
        },
        calls: { $sum: 1 },
        errors: {
          $sum: {
            $cond: [{ $gte: ['$statusCode', 400] }, 1, 0]
          }
        }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  return rows.map((row) => ({
    date: row._id,
    calls: row.calls,
    errors: row.errors
  }));
};

const computeBillingEstimate = (partner, monthUsage, yearUsage = {}) => {
  const limits = partner.usageLimits || {};
  const rates = partner.overageRates || {};
  const annualFee = partner.contractAnnualFeeInr || 0;
  const monthlyPlatformFee = Math.round(annualFee / 12);

  const billableApiCalls = monthUsage.apiCalls ?? monthUsage.totalCalls;
  const apiOver = Math.max(0, billableApiCalls - (limits.apiCallsPerMonth || 0));
  const webhookOver = Math.max(0, monthUsage.webhookCalls - (limits.webhookEventsPerMonth || 0));
  const reportOver = Math.max(0, monthUsage.reportPullCalls - (limits.reportPullsPerMonth || 0));
  const msmeOver = Math.max(
    0,
    (yearUsage.distinctMsmeAccessed || 0) - (limits.msmeMonitoredPerYear || 0)
  );

  const apiOverageInr = apiOver * (rates.perApiCallInr || 0);
  const webhookOverageInr = webhookOver * (rates.perWebhookInr || 0);
  const reportOverageInr = reportOver * (rates.perReportPullInr || 0);
  const msmeOverageInr = msmeOver * (rates.perMsmeMonthInr || 0);

  const overageInr = apiOverageInr + webhookOverageInr + reportOverageInr + msmeOverageInr;

  return {
    currency: 'INR',
    billingPeriod: 'monthly',
    contractAnnualFeeInr: annualFee,
    estimatedMonthlyPlatformFeeInr: monthlyPlatformFee,
    usageIncluded: {
      apiCallsPerMonth: limits.apiCallsPerMonth,
      webhookEventsPerMonth: limits.webhookEventsPerMonth,
      reportPullsPerMonth: limits.reportPullsPerMonth,
      msmeMonitoredPerYear: limits.msmeMonitoredPerYear
    },
    currentPeriodUsage: {
      apiCalls: billableApiCalls,
      webhookEvents: monthUsage.webhookCalls,
      reportPulls: monthUsage.reportPullCalls,
      distinctMsmeAccessedMonth: monthUsage.distinctMsmeAccessed,
      distinctMsmeAccessedYear: yearUsage.distinctMsmeAccessed || 0
    },
    overage: {
      apiCalls: apiOver,
      webhookEvents: webhookOver,
      reportPulls: reportOver,
      msmeAccounts: msmeOver,
      estimatedOverageInr: Math.round(overageInr * 100) / 100,
      breakdownInr: {
        apiCalls: Math.round(apiOverageInr * 100) / 100,
        webhookEvents: Math.round(webhookOverageInr * 100) / 100,
        reportPulls: Math.round(reportOverageInr * 100) / 100,
        msmeAccounts: Math.round(msmeOverageInr * 100) / 100
      }
    },
    estimatedTotalInr: Math.round((monthlyPlatformFee + overageInr) * 100) / 100,
    paymentGateway: {
      enabled: false,
      provider: null,
      mode: 'contract_invoice',
      reason: 'Partner accounts are billed through contract invoicing; Razorpay checkout is enabled for direct MSME plans.'
    },
    settlementModel: 'partner_contract_invoice',
    note: 'Indicative estimate excluding GST. Final invoicing per your partnership agreement.'
  };
};

const buildQuotaStatus = (partner, monthUsage, yearUsage = {}) => {
  const limits = partner.usageLimits || {};
  const billableApiCalls = monthUsage.apiCalls ?? monthUsage.totalCalls;

  const quotaItems = [
    {
      metric: 'apiCallsPerMonth',
      label: 'API calls',
      period: 'month',
      used: billableApiCalls,
      limit: limits.apiCallsPerMonth || 0
    },
    {
      metric: 'webhookEventsPerMonth',
      label: 'Webhook events',
      period: 'month',
      used: monthUsage.webhookCalls,
      limit: limits.webhookEventsPerMonth || 0
    },
    {
      metric: 'reportPullsPerMonth',
      label: 'Report pulls',
      period: 'month',
      used: monthUsage.reportPullCalls,
      limit: limits.reportPullsPerMonth || 0
    },
    {
      metric: 'msmeMonitoredPerYear',
      label: 'Distinct MSMEs',
      period: 'year',
      used: yearUsage.distinctMsmeAccessed || 0,
      limit: limits.msmeMonitoredPerYear || 0
    }
  ];

  return quotaItems.map((item) => {
    const remaining = Math.max(0, item.limit - item.used);
    const percentUsed = item.limit > 0 ? Math.round((item.used / item.limit) * 1000) / 10 : 0;
    const exceeded = item.limit > 0 && item.used >= item.limit;

    return {
      ...item,
      remaining,
      percentUsed,
      exceeded
    };
  });
};

const checkUsageQuotaExceeded = (partner, monthUsage, yearUsage = {}) => {
  const quotas = buildQuotaStatus(partner, monthUsage, yearUsage);
  return quotas.filter((q) => q.exceeded);
};

const buildUsageResponseHeaders = (partner, monthUsage, yearUsage = {}) => {
  const limits = partner.usageLimits || {};
  const billableApiCalls = monthUsage.apiCalls ?? monthUsage.totalCalls;

  return {
    'X-Partner-Usage-Api-Calls': String(billableApiCalls),
    'X-Partner-Usage-Limit-Api-Calls': String(limits.apiCallsPerMonth || 0),
    'X-Partner-Usage-Webhook-Events': String(monthUsage.webhookCalls),
    'X-Partner-Usage-Limit-Webhooks': String(limits.webhookEventsPerMonth || 0),
    'X-Partner-Usage-Report-Pulls': String(monthUsage.reportPullCalls),
    'X-Partner-Usage-Limit-Reports': String(limits.reportPullsPerMonth || 0),
    'X-Partner-Usage-Msme-Year': String(yearUsage.distinctMsmeAccessed || 0),
    'X-Partner-Usage-Limit-Msme-Year': String(limits.msmeMonitoredPerYear || 0),
    'X-Partner-Usage-Period-Reset': endOfMonth().toISOString()
  };
};

const getPartnerUsageSummary = async (partner, options = {}) => {
  const days = Math.min(Math.max(parseInt(options.days, 10) || 30, 7), 90);
  const monthStart = startOfMonth();
  const yearStart = startOfYear();

  const [monthUsage, yearUsage, dailySeries] = await Promise.all([
    getCachedUsageCounts(partner._id, monthStart),
    getCachedUsageCounts(partner._id, yearStart),
    buildDailySeries(partner._id, days)
  ]);

  const billing = computeBillingEstimate(partner, monthUsage, yearUsage);
  const quotas = buildQuotaStatus(partner, monthUsage, yearUsage);

  return {
    period: {
      monthStart: monthStart.toISOString(),
      yearStart: yearStart.toISOString(),
      monthEnd: endOfMonth().toISOString()
    },
    statistics: {
      monthToDate: monthUsage,
      yearToDate: {
        totalCalls: yearUsage.totalCalls,
        apiCalls: yearUsage.apiCalls,
        errorCalls: yearUsage.errorCalls,
        webhookCalls: yearUsage.webhookCalls,
        reportPullCalls: yearUsage.reportPullCalls,
        distinctMsmeAccessed: yearUsage.distinctMsmeAccessed
      }
    },
    dailySeries,
    quotas,
    billing,
    rateLimitTier: partner.rateLimitTier || 'standard'
  };
};

const getPartnerDashboard = async (partner) => {
  const summary = await getPartnerUsageSummary(partner, { days: 14 });
  const billingAccess = resolvePartnerBillingAccess(partner);

  return {
    partner: {
      id: partner._id,
      name: partner.name,
      organizationName: partner.organizationName,
      organizationType: partner.organizationType,
      billingPlanId: partner.billingPlanId,
      billingStatus: partner.billingStatus,
      billingActivatedAt: partner.billingActivatedAt,
      contractPaidUntil: partner.contractPaidUntil,
      scopes: partner.scopes,
      apiKeyMasked: `${partner.apiKeyPrefix}_••••••••••••••••`,
      rateLimitTier: partner.rateLimitTier,
      lastUsedAt: partner.lastUsedAt,
      webhookConfigured: Boolean(partner.webhookUrl),
      usageLimits: partner.usageLimits,
      overageRates: partner.overageRates,
      billingAccess
    },
    statistics: summary.statistics,
    usageChart: summary.dailySeries,
    quotas: summary.quotas,
    billing: summary.billing
  };
};

module.exports = {
  USAGE_CATEGORIES,
  normalizeEndpointKey,
  classifyUsageCategory,
  recordPartnerApiEvent,
  countUsageSince,
  getCachedUsageCounts,
  invalidateUsageCache,
  buildDailySeries,
  computeBillingEstimate,
  buildQuotaStatus,
  checkUsageQuotaExceeded,
  buildUsageResponseHeaders,
  getPartnerUsageSummary,
  getPartnerDashboard,
  startOfMonth,
  startOfYear,
  endOfMonth
};
