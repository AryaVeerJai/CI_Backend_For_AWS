const Transaction = require('../models/Transaction');
const MSME = require('../models/MSME');
const carbonCalculationService = require('./carbonCalculationService');
const duplicateDetectionService = require('./duplicateDetectionService');
const orchestrationManagerEventService = require('./orchestrationManagerEventService');
const dataProcessorAgent = require('./agents/dataProcessorAgent');
const logger = require('../utils/logger');
const {
  HIGH_VALUE_THRESHOLD_INR,
  HIGH_VALUE_WORKFLOWS,
  isHighValueTransactionRequiringBill,
  buildHighValueUploadRequirement
} = require('../config/highValueTransactionPolicy');

const buildAgentEnrichmentMap = (rows = [], agentResult = {}) => {
  const enrichmentBySourceId = new Map();
  const classified = Array.isArray(agentResult?.classified) ? agentResult.classified : [];

  classified.forEach((transaction, index) => {
    const sourceId = transaction?.sourceId || rows[index]?.parsed?.sourceId;
    if (!sourceId) {
      return;
    }
    enrichmentBySourceId.set(sourceId, {
      transaction,
      documentRequest: (agentResult.documentRequests || []).find(
        (request) => request.transactionId === sourceId
      ) || null
    });
  });

  return enrichmentBySourceId;
};

const enrichTransactionsWithAgents = async (rows = [], logContext = 'accounting rows') => {
  if (!rows.length) {
    return new Map();
  }

  try {
    const agentResult = await dataProcessorAgent.processTransactions(
      rows.map((row) => row.parsed),
      {
        thresholds: { highValueAmount: HIGH_VALUE_THRESHOLD_INR }
      }
    );
    return buildAgentEnrichmentMap(rows, agentResult);
  } catch (agentError) {
    logger.warn(`Data processor agent enrichment failed for ${logContext}`, {
      error: agentError.message,
      rowCount: rows.length
    });
    return new Map();
  }
};

const enrichHighValueTransactionsWithAgents = async (rows = []) => (
  enrichTransactionsWithAgents(rows, 'high-value accounting rows')
);

const resolveMsmeData = async ({ msmeData, msmeId }) => {
  if (msmeData) {
    return msmeData;
  }
  if (!msmeId) {
    return null;
  }
  return MSME.findById(msmeId).lean();
};

const mergeAgentEnrichment = (payload, enrichment) => {
  if (!enrichment?.transaction) {
    return payload;
  }
  return {
    ...payload,
    ...enrichment.transaction,
    processingMetadata: enrichment.transaction.processingMetadata || payload.processingMetadata
  };
};

const applyAgentCarbonFootprint = async (payload, msmeData) => {
  const runtimeContext = msmeData
    ? {
      msmeData: {
        ...msmeData,
        manufacturingProfile: msmeData.manufacturingProfile || {}
      },
      __fuelPriceCache: {}
    }
    : {};

  const enrichedPayload = {
    ...payload,
    industry: payload.industry || msmeData?.industry,
    businessDomain: payload.businessDomain || msmeData?.businessDomain,
    manufacturingProfile: payload.manufacturingProfile || msmeData?.manufacturingProfile || {}
  };

  return carbonCalculationService.calculateTransactionCarbonFootprintForAgent(
    enrichedPayload,
    runtimeContext
  );
};

const persistParsedAccountingTransactions = async ({
  msmeId,
  organizationId = null,
  parsedResult,
  receivedCount = null,
  runAgents = true,
  msmeData = null
}) => {
  const imported = [];
  const duplicates = [];
  const persistFailures = [];
  const pendingBillUpload = [];

  const standardRows = [];
  const highValueRows = [];

  for (const row of parsedResult.validRows) {
    if (isHighValueTransactionRequiringBill(row.parsed)) {
      highValueRows.push(row);
    } else {
      standardRows.push(row);
    }
  }

  const resolvedMsmeData = runAgents ? await resolveMsmeData({ msmeData, msmeId }) : null;
  const agentEnrichmentBySourceId = await enrichHighValueTransactionsWithAgents(highValueRows);
  const standardAgentEnrichmentBySourceId = runAgents
    ? await enrichTransactionsWithAgents(standardRows, 'connector standard accounting rows')
    : new Map();

  for (const row of highValueRows) {
    const payload = row.parsed;
    const enrichment = agentEnrichmentBySourceId.get(payload.sourceId);
    const enrichedTransaction = enrichment?.transaction
      ? { ...payload, ...enrichment.transaction, importRowIndex: row.rowIndex }
      : { ...payload, importRowIndex: row.rowIndex };

    const uploadRequest = buildHighValueUploadRequirement(
      enrichedTransaction,
      payload.sourceId,
      HIGH_VALUE_WORKFLOWS.ACCOUNTING
    );

    if (enrichment?.documentRequest) {
      uploadRequest.documentRequest = enrichment.documentRequest;
    }
    if (enrichedTransaction.processingMetadata) {
      uploadRequest.agentClassification = enrichedTransaction.processingMetadata;
    }

    pendingBillUpload.push({
      rowIndex: row.rowIndex,
      sourceId: payload.sourceId,
      amount: payload.amount,
      category: payload.category || 'other',
      description: payload.description || '',
      actionRequired: true,
      uploadRequest
    });

    try {
      orchestrationManagerEventService.emitEvent(
        'transactions.accounting_high_value_pending_bill_upload',
        {
          msmeId,
          provider: parsedResult.provider,
          sourceId: payload.sourceId,
          rowIndex: row.rowIndex,
          transactionPreview: uploadRequest.transactionPreview,
          uploadRequest
        },
        'transactions'
      );
    } catch (eventError) {
      logger.warn('Failed to emit high-value accounting bill upload event', {
        error: eventError.message,
        msmeId,
        sourceId: payload.sourceId
      });
    }
  }

  for (const row of standardRows) {
    const payload = row.parsed;
    const duplicateDetection = await duplicateDetectionService.detectDuplicate(payload, msmeId);

    if (duplicateDetection.isDuplicate) {
      duplicates.push({
        rowIndex: row.rowIndex,
        sourceId: payload.sourceId,
        reasons: duplicateDetection.reasons,
        similarityScore: duplicateDetection.similarityScore
      });
      continue;
    }

    try {
      const enrichment = standardAgentEnrichmentBySourceId.get(payload.sourceId);
      const enrichedPayload = mergeAgentEnrichment(
        { ...payload, importRowIndex: row.rowIndex },
        enrichment
      );

      const transaction = new Transaction({
        ...(organizationId ? { organizationId } : {}),
        ...(msmeId ? { msmeId } : {}),
        ...enrichedPayload,
        isProcessed: true,
        processedAt: new Date(),
        isDuplicate: false,
        isSpam: false
      });

      const carbonData = runAgents
        ? await applyAgentCarbonFootprint(enrichedPayload, resolvedMsmeData)
        : carbonCalculationService.calculateTransactionCarbonFootprint(payload);
      transaction.carbonFootprint = carbonData;
      await transaction.save();

      imported.push({
        id: transaction._id,
        rowIndex: row.rowIndex,
        sourceId: transaction.sourceId,
        amount: transaction.amount,
        date: transaction.date
      });
    } catch (persistError) {
      persistFailures.push({
        rowIndex: row.rowIndex,
        sourceId: payload.sourceId,
        error: persistError.message
      });
    }
  }

  try {
    orchestrationManagerEventService.emitEvent('transactions.accounting_imported', {
      msmeId,
      provider: parsedResult.provider,
      parsedCount: parsedResult.parsedCount,
      importedCount: imported.length,
      duplicateCount: duplicates.length,
      invalidCount: parsedResult.invalidRows.length,
      persistFailureCount: persistFailures.length,
      pendingBillUploadCount: pendingBillUpload.length
    }, 'transactions');
  } catch (eventError) {
    logger.warn('Failed to emit orchestration event for accounting import', {
      error: eventError.message,
      msmeId,
      provider: parsedResult.provider
    });
  }

  return {
    provider: parsedResult.provider,
    actionRequired: pendingBillUpload.length > 0,
    runAgents,
    totals: {
      received: receivedCount ?? parsedResult.parsedCount,
      parsed: parsedResult.parsedCount,
      imported: imported.length,
      duplicates: duplicates.length,
      invalid: parsedResult.invalidRows.length,
      persistFailures: persistFailures.length,
      pendingBillUpload: pendingBillUpload.length
    },
    imported,
    duplicates,
    pendingBillUpload,
    invalidRows: parsedResult.invalidRows.map((row) => ({
      rowIndex: row.rowIndex,
      errors: row.errors,
      sourceId: row.parsed?.sourceId || null
    })),
    persistFailures
  };
};

module.exports = {
  persistParsedAccountingTransactions
};
