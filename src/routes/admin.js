const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const BillingModuleConfig = require('../models/BillingModuleConfig');
const spamDetectionService = require('../services/spamDetectionService');
const duplicateDetectionService = require('../services/duplicateDetectionService');
const logger = require('../utils/logger');
const BillingPayment = require('../models/BillingPayment');
const { getDefaultBillingMethods, getDefaultFixedPlans } = require('../config/billingDefaults');

router.use(auth, auth.requireRole('admin'));

const buildMsmeScopedQuery = (req, additionalQuery = {}) => {
  const scopedQuery = { ...additionalQuery };
  if (req.user.role !== 'admin' && req.user.msmeId) {
    scopedQuery.msmeId = req.user.msmeId;
  }
  return scopedQuery;
};

// @route   GET /api/admin/spam-transactions
// @desc    Get spam transactions for MSME
// @access  Private
router.get('/spam-transactions', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      startDate, 
      endDate,
      source,
      category
    } = req.query;
    
    const query = buildMsmeScopedQuery(req, { isSpam: true });
    
    // Apply filters
    if (source) query.source = source;
    if (category) query.category = category;
    
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
    logger.error('Get spam transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/admin/duplicate-transactions
// @desc    Get duplicate transactions for MSME
// @access  Private
router.get('/duplicate-transactions', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      startDate, 
      endDate,
      source,
      category,
      duplicateType
    } = req.query;
    
    const query = buildMsmeScopedQuery(req, { isDuplicate: true });
    
    // Apply filters
    if (source) query.source = source;
    if (category) query.category = category;
    if (duplicateType) query.duplicateType = duplicateType;
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(query)
      .sort({ date: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('msmeId', 'companyName')
      .populate('matchedTransactionId', 'description amount date');

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
    logger.error('Get duplicate transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PUT /api/admin/transactions/:id/restore
// @desc    Restore a spam or duplicate transaction
// @access  Private
router.put('/transactions/:id/restore', async (req, res) => {
  try {
    const transaction = await Transaction.findOne(buildMsmeScopedQuery(req, {
      _id: req.params.id
    }));

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Restore transaction
    transaction.isSpam = false;
    transaction.isDuplicate = false;
    transaction.spamScore = 0;
    transaction.spamReasons = [];
    transaction.spamConfidence = 0;
    transaction.duplicateType = null;
    transaction.similarityScore = 0;
    transaction.matchedTransactionId = null;
    transaction.duplicateReasons = [];

    await transaction.save();

    logger.info(`Transaction restored: ${req.params.id}`, {
      msmeId: transaction.msmeId,
      wasSpam: true,
      wasDuplicate: true
    });

    res.json({
      success: true,
      message: 'Transaction restored successfully',
      data: transaction
    });

  } catch (error) {
    logger.error('Restore transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   DELETE /api/admin/transactions/:id/confirm-spam
// @desc    Confirm a transaction as spam and delete it
// @access  Private
router.delete('/transactions/:id/confirm-spam', async (req, res) => {
  try {
    const transaction = await Transaction.findOneAndDelete(buildMsmeScopedQuery(req, {
      _id: req.params.id,
      isSpam: true
    }));

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Spam transaction not found'
      });
    }

    logger.info(`Spam transaction confirmed and deleted: ${req.params.id}`, {
      msmeId: transaction.msmeId
    });

    res.json({
      success: true,
      message: 'Spam transaction confirmed and deleted successfully'
    });

  } catch (error) {
    logger.error('Confirm spam transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   DELETE /api/admin/transactions/:id/confirm-duplicate
// @desc    Confirm a transaction as duplicate and delete it
// @access  Private
router.delete('/transactions/:id/confirm-duplicate', async (req, res) => {
  try {
    const transaction = await Transaction.findOneAndDelete(buildMsmeScopedQuery(req, {
      _id: req.params.id,
      isDuplicate: true
    }));

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Duplicate transaction not found'
      });
    }

    logger.info(`Duplicate transaction confirmed and deleted: ${req.params.id}`, {
      msmeId: transaction.msmeId
    });

    res.json({
      success: true,
      message: 'Duplicate transaction confirmed and deleted successfully'
    });

  } catch (error) {
    logger.error('Confirm duplicate transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/admin/spam-statistics
// @desc    Get spam detection statistics
// @access  Private
router.get('/spam-statistics', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const statistics = await spamDetectionService.getSpamStatistics(
      req.user.role === 'admin' ? undefined : req.user.msmeId,
      startDate,
      endDate
    );

    res.json({
      success: true,
      data: statistics
    });

  } catch (error) {
    logger.error('Get spam statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/admin/duplicate-statistics
// @desc    Get duplicate detection statistics
// @access  Private
router.get('/duplicate-statistics', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const statistics = await duplicateDetectionService.getDuplicateStatistics(
      req.user.role === 'admin' ? undefined : req.user.msmeId,
      startDate,
      endDate
    );

    res.json({
      success: true,
      data: statistics
    });

  } catch (error) {
    logger.error('Get duplicate statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/admin/transactions/:id/mark-spam
// @desc    Manually mark a transaction as spam
// @access  Private
router.post('/transactions/:id/mark-spam', [
  body('reasons').isArray().withMessage('Reasons array is required')
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

    const { reasons } = req.body;
    const transaction = await Transaction.findOne(buildMsmeScopedQuery(req, {
      _id: req.params.id
    }));

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Mark as spam
    transaction.isSpam = true;
    transaction.spamReasons = reasons;
    transaction.spamScore = 10; // Manual marking gets high score
    transaction.spamConfidence = 1.0;

    await transaction.save();

    logger.info(`Transaction manually marked as spam: ${req.params.id}`, {
      msmeId: transaction.msmeId,
      reasons
    });

    res.json({
      success: true,
      message: 'Transaction marked as spam successfully',
      data: transaction
    });

  } catch (error) {
    logger.error('Mark transaction as spam error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/admin/transactions/:id/mark-duplicate
// @desc    Manually mark a transaction as duplicate
// @access  Private
router.post('/transactions/:id/mark-duplicate', [
  body('matchedTransactionId').notEmpty().withMessage('Matched transaction ID is required'),
  body('reasons').isArray().withMessage('Reasons array is required')
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

    const { matchedTransactionId, reasons } = req.body;
    const transaction = await Transaction.findOne(buildMsmeScopedQuery(req, {
      _id: req.params.id
    }));

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Verify matched transaction exists
    const matchedTransaction = await Transaction.findOne(buildMsmeScopedQuery(req, {
      _id: matchedTransactionId
    }));

    if (!matchedTransaction) {
      return res.status(404).json({
        success: false,
        message: 'Matched transaction not found'
      });
    }

    // Mark as duplicate
    transaction.isDuplicate = true;
    transaction.duplicateType = 'manual';
    transaction.similarityScore = 1.0;
    transaction.matchedTransactionId = matchedTransactionId;
    transaction.duplicateReasons = reasons;

    await transaction.save();

    logger.info(`Transaction manually marked as duplicate: ${req.params.id}`, {
      msmeId: transaction.msmeId,
      matchedTransactionId,
      reasons
    });

    res.json({
      success: true,
      message: 'Transaction marked as duplicate successfully',
      data: transaction
    });

  } catch (error) {
    logger.error('Mark transaction as duplicate error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/admin/view-users
// @desc    List users provisioned with view role access
// @access  Private (admin)
router.get('/view-users', async (req, res) => {
  try {
    const users = await User.find({ role: 'view' })
      .select('email role isActive profile accessCredentials createdAt lastLogin')
      .populate('accessCredentials.approvedBy', 'email profile.firstName profile.lastName')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        users
      }
    });
  } catch (error) {
    logger.error('Get view users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/admin/view-users
// @desc    Provision a credentialed user with view role access
// @access  Private (admin)
router.post('/view-users', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('profile.firstName').notEmpty().withMessage('First name is required'),
  body('organizationType')
    .isIn(['government_accredited_auditor', 'bank_incentives_partner', 'verification_agency', 'other'])
    .withMessage('Valid organization type is required'),
  body('organizationName').notEmpty().withMessage('Organization name is required'),
  body('credentialId').notEmpty().withMessage('Credential ID is required'),
  body('accessPurpose').notEmpty().withMessage('Access purpose is required')
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

    const {
      email,
      password,
      profile = {},
      organizationType,
      organizationName,
      credentialId,
      accessPurpose
    } = req.body;

    const normalizedEmail = String(email).toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'A user with this email already exists'
      });
    }

    const user = new User({
      email: normalizedEmail,
      password,
      role: 'view',
      profile: {
        firstName: String(profile.firstName || '').trim(),
        lastName: String(profile.lastName || '').trim(),
        phone: String(profile.phone || '').trim()
      },
      accessCredentials: {
        organizationType,
        organizationName: String(organizationName).trim(),
        credentialId: String(credentialId).trim(),
        accessPurpose: String(accessPurpose).trim(),
        approvedBy: req.user.userId,
        approvedAt: new Date()
      }
    });

    await user.save();

    const createdUser = await User.findById(user._id)
      .select('email role isActive profile accessCredentials createdAt lastLogin')
      .populate('accessCredentials.approvedBy', 'email profile.firstName profile.lastName')
      .lean();

    logger.info(`View role user provisioned: ${normalizedEmail}`, {
      createdBy: req.user.email,
      organizationType
    });

    res.status(201).json({
      success: true,
      message: 'View-role user provisioned successfully',
      data: {
        user: createdUser
      }
    });
  } catch (error) {
    logger.error('Create view user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PATCH /api/admin/view-users/:id/access
// @desc    Allow or remove access for a view-role user
// @access  Private (admin)
router.patch('/view-users/:id/access', [
  body('isActive').isBoolean().withMessage('isActive must be a boolean')
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

    const viewUser = await User.findOne({
      _id: req.params.id,
      role: 'view'
    });

    if (!viewUser) {
      return res.status(404).json({
        success: false,
        message: 'View-role user not found'
      });
    }

    viewUser.isActive = req.body.isActive;
    await viewUser.save();

    const updatedUser = await User.findById(viewUser._id)
      .select('email role isActive profile accessCredentials createdAt lastLogin')
      .populate('accessCredentials.approvedBy', 'email profile.firstName profile.lastName')
      .lean();

    logger.info(`View role user access ${viewUser.isActive ? 'enabled' : 'removed'}: ${viewUser.email}`, {
      updatedBy: req.user.email
    });

    res.json({
      success: true,
      message: viewUser.isActive
        ? 'User access allowed successfully'
        : 'User access removed successfully',
      data: {
        user: updatedUser
      }
    });
  } catch (error) {
    logger.error('Update view user access error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

const buildBillingAnalytics = async () => {
  const transactions = await Transaction.aggregate([
    {
      $group: {
        _id: '$source',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    }
  ]);

  const sourceMapping = {
    sms: 'upi',
    email: 'netBanking',
    api: 'cards',
    manual: 'cards',
    excel: 'netBanking',
    tally: 'netBanking',
    zoho: 'netBanking',
    busy: 'netBanking',
    marg: 'netBanking',
    quickbooks: 'netBanking',
    erpnext: 'netBanking',
    odoo: 'netBanking',
    vyapar: 'netBanking',
    khatabook: 'netBanking',
    mybillbook: 'netBanking',
    profitbooks: 'netBanking'
  };

  const defaultMethodStats = {
    upi: { count: 0, totalAmount: 0 },
    netBanking: { count: 0, totalAmount: 0 },
    cards: { count: 0, totalAmount: 0 }
  };

  transactions.forEach((entry) => {
    const methodKey = sourceMapping[entry._id];
    if (!methodKey) {
      return;
    }
    defaultMethodStats[methodKey].count += Number(entry.count || 0);
    defaultMethodStats[methodKey].totalAmount += Number(entry.totalAmount || 0);
  });

  const totalTransactions = Object.values(defaultMethodStats)
    .reduce((sum, methodItem) => sum + methodItem.count, 0);
  const totalAmount = Object.values(defaultMethodStats)
    .reduce((sum, methodItem) => sum + methodItem.totalAmount, 0);

  const byMethod = Object.entries(defaultMethodStats).map(([method, stats]) => ({
    method,
    count: stats.count,
    totalAmount: Number(stats.totalAmount.toFixed(2)),
    sharePercent: totalTransactions > 0
      ? Number(((stats.count / totalTransactions) * 100).toFixed(2))
      : 0
  }));

  const [razorpayPaymentCount, razorpayPaymentTotal] = await Promise.all([
    BillingPayment.countDocuments({ status: 'paid' }),
    BillingPayment.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])
  ]);

  return {
    totalTransactions,
    totalAmount: Number(totalAmount.toFixed(2)),
    byMethod,
    razorpayPayments: {
      count: razorpayPaymentCount,
      totalAmount: Number((razorpayPaymentTotal[0]?.total || 0).toFixed(2))
    }
  };
};

// @route   GET /api/admin/billing-module
// @desc    Get billing module configuration and analytics
// @access  Private (admin)
router.get('/billing-module', async (req, res) => {
  try {
    let config = await BillingModuleConfig.findOne()
      .populate('updatedBy', 'email profile.firstName profile.lastName')
      .lean();

    if (!config) {
      const createdConfig = await BillingModuleConfig.create({
        moduleEnabled: true,
        provider: 'razorpay',
        informationalOnly: true,
        methods: getDefaultBillingMethods(),
        fixedPlans: getDefaultFixedPlans(),
        updatedBy: req.user.userId
      });
      config = await BillingModuleConfig.findById(createdConfig._id)
        .populate('updatedBy', 'email profile.firstName profile.lastName')
        .lean();
    }

    const analytics = await buildBillingAnalytics();

    res.json({
      success: true,
      data: {
        config,
        analytics
      }
    });
  } catch (error) {
    logger.error('Get billing module config error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PUT /api/admin/billing-module
// @desc    Update billing module configuration
// @access  Private (admin)
router.put('/billing-module', [
  body('moduleEnabled').optional().isBoolean().withMessage('moduleEnabled must be a boolean'),
  body('methods').optional().isObject().withMessage('methods must be an object'),
  body('methods.upi').optional().isBoolean().withMessage('methods.upi must be a boolean'),
  body('methods.netBanking').optional().isBoolean().withMessage('methods.netBanking must be a boolean'),
  body('methods.cards').optional().isBoolean().withMessage('methods.cards must be a boolean'),
  body('informationalOnly').optional().isBoolean().withMessage('informationalOnly must be a boolean'),
  body('fixedPlans').optional().isArray().withMessage('fixedPlans must be an array')
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

    let config = await BillingModuleConfig.findOne();
    if (!config) {
      config = new BillingModuleConfig({
        moduleEnabled: true,
        provider: 'razorpay',
        informationalOnly: true,
        methods: getDefaultBillingMethods(),
        fixedPlans: getDefaultFixedPlans()
      });
    }

    if (typeof req.body.moduleEnabled === 'boolean') {
      config.moduleEnabled = req.body.moduleEnabled;
    }

    if (typeof req.body.informationalOnly === 'boolean') {
      config.informationalOnly = req.body.informationalOnly;
    }

    if (Array.isArray(req.body.fixedPlans)) {
      config.fixedPlans = req.body.fixedPlans;
    }

    if (req.body.methods && typeof req.body.methods === 'object') {
      config.methods = {
        ...getDefaultBillingMethods(),
        ...(config.methods || {}),
        ...req.body.methods
      };
    }

    config.updatedBy = req.user.userId;
    await config.save();

    const updatedConfig = await BillingModuleConfig.findById(config._id)
      .populate('updatedBy', 'email profile.firstName profile.lastName')
      .lean();

    const analytics = await buildBillingAnalytics();

    logger.info(`Billing module configuration updated by ${req.user.email}`, {
      moduleEnabled: updatedConfig.moduleEnabled,
      methods: updatedConfig.methods
    });

    res.json({
      success: true,
      message: 'Billing module configuration updated successfully',
      data: {
        config: updatedConfig,
        analytics
      }
    });
  } catch (error) {
    logger.error('Update billing module config error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;