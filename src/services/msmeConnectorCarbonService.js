const Transaction = require('../models/Transaction');
const MSME = require('../models/MSME');
const accountingSyncService = require('./accountingSyncService');
const { persistParsedAccountingTransactions } = require('./accountingImportService');
const carbonCalculationService = require('./carbonCalculationService');
const msmeEmissionsOrchestrationService = require('./msmeEmissionsOrchestrationService');
const logger = require('../utils/logger');

const ownerContextFromRequest = (req) => ({
  msmeId: req.user?.msmeId,
  organizationId: req.user?.organizationId,
  legalName: req.user?.legalName,
  companyName: req.body?.companyName || req.query?.companyName
});

const isExplicitFalse = (value) => value === false || value === 'false' || value === '0';

const resolveCarbonPipelineOptions = (body = {}) => ({
  runAgents: !isExplicitFalse(body.runAgents),
  runOrchestration: !isExplicitFalse(body.runOrchestration)
});

const loadMsmeProfile = async (msmeId) => {
  if (!msmeId) {
    return null;
  }
  return MSME.findById(msmeId).lean();
};

const loadImportedTransactions = async ({ msmeId, organizationId, importedIds = [] }) => {
  if (!importedIds.length) {
    return [];
  }

  const filter = {
    _id: { $in: importedIds },
    isSpam: { $ne: true },
    isDuplicate: { $ne: true }
  };
  if (msmeId) {
    filter.msmeId = msmeId;
  }
  if (organizationId) {
    filter.organizationId = organizationId;
  }

  return Transaction.find(filter).sort({ date: -1 }).lean();
};

const runPostImportCarbonAnalysis = async ({
  msmeId,
  organizationId,
  importedIds = [],
  runAgents = true,
  runOrchestration = true,
  msmeData = null
}) => {
  const resolvedMsmeData = msmeData || await loadMsmeProfile(msmeId);
  const connectorTransactions = await loadImportedTransactions({
    msmeId,
    organizationId,
    importedIds
  });

  let carbonAssessment = null;
  let orchestration = null;

  if (connectorTransactions.length > 0 && resolvedMsmeData) {
    try {
      carbonAssessment = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
        resolvedMsmeData,
        connectorTransactions
      );
    } catch (assessmentError) {
      logger.warn('MSME post-import carbon assessment failed', {
        error: assessmentError.message,
        msmeId,
        transactionCount: connectorTransactions.length
      });
    }
  }

  if (
    runAgents
    && runOrchestration
    && resolvedMsmeData
    && connectorTransactions.length > 0
  ) {
    try {
      orchestration = await msmeEmissionsOrchestrationService.orchestrateEmissions({
        msmeId,
        msmeData: resolvedMsmeData,
        transactions: connectorTransactions
      });
    } catch (orchestrationError) {
      logger.warn('MSME post-import emissions orchestration failed', {
        error: orchestrationError.message,
        msmeId,
        transactionCount: connectorTransactions.length
      });
      orchestration = {
        status: 'failed',
        error: orchestrationError.message
      };
    }
  }

  return {
    connectorTransactions: {
      count: connectorTransactions.length,
      importedIds
    },
    carbonAssessment,
    orchestration
  };
};

/**
 * Sync API-ready accounting connectors, persist transactional data with agent-aligned
 * carbon footprints, then run MSME multi-agent emissions orchestration.
 */
const syncConnectorsAndCalculateCarbon = async (req, options = {}) => {
  const {
    runAgents = true,
    runOrchestration = true,
    syncAllPages = true
  } = options;

  const context = ownerContextFromRequest(req);
  const { msmeId, organizationId } = context;

  if (!msmeId && !organizationId) {
    const error = new Error('MSME or organization profile not found for authenticated user');
    error.statusCode = 404;
    throw error;
  }

  const msmeData = await loadMsmeProfile(msmeId);
  const statuses = await accountingSyncService.listConnectorStatuses(context);
  const syncResults = [];

  for (const entry of statuses) {
    if (!entry?.api?.syncReady || !entry.supportsApiSync) {
      continue;
    }

    try {
      const syncResult = await accountingSyncService.syncProviderTransactions(entry.id, {
        syncAllPages,
        ...context
      });

      const importResult = await persistParsedAccountingTransactions({
        msmeId: msmeId || null,
        organizationId: organizationId || null,
        parsedResult: syncResult.parsedResult,
        receivedCount: syncResult.fetchedCount,
        runAgents,
        msmeData
      });

      syncResults.push({
        provider: entry.id,
        status: 'completed',
        fetchedCount: syncResult.fetchedCount,
        importResult
      });
    } catch (error) {
      logger.warn('Connector sync failed', { provider: entry.id, error: error.message });
      syncResults.push({
        provider: entry.id,
        status: 'failed',
        error: error.message
      });
    }
  }

  const importedIds = syncResults.flatMap((entry) => (
    entry.importResult?.imported || []
  ).map((row) => row.id).filter(Boolean));

  const carbonAnalysis = await runPostImportCarbonAnalysis({
    msmeId,
    organizationId,
    importedIds,
    runAgents,
    runOrchestration,
    msmeData
  });

  return {
    syncResults,
    ...carbonAnalysis
  };
};

module.exports = {
  syncConnectorsAndCalculateCarbon,
  runPostImportCarbonAnalysis,
  resolveCarbonPipelineOptions,
  loadImportedTransactions,
  loadMsmeProfile
};
