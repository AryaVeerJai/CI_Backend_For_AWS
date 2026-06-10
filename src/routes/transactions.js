const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const carbonCalculationService = require('../services/carbonCalculationService');
const logger = require('../utils/logger');
const orchestrationManagerEventService = require('../services/orchestrationManagerEventService');
const duplicateDetectionService = require('../services/duplicateDetectionService');
const {
  SUPPORTED_PROVIDERS,
  listAccountingProviders
} = require('../services/accountingTransactionParserService');
const { buildOrgDataFilter, getOrgScope, withOrgPayload, mergeOrgFilter } = require('../utils/orgDataScope');
const accountingRoutes = require('./accounting');
const { createAccountingImportRouter } = require('./accountingImportRoutes');
const {
  applyClassificationToTransaction,
  normalizeBoundary,
  resolveMsmeProfile
} = require('../services/transactionClassificationService');
const { buildProductCatalog } = require('../utils/productAttribution');

const requireOperationalTransactions = [
  auth,
  auth.requireRole('msme', 'enterprise'),
  auth.requireOrganizationProfile
];

router.use(createAccountingImportRouter(requireOperationalTransactions));

// @route   GET /api/transactions
// @desc    Get all transactions for MSME
// @access  Private
router.get('/', requireOperationalTransactions, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      category, 
      source, 
      startDate, 
      endDate,
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;
    
    const query = mergeOrgFilter(req, {
      isSpam: { $ne: true },
      isDuplicate: { $ne: true }
    });
    
    // Apply filters
    if (category) query.category = category;
    if (source) query.source = source;
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    // Sort options
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const transactions = await Transaction.find(query)
      .sort(sortOptions)
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
    logger.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/transactions
// @desc    Create a manual operational transaction
// @access  Private
router.post('/', requireOperationalTransactions, async (req, res) => {
  try {
    const scope = getOrgScope(req);
    const {
      amount,
      category,
      description,
      date,
      transactionType = 'expense',
      source = 'manual',
      currency = 'INR',
      subcategory,
      vendor,
      tags,
      sustainability
    } = req.body || {};

    if (amount == null || Number.isNaN(Number(amount)) || Number(amount) < 0) {
      return res.status(400).json({
        success: false,
        message: 'A valid non-negative amount is required'
      });
    }

    if (!category || typeof category !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'category is required'
      });
    }

    const normalizedDescription =
      typeof description === 'string' && description.trim().length > 0
        ? description.trim()
        : `${category} transaction`;

    const transactionDate = date ? new Date(date) : new Date();
    if (Number.isNaN(transactionDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'date must be a valid ISO date string'
      });
    }

    const payload = withOrgPayload(req, {
      source,
      sourceId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      transactionType,
      amount: Number(amount),
      currency,
      description: normalizedDescription,
      category,
      subcategory,
      vendor,
      tags,
      sustainability,
      date: transactionDate,
      isProcessed: true,
      processedAt: new Date(),
      isDuplicate: false,
      isSpam: false
    });

    const transaction = new Transaction(payload);
    transaction.carbonFootprint = carbonCalculationService.calculateTransactionCarbonFootprint(transaction);
    await transaction.save();

    logger.info(`Manual transaction created: ${transaction._id}`, {
      organizationId: scope.organizationId,
      msmeId: scope.msmeId
    });

    try {
      orchestrationManagerEventService.emitEvent('transactions.created', {
        organizationId: scope.organizationId,
        msmeId: scope.msmeId,
        transaction: transaction.toObject()
      }, 'transactions');
    } catch (eventError) {
      logger.warn('Failed to emit orchestration event for manual transaction create', {
        error: eventError.message,
        organizationId: scope.organizationId,
        transactionId: transaction._id
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      data: transaction
    });
  } catch (error) {
    logger.error('Create transaction error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/transactions/accounting-providers
// @desc    List supported Indian accounting product connectors
// @access  Private
router.get('/accounting-providers', auth, (_req, res) => {
  return res.json({
    success: true,
    data: {
      providers: listAccountingProviders(),
      supportedProviderIds: SUPPORTED_PROVIDERS
    }
  });
});

// Accounting connector sync/import routes (also mounted at /api/accounting).
// Nested here so deployments that omit the top-level accounting mount still serve Data connectors.
router.use('/accounting', accountingRoutes);

// @route   GET /api/transactions/analytics
// @desc    Get transaction analytics
// @access  Private
router.get('/analytics', requireOperationalTransactions, async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'month' } = req.query;

    const query = mergeOrgFilter(req, {
      isSpam: { $ne: true },
      isDuplicate: { $ne: true }
    });
    
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
      sourceBreakdown: {},
      monthlyTrend: {},
      topVendors: {},
      sustainabilityMetrics: {
        greenTransactions: 0,
        sustainabilityScore: 0,
        averageConfidence: 0
      }
    };

    // Process transactions for analytics
    transactions.forEach(transaction => {
      // Category breakdown
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

      // Source breakdown
      const source = transaction.source;
      if (!analytics.sourceBreakdown[source]) {
        analytics.sourceBreakdown[source] = {
          count: 0,
          amount: 0,
          co2Emissions: 0
        };
      }
      analytics.sourceBreakdown[source].count++;
      analytics.sourceBreakdown[source].amount += transaction.amount;
      analytics.sourceBreakdown[source].co2Emissions += transaction.carbonFootprint.co2Emissions;

      // Monthly trend
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

      // Top vendors
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

      // Sustainability metrics
      if (transaction.sustainability.isGreen) {
        analytics.sustainabilityMetrics.greenTransactions++;
      }
    });

    // Calculate sustainability score
    analytics.sustainabilityMetrics.sustainabilityScore = transactions.length > 0 ? 
      (analytics.sustainabilityMetrics.greenTransactions / transactions.length) * 100 : 0;

    // Calculate average confidence
    const totalConfidence = transactions.reduce((sum, t) => sum + t.metadata.confidence, 0);
    analytics.sustainabilityMetrics.averageConfidence = transactions.length > 0 ? 
      totalConfidence / transactions.length : 0;

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    logger.error('Get transaction analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/transactions/product-catalog
// @desc    Manufactured products from MSME profile for transaction classification
// @access  Private
router.get('/product-catalog', requireOperationalTransactions, async (req, res) => {
  try {
    const scope = getOrgScope(req);
    const msmeProfile = await resolveMsmeProfile({
      msmeId: scope.msmeId,
      userId: req.user?.userId
    });

    if (!msmeProfile) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found. Add manufactured products under My company → Profile.'
      });
    }

    const catalog = buildProductCatalog(msmeProfile);

    return res.json({
      success: true,
      data: {
        products: catalog,
        source: 'msme_profile'
      }
    });
  } catch (error) {
    logger.error('Get product catalog error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/transactions/classify
// @desc    Classify one or more transactions as company or manufactured product boundary
// @access  Private
router.post('/classify', requireOperationalTransactions, async (req, res) => {
  try {
    const {
      transactionIds = [],
      emissionBoundary,
      productNames = [],
      reason = ''
    } = req.body || {};

    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'transactionIds must be a non-empty array'
      });
    }

    const boundary = normalizeBoundary(emissionBoundary);
    if (boundary === 'product' && (!Array.isArray(productNames) || productNames.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Select at least one manufactured product from your profile when classifying as product-level'
      });
    }

    const scope = getOrgScope(req);
    const msmeProfile = await resolveMsmeProfile({
      msmeId: scope.msmeId,
      userId: req.user?.userId
    });

    const transactions = await Transaction.find(
      mergeOrgFilter(req, { _id: { $in: transactionIds } })
    );

    if (transactions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No matching transactions found'
      });
    }

    const updated = [];
    for (const transaction of transactions) {
      applyClassificationToTransaction(transaction, {
        emissionBoundary: boundary,
        productNames,
        reason,
        msmeProfile
      });
      await transaction.save();
      updated.push(transaction);
    }

    logger.info('Transactions classified', {
      organizationId: scope.organizationId,
      msmeId: scope.msmeId,
      count: updated.length,
      emissionBoundary: boundary
    });

    return res.json({
      success: true,
      message: `Classified ${updated.length} transaction(s) as ${boundary}-level`,
      data: {
        updatedCount: updated.length,
        transactions: updated
      }
    });
  } catch (error) {
    logger.error('Classify transactions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/transactions/:id
// @desc    Get single transaction
// @access  Private
router.get('/:id', requireOperationalTransactions, async (req, res) => {
  try {
    const transaction = await Transaction.findOne(
      mergeOrgFilter(req, { _id: req.params.id })
    ).populate('msmeId', 'companyName');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    res.json({
      success: true,
      data: transaction
    });

  } catch (error) {
    logger.error('Get transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PUT /api/transactions/:id
// @desc    Update transaction
// @access  Private
router.put('/:id', requireOperationalTransactions, async (req, res) => {
  try {
    const {
      category,
      subcategory,
      tags,
      sustainability,
      emissionBoundary,
      productNames,
      reason
    } = req.body;
    const scope = getOrgScope(req);
    
    const transaction = await Transaction.findOne(
      mergeOrgFilter(req, { _id: req.params.id })
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    const previousCategory = transaction.category;

    // Update fields
    if (category) transaction.category = category;
    if (subcategory) transaction.subcategory = subcategory;
    if (tags) transaction.tags = tags;
    if (sustainability) transaction.sustainability = { ...transaction.sustainability, ...sustainability };

    if (emissionBoundary) {
      const msmeProfile = await resolveMsmeProfile({
        msmeId: scope.msmeId,
        userId: req.user?.userId
      });
      applyClassificationToTransaction(transaction, {
        emissionBoundary,
        productNames: Array.isArray(productNames) ? productNames : [],
        reason,
        msmeProfile
      });
    } else if (category && category !== previousCategory) {
      const carbonData = carbonCalculationService.calculateTransactionCarbonFootprint(transaction);
      transaction.carbonFootprint = carbonData;
    }

    await transaction.save();

    logger.info(`Transaction updated: ${req.params.id}`, {
      organizationId: scope.organizationId,
      msmeId: scope.msmeId,
      updates: { category, subcategory, tags, sustainability, emissionBoundary, productNames }
    });

    try {
      orchestrationManagerEventService.emitEvent('transactions.updated', {
        organizationId: scope.organizationId,
        msmeId: scope.msmeId,
        transaction: transaction.toObject(),
        updates: { category, subcategory, tags, sustainability }
      }, 'transactions');
    } catch (eventError) {
      logger.warn('Failed to emit orchestration event for transaction update', {
        error: eventError.message,
        organizationId: scope.organizationId,
        transactionId: req.params.id
      });
    }

    res.json({
      success: true,
      message: 'Transaction updated successfully',
      data: transaction
    });

  } catch (error) {
    logger.error('Update transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   DELETE /api/transactions/:id
// @desc    Delete transaction
// @access  Private
router.delete('/:id', requireOperationalTransactions, async (req, res) => {
  try {
    const scope = getOrgScope(req);
    const transaction = await Transaction.findOneAndDelete(
      mergeOrgFilter(req, { _id: req.params.id })
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    logger.info(`Transaction deleted: ${req.params.id}`, {
      organizationId: scope.organizationId,
      msmeId: scope.msmeId
    });

    try {
      orchestrationManagerEventService.emitEvent('transactions.deleted', {
        organizationId: scope.organizationId,
        msmeId: scope.msmeId,
        transaction: transaction.toObject()
      }, 'transactions');
    } catch (eventError) {
      logger.warn('Failed to emit orchestration event for transaction delete', {
        error: eventError.message,
        organizationId: scope.organizationId,
        transactionId: req.params.id
      });
    }

    res.json({
      success: true,
      message: 'Transaction deleted successfully'
    });

  } catch (error) {
    logger.error('Delete transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;