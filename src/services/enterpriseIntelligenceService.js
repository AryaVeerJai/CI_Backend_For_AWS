const Transaction = require('../models/Transaction');
const CarbonAssessment = require('../models/CarbonAssessment');
const Document = require('../models/Document');
const carbonCalculationService = require('./carbonCalculationService');
const carbonForecastingService = require('./carbonForecastingService');
const { getOperationalProfile } = require('./organizationProfileService');
const { listConnectors } = require('./connectors/accountingConnectorRegistry');
const accountingSyncService = require('./accountingSyncService');
const { persistParsedAccountingTransactions } = require('./accountingImportService');
const { getHandler } = require('./agents/registry');
const { runEnterpriseAgentPipeline } = require('./enterpriseEmissionsOrchestrationService');
const complianceHubService = require('./complianceHubService');
const { buildOrgDataFilter } = require('../utils/orgDataScope');
const logger = require('../utils/logger');

const safeRound = (value, decimals = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
};

const toCo2 = (tx) => safeRound(tx?.carbonFootprint?.co2Emissions || 0);

const buildConnectorStatus = async (context = {}) => {
  const connectors = listConnectors({ includeConfiguration: false });
  const apiStatuses = await accountingSyncService.listConnectorStatuses(context);
  return connectors.map((connector) => {
    const api = apiStatuses.find((entry) => entry.id === connector.id);
    const syncReady = Boolean(
      (api?.api?.configured || api?.api?.selfServeConnected) && api?.supportsApiSync
    );
    return {
      id: connector.id,
      name: connector.name,
      supportsImport: connector.integrationTypes.includes('import'),
      supportsApiSync: connector.integrationTypes.includes('api'),
      apiConfigured: Boolean(api?.api?.configured || api?.api?.selfServeConnected),
      selfServeConnected: Boolean(api?.api?.selfServeConnected),
      syncReady
    };
  });
};

const buildHotspots = (transactions, limit = 10) => (
  [...(transactions || [])]
    .filter((t) => toCo2(t) > 0)
    .sort((a, b) => toCo2(b) - toCo2(a))
    .slice(0, limit)
    .map((t, index) => ({
      rank: index + 1,
      transactionId: t._id,
      description: t.description || t.vendor || t.category || 'Activity',
      category: t.category || t.carbonFootprint?.category || 'other',
      co2Kg: toCo2(t),
      scope: t.carbonFootprint?.emissionBreakdown?.scope
        || t.carbonFootprint?.scope
        || 'scope3',
      date: t.date,
      facility: t.facility || t.site || null
    }))
);

const buildCategoryBreakdown = (transactions) => {
  const map = new Map();
  (transactions || []).forEach((tx) => {
    const category = String(tx.category || tx.carbonFootprint?.category || 'other').toLowerCase();
    const cur = map.get(category) || { category, co2Kg: 0, count: 0 };
    cur.co2Kg += toCo2(tx);
    cur.count += 1;
    map.set(category, cur);
  });
  return Array.from(map.values()).sort((a, b) => b.co2Kg - a.co2Kg);
};

const loadOrgTransactions = async (req, periodDays = 365) => {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const filter = buildOrgDataFilter(req, {
    date: { $gte: startDate, $lte: endDate },
    isSpam: { $ne: true },
    isDuplicate: { $ne: true }
  });
  return Transaction.find(filter).sort({ date: -1 }).limit(5000).lean();
};

const loadOrgAssessments = async (req, limit = 24) => {
  const filter = buildOrgDataFilter(req);
  return CarbonAssessment.find(filter)
    .sort({ 'period.startDate': -1, createdAt: -1 })
    .limit(limit)
    .lean();
};

const runCarbonAgents = async (profile, transactions, assessment) => {
  const agentInput = {
    enterpriseProfile: profile.enterpriseProfile || profile,
    transactions,
    assessment,
    totalCO2: assessment?.totalCO2Emissions || 0
  };

  const agentTypes = [
    'carbon_analyzer',
    'recommendation_engine',
    'trend_analyzer',
    'anomaly_detector',
    'compliance_monitor'
  ];

  const results = [];
  for (const type of agentTypes) {
    try {
      const handler = getHandler(type);
      const result = handler
        ? await handler({ input: agentInput })
        : { skipped: true, reason: 'No handler registered' };
      results.push({ agent: type, status: 'completed', result });
    } catch (error) {
      logger.warn(`Enterprise agent ${type} failed:`, error.message);
      results.push({ agent: type, status: 'failed', error: error.message });
    }
  }
  return results;
};

const extractRecommendations = (agentResults) => {
  const recommendations = [];
  agentResults.forEach((entry) => {
    if (entry.status !== 'completed' || !entry.result) return;
    const result = entry.result;
    const items = result.recommendations
      || result.suggestions
      || result.actions
      || (Array.isArray(result) ? result : []);
    if (Array.isArray(items)) {
      items.forEach((item) => {
        recommendations.push({
          source: entry.agent,
          title: item.title || item.name || item.message || 'Recommendation',
          description: item.description || item.message || '',
          priority: item.priority || 'medium',
          potentialReductionKg: item.potentialReduction
            || item.potentialCO2Reduction
            || item.potentialReductionKg
            || null,
          category: item.category || null
        });
      });
    }
  });
  return recommendations.slice(0, 15);
};

/**
 * Full enterprise intelligence: connectors, emissions, hotspots, agents, forecast, compliance.
 */
const buildEnterpriseIntelligence = async (req, options = {}) => {
  const { period = 'annual', runAgents = true, includeForecast = true } = options;
  const operational = await getOperationalProfile(req.user);
  if (!operational || operational.segment !== 'enterprise') {
    return { success: false, message: 'Enterprise profile required' };
  }

  const { profile } = operational;
  const enterpriseRaw = profile.enterpriseProfile || profile;

  const [transactions, assessments, documents] = await Promise.all([
    loadOrgTransactions(req),
    loadOrgAssessments(req),
    Document.find(buildOrgDataFilter(req, { createdAt: { $gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) } }))
      .select('_id fileName originalName documentType status createdAt')
      .limit(100)
      .lean()
  ]);

  let latestAssessment = assessments[0] || null;
  if (!latestAssessment && transactions.length > 0) {
    try {
      const calculated = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
        profile,
        transactions
      );
      latestAssessment = calculated;
    } catch (error) {
      logger.warn('Enterprise carbon calculation failed:', error.message);
    }
  }

  const totalCO2Kg = safeRound(latestAssessment?.totalCO2Emissions || 0);
  const scopes = {
    scope1: safeRound(latestAssessment?.breakdown?.scopes?.scope1
      ?? latestAssessment?.breakdown?.scope1 ?? 0),
    scope2: safeRound(latestAssessment?.breakdown?.scopes?.scope2
      ?? latestAssessment?.breakdown?.scope2 ?? 0),
    scope3: safeRound(latestAssessment?.breakdown?.scopes?.scope3
      ?? latestAssessment?.breakdown?.scope3 ?? 0)
  };

  const hotspots = buildHotspots(transactions);
  const categoryBreakdown = buildCategoryBreakdown(transactions);
  const connectors = await buildConnectorStatus({
    msmeId: req.user?.msmeId,
    organizationId: req.user?.organizationId,
    legalName: req.user?.legalName
  });

  let agentPipeline = null;
  let carbonAgents = [];
  let recommendations = [];

  if (runAgents) {
    [agentPipeline, carbonAgents] = await Promise.all([
      runEnterpriseAgentPipeline(enterpriseRaw),
      runCarbonAgents(profile, transactions, latestAssessment)
    ]);
    recommendations = extractRecommendations([
      ...carbonAgents,
      ...(agentPipeline?.orchestrationResults || [])
    ]);
  }

  let forecast = null;
  if (includeForecast && assessments.length >= 3) {
    const forecastResult = await carbonForecastingService.generateCarbonFootprintForecast(
      profile,
      assessments,
      { forecastPeriods: 12, modelType: 'auto' }
    );
    if (forecastResult.success) {
      forecast = forecastResult.data;
    } else {
      forecast = {
        available: false,
        reason: forecastResult.message || forecastResult.error,
        minimumAssessmentsRequired: 3,
        currentAssessments: assessments.length
      };
    }
  } else if (includeForecast) {
    forecast = {
      available: false,
      reason: 'Insufficient assessment history',
      minimumAssessmentsRequired: 3,
      currentAssessments: assessments.length
    };
  }

  let compliance = null;
  try {
    compliance = await complianceHubService.getHubOverviewForUser(req.user, period);
  } catch (error) {
    logger.warn('Enterprise compliance hub overview failed:', error.message);
    compliance = agentPipeline?.compliance || null;
  }

  const configuredConnectors = connectors.filter((c) => c.apiConfigured || c.supportsImport);
  const dataCollectionScore = Math.min(100, Math.round(
    (transactions.length > 0 ? 40 : 0)
    + (documents.length > 0 ? 20 : 0)
    + (configuredConnectors.some((c) => c.syncReady) ? 25 : 10)
    + (assessments.length > 0 ? 15 : 0)
  ));

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    companyName: profile.companyName,
    segment: 'enterprise',
    dataCollection: {
      score: dataCollectionScore,
      transactionCount: transactions.length,
      documentCount: documents.length,
      assessmentCount: assessments.length,
      connectors,
      configuredConnectorCount: configuredConnectors.filter((c) => c.syncReady).length,
      guidance: dataCollectionScore < 60
        ? 'Connect accounting software (Tally, Zoho, QuickBooks) or upload facility utility bills to improve inventory quality.'
        : 'Data collection is sufficient for BRSR-aligned inventory and hotspot analysis.'
    },
    emissions: {
      totalCO2Kg,
      scopes,
      latestAssessmentId: latestAssessment?._id || null,
      categoryBreakdown,
      period
    },
    hotspots: {
      items: hotspots,
      topCategory: categoryBreakdown[0]?.category || null,
      topCategorySharePercent: totalCO2Kg > 0 && categoryBreakdown[0]
        ? safeRound((categoryBreakdown[0].co2Kg / totalCO2Kg) * 100)
        : 0
    },
    recommendations,
    forecast,
    compliance: {
      overview: compliance,
      mandates: agentPipeline?.compliance?.applicableMandates || [],
      readinessScore: agentPipeline?.compliance?.readinessScore || null,
      gaps: agentPipeline?.compliance?.gaps || []
    },
    agents: {
      enterprisePipeline: agentPipeline
        ? {
          summary: agentPipeline.summary,
          brsr: agentPipeline.brsr,
          pat: agentPipeline.pat
        }
        : null,
      carbonAgents: carbonAgents.map((a) => ({ agent: a.agent, status: a.status }))
    }
  };
};

/**
 * Sync all configured accounting connectors and recalculate emissions snapshot.
 */
const syncConnectorsAndAnalyze = async (req) => {
  const statuses = await accountingSyncService.listConnectorStatuses({
    msmeId: req.user?.msmeId,
    organizationId: req.user?.organizationId,
    legalName: req.user?.legalName
  });
  const syncResults = [];

  for (const entry of statuses) {
    if (!entry?.api?.syncReady || !entry.supportsApiSync) {
      continue;
    }
    try {
      const syncResult = await accountingSyncService.syncProviderTransactions(entry.id, {
        syncAllPages: true,
        msmeId: req.user?.msmeId,
        organizationId: req.user?.organizationId,
        legalName: req.user?.legalName
      });
      const importResult = await persistParsedAccountingTransactions({
        organizationId: req.user.organizationId,
        msmeId: req.user.msmeId || null,
        parsedResult: syncResult.parsedResult,
        receivedCount: syncResult.fetchedCount,
        runAgents: true
      });
      syncResults.push({
        provider: entry.id,
        status: 'completed',
        fetchedCount: syncResult.fetchedCount,
        importResult
      });
    } catch (error) {
      syncResults.push({ provider: entry.id, status: 'failed', error: error.message });
    }
  }

  const intelligence = await buildEnterpriseIntelligence(req, { runAgents: true });
  return {
    syncResults,
    intelligence
  };
};

module.exports = {
  buildEnterpriseIntelligence,
  syncConnectorsAndAnalyze,
  buildHotspots,
  buildConnectorStatus
};
