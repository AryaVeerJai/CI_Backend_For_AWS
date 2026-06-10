const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const emailService = require('../services/emailService');
const carbonCalculationService = require('../services/carbonCalculationService');
const spamDetectionService = require('../services/spamDetectionService');
const duplicateDetectionService = require('../services/duplicateDetectionService');
const emailIngestionAgent = require('../services/emailIngestionAgent');
const emailConnectionService = require('../services/emailConnectionService');
const Transaction = require('../models/Transaction');
const MSME = require('../models/MSME');
const Bank = require('../models/Bank');
const logger = require('../utils/logger');
const orchestrationManagerEventService = require('../services/orchestrationManagerEventService');
const { assignProductsToTransaction } = require('../utils/productAttribution');

// @route   POST /api/email/process
// @desc    Process email and extract transaction data
// @access  Private
router.post('/process', [
  auth,
  body('subject').notEmpty().withMessage('Email subject is required'),
  body('body').notEmpty().withMessage('Email body is required'),
  body('from').isEmail().withMessage('Valid from email is required'),
  body('to').isEmail().withMessage('Valid to email is required'),
  body('date').isISO8601().withMessage('Valid date is required'),
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

    const { subject, body, from, to, date, messageId } = req.body;
    const msmeId = req.user.msmeId;

    const msmeProfile = msmeId ? await MSME.findById(msmeId).lean() : null;

    // Process email
    const result = await emailService.processEmail({
      subject,
      body,
      from,
      to,
      date,
      messageId
    }, msmeProfile);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Email processing failed',
        error: result.error
      });
    }

    // Detect spam
    const spamDetection = spamDetectionService.detectSpam(result.transaction, {
      sender: from,
      subject,
      body
    });

    // Detect duplicates
    const duplicateDetection = await duplicateDetectionService.detectDuplicate(result.transaction, msmeId);

    // Skip processing if spam or duplicate
    if (spamDetection.isSpam || duplicateDetection.isDuplicate) {
      logger.info(`Email skipped - Spam: ${spamDetection.isSpam}, Duplicate: ${duplicateDetection.isDuplicate}`, {
        messageId,
        msmeId,
        spamReasons: spamDetection.reasons,
        duplicateReasons: duplicateDetection.reasons
      });

      return res.json({
        success: true,
        message: 'Email processed but skipped due to spam/duplicate detection',
        data: {
          skipped: true,
          spam: spamDetection.isSpam,
          duplicate: duplicateDetection.isDuplicate,
          spamReasons: spamDetection.reasons,
          duplicateReasons: duplicateDetection.reasons
        }
      });
    }

    // Calculate carbon footprint
    const carbonData = carbonCalculationService.calculateTransactionCarbonFootprint(result.transaction);
    result.transaction.carbonFootprint = carbonData;

    const attributedTransaction = assignProductsToTransaction(result.transaction, msmeProfile, {
      assignmentSource: 'email_data_stage'
    });

    // Save transaction to database
    const transaction = new Transaction({
      msmeId,
      ...attributedTransaction,
      isProcessed: true,
      processedAt: new Date(),
      // Spam detection results
      isSpam: spamDetection.isSpam,
      spamScore: spamDetection.score,
      spamReasons: spamDetection.reasons,
      spamConfidence: spamDetection.confidence,
      // Duplicate detection results
      isDuplicate: duplicateDetection.isDuplicate,
      duplicateType: duplicateDetection.duplicateType,
      similarityScore: duplicateDetection.similarityScore,
      matchedTransactionId: duplicateDetection.matchedTransaction?._id,
      duplicateReasons: duplicateDetection.reasons
    });

    await transaction.save();

    logger.info(`Email processed successfully for MSME ${msmeId}`, {
      messageId,
      transactionType: result.transaction.transactionType,
      amount: result.transaction.amount,
      co2Emissions: carbonData.co2Emissions
    });

    try {
      orchestrationManagerEventService.emitEvent('transactions.email_processed', {
        msmeId,
        transaction: transaction.toObject(),
        source: 'email',
        messageId
      }, 'email');
    } catch (eventError) {
      logger.warn('Failed to emit orchestration event for email transaction', {
        error: eventError.message,
        msmeId,
        messageId
      });
    }

    res.json({
      success: true,
      message: 'Email processed successfully',
      data: {
        transaction: transaction,
        confidence: result.confidence
      }
    });

  } catch (error) {
    logger.error('Email processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/email/transactions
// @desc    Get email transactions for MSME
// @access  Private
router.get('/transactions', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, category, startDate, endDate } = req.query;
    const msmeId = req.user.msmeId;

    const query = { 
      msmeId, 
      source: 'email',
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
    logger.error('Get email transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/email/analytics
// @desc    Get email transaction analytics
// @access  Private
router.get('/analytics', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const msmeId = req.user.msmeId;

    const query = { 
      msmeId, 
      source: 'email',
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
      sustainabilityScore: 0,
      confidenceScore: 0
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

    // Calculate average confidence score
    const totalConfidence = transactions.reduce((sum, t) => sum + t.metadata.confidence, 0);
    analytics.confidenceScore = transactions.length > 0 ? totalConfidence / transactions.length : 0;

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    logger.error('Get email analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/email/bulk-process
// @desc    Process multiple emails
// @access  Private
router.post('/bulk-process', [
  auth,
  body('emails').isArray().withMessage('Emails array is required'),
  body('emails.*.subject').notEmpty().withMessage('Email subject is required'),
  body('emails.*.body').notEmpty().withMessage('Email body is required'),
  body('emails.*.from').isEmail().withMessage('Valid from email is required'),
  body('emails.*.to').isEmail().withMessage('Valid to email is required'),
  body('emails.*.date').isISO8601().withMessage('Valid date is required'),
  body('emails.*.messageId').notEmpty().withMessage('Message ID is required')
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

    const { emails } = req.body;
    const msmeId = req.user.msmeId;
    const results = [];

    const msmeProfile = msmeId ? await MSME.findById(msmeId).lean() : null;

    for (const email of emails) {
      try {
        // Process email
        const result = await emailService.processEmail(email, msmeProfile);
        
        if (result.success) {
          // Detect spam
          const spamDetection = spamDetectionService.detectSpam(result.transaction, {
            sender: email.from,
            subject: email.subject,
            body: email.body
          });

          // Detect duplicates
          const duplicateDetection = await duplicateDetectionService.detectDuplicate(result.transaction, msmeId);

          // Skip processing if spam or duplicate
          if (spamDetection.isSpam || duplicateDetection.isDuplicate) {
            results.push({
              messageId: email.messageId,
              success: true,
              skipped: true,
              spam: spamDetection.isSpam,
              duplicate: duplicateDetection.isDuplicate,
              spamReasons: spamDetection.reasons,
              duplicateReasons: duplicateDetection.reasons
            });
            continue;
          }

          // Calculate carbon footprint
          const carbonData = carbonCalculationService.calculateTransactionCarbonFootprint(result.transaction);
          result.transaction.carbonFootprint = carbonData;

          const attributedTransaction = assignProductsToTransaction(result.transaction, msmeProfile, {
            assignmentSource: 'email_data_stage'
          });

          // Save transaction
          const transaction = new Transaction({
            msmeId,
            ...attributedTransaction,
            isProcessed: true,
            processedAt: new Date(),
            // Spam detection results
            isSpam: spamDetection.isSpam,
            spamScore: spamDetection.score,
            spamReasons: spamDetection.reasons,
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
            orchestrationManagerEventService.emitEvent('transactions.email_processed', {
              msmeId,
              transaction: transaction.toObject(),
              source: 'email',
              messageId: email.messageId
            }, 'email');
          } catch (eventError) {
            logger.warn('Failed to emit orchestration event for batch email transaction', {
              error: eventError.message,
              msmeId,
              messageId: email.messageId
            });
          }
          
          results.push({
            messageId: email.messageId,
            success: true,
            transaction: transaction
          });
        } else {
          results.push({
            messageId: email.messageId,
            success: false,
            error: result.error
          });
        }
      } catch (error) {
        results.push({
          messageId: email.messageId,
          success: false,
          ...clientErrorPayload(error)
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    logger.info(`Bulk email processing completed for MSME ${msmeId}`, {
      total: emails.length,
      success: successCount,
      failure: failureCount
    });

    res.json({
      success: true,
      message: `Processed ${emails.length} emails: ${successCount} successful, ${failureCount} failed`,
      data: {
        results,
        summary: {
          total: emails.length,
          successful: successCount,
          failed: failureCount
        }
      }
    });

  } catch (error) {
    logger.error('Bulk email processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/email/connect
// @desc    Connect email account for automatic processing
// @access  Private
router.post('/connect', [
  auth,
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  body('imapServer').notEmpty().withMessage('IMAP server is required'),
  body('imapPort').isInt().withMessage('IMAP port must be a number')
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
      appPassword,
      imapServer,
      imapPort,
      secure = true
    } = req.body;
    const msmeId = req.user.msmeId;

    if (!msmeId) {
      return res.status(400).json({
        success: false,
        message: 'MSME profile is required to connect an email account'
      });
    }

    const connection = await emailConnectionService.connectAccount(msmeId, {
      email,
      password: password || appPassword,
      imapServer,
      imapPort: imapPort ? Number(imapPort) : undefined,
      secure
    });

    logger.info(`Email account connected for MSME ${msmeId}`, {
      email: connection.emailMasked,
      imapServer: connection.imapServer,
      imapPort: connection.imapPort
    });

    return res.json({
      success: true,
      message: 'Email account connected successfully',
      data: connection
    });

  } catch (error) {
    logger.error('Email connection error:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Internal server error',
      ...(statusCode >= 500 ? clientErrorPayload(error) : {})
    });
  }
});

// @route   GET /api/email/connections
// @desc    List connected email accounts for the authenticated MSME
// @access  Private
router.get('/connections', auth, async (req, res) => {
  try {
    const msmeId = req.user.msmeId;
    if (!msmeId) {
      return res.status(400).json({
        success: false,
        message: 'MSME profile is required'
      });
    }

    const connections = await emailConnectionService.listConnections(msmeId);
    return res.json({
      success: true,
      data: { connections }
    });
  } catch (error) {
    logger.error('List email connections error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   DELETE /api/email/connections/:connectionId
// @desc    Disconnect a stored email account
// @access  Private
router.delete('/connections/:connectionId', auth, async (req, res) => {
  try {
    const msmeId = req.user.msmeId;
    if (!msmeId) {
      return res.status(400).json({
        success: false,
        message: 'MSME profile is required'
      });
    }

    const connection = await emailConnectionService.disconnectAccount(
      msmeId,
      req.params.connectionId
    );

    return res.json({
      success: true,
      message: 'Email account disconnected',
      data: connection
    });
  } catch (error) {
    logger.error('Disconnect email account error:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Internal server error',
      ...(statusCode >= 500 ? clientErrorPayload(error) : {})
    });
  }
});

// @route   POST /api/email/connections/:connectionId/sync
// @desc    Sync transactions from a connected email account
// @access  Private
router.post('/connections/:connectionId/sync', [
  auth,
  body('limit').optional().isInt({ min: 1, max: 100 }),
  body('sinceDays').optional().isInt({ min: 1, max: 365 })
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
    if (!msmeId) {
      return res.status(400).json({
        success: false,
        message: 'MSME profile is required'
      });
    }

    const msme = await MSME.findById(msmeId);
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const connection = await emailConnectionService.getActiveConnection(
      msmeId,
      req.params.connectionId
    );
    const credentials = await emailConnectionService.getDecryptedCredentials(connection);
    const { limit = 25, sinceDays = 30 } = req.body;

    const ingestionResult = await emailIngestionAgent.fetchEmails({
      email: connection.email,
      password: credentials.password,
      imapServer: connection.imapServer,
      imapPort: connection.imapPort,
      secure: connection.secure,
      limit,
      sinceDays
    });

    if (!ingestionResult.success) {
      connection.status = 'error';
      connection.lastSyncError = ingestionResult.error || 'Mailbox sync failed';
      await connection.save();

      return res.status(400).json({
        success: false,
        message: 'Unable to sync emails from the connected mailbox',
        error: ingestionResult.error
      });
    }

    const processedTransactions = [];
    const skippedEmails = [];
    const failures = [];

    for (const emailMessage of ingestionResult.emails) {
      try {
        const processed = await emailService.processEmail({
          subject: emailMessage.subject,
          body: emailMessage.body,
          from: emailMessage.from,
          to: Array.isArray(emailMessage.to) && emailMessage.to.length > 0
            ? emailMessage.to[0]
            : connection.email,
          date: emailMessage.date,
          messageId: emailMessage.id
        }, msme);

        if (!processed.success) {
          failures.push({
            messageId: emailMessage.id,
            subject: emailMessage.subject,
            error: processed.error || 'Processing failed'
          });
          continue;
        }

        const transactionData = {
          ...processed.transaction,
          industry: msme.industry,
          businessDomain: msme.businessDomain
        };
        const attributedTransactionData = assignProductsToTransaction(transactionData, msme.toObject(), {
          assignmentSource: 'email_sync'
        });
        const carbonData = carbonCalculationService.calculateTransactionCarbonFootprint(attributedTransactionData);
        attributedTransactionData.carbonFootprint = carbonData;

        const spamDetection = spamDetectionService.detectSpam(attributedTransactionData, {
          sender: emailMessage.from,
          subject: emailMessage.subject,
          body: emailMessage.body
        });
        const duplicateDetection = await duplicateDetectionService.detectDuplicate(
          attributedTransactionData,
          msmeId
        );

        if (spamDetection.isSpam || duplicateDetection.isDuplicate) {
          skippedEmails.push({
            messageId: emailMessage.id,
            subject: emailMessage.subject,
            spam: spamDetection.isSpam,
            duplicate: duplicateDetection.isDuplicate
          });
          continue;
        }

        const transaction = new Transaction({
          ...attributedTransactionData,
          msmeId,
          source: 'email_sync',
          metadata: {
            ...(attributedTransactionData.metadata || {}),
            emailConnectionId: connection._id,
            messageId: emailMessage.id
          }
        });
        await transaction.save();
        processedTransactions.push(transaction);
      } catch (syncError) {
        failures.push({
          messageId: emailMessage.id,
          subject: emailMessage.subject,
          error: syncError.message
        });
      }
    }

    const syncSummary = {
      fetched: ingestionResult.emails.length,
      processed: processedTransactions.length,
      skipped: skippedEmails.length,
      failed: failures.length
    };

    connection.status = 'connected';
    connection.lastSyncAt = new Date();
    connection.lastSyncError = null;
    connection.lastSyncSummary = syncSummary;
    await connection.save();

    return res.json({
      success: true,
      message: 'Email account synced successfully',
      data: {
        connection: {
          id: connection._id,
          email: connection.email,
          status: connection.status,
          lastSyncAt: connection.lastSyncAt,
          lastSyncSummary: syncSummary
        },
        processedTransactions: processedTransactions.length,
        skippedEmails,
        failures
      }
    });
  } catch (error) {
    logger.error('Email connection sync error:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Internal server error',
      ...(statusCode >= 500 ? clientErrorPayload(error) : {})
    });
  }
});

// Backwards-compatible alias used by older clients/integrations.
router.post('/send', auth, async (req, res) => {
  try {
    const {
      subject = 'Notification from Carbon Platform',
      body: emailBody,
      html,
      from,
      to,
      date,
      messageId
    } = req.body || {};

    if (!to || !(emailBody || html)) {
      return res.status(400).json({
        success: false,
        message: 'to and body/html are required'
      });
    }

    const normalizedBody = emailBody || html;
    const normalizedFrom = from || process.env.EMAIL_USER || 'no-reply@carbon-platform.local';
    const normalizedTo = Array.isArray(to) ? to[0] : to;
    const normalizedDate = date || new Date().toISOString();
    const normalizedMessageId = messageId || `email_send_${Date.now()}`;

    const msmeId = req.user.msmeId;
    const msmeProfile = msmeId ? await MSME.findById(msmeId).lean() : null;

    const result = await emailService.processEmail({
      subject,
      body: normalizedBody,
      from: normalizedFrom,
      to: normalizedTo,
      date: normalizedDate,
      messageId: normalizedMessageId
    }, msmeProfile);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Email processing failed'
      });
    }

    const carbonData = carbonCalculationService.calculateTransactionCarbonFootprint(result.transaction);
    result.transaction.carbonFootprint = carbonData;

    const attributedTransaction = assignProductsToTransaction(result.transaction, msmeProfile, {
      assignmentSource: 'email_data_stage'
    });

    const transaction = new Transaction({
      msmeId,
      ...attributedTransaction,
      isProcessed: true,
      processedAt: new Date(),
      isSpam: false,
      isDuplicate: false
    });
    await transaction.save();

    return res.json({
      success: true,
      message: 'Email processed successfully',
      data: {
        transaction,
        confidence: result.confidence
      }
    });
  } catch (error) {
    logger.error('Email send alias error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process email'
    });
  }
});

// @route   POST /api/email/ingest-assess
// @desc    Connect to MSME mailbox, ingest emails, and generate AI carbon assessment
// @access  Private
router.post('/ingest-assess', [
  auth,
  body('email').isEmail().withMessage('Valid email address is required'),
  body('appPassword').notEmpty().withMessage('Application-specific password is required'),
  body('imapServer').optional().isString(),
  body('imapPort').optional().isInt({ min: 1 }),
  body('secure').optional().isBoolean(),
  body('limit').optional().isInt({ min: 1, max: 100 }),
  body('sinceDays').optional().isInt({ min: 1, max: 365 })
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
      email: mailboxEmail,
      appPassword,
      imapServer,
      imapPort,
      secure = true,
      limit = 25,
      sinceDays = 30
    } = req.body;

    // Resolve MSME profile from authenticated user
    let msme = null;
    if (req.user.msmeId) {
      msme = await MSME.findById(req.user.msmeId);
    }
    if (!msme && req.user.userId) {
      msme = await MSME.findOne({ userId: req.user.userId });
    }

    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found for the authenticated user'
      });
    }

    // Step 1: Fetch emails using IMAP agent
    const ingestionResult = await emailIngestionAgent.fetchEmails({
      email: mailboxEmail,
      password: appPassword,
      imapServer,
      imapPort,
      secure,
      limit,
      sinceDays
    });

    if (!ingestionResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Unable to read emails from the provided mailbox',
        error: ingestionResult.error
      });
    }

    if (ingestionResult.emails.length === 0) {
      return res.json({
        success: true,
        message: 'No relevant emails found in the selected timeframe.',
        data: {
          ingestedEmails: 0,
          processedTransactions: 0,
          skippedEmails: [],
          failures: [],
          carbonAssessment: null,
          incentives: [],
          greenLoanOffers: []
        }
      });
    }

    const processedTransactions = [];
    const assessmentTransactions = [];
    const skippedEmails = [];
    const failures = [];

    for (const email of ingestionResult.emails) {
      try {
        const processed = await emailService.processEmail({
          subject: email.subject,
          body: email.body,
          from: email.from,
          to: Array.isArray(email.to) && email.to.length > 0 ? email.to[0] : mailboxEmail,
          date: email.date,
          messageId: email.id
        }, msme);

        if (!processed.success) {
          failures.push({
            messageId: email.id,
            subject: email.subject,
            error: processed.error || 'Processing failed'
          });
          continue;
        }

        const transactionData = {
          ...processed.transaction,
          industry: msme.industry,
          businessDomain: msme.businessDomain
        };
        const attributedTransactionData = assignProductsToTransaction(transactionData, msme.toObject(), {
          assignmentSource: 'email_data_stage'
        });

        const spamDetection = spamDetectionService.detectSpam(attributedTransactionData, {
          sender: email.from,
          subject: email.subject,
          body: email.textBody || email.body
        });

        const duplicateDetection = await duplicateDetectionService.detectDuplicate(attributedTransactionData, msme._id);

        if (spamDetection.isSpam || duplicateDetection.isDuplicate) {
          skippedEmails.push({
            messageId: email.id,
            subject: email.subject,
            spam: spamDetection.isSpam,
            duplicate: duplicateDetection.isDuplicate,
            spamReasons: spamDetection.reasons,
            duplicateReasons: duplicateDetection.reasons
          });
          continue;
        }

        const carbonData = carbonCalculationService.calculateTransactionCarbonFootprint(attributedTransactionData);
        attributedTransactionData.carbonFootprint = carbonData;

        const transactionDocument = new Transaction({
          msmeId: msme._id,
          ...attributedTransactionData,
          isProcessed: true,
          processedAt: new Date(),
          metadata: {
            ...attributedTransactionData.metadata,
            ingestionSource: 'ai_email_agent',
            mailbox: mailboxEmail,
            confidence: attributedTransactionData.metadata?.confidence || 0
          },
          isSpam: false,
          spamScore: spamDetection.score,
          spamReasons: spamDetection.reasons,
          spamConfidence: spamDetection.confidence,
          isDuplicate: false,
          duplicateType: duplicateDetection.duplicateType,
          similarityScore: duplicateDetection.similarityScore,
          matchedTransactionId: duplicateDetection.matchedTransaction?._id,
          duplicateReasons: duplicateDetection.reasons
        });

        await transactionDocument.save();

        try {
          orchestrationManagerEventService.emitEvent('transactions.email_ingested', {
            msmeId: msme._id?.toString(),
            transaction: transactionDocument.toObject(),
            source: 'ai_email_agent',
            messageId: email.id
          }, 'email_ingestion');
        } catch (eventError) {
          logger.warn('Failed to emit orchestration event for ingested email transaction', {
            error: eventError.message,
            msmeId: msme._id?.toString(),
            messageId: email.id
          });
        }

        processedTransactions.push({
          messageId: email.id,
          subject: email.subject,
          transactionType: attributedTransactionData.transactionType,
          amount: attributedTransactionData.amount,
          category: attributedTransactionData.category,
          co2Emissions: carbonData.co2Emissions,
          confidence: attributedTransactionData.metadata?.confidence || 0,
          processedAt: transactionDocument.processedAt
        });

        assessmentTransactions.push(transactionDocument.toObject());
      } catch (processingError) {
        logger.error('Email ingestion processing error', {
          error: processingError.message,
          messageId: email.id
        });

        failures.push({
          messageId: email.id,
          subject: email.subject,
          error: processingError.message
        });
      }
    }

    let carbonAssessment = null;
    if (assessmentTransactions.length > 0) {
      carbonAssessment = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
        msme,
        assessmentTransactions.map((transaction) => ({
          ...transaction,
          industry: msme.industry,
          businessDomain: msme.businessDomain
        }))
      );
    }

    const incentives = generateAIIncentives(msme, carbonAssessment, processedTransactions.length);
    const greenLoanOffers = await generateGreenLoanOffers(msme, carbonAssessment);

    res.json({
      success: true,
      message: 'Email ingestion and AI assessment completed successfully',
      data: {
        ingestedEmails: ingestionResult.emails.length,
        processedTransactions: processedTransactions.length,
        skippedEmails,
        failures,
        transactions: processedTransactions,
        carbonAssessment,
        incentives,
        greenLoanOffers,
        metadata: ingestionResult.metadata
      }
    });
  } catch (error) {
    logger.error('Email AI ingestion error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to complete AI-driven email assessment',
      ...clientErrorPayload(error)
    });
  }
});

const generateAIIncentives = (msme, carbonAssessment, processedCount) => {
  const incentives = [];
  const carbonScore = carbonAssessment?.carbonScore ?? null;
  const totalEmissions = carbonAssessment?.totalCO2Emissions ?? 0;
  const recommendationCount = carbonAssessment?.recommendations?.length || 0;

  incentives.push({
    id: 'ai-email-ingestion',
    title: 'AI Email Agent Bonus',
    description: `Automated carbon extraction completed for ${processedCount} messages in your mailbox.`,
    rewardPoints: 50 + processedCount * 10,
    category: 'automation',
    badge: 'AI-Powered'
  });

  if (carbonScore !== null) {
    incentives.push({
      id: 'carbon-score-recognition',
      title: 'Carbon Intelligence Score',
      description: `Your current carbon score is ${carbonScore}. Keep improving to unlock premium sustainability rewards.`,
      rewardPoints: Math.max(0, 100 - carbonScore) * 2,
      category: 'performance',
      badge: carbonScore >= 80 ? 'Platinum' : carbonScore >= 60 ? 'Gold' : 'Silver'
    });
  }

  if (totalEmissions > 0) {
    incentives.push({
      id: 'emissions-reduction-opportunity',
      title: 'Carbon Reduction Opportunity',
      description: `Identified ${totalEmissions.toFixed(2)} kg CO₂e emissions this period. Implement recommendations to unlock carbon reduction rebates.`,
      rewardPoints: Math.round(totalEmissions / 5),
      category: 'sustainability',
      badge: 'Action Needed'
    });
  }

  if (recommendationCount > 0) {
    incentives.push({
      id: 'recommendation-tracker',
      title: 'Recommendation Tracker',
      description: `AI agents suggested ${recommendationCount} targeted improvements. Implement at least one for instant climate credits.`,
      rewardPoints: 25 * recommendationCount,
      category: 'engagement',
      badge: 'Next Steps'
    });
  }

  return incentives;
};

const calculateCarbonScoreDiscount = (bank, carbonScore) => {
  if (!carbonScore || !bank.greenLoanPolicy?.carbonScoreDiscounts) {
    return 0;
  }

  for (const discount of bank.greenLoanPolicy.carbonScoreDiscounts) {
    if (!discount.scoreRange) continue;
    const { min = 0, max = 100 } = discount.scoreRange;
    if (carbonScore >= min && carbonScore <= max) {
      return discount.discountPercentage || 0;
    }
  }

  return 0;
};

const generateGreenLoanOffers = async (msme, carbonAssessment) => {
  const carbonScore = carbonAssessment?.carbonScore ?? 0;
  const banks = await Bank.find({ isActive: true }).limit(5).lean();

  return banks.map((bank) => {
    const policy = bank.greenLoanPolicy || {};
    const eligible = carbonScore >= (policy.minCarbonScore || 0);
    const discount = calculateCarbonScoreDiscount(bank, carbonScore);
    const baseRate = policy.interestRateRange?.min ?? 10;
    const maxRate = policy.interestRateRange?.max ?? baseRate + 2;
    const indicativeRate = eligible
      ? Math.max(baseRate - discount, baseRate * 0.5)
      : Math.min(maxRate, baseRate + 1.5);

    return {
      bankId: bank._id,
      bankName: bank.bankName,
      eligible,
      minCarbonScore: policy.minCarbonScore || 0,
      carbonScore,
      discountPercentage: discount,
      indicativeInterestRate: Number(indicativeRate.toFixed(2)),
      maxLoanAmount: policy.maxLoanAmount || null,
      message: eligible
        ? `Eligible for up to ${discount}% interest discount based on your carbon score.`
        : `Improve your carbon score by ${Math.max(0, (policy.minCarbonScore || 0) - carbonScore)} points to unlock discounted green capital.`
    };
  });
};

module.exports = router;