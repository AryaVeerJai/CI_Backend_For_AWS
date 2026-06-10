/**
 * Accounting JSON + file import routes.
 * Mounted at /api/transactions/* and /api/accounting/* so Data connectors imports
 * work whether the deployment exposes the transactions or accounting API prefix.
 */
const express = require('express');
const multer = require('multer');
const { clientErrorPayload } = require('../utils/httpErrors');
const logger = require('../utils/logger');
const {
  parseTransactions,
  SUPPORTED_PROVIDERS
} = require('../services/accountingTransactionParserService');
const { persistParsedAccountingTransactions } = require('../services/accountingImportService');
const {
  runPostImportCarbonAnalysis,
  resolveCarbonPipelineOptions,
  loadMsmeProfile
} = require('../services/msmeConnectorCarbonService');
const {
  detectTallyPrimeImportFile,
  parseTallyPrimeImportFile
} = require('../services/connectors/tallyPrimeImportParser');
const {
  detectZohoBooksImportFile,
  parseZohoBooksImportFile
} = require('../services/connectors/zohoBooksImportParser');
const {
  detectProviderImportFile,
  parseProviderImportFile,
  getProviderDisplayName,
  SUPPORTED_PROVIDER_IMPORT_IDS
} = require('../services/connectors/providerSpecificImportParser');
const { getOrgScope } = require('../utils/orgDataScope');
const uploadLimits = require('../config/uploadLimits');

const accountingImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadLimits.maxFileBytes },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'text/xml',
      'application/xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/json',
      'application/pdf'
    ];
    const lowered = String(file.originalname || '').toLowerCase();
    if (
      allowed.includes(file.mimetype)
      || lowered.endsWith('.xml')
      || lowered.endsWith('.xlsx')
      || lowered.endsWith('.xls')
      || lowered.endsWith('.csv')
      || lowered.endsWith('.json')
      || lowered.endsWith('.pdf')
    ) {
      cb(null, true);
      return;
    }
    cb(new Error('Unsupported accounting import file type'));
  }
});

function createAccountingImportRouter(requireOperationalTransactions) {
  const router = express.Router();

  router.post('/import-accounting', requireOperationalTransactions, async (req, res) => {
    try {
      const { provider, transactions } = req.body || {};
      const scope = getOrgScope(req);

      if (!scope.organizationId) {
        return res.status(404).json({
          success: false,
          message: 'Organization profile not found for authenticated user'
        });
      }

      let parsedResult;
      try {
        parsedResult = parseTransactions({ provider, transactions });
      } catch (parseError) {
        return res.status(400).json({
          success: false,
          message: parseError.message,
          supportedProviders: SUPPORTED_PROVIDERS
        });
      }

      const { runAgents, runOrchestration } = resolveCarbonPipelineOptions(req.body);
      const msmeData = runAgents ? await loadMsmeProfile(scope.msmeId) : null;

      const importResult = await persistParsedAccountingTransactions({
        msmeId: scope.msmeId,
        organizationId: scope.organizationId,
        parsedResult,
        receivedCount: Array.isArray(transactions) ? transactions.length : 0,
        runAgents,
        msmeData
      });

      const importedIds = importResult.imported.map((row) => row.id).filter(Boolean);
      let carbonAnalysis = null;
      if (importedIds.length > 0) {
        carbonAnalysis = await runPostImportCarbonAnalysis({
          msmeId: scope.msmeId,
          organizationId: scope.organizationId,
          importedIds,
          runAgents,
          runOrchestration,
          msmeData
        });
      }

      const message = importResult.actionRequired
        ? 'Accounting transactions parsed. High-value rows require bill uploads for line-item emission breakup.'
        : runOrchestration && importedIds.length > 0
          ? 'Accounting transactions imported with multi-agent carbon analysis.'
          : 'Accounting transactions parsed successfully';

      return res.json({
        success: true,
        message,
        data: {
          ...importResult,
          ...(carbonAnalysis || {})
        }
      });
    } catch (error) {
      logger.error('Import accounting transactions error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        ...clientErrorPayload(error)
      });
    }
  });

  router.post(
    '/import-accounting-file',
    requireOperationalTransactions,
    accountingImportUpload.single('file'),
    async (req, res) => {
      try {
        const scope = getOrgScope(req);
        if (!scope.organizationId) {
          return res.status(404).json({
            success: false,
            message: 'Organization profile not found for authenticated user'
          });
        }

        if (!req.file) {
          return res.status(400).json({
            success: false,
            message: 'Accounting import file is required'
          });
        }

        const provider = String(req.body?.provider || 'tally').trim().toLowerCase();
        const filename = req.file.originalname || 'import';
        const loweredName = filename.toLowerCase();
        const isBinarySpreadsheet = loweredName.endsWith('.xlsx') || loweredName.endsWith('.xls');
        const isPdf = loweredName.endsWith('.pdf');

        let parsedFile;
        let detection;

        if (provider === 'zoho') {
          parsedFile = await parseZohoBooksImportFile({
            filename,
            content: isBinarySpreadsheet || isPdf ? null : req.file.buffer.toString('utf8'),
            buffer: isBinarySpreadsheet || isPdf ? req.file.buffer : null
          });
          detection = parsedFile.detection || detectZohoBooksImportFile({
            filename,
            content: isBinarySpreadsheet || isPdf ? '' : req.file.buffer.toString('utf8'),
            headers: parsedFile.meta?.headers || []
          });
        } else if (provider === 'tally') {
          parsedFile = await parseTallyPrimeImportFile({
            filename,
            content: isBinarySpreadsheet || isPdf ? null : req.file.buffer.toString('utf8'),
            buffer: isBinarySpreadsheet || isPdf ? req.file.buffer : null
          });
          detection = parsedFile.detection || detectTallyPrimeImportFile({
            filename,
            content: isBinarySpreadsheet || isPdf ? '' : req.file.buffer.toString('utf8'),
            headers: parsedFile.meta?.headers || []
          });
        } else if (SUPPORTED_PROVIDER_IMPORT_IDS.includes(provider)) {
          parsedFile = await parseProviderImportFile({
            provider,
            filename,
            content: isBinarySpreadsheet || isPdf ? null : req.file.buffer.toString('utf8'),
            buffer: isBinarySpreadsheet || isPdf ? req.file.buffer : null
          });
          detection = parsedFile.detection || detectProviderImportFile({
            provider,
            filename,
            content: isBinarySpreadsheet || isPdf ? '' : req.file.buffer.toString('utf8'),
            headers: parsedFile.meta?.headers || []
          });
        } else {
          return res.status(400).json({
            success: false,
            message: `File import is not configured for provider "${provider}". Supported file-import providers: tally, zoho, ${SUPPORTED_PROVIDER_IMPORT_IDS.join(', ')}.`,
            supportedProviders: SUPPORTED_PROVIDERS
          });
        }

        if (provider === 'tally' && !detection.accepted) {
          return res.status(400).json({
            success: false,
            message: 'File does not match TallyPrime Day Book export keywords. Export from TallyPrime Day Book as XML, XLSX, or PDF.',
            detection
          });
        }

        if (provider === 'zoho' && !detection.accepted) {
          return res.status(400).json({
            success: false,
            message: 'File does not match Zoho Books transaction export keywords. Export from Zoho Books Reports → Transaction List as CSV, XLSX, or PDF.',
            detection
          });
        }

        if (SUPPORTED_PROVIDER_IMPORT_IDS.includes(provider) && !detection.accepted) {
          const providerLabel = getProviderDisplayName(provider);
          return res.status(400).json({
            success: false,
            message: `File does not match ${providerLabel} export keywords. Export from ${providerLabel} as XLSX or PDF with the expected column headers.`,
            detection
          });
        }

        const transactions = Array.isArray(parsedFile.transactions) ? parsedFile.transactions : [];
        if (transactions.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'No transactions were found in the selected accounting export file.',
            detection,
            meta: parsedFile.meta || null
          });
        }

        let parsedResult;
        try {
          parsedResult = parseTransactions({ provider, transactions });
        } catch (parseError) {
          return res.status(400).json({
            success: false,
            message: parseError.message,
            supportedProviders: SUPPORTED_PROVIDERS,
            detection
          });
        }

        const { runAgents, runOrchestration } = resolveCarbonPipelineOptions(req.body);
        const msmeData = runAgents ? await loadMsmeProfile(scope.msmeId) : null;
        const importResult = await persistParsedAccountingTransactions({
          msmeId: scope.msmeId,
          organizationId: scope.organizationId,
          parsedResult,
          receivedCount: transactions.length,
          runAgents,
          msmeData
        });

        const importedIds = importResult.imported.map((row) => row.id).filter(Boolean);
        let carbonAnalysis = null;
        if (importedIds.length > 0) {
          carbonAnalysis = await runPostImportCarbonAnalysis({
            msmeId: scope.msmeId,
            organizationId: scope.organizationId,
            importedIds,
            runAgents,
            runOrchestration,
            msmeData
          });
        }

        const providerLabel = provider === 'zoho'
          ? 'Zoho Books'
          : provider === 'tally'
            ? 'TallyPrime'
            : getProviderDisplayName(provider);
        const message = importResult.actionRequired
          ? `${providerLabel} export parsed. High-value rows require bill uploads for line-item emission breakup.`
          : runOrchestration && importedIds.length > 0
            ? `${providerLabel} export imported with multi-agent carbon analysis.`
            : `${providerLabel} export imported successfully`;

        return res.json({
          success: true,
          message,
          data: {
            ...importResult,
            ...(carbonAnalysis || {}),
            detection,
            importMeta: parsedFile.meta || null
          }
        });
      } catch (error) {
        logger.error('Import accounting file error:', error);
        return res.status(500).json({
          success: false,
          message: 'Internal server error',
          ...clientErrorPayload(error)
        });
      }
    }
  );

  return router;
}

module.exports = { createAccountingImportRouter, accountingImportUpload };
