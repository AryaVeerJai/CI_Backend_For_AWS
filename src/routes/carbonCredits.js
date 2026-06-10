const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const carbonCreditsService = require('../services/carbonCreditsService');
const logger = require('../utils/logger');
const MSME = require('../models/MSME');

// @route   POST /api/carbon-credits/aggregate
// @desc    Aggregate carbon savings and allocate credits to MSMEs
// @access  Private (Admin only)
router.post('/aggregate', auth, auth.requireRole('admin'), async (req, res) => {
  try {
    const { period = 'monthly' } = req.body;

    const result = await carbonCreditsService.aggregateAndAllocateCredits(period);

    res.json({
      success: result.success,
      message: result.message || 'Carbon credits aggregated and allocated successfully',
      data: result.data
    });

  } catch (error) {
    logger.error('Carbon credits aggregation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon-credits/msme/:msmeId
// @desc    Get carbon credits for a specific MSME
// @access  Private
router.get('/msme/:msmeId', auth, async (req, res) => {
  try {
    const { msmeId } = req.params;

    // Only admins can access arbitrary MSME credit records.
    if (req.user.role !== 'admin' && (!req.user.msmeId || req.user.msmeId.toString() !== msmeId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this MSME data'
      });
    }

    const msmeCredits = await carbonCreditsService.getMSMECredits(msmeId);

    res.json({
      success: true,
      data: msmeCredits
    });

  } catch (error) {
    logger.error('Get MSME carbon credits error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon-credits/my-credits
// @desc    Get current user's MSME carbon credits
// @access  Private
router.get('/my-credits', auth, async (req, res) => {
  try {
    const msmeId = req.user.msmeId;
    
    if (!msmeId) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const msmeCredits = await carbonCreditsService.getMSMECredits(msmeId);
    const msme = await MSME.findById(msmeId).lean();

    res.json({
      success: true,
      data: carbonCreditsService.enrichMsmeCreditsWithIcm(msmeCredits, msme)
    });

  } catch (error) {
    logger.error('Get my carbon credits error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/carbon-credits/use
// @desc    Use carbon credits for a specific purpose
// @access  Private
router.post('/use', auth, async (req, res) => {
  try {
    const { amount, purpose, referenceId } = req.body;
    const msmeId = req.user.msmeId;

    if (!msmeId) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    const msmeCredits = await carbonCreditsService.useCredits(
      msmeId,
      amount,
      purpose || 'General usage',
      referenceId
    );

    res.json({
      success: true,
      message: 'Credits used successfully',
      data: {
        usedAmount: amount,
        remainingCredits: msmeCredits.availableCredits,
        totalUsed: msmeCredits.usedCredits
      }
    });

  } catch (error) {
    logger.error('Use carbon credits error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// @route   POST /api/carbon-credits/retire
// @desc    Retire carbon credits (permanent removal)
// @access  Private
router.post('/retire', auth, async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const msmeId = req.user.msmeId;

    if (!msmeId) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    const msmeCredits = await carbonCreditsService.retireCredits(
      msmeId,
      amount,
      reason || 'Voluntary retirement'
    );

    res.json({
      success: true,
      message: 'Credits retired successfully',
      data: {
        retiredAmount: amount,
        remainingCredits: msmeCredits.availableCredits,
        totalRetired: msmeCredits.retiredCredits
      }
    });

  } catch (error) {
    logger.error('Retire carbon credits error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// @route   GET /api/carbon-credits/market
// @desc    Get carbon credits market data
// @access  Private
router.get('/market', auth, async (req, res) => {
  try {
    const marketData = await carbonCreditsService.getMarketData();

    res.json({
      success: true,
      data: marketData
    });

  } catch (error) {
    logger.error('Get carbon credits market data error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon-credits/leaderboard
// @desc    Get MSME leaderboard based on carbon credits
// @access  Private
router.get('/leaderboard', auth, async (req, res) => {
  try {
    const { limit = 10, period = 'all' } = req.query;

    const leaderboard = await carbonCreditsService.getMSMELeaderboard(
      parseInt(limit),
      period
    );

    res.json({
      success: true,
      data: {
        leaderboard,
        period,
        totalParticipants: leaderboard.length
      }
    });

  } catch (error) {
    logger.error('Get carbon credits leaderboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon-credits/pool
// @desc    Get carbon credits pool information
// @access  Private
router.get('/pool', auth, async (req, res) => {
  try {
    const { CarbonCredits } = require('../models/CarbonCredits');
    const pool = await CarbonCredits.findOne({ poolId: 'indian_carbon_market_pool' });

    if (!pool) {
      return res.status(404).json({
        success: false,
        message: 'Carbon credits pool not found'
      });
    }

    res.json({
      success: true,
      data: pool
    });

  } catch (error) {
    logger.error('Get carbon credits pool error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/carbon-credits/verify-pool
// @desc    Verify carbon credits pool (Admin only)
// @access  Private (Admin only)
router.post('/verify-pool', auth, auth.requireRole('admin'), async (req, res) => {
  try {
    const { notes } = req.body;
    const verifiedBy = req.user.userId;

    const pool = await carbonCreditsService.verifyPool(verifiedBy, notes);

    res.json({
      success: true,
      message: 'Carbon credits pool verified successfully',
      data: pool
    });

  } catch (error) {
    logger.error('Verify carbon credits pool error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// @route   GET /api/carbon-credits/icm/integration
// @desc    Portal links, registry alignment, and ICM integration context for current MSME
// @access  Private
router.get('/icm/integration', auth, async (req, res) => {
  try {
    const msmeId = req.user.msmeId;
    if (!msmeId) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const data = await carbonCreditsService.getIndianCarbonMarketIntegration(msmeId);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Get ICM integration context error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon-credits/registry/status
// @desc    Get Indian carbon market registry integration status
// @access  Private (Admin only)
router.get('/registry/status', auth, auth.requireRole('admin'), async (req, res) => {
  try {
    const status = carbonCreditsService.getRegistryIntegrationStatus();

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Get registry integration status error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// @route   GET /api/carbon-credits/registry/health
// @desc    Check health of Indian carbon market registry API
// @access  Private (Admin only)
router.get('/registry/health', auth, auth.requireRole('admin'), async (req, res) => {
  try {
    const health = await carbonCreditsService.getRegistryHealthStatus();

    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    logger.error('Get registry health status error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// @route   GET /api/carbon-credits/registry/msme/:msmeId
// @desc    Pull MSME credit state from Indian carbon registry and store sync snapshot
// @access  Private (Admin only)
router.get('/registry/msme/:msmeId', auth, auth.requireRole('admin'), async (req, res) => {
  try {
    const { msmeId } = req.params;
    const data = await carbonCreditsService.getMSMECreditsFromRegistry(msmeId);

    res.json({
      success: true,
      message: 'MSME credit state fetched from registry',
      data
    });
  } catch (error) {
    logger.error('Get MSME credits from registry error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// @route   POST /api/carbon-credits/registry/sync/:msmeId
// @desc    Push local MSME credit state to Indian carbon registry
// @access  Private (Admin only)
router.post('/registry/sync/:msmeId', auth, auth.requireRole('admin'), async (req, res) => {
  try {
    const { msmeId } = req.params;
    const { metadata = {} } = req.body;
    const data = await carbonCreditsService.syncMSMECreditsWithRegistry(msmeId, metadata);

    res.json({
      success: true,
      message: 'MSME credits synced with Indian carbon registry',
      data
    });
  } catch (error) {
    logger.error('Sync MSME credits with registry error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// @route   POST /api/carbon-credits/workflow/:msmeId/baseline
// @desc    Set/update ICM workflow baseline for an MSME
// @access  Private (Admin only)
router.post('/workflow/:msmeId/baseline', auth, auth.requireRole('admin'), async (req, res) => {
  try {
    const { msmeId } = req.params;
    const {
      co2Emissions,
      assessmentId,
      source = 'platform',
      notes = '',
      workflow = 'Platform'
    } = req.body || {};

    const result = await carbonCreditsService.setICMWorkflowBaseline(msmeId, {
      baselineCO2Emissions: co2Emissions,
      assessmentId,
      source,
      notes,
      workflow
    });

    res.json({
      success: true,
      message: 'ICM workflow baseline updated successfully',
      data: result
    });
  } catch (error) {
    logger.error('Set ICM workflow baseline error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// @route   POST /api/carbon-credits/workflow/:msmeId/track-reduction
// @desc    Track emission reduction against ICM baseline
// @access  Private (Admin only)
router.post('/workflow/:msmeId/track-reduction', auth, auth.requireRole('admin'), async (req, res) => {
  try {
    const { msmeId } = req.params;
    const {
      currentCo2Emissions,
      measuredAt,
      source = 'platform',
      note = '',
      workflow = 'Platform'
    } = req.body || {};

    const result = await carbonCreditsService.trackICMEmissionReduction(msmeId, {
      currentCO2Emissions: currentCo2Emissions,
      measuredAt,
      source,
      note,
      workflow
    });

    res.json({
      success: true,
      message: 'ICM emission reduction tracked successfully',
      data: result
    });
  } catch (error) {
    logger.error('Track ICM emission reduction error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// @route   POST /api/carbon-credits/workflow/:msmeId/quantify-credits
// @desc    Quantify ICM credits from tracked emission reduction
// @access  Private (Admin only)
router.post('/workflow/:msmeId/quantify-credits', auth, auth.requireRole('admin'), async (req, res) => {
  try {
    const { msmeId } = req.params;
    const {
      method = 'baseline_delta',
      creditPerKgCO2,
      reductionKgCO2,
      source = 'platform',
      workflow = 'Platform'
    } = req.body || {};

    const result = await carbonCreditsService.quantifyICMCredits(msmeId, {
      method,
      creditPerKgCO2,
      reductionKgCO2,
      source,
      workflow
    });

    res.json({
      success: true,
      message: 'ICM credits quantified successfully',
      data: result
    });
  } catch (error) {
    logger.error('Quantify ICM credits error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// @route   GET /api/carbon-credits/workflow/:msmeId
// @desc    Get complete ICM workflow state for an MSME
// @access  Private (Admin only)
router.get('/workflow/:msmeId', auth, auth.requireRole('admin'), async (req, res) => {
  try {
    const { msmeId } = req.params;
    const data = await carbonCreditsService.getICMWorkflowState(msmeId);

    res.json({
      success: true,
      data
    });
  } catch (error) {
    logger.error('Get ICM workflow state error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// @route   GET /api/carbon-credits/transactions
// @desc    Get carbon credit transactions
// @access  Private
router.get('/transactions', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, type, status } = req.query;
    const msmeId = req.user.msmeId;

    const { CarbonCreditTransaction } = require('../models/CarbonCredits');
    
    const query = {
      $or: [
        { fromMSME: msmeId },
        { toMSME: msmeId }
      ]
    };

    if (type) query.type = type;
    if (status) query.status = status;

    const transactions = await CarbonCreditTransaction.find(query)
      .populate('fromMSME', 'companyName')
      .populate('toMSME', 'companyName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await CarbonCreditTransaction.countDocuments(query);

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
    logger.error('Get carbon credit transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/carbon-credits/transfer
// @desc    Transfer carbon credits between MSMEs
// @access  Private
router.post('/transfer', auth, async (req, res) => {
  try {
    const { toMSMEId, amount, description } = req.body;
    const fromMSMEId = req.user.msmeId;
    const transferAmount = Number(amount);

    if (!fromMSMEId) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    if (!toMSMEId || !Number.isFinite(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid recipient and amount are required'
      });
    }

    if (fromMSMEId.toString() === toMSMEId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer credits to yourself'
      });
    }

    const recipientMSME = await MSME.findById(toMSMEId).select('_id companyName');
    if (!recipientMSME) {
      return res.status(404).json({
        success: false,
        message: 'Recipient MSME not found'
      });
    }

    const transferResult = await carbonCreditsService.transferCredits(
      fromMSMEId,
      toMSMEId,
      transferAmount,
      description
    );

    // Create transaction record
    const { CarbonCreditTransaction } = require('../models/CarbonCredits');
    const transaction = new CarbonCreditTransaction({
      transactionId: transferResult.referenceId,
      fromMSME: fromMSMEId,
      toMSME: toMSMEId,
      type: 'transfer',
      creditsAmount: transferAmount,
      pricePerCredit: 0, // Free transfer
      totalValue: 0,
      marketType: 'bilateral',
      status: 'completed',
      description: description || 'Credit transfer',
      poolId: 'indian_carbon_market_pool'
    });

    await transaction.save();

    res.json({
      success: true,
      message: 'Credits transferred successfully',
      data: {
        transactionId: transaction.transactionId,
        amount: transferAmount,
        fromMSME: fromMSMEId,
        toMSME: toMSMEId,
        sender: carbonCreditsService.getCreditSummary(transferResult.fromCredits),
        recipient: carbonCreditsService.getCreditSummary(transferResult.toCredits)
      }
    });

  } catch (error) {
    logger.error('Transfer carbon credits error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

module.exports = router;