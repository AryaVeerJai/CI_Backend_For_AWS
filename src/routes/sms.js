const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const smsService = require('../services/smsService');
const carbonCalculationService = require('../services/carbonCalculationService');
const spamDetectionService = require('../services/spamDetectionService');
const duplicateDetectionService = require('../services/duplicateDetectionService');
const Transaction = require('../models/Transaction');
const MSME = require('../models/MSME');
const logger = require('../utils/logger');
const { MSMENotificationService } = require('../services/msmeNotificationService');
const orchestrationManagerEventService = require('../services/orchestrationManagerEventService');
const aiAgentService = require('../services/aiAgentService');
const { assignProductsToTransaction } = require('../utils/productAttribution');
const {
  HIGH_VALUE_THRESHOLD_INR: HIGH_VALUE_SMS_THRESHOLD_INR,
  isHighValueTransactionRequiringBill,
  buildHighValueUploadRequirement
} = require('../config/highValueTransactionPolicy');

const notificationService = new MSMENotificationService();

const BACKEND_TRANSACTION_TYPES = new Set([
  'purchase',
  'sale',
  'expense',
  'investment',
  'utility',
  'transport',
  'other'
]);

const carbonCategoryTaxonomy = require('../../../shared/carbonCategoryTaxonomy');

const BACKEND_CATEGORIES = carbonCategoryTaxonomy.TRANSACTION_CATEGORY_SET;

const toSafeDate = (value) => {
  if (!value) return new Date();
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampConfidence = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const normalizeSender = (message = {}) =>
  message.sender ||
  message.address ||
  message?.originalSMS?.address ||
  'unknown_sender';

const normalizeMessageBody = (message = {}) =>
  message.body ||
  message.message ||
  message?.originalSMS?.body ||
  '';

const normalizeMessageTimestamp = (message = {}) =>
  message.timestamp ||
  message.date ||
  message?.originalSMS?.date ||
  new Date().toISOString();

const normalizeMessageId = (message = {}, fallbackPrefix = 'sms') => {
  const id =
    message.messageId ||
    message.id ||
    message._id ||
    message?.originalSMS?.id;
  return String(id || `${fallbackPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
};

const normalizeVendor = (vendor, fallbackName = 'Unknown Sender') => {
  if (vendor && typeof vendor === 'object') {
    const name = vendor.name || fallbackName;
    return {
      ...vendor,
      name
    };
  }

  const name = typeof vendor === 'string' && vendor.trim()
    ? vendor.trim()
    : fallbackName;

  return {
    name,
    category: 'other',
    location: null
  };
};

const isClassifiedMessagePayload = (payload = {}) => {
  if (payload.classifiedMessage && typeof payload.classifiedMessage === 'object') {
    return true;
  }

  return [
    payload.isSpam,
    payload.category,
    payload.subcategory,
    payload.amount,
    payload.transactionType,
    payload.reasonCodes,
    payload.merchant,
    payload.transactionData
  ].some(value => value !== undefined && value !== null);
};

const mapMobileCategoryToBackend = (category, subcategory = '', smsBody = '') => {
  const mapped = carbonCategoryTaxonomy.mapSmsExpenseCategory(category, subcategory, smsBody);
  return mapped.category;
};

const mapMobileSubcategoryToBackend = (category, subcategory = '', smsBody = '') => {
  const mapped = carbonCategoryTaxonomy.mapSmsExpenseCategory(category, subcategory, smsBody);
  return mapped.subcategory;
};

const inferTransactionTypeFromCategory = (category) => {
  switch (category) {
    case 'raw_materials':
      return 'purchase';
    case 'energy':
    case 'utilities':
    case 'water':
    case 'telecom':
      return 'utility';
    case 'transportation':
      return 'transport';
    case 'equipment':
      return 'investment';
    case 'maintenance':
    case 'waste_management':
      return 'expense';
    default:
      return 'expense';
  }
};

const mapClassifiedTransactionType = ({
  transactionType,
  category,
  transactionDataType
}) => {
  const normalizedType = String(transactionType || '').toLowerCase();
  if (BACKEND_TRANSACTION_TYPES.has(normalizedType)) {
    return normalizedType;
  }

  if (normalizedType === 'credit') {
    return 'sale';
  }

  if (normalizedType === 'debit') {
    return inferTransactionTypeFromCategory(category);
  }

  const normalizedDataType = String(transactionDataType || '').toLowerCase();
  if (normalizedDataType === 'income' || normalizedDataType === 'credit') {
    return 'sale';
  }
  if (normalizedDataType === 'purchase') {
    return 'purchase';
  }
  if (normalizedDataType === 'investment') {
    return 'investment';
  }
  if (normalizedDataType === 'transport') {
    return 'transport';
  }
  if (normalizedDataType === 'utility') {
    return 'utility';
  }

  return inferTransactionTypeFromCategory(category);
};

const normalizeMobileClassifiedTransaction = (payload = {}) => {
  const classified = payload.classifiedMessage && typeof payload.classifiedMessage === 'object'
    ? payload.classifiedMessage
    : payload;

  const sender = normalizeSender(payload);
  const body = normalizeMessageBody(payload);
  const messageId = normalizeMessageId(payload, 'mobile');
  const timestamp = normalizeMessageTimestamp(payload);

  const category = mapMobileCategoryToBackend(
    classified.category || classified?.transactionData?.category,
    classified.subcategory || classified?.transactionData?.subcategory,
    body
  );

  const transactionType = mapClassifiedTransactionType({
    transactionType: classified.transactionType,
    category,
    transactionDataType: classified?.transactionData?.type
  });

  const amount = toFiniteNumber(
    classified?.amount?.value ??
    classified.amount ??
    classified?.transactionData?.amount,
    0
  );

  const currency =
    classified?.amount?.currency ||
    classified.currency ||
    classified?.transactionData?.currency ||
    'INR';

  const vendorName =
    classified.merchant ||
    classified.vendor?.name ||
    classified.vendor ||
    sender;

  const confidence = clampConfidence(
    toFiniteNumber(
      classified.confidence ??
      classified?.transactionData?.confidence ??
      classified.industryConfidence,
      0.5
    )
  );

  const shortSummary =
    typeof body === 'string' && body.length > 160 ? `${body.slice(0, 157)}...` : body;

  return {
    source: 'sms',
    sourceId: messageId,
    transactionType,
    amount,
    currency,
    description: shortSummary,
    vendor: normalizeVendor(vendorName, sender),
    category,
    subcategory: mapMobileSubcategoryToBackend(
      classified.category || classified?.transactionData?.category,
      classified.subcategory || classified?.transactionData?.subcategory,
      body
    ),
    date: toSafeDate(classified.date || classified?.transactionData?.date || timestamp),
    metadata: {
      extractedData: {
        sender,
        messageId,
        source: 'mobile_classified'
      },
      confidence,
      mobileClassification: {
        isSpam: Boolean(classified.isSpam),
        reasonCodes: Array.isArray(classified.reasonCodes) ? classified.reasonCodes : [],
        industry: classified.industry || null,
        industryLabel: classified.industryLabel || null,
        industryConfidence: toFiniteNumber(classified.industryConfidence, 0)
      }
    },
    tags: Array.isArray(classified.reasonCodes) ? classified.reasonCodes.slice(0, 10) : []
  };
};

const selectProcessedTransaction = (processingResult, fallbackTransaction) => {
  if (!processingResult || typeof processingResult !== 'object') {
    return fallbackTransaction;
  }

  const preferredCollections = [
    processingResult.validated,
    processingResult.enriched,
    processingResult.classified,
    processingResult.cleaned
  ];

  for (const collection of preferredCollections) {
    if (Array.isArray(collection) && collection.length > 0) {
      return {
        ...collection[0],
        vendor: normalizeVendor(collection[0].vendor, fallbackTransaction.vendor?.name || 'Unknown Sender')
      };
    }
  }

  return fallbackTransaction;
};

const summarizeCarbonAnalysis = (carbonAnalysis) => {
  if (!carbonAnalysis || carbonAnalysis.error) {
    return {
      totalEmissions: 0,
      categories: [],
      error: carbonAnalysis?.error || null
    };
  }

  return {
    totalEmissions: toFiniteNumber(carbonAnalysis.totalEmissions, 0),
    categories: Object.keys(carbonAnalysis.categoryBreakdown || {}),
    recommendationCount: Array.isArray(carbonAnalysis.recommendations)
      ? carbonAnalysis.recommendations.length
      : 0,
    insightCount: Array.isArray(carbonAnalysis.insights)
      ? carbonAnalysis.insights.length
      : 0
  };
};

const runAgentPipelineForTransaction = async (baseTransaction, { msmeProfile, context = {} } = {}) => {
  let processedTransaction = {
    ...baseTransaction,
    vendor: normalizeVendor(baseTransaction.vendor, 'Unknown Sender')
  };
  let dataProcessing = null;
  let carbonAnalysis = null;

  const pipelineMetadata = {
    dataProcessor: {
      attempted: true,
      used: false,
      error: null
    },
    carbonAnalyzer: {
      attempted: true,
      used: false,
      error: null
    }
  };

  try {
    dataProcessing = await aiAgentService.dataProcessorAgent({
      input: {
        transactions: [processedTransaction],
        msmeData: msmeProfile || {},
        context,
        transactionTypeContext: context?.transactionTypeContext
      }
    });

    if (dataProcessing?.error) {
      pipelineMetadata.dataProcessor.error = dataProcessing.error;
    } else {
      processedTransaction = selectProcessedTransaction(dataProcessing, processedTransaction);
      pipelineMetadata.dataProcessor.used = true;
    }
  } catch (error) {
    pipelineMetadata.dataProcessor.error = error.message;
    logger.warn('Data processor agent pipeline step failed for SMS message', {
      ...clientErrorPayload(error),
      sourceId: baseTransaction.sourceId
    });
  }

  try {
    carbonAnalysis = await aiAgentService.carbonAnalyzerAgent({
      input: {
        transactions: [processedTransaction],
        msmeData: msmeProfile || {},
        context
      }
    });

    if (!carbonAnalysis?.error) {
      pipelineMetadata.carbonAnalyzer.used = true;
    } else {
      pipelineMetadata.carbonAnalyzer.error = carbonAnalysis.error;
    }
  } catch (error) {
    pipelineMetadata.carbonAnalyzer.error = error.message;
    logger.warn('Carbon analyzer agent pipeline step failed for SMS message', {
      ...clientErrorPayload(error),
      sourceId: baseTransaction.sourceId
    });
  }

  const runtimeContext = {
    msmeData: msmeProfile || {},
    context,
    __fuelPriceCache: {}
  };
  const computedFootprint = await carbonCalculationService.calculateTransactionCarbonFootprintForAgent(
    processedTransaction,
    runtimeContext
  );
  const carbonData = carbonCalculationService.ensureCarbonFootprintMetrics(
    processedTransaction,
    computedFootprint
  );
  processedTransaction.carbonFootprint = carbonData;
  processedTransaction.metadata = {
    ...(processedTransaction.metadata || {}),
    agentPipeline: {
      stage: 'sms_ingestion',
      dataProcessor: pipelineMetadata.dataProcessor,
      carbonAnalyzer: {
        ...pipelineMetadata.carbonAnalyzer,
        summary: summarizeCarbonAnalysis(carbonAnalysis)
      }
    }
  };

  return {
    processedTransaction,
    dataProcessing,
    carbonAnalysis,
    carbonData,
    pipelineMetadata
  };
};

const processIncomingSMSMessage = async ({
  message,
  msmeId,
  msmeProfile
}) => {
  const messageId = normalizeMessageId(message, 'sms');
  const sender = normalizeSender(message);
  const body = normalizeMessageBody(message);
  const timestamp = normalizeMessageTimestamp(message);

  const classifiedPayload = isClassifiedMessagePayload(message)
    ? (message.classifiedMessage && typeof message.classifiedMessage === 'object'
      ? message.classifiedMessage
      : message)
    : null;

  if (!body && !classifiedPayload) {
    return {
      success: false,
      messageId,
      error: 'SMS body is required'
    };
  }

  let extractedTransaction = null;
  let confidence = 0;

  try {
    if (classifiedPayload) {
      extractedTransaction = normalizeMobileClassifiedTransaction({
        ...message,
        messageId,
        sender,
        body,
        timestamp
      });
      confidence = extractedTransaction.metadata?.confidence || 0;
    } else {
      const result = await smsService.processSMS({
        body,
        sender,
        timestamp,
        messageId
      }, msmeProfile);

      if (!result.success) {
        return {
          success: false,
          messageId,
          error: result.error || 'SMS processing failed'
        };
      }

      extractedTransaction = result.transaction;
      confidence = result.confidence || 0;
    }
  } catch (error) {
    return {
      success: false,
      messageId,
      ...clientErrorPayload(error)
    };
  }

  extractedTransaction = {
    ...extractedTransaction,
    source: 'sms',
    sourceId: messageId,
    date: toSafeDate(extractedTransaction.date || timestamp),
    vendor: normalizeVendor(extractedTransaction.vendor, sender)
  };

  const spamBodyHint =
    classifiedPayload && !body
      ? ''
      : typeof body === 'string' && body.length > 200
        ? `${body.slice(0, 200)}...`
        : body;

  const spamDetection = spamDetectionService.detectSpam(extractedTransaction, {
    sender,
    subject: `SMS from ${sender}`,
    body: spamBodyHint
  });

  const clientMarkedSpam = Boolean(classifiedPayload?.isSpam);
  const combinedSpamReasons = [
    ...(clientMarkedSpam ? ['Marked as spam by mobile classifier'] : []),
    ...(spamDetection.reasons || [])
  ];

  const duplicateDetection = await duplicateDetectionService.detectDuplicate(extractedTransaction, msmeId);

  if (clientMarkedSpam || spamDetection.isSpam || duplicateDetection.isDuplicate) {
    logger.info(`SMS skipped - Spam: ${clientMarkedSpam || spamDetection.isSpam}, Duplicate: ${duplicateDetection.isDuplicate}`, {
      messageId,
      msmeId,
      spamReasons: combinedSpamReasons,
      duplicateReasons: duplicateDetection.reasons
    });

    return {
      success: true,
      skipped: true,
      messageId,
      spam: clientMarkedSpam || spamDetection.isSpam,
      duplicate: duplicateDetection.isDuplicate,
      spamReasons: combinedSpamReasons,
      duplicateReasons: duplicateDetection.reasons
    };
  }

  if (isHighValueTransactionRequiringBill(extractedTransaction)) {
    const uploadRequest = buildHighValueUploadRequirement(extractedTransaction, messageId);
    try {
      orchestrationManagerEventService.emitEvent('transactions.sms_high_value_pending_bill_upload', {
        msmeId,
        source: classifiedPayload ? 'mobile_sms_classified' : 'sms',
        messageId,
        transactionPreview: uploadRequest.transactionPreview,
        uploadRequest
      }, 'sms');
    } catch (eventError) {
      logger.warn('Failed to emit high-value SMS upload requirement event', {
        error: eventError.message,
        msmeId,
        messageId
      });
    }

    return {
      success: true,
      skipped: false,
      actionRequired: true,
      messageId,
      confidence: clampConfidence(
        toFiniteNumber(extractedTransaction.metadata?.confidence, confidence || 0)
      ),
      uploadRequest
    };
  }

  const {
    processedTransaction,
    dataProcessing,
    carbonAnalysis
  } = await runAgentPipelineForTransaction(extractedTransaction, {
    msmeProfile,
    context: {
      source: classifiedPayload ? 'mobile_classified_sms' : 'sms_service',
      sender,
      messageId
    }
  });

  const metadata = {
    ...(processedTransaction.metadata || {}),
    confidence: clampConfidence(
      toFiniteNumber(processedTransaction.metadata?.confidence, confidence || 0)
    ),
    extractionConfidence: clampConfidence(toFiniteNumber(confidence, 0)),
    messageClassificationSource: classifiedPayload ? 'mobile_app' : 'backend_sms_service'
  };
  const attributedTransaction = assignProductsToTransaction({
    ...processedTransaction,
    metadata
  }, msmeProfile, {
    assignmentSource: 'sms_data_stage'
  });

  const transaction = new Transaction({
    msmeId,
    ...attributedTransaction,
    isProcessed: true,
    processedAt: new Date(),
    // Spam detection results
    isSpam: false,
    spamScore: spamDetection.score,
    spamReasons: combinedSpamReasons,
    spamConfidence: spamDetection.confidence,
    // Duplicate detection results
    isDuplicate: duplicateDetection.isDuplicate,
    duplicateType: duplicateDetection.duplicateType,
    similarityScore: duplicateDetection.similarityScore,
    matchedTransactionId: duplicateDetection.matchedTransaction?._id,
    duplicateReasons: duplicateDetection.reasons
  });

  await transaction.save();

  try {
    orchestrationManagerEventService.emitEvent('transactions.sms_processed', {
      msmeId,
      transaction: transaction.toObject(),
      source: classifiedPayload ? 'mobile_sms_classified' : 'sms',
      messageId
    }, 'sms');
  } catch (eventError) {
    logger.warn('Failed to emit orchestration event for SMS transaction', {
      error: eventError.message,
      msmeId,
      messageId
    });
  }

  return {
    success: true,
    skipped: false,
    messageId,
    transaction,
    confidence: metadata.confidence,
    pipeline: {
      dataProcessor: {
        statistics: dataProcessing?.statistics || null
      },
      carbonAnalyzer: summarizeCarbonAnalysis(carbonAnalysis)
    }
  };
};

// @route   POST /api/sms/process
// @desc    Process SMS message and extract transaction data
// @access  Private
router.post('/process', [
  auth,
  body('body').notEmpty().withMessage('SMS body is required'),
  body('sender').notEmpty().withMessage('Sender is required'),
  body('timestamp').isISO8601().withMessage('Valid timestamp is required'),
  body('messageId').notEmpty().withMessage('Message ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const msmeId = req.user.msmeId;

    const msmeProfile = msmeId ? await MSME.findById(msmeId).lean() : null;

    const processingResult = await processIncomingSMSMessage({
      message: req.body,
      msmeId,
      msmeProfile
    });

    if (!processingResult.success) {
      return res.status(400).json({
        success: false,
        message: 'SMS processing failed',
        error: processingResult.error
      });
    }

    if (processingResult.skipped) {
      return res.json({
        success: true,
        message: 'SMS processed but skipped due to spam/duplicate detection',
        data: {
          skipped: true,
          spam: processingResult.spam,
          duplicate: processingResult.duplicate,
          spamReasons: processingResult.spamReasons,
          duplicateReasons: processingResult.duplicateReasons
        }
      });
    }

    if (processingResult.actionRequired) {
      return res.json({
        success: true,
        message: 'High-value SMS detected. Upload bill PDF for detailed GHG processing.',
        data: {
          actionRequired: true,
          confidence: processingResult.confidence,
          uploadRequest: processingResult.uploadRequest
        }
      });
    }

    logger.info(`SMS processed successfully for MSME ${msmeId}`, {
      messageId: processingResult.messageId,
      transactionType: processingResult.transaction.transactionType,
      amount: processingResult.transaction.amount,
      co2Emissions: processingResult.transaction.carbonFootprint?.co2Emissions || 0
    });

    res.json({
      success: true,
      message: 'SMS processed successfully',
      data: {
        transaction: processingResult.transaction,
        confidence: processingResult.confidence,
        agentPipeline: processingResult.pipeline
      }
    });

  } catch (error) {
    logger.error('SMS processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/sms/transactions
// @desc    Get SMS transactions for MSME
// @access  Private
router.get('/transactions', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, category, startDate, endDate } = req.query;
    const msmeId = req.user.msmeId;

    const query = {
      msmeId,
      source: 'sms',
      isSpam: { $ne: true },
      isDuplicate: { $ne: true }
    };

    if (category) {
      query.category = category;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(query)
      .sort({ date: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('msmeId', 'companyName');

    const total = await Transaction.countDocuments(query);

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    logger.error('Get SMS transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/sms/analytics
// @desc    Get SMS transaction analytics
// @access  Private
router.get('/analytics', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const msmeId = req.user.msmeId;

    const query = {
      msmeId,
      source: 'sms',
      isSpam: { $ne: true },
      isDuplicate: { $ne: true }
    };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(query);

    // Calculate analytics
    const analytics = {
      totalTransactions: transactions.length,
      totalAmount: transactions.reduce((sum, t) => sum + t.amount, 0),
      totalCO2Emissions: transactions.reduce((sum, t) => sum + t.carbonFootprint.co2Emissions, 0),
      averageAmount: transactions.length > 0 ? transactions.reduce((sum, t) => sum + t.amount, 0) / transactions.length : 0,
      averageCO2Emissions: transactions.length > 0 ? transactions.reduce((sum, t) => sum + t.carbonFootprint.co2Emissions, 0) / transactions.length : 0,
      categoryBreakdown: {},
      transactionTypeBreakdown: {},
      monthlyTrend: {},
      topVendors: {},
      sustainabilityScore: 0
    };

    // Category breakdown
    transactions.forEach(transaction => {
      const category = transaction.category;
      if (!analytics.categoryBreakdown[category]) {
        analytics.categoryBreakdown[category] = {
          count: 0,
          amount: 0,
          co2Emissions: 0
        };
      }
      analytics.categoryBreakdown[category].count++;
      analytics.categoryBreakdown[category].amount += transaction.amount;
      analytics.categoryBreakdown[category].co2Emissions += transaction.carbonFootprint.co2Emissions;
    });

    // Transaction type breakdown
    transactions.forEach(transaction => {
      const type = transaction.transactionType;
      if (!analytics.transactionTypeBreakdown[type]) {
        analytics.transactionTypeBreakdown[type] = {
          count: 0,
          amount: 0,
          co2Emissions: 0
        };
      }
      analytics.transactionTypeBreakdown[type].count++;
      analytics.transactionTypeBreakdown[type].amount += transaction.amount;
      analytics.transactionTypeBreakdown[type].co2Emissions += transaction.carbonFootprint.co2Emissions;
    });

    // Monthly trend
    transactions.forEach(transaction => {
      const month = transaction.date.toISOString().substring(0, 7);
      if (!analytics.monthlyTrend[month]) {
        analytics.monthlyTrend[month] = {
          count: 0,
          amount: 0,
          co2Emissions: 0
        };
      }
      analytics.monthlyTrend[month].count++;
      analytics.monthlyTrend[month].amount += transaction.amount;
      analytics.monthlyTrend[month].co2Emissions += transaction.carbonFootprint.co2Emissions;
    });

    // Top vendors
    transactions.forEach(transaction => {
      const vendor = transaction.vendor.name;
      if (!analytics.topVendors[vendor]) {
        analytics.topVendors[vendor] = {
          count: 0,
          amount: 0,
          co2Emissions: 0
        };
      }
      analytics.topVendors[vendor].count++;
      analytics.topVendors[vendor].amount += transaction.amount;
      analytics.topVendors[vendor].co2Emissions += transaction.carbonFootprint.co2Emissions;
    });

    // Calculate sustainability score
    const greenTransactions = transactions.filter(t => t.sustainability.isGreen);
    analytics.sustainabilityScore = transactions.length > 0 ?
      (greenTransactions.length / transactions.length) * 100 : 0;

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    logger.error('Get SMS analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/sms/bulk-process
// @desc    Process multiple SMS messages
// @access  Private
router.post('/bulk-process', [
  auth,
  body('messages').isArray().withMessage('Messages array is required'),
  body('messages.*.body').notEmpty().withMessage('SMS body is required'),
  body('messages.*.sender').notEmpty().withMessage('Sender is required'),
  body('messages.*.timestamp').isISO8601().withMessage('Valid timestamp is required'),
  body('messages.*.messageId').notEmpty().withMessage('Message ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { messages } = req.body;
    const msmeId = req.user.msmeId;
    const results = [];

    const msmeProfile = msmeId ? await MSME.findById(msmeId).lean() : null;

    for (const message of messages) {
      try {
        const processingResult = await processIncomingSMSMessage({
          message,
          msmeId,
          msmeProfile
        });

        if (!processingResult.success) {
          results.push({
            messageId: processingResult.messageId || normalizeMessageId(message, 'sms_bulk'),
            success: false,
            error: processingResult.error
          });
          continue;
        }

        if (processingResult.skipped) {
          results.push({
            messageId: processingResult.messageId,
            success: true,
            skipped: true,
            spam: processingResult.spam,
            duplicate: processingResult.duplicate,
            spamReasons: processingResult.spamReasons,
            duplicateReasons: processingResult.duplicateReasons
          });
          continue;
        }

        if (processingResult.actionRequired) {
          results.push({
            messageId: processingResult.messageId,
            success: true,
            actionRequired: true,
            confidence: processingResult.confidence,
            uploadRequest: processingResult.uploadRequest
          });
          continue;
        }

        results.push({
          messageId: processingResult.messageId,
          success: true,
          transaction: processingResult.transaction,
          agentPipeline: processingResult.pipeline
        });
      } catch (error) {
        results.push({
          messageId: normalizeMessageId(message, 'sms_bulk'),
          success: false,
          ...clientErrorPayload(error)
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    logger.info(`Bulk SMS processing completed for MSME ${msmeId}`, {
      total: messages.length,
      success: successCount,
      failure: failureCount
    });

    res.json({
      success: true,
      message: `Processed ${messages.length} messages: ${successCount} successful, ${failureCount} failed`,
      data: {
        results,
        summary: {
          total: messages.length,
          successful: successCount,
          failed: failureCount
        }
      }
    });

  } catch (error) {
    logger.error('Bulk SMS processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/sms/classified/bulk-process
// @desc    Process mobile-classified SMS messages through AI agent pipeline
// @access  Private
router.post('/classified/bulk-process', [
  auth,
  body('messages').isArray({ min: 1 }).withMessage('Messages array is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { messages } = req.body;
    const msmeId = req.user.msmeId;
    const msmeProfile = msmeId ? await MSME.findById(msmeId).lean() : null;
    const results = [];

    for (const message of messages) {
      try {
        const processingResult = await processIncomingSMSMessage({
          message,
          msmeId,
          msmeProfile
        });

        if (!processingResult.success) {
          results.push({
            messageId: processingResult.messageId || normalizeMessageId(message, 'classified_sms'),
            success: false,
            error: processingResult.error
          });
          continue;
        }

        if (processingResult.skipped) {
          results.push({
            messageId: processingResult.messageId,
            success: true,
            skipped: true,
            spam: processingResult.spam,
            duplicate: processingResult.duplicate,
            spamReasons: processingResult.spamReasons,
            duplicateReasons: processingResult.duplicateReasons
          });
          continue;
        }

        if (processingResult.actionRequired) {
          results.push({
            messageId: processingResult.messageId,
            success: true,
            actionRequired: true,
            confidence: processingResult.confidence,
            uploadRequest: processingResult.uploadRequest
          });
          continue;
        }

        results.push({
          messageId: processingResult.messageId,
          success: true,
          transaction: processingResult.transaction,
          confidence: processingResult.confidence,
          agentPipeline: processingResult.pipeline
        });
      } catch (error) {
        results.push({
          messageId: normalizeMessageId(message, 'classified_sms'),
          success: false,
          ...clientErrorPayload(error)
        });
      }
    }

    const successful = results.filter(result => result.success).length;
    const failed = results.length - successful;

    logger.info(`Classified SMS batch processed for MSME ${msmeId}`, {
      total: messages.length,
      successful,
      failed
    });

    res.json({
      success: true,
      message: `Processed ${messages.length} classified messages: ${successful} successful, ${failed} failed`,
      data: {
        results,
        summary: {
          total: messages.length,
          successful,
          failed
        }
      }
    });
  } catch (error) {
    logger.error('Classified SMS bulk processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/sms/notify
// @desc    Send SMS notification to MSME via MSG91
// @access  Private
router.post('/notify', [
  auth,
  body('type').isString().withMessage('Notification type is required'),
  body('data').optional().isObject().withMessage('Data must be an object'),
  body('msmeId').optional().isMongoId().withMessage('Valid MSME id is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { type, data = {}, msmeId: targetMsmeId } = req.body;
    const supportedTypes = notificationService.getSupportedTypes();

    if (!supportedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported notification type. Allowed types: ${supportedTypes.join(', ')}`
      });
    }

    let msmeId = req.user.msmeId;

    if (req.user.role !== 'msme' && targetMsmeId) {
      msmeId = targetMsmeId;
    }

    if (!msmeId) {
      return res.status(400).json({
        success: false,
        message: 'MSME id is required to send notifications'
      });
    }

    const result = await notificationService.sendNotification(type, msmeId, data);

    res.json({
      success: true,
      message: 'SMS notification sent successfully',
      data: result
    });
  } catch (error) {
    logger.error('SMS notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send SMS notification',
      ...clientErrorPayload(error)
    });
  }
});

// Backwards-compatible alias used by older clients/integrations.
router.post('/send', auth, async (req, res) => {
  try {
    const {
      type = 'custom',
      data = {},
      message,
      msmeId: targetMsmeId
    } = req.body || {};
    const payload = { ...(data || {}) };
    if (message && !payload.message) {
      payload.message = message;
    }

    const supportedTypes = notificationService.getSupportedTypes();
    if (!supportedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported notification type. Allowed types: ${supportedTypes.join(', ')}`
      });
    }

    let msmeId = req.user.msmeId;
    if (req.user.role !== 'msme' && targetMsmeId) {
      msmeId = targetMsmeId;
    }
    if (!msmeId) {
      return res.status(400).json({
        success: false,
        message: 'MSME id is required to send notifications'
      });
    }

    const result = await notificationService.sendNotification(type, msmeId, payload);
    return res.json({
      success: true,
      message: 'SMS notification sent successfully',
      data: result
    });
  } catch (error) {
    logger.error('SMS send alias error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send SMS notification'
    });
  }
});

module.exports = router;