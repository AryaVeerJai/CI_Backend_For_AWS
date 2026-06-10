const express = require('express');
const auth = require('../middleware/auth');
const { createAccountingImportRouter } = require('./accountingImportRoutes');
const { listConnectors } = require('../services/connectors/accountingConnectorRegistry');
const accountingSyncService = require('../services/accountingSyncService');
const msmeConnectorConnectionService = require('../services/msmeConnectorConnectionService');
const { parseTransactions, SUPPORTED_PROVIDERS } = require('../services/accountingTransactionParserService');
const { persistParsedAccountingTransactions } = require('../services/accountingImportService');
const { syncConnectorsAndCalculateCarbon, runPostImportCarbonAnalysis, resolveCarbonPipelineOptions, loadMsmeProfile } = require('../services/msmeConnectorCarbonService');
const { clientErrorPayload } = require('../utils/httpErrors');
const logger = require('../utils/logger');

const router = express.Router();

const requireOperationalTransactions = [
  auth,
  auth.requireRole('msme', 'enterprise'),
  auth.requireOrganizationProfile
];

router.use(createAccountingImportRouter(requireOperationalTransactions));

const ownerContextFromRequest = (req) => ({
  msmeId: req.user.msmeId,
  organizationId: req.user.organizationId,
  legalName: req.user.legalName,
  companyName: req.query.companyName
});

const requireOwnerProfile = (req, res) => {
  if (!req.user.msmeId && !req.user.organizationId) {
    res.status(404).json({
      success: false,
      message: 'MSME or organization profile not found for authenticated user'
    });
    return false;
  }
  return true;
};

// @route   GET /api/accounting/connectors
// @desc    List Indian accounting software connectors
// @access  Private
router.get('/connectors', auth, (req, res) => {
  res.json({
    success: true,
    data: {
      connectors: listConnectors({ includeConfiguration: true }),
      supportedImportProviders: SUPPORTED_PROVIDERS,
      selfServeConnectSchemas: msmeConnectorConnectionService.listConnectSchemas()
    }
  });
});

// @route   GET /api/accounting/connections
// @desc    List MSME self-serve connector connections for the authenticated owner
// @access  Private
router.get('/connections', auth, async (req, res) => {
  try {
    if (!requireOwnerProfile(req, res)) return;

    const connections = await msmeConnectorConnectionService.listConnections(ownerContextFromRequest(req));
    return res.json({
      success: true,
      data: { connections }
    });
  } catch (error) {
    logger.error('List MSME connector connections error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/accounting/connect-schemas
// @desc    Self-serve connect field schemas (Tally, Zoho, QuickBooks, import-only tools)
// @access  Private
router.get('/connect-schemas', auth, (_req, res) => {
  res.json({
    success: true,
    data: {
      schemas: msmeConnectorConnectionService.listConnectSchemas()
    }
  });
});

// @route   GET /api/accounting/api-status
// @desc    List API sync configuration status for all API-capable connectors
// @access  Private
router.get('/api-status', auth, async (req, res) => {
  try {
    const context = ownerContextFromRequest(req);
    const statuses = await accountingSyncService.listConnectorStatuses(context);
    return res.json({
      success: true,
      data: {
        connectors: statuses,
        anyConfigured: statuses.some((entry) => entry.api?.configured || entry.api?.selfServeConnected)
      }
    });
  } catch (error) {
    logger.error('Accounting API status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PUT /api/accounting/connections/:provider
// @desc    Save MSME self-serve connector credentials or mark import-only tool as connected
// @access  Private
router.put('/connections/:provider', auth, async (req, res) => {
  try {
    if (!requireOwnerProfile(req, res)) return;

    const connection = await msmeConnectorConnectionService.upsertConnection({
      ...ownerContextFromRequest(req),
      provider: req.params.provider,
      credentials: req.body?.credentials || req.body || {},
      connectionType: req.body?.connectionType
    });

    return res.json({
      success: true,
      message: 'Accounting connector connected',
      data: { connection }
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      logger.error('MSME connector connect error:', error);
    }
    return res.status(statusCode).json({
      success: false,
      message: error.message,
      ...clientErrorPayload(error)
    });
  }
});

// @route   DELETE /api/accounting/connections/:provider
// @desc    Disconnect MSME accounting connector
// @access  Private
router.delete('/connections/:provider', auth, async (req, res) => {
  try {
    if (!requireOwnerProfile(req, res)) return;

    const connection = await msmeConnectorConnectionService.disconnectConnection({
      ...ownerContextFromRequest(req),
      provider: req.params.provider
    });

    return res.json({
      success: true,
      message: 'Accounting connector disconnected',
      data: { connection }
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      logger.error('MSME connector disconnect error:', error);
    }
    return res.status(statusCode).json({
      success: false,
      message: error.message,
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/accounting/connections/:provider/test
// @desc    Test MSME connector credentials (saved or submitted in body)
// @access  Private
router.post('/connections/:provider/test', auth, async (req, res) => {
  try {
    if (!requireOwnerProfile(req, res)) return;

    const result = await msmeConnectorConnectionService.testConnection({
      ...ownerContextFromRequest(req),
      provider: req.params.provider,
      credentials: req.body?.credentials
    });

    return res.json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      logger.error('MSME connector test error:', error);
    }
    return res.status(statusCode).json({
      success: false,
      message: error.message,
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/accounting/:provider/status
// @desc    Get connector and API configuration status
// @access  Private
router.get('/:provider/status', auth, async (req, res) => {
  try {
    const status = await accountingSyncService.getConnectorStatus(req.params.provider, ownerContextFromRequest(req));
    return res.json({
      success: true,
      data: status
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      logger.error('Accounting connector status error:', error);
    }
    return res.status(statusCode).json({
      success: false,
      message: error.message,
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/accounting/sync-connectors
// @desc    Sync all API-ready data connectors, calculate carbon with agents, run orchestration
// @access  Private
router.post('/sync-connectors', auth, async (req, res) => {
  try {
    if (!requireOwnerProfile(req, res)) return;

    const runAgents = req.body?.runAgents !== false;
    const runOrchestration = req.body?.runOrchestration !== false;

    const result = await syncConnectorsAndCalculateCarbon(req, {
      runAgents,
      runOrchestration,
      syncAllPages: req.body?.syncAllPages !== false
    });

    const syncedCount = result.syncResults.filter((entry) => entry.status === 'completed').length;
    const importedCount = result.connectorTransactions.count;

    return res.json({
      success: true,
      message: importedCount > 0
        ? `Synced ${syncedCount} connector(s) and processed ${importedCount} transaction(s) with multi-agent carbon analysis.`
        : 'No API-ready connectors were synced. Connect Tally, Zoho, or QuickBooks under Data connectors.',
      data: result
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      logger.error('Accounting sync-connectors error:', error);
    }
    return res.status(statusCode).json({
      success: false,
      message: error.message,
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/accounting/:provider/sync
// @desc    Fetch transactions from accounting API and import into carbon ledger
// @access  Private
router.post('/:provider/sync', auth, async (req, res) => {
  try {
    const msmeId = req.user.msmeId;
    const organizationId = req.user.organizationId;
    if (!msmeId && !organizationId) {
      return res.status(404).json({
        success: false,
        message: 'Organization profile not found for authenticated user'
      });
    }

    const provider = req.params.provider;
    const fetchOptions = {
      ...(req.body || {}),
      msmeId: msmeId || undefined,
      organizationId: organizationId || undefined,
      legalName: req.user.legalName || undefined
    };
    let syncResult;
    try {
      syncResult = await accountingSyncService.syncProviderTransactions(provider, fetchOptions);
    } catch (syncError) {
      const statusCode = syncError.statusCode || 400;
      return res.status(statusCode).json({
        success: false,
        message: syncError.message,
        ...clientErrorPayload(syncError)
      });
    }

    const { runAgents, runOrchestration } = resolveCarbonPipelineOptions(req.body);
    const msmeData = runAgents ? await loadMsmeProfile(msmeId) : null;

    const importResult = await persistParsedAccountingTransactions({
      msmeId: msmeId || null,
      organizationId: organizationId || null,
      parsedResult: syncResult.parsedResult,
      receivedCount: syncResult.fetchedCount,
      runAgents,
      msmeData
    });

    const importedIds = importResult.imported.map((row) => row.id).filter(Boolean);
    let carbonAnalysis = null;
    if (importedIds.length > 0) {
      carbonAnalysis = await runPostImportCarbonAnalysis({
        msmeId,
        organizationId,
        importedIds,
        runAgents,
        runOrchestration,
        msmeData
      });
    }

    const message = importResult.actionRequired
      ? 'Accounting transactions synced. High-value rows require bill uploads for line-item emission breakup.'
      : runOrchestration && importedIds.length > 0
        ? 'Accounting transactions synced with multi-agent carbon analysis.'
        : 'Accounting transactions synced successfully';

    return res.json({
      success: true,
      message,
      data: {
        ...importResult,
        ...(carbonAnalysis || {}),
        fetchedCount: syncResult.fetchedCount,
        fetchMeta: syncResult.fetchMeta
      }
    });
  } catch (error) {
    logger.error('Accounting sync error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/accounting/:provider/preview
// @desc    Fetch and parse accounting API transactions without persisting
// @access  Private
router.post('/:provider/preview', auth, async (req, res) => {
  try {
    const provider = req.params.provider;
    const fetchOptions = {
      ...(req.body || {}),
      msmeId: req.user.msmeId || undefined,
      organizationId: req.user.organizationId || undefined,
      legalName: req.user.legalName || undefined
    };
    const fetchResult = await accountingSyncService.fetchTransactionsFromProvider(provider, fetchOptions);
    const parsedResult = parseTransactions({
      provider,
      transactions: fetchResult.transactions
    });

    return res.json({
      success: true,
      data: {
        provider: parsedResult.provider,
        fetchedCount: fetchResult.transactions.length,
        parsedCount: parsedResult.parsedCount,
        validCount: parsedResult.validRows.length,
        invalidCount: parsedResult.invalidRows.length,
        validRows: parsedResult.validRows.map((row) => ({
          rowIndex: row.rowIndex,
          parsed: row.parsed
        })),
        invalidRows: parsedResult.invalidRows
      }
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      logger.error('Accounting preview error:', error);
    }
    return res.status(statusCode).json({
      success: false,
      message: error.message,
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;
