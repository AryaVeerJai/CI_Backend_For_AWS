const express = require('express');
const mongoose = require('mongoose');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireMsmePlanFeature } = require('../middleware/enforceMsmePlanLimits');
const CarbonTrading = require('../models/CarbonTrading');
const CarbonOffset = require('../models/CarbonOffset');
const MSME = require('../models/MSME');
const logger = require('../utils/logger');

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const restoreOffsetCredits = async (offsetId, purchaseAmount, session) => {
  const options = session ? { session } : {};
  await CarbonOffset.updateOne(
    { _id: offsetId },
    { $inc: { availableCredits: purchaseAmount }, $set: { isActive: true } },
    options
  );
};

// @route   GET /api/carbon/trading/portfolio
// @desc    Get MSME carbon trading portfolio
// @access  Private
router.get('/portfolio', auth, auth.requireMSMEProfile, requireMsmePlanFeature('carbonCredits'), async (req, res) => {
  try {
    const msmeId = req.user.msmeId;

    // Get MSME data
    const msme = await MSME.findById(msmeId);
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME not found'
      });
    }

    // Get trading portfolio
    const portfolio = await CarbonTrading.findOne({ msmeId });
    
    // If no portfolio exists, create one
    if (!portfolio) {
      const newPortfolio = new CarbonTrading({
        msmeId,
        totalCredits: 0,
        availableCredits: 0,
        usedCredits: 0,
        totalInvestment: 0,
        averagePrice: 0,
        lastPurchase: null,
        transactions: []
      });
      await newPortfolio.save();
      
      return res.json({
        success: true,
        data: {
          totalCredits: 0,
          availableCredits: 0,
          usedCredits: 0,
          totalInvestment: 0,
          averagePrice: 0,
          lastPurchase: null
        }
      });
    }

    res.json({
      success: true,
      data: {
        totalCredits: portfolio.totalCredits,
        availableCredits: portfolio.availableCredits,
        usedCredits: portfolio.usedCredits,
        totalInvestment: portfolio.totalInvestment,
        averagePrice: portfolio.averagePrice,
        lastPurchase: portfolio.lastPurchase
      }
    });

  } catch (error) {
    logger.error('Get carbon trading portfolio error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon/trading/offsets
// @desc    Get available carbon offset options
// @access  Private
router.get('/offsets', auth, auth.requireMSMEProfile, async (req, res) => {
  try {
    const { 
      type, 
      minPrice, 
      maxPrice, 
      location, 
      verifiedBy,
      icmRegistered,
      page = 1,
      limit = 20
    } = req.query;

    const query = { isActive: true };
    
    if (type) query.type = type;
    if (icmRegistered === 'true') {
      query['icmRegistry.isRegistered'] = true;
    }
    if (minPrice || maxPrice) {
      query.pricePerTon = {};
      if (minPrice) query.pricePerTon.$gte = parseFloat(minPrice);
      if (maxPrice) query.pricePerTon.$lte = parseFloat(maxPrice);
    }
    if (location) query.location = { $regex: escapeRegExp(location), $options: 'i' };
    if (verifiedBy) query.verifiedBy = { $regex: escapeRegExp(verifiedBy), $options: 'i' };

    const offsets = await CarbonOffset.find(query)
      .sort({ rating: -1, pricePerTon: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await CarbonOffset.countDocuments(query);

    res.json({
      success: true,
      data: offsets,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });

  } catch (error) {
    logger.error('Get carbon offset options error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/carbon/trading/purchase
// @desc    Purchase carbon offset credits
// @access  Private
router.post('/purchase', auth, auth.requireMSMEProfile, async (req, res) => {
  try {
    const { offsetId, amount, pricePerTon } = req.body;
    const msmeId = req.user.msmeId;

    if (!offsetId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const purchaseAmount = Number(amount);
    if (!Number.isFinite(purchaseAmount) || purchaseAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    const session = await mongoose.startSession();
    let offsetAfterDebit;
    let portfolio;
    let transaction;
    let totalCost;

    try {
      await session.withTransaction(async () => {
        offsetAfterDebit = await CarbonOffset.findOneAndUpdate(
          {
            _id: offsetId,
            isActive: true,
            availableCredits: { $gte: purchaseAmount }
          },
          [
            {
              $set: {
                availableCredits: { $subtract: ['$availableCredits', purchaseAmount] },
                isActive: {
                  $cond: [
                    { $gt: [{ $subtract: ['$availableCredits', purchaseAmount] }, 0] },
                    '$isActive',
                    false
                  ]
                }
              }
            }
          ],
          { new: true, session }
        );

        if (!offsetAfterDebit) {
          const exists = await CarbonOffset.findById(offsetId).select('_id').session(session).lean();
          if (!exists) {
            const err = new Error('Carbon offset option not found');
            err.statusCode = 404;
            throw err;
          }
          const err = new Error('Insufficient credits available');
          err.statusCode = 400;
          throw err;
        }

        const serverPricePerTon = Number(offsetAfterDebit.pricePerTon);
        if (!Number.isFinite(serverPricePerTon) || serverPricePerTon <= 0) {
          const err = new Error('Invalid offset pricing configuration');
          err.statusCode = 500;
          throw err;
        }

        if (pricePerTon !== undefined && pricePerTon !== null) {
          const clientPrice = Number(pricePerTon);
          if (!Number.isFinite(clientPrice) || clientPrice <= 0) {
            const err = new Error('Invalid client price confirmation');
            err.statusCode = 400;
            throw err;
          }
          const relDiff = Math.abs(clientPrice - serverPricePerTon) / serverPricePerTon;
          if (relDiff > 0.02) {
            const err = new Error('Quoted price does not match current server price');
            err.statusCode = 400;
            err.serverPricePerTon = serverPricePerTon;
            throw err;
          }
        }

        totalCost = purchaseAmount * serverPricePerTon;

        transaction = {
          type: 'purchase',
          offsetId: offsetAfterDebit._id,
          offsetName: offsetAfterDebit.name,
          amount: purchaseAmount,
          pricePerTon: serverPricePerTon,
          totalCost,
          timestamp: new Date(),
          status: 'completed'
        };

        portfolio = await CarbonTrading.findOne({ msmeId }).session(session);
        if (!portfolio) {
          portfolio = new CarbonTrading({
            msmeId,
            totalCredits: 0,
            availableCredits: 0,
            usedCredits: 0,
            totalInvestment: 0,
            averagePrice: 0,
            lastPurchase: null,
            transactions: []
          });
        }

        portfolio.totalCredits += purchaseAmount;
        portfolio.availableCredits += purchaseAmount;
        portfolio.totalInvestment += totalCost;
        portfolio.averagePrice = portfolio.totalCredits > 0
          ? portfolio.totalInvestment / portfolio.totalCredits
          : serverPricePerTon;
        portfolio.lastPurchase = new Date();
        portfolio.transactions.push(transaction);

        await portfolio.save({ session });
      });
    } catch (purchaseError) {
      if (purchaseError.statusCode === 404) {
        return res.status(404).json({ success: false, message: purchaseError.message });
      }
      if (purchaseError.statusCode === 400) {
        return res.status(400).json({
          success: false,
          message: purchaseError.message,
          ...(purchaseError.serverPricePerTon != null
            ? { serverPricePerTon: purchaseError.serverPricePerTon }
            : {})
        });
      }
      if (purchaseError.statusCode === 500) {
        return res.status(500).json({ success: false, message: purchaseError.message });
      }
      throw purchaseError;
    } finally {
      await session.endSession();
    }

    logger.info(`Carbon offset purchased: ${purchaseAmount} tons for ₹${totalCost}`, {
      msmeId,
      offsetId
    });

    return res.json({
      success: true,
      message: 'Carbon offset purchased successfully',
      data: {
        transaction,
        portfolio: {
          totalCredits: portfolio.totalCredits,
          availableCredits: portfolio.availableCredits,
          totalInvestment: portfolio.totalInvestment
        }
      }
    });
  } catch (error) {
    logger.error('Purchase carbon offset error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/carbon/trading/offset
// @desc    Use carbon credits to offset emissions
// @access  Private
router.post('/offset', auth, auth.requireMSMEProfile, async (req, res) => {
  try {
    const { amount, description } = req.body;
    const msmeId = req.user.msmeId;

    const rawAmount = Number(amount);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    const offsetTx = {
      type: 'offset',
      amount: rawAmount,
      description: description || 'Carbon emission offset',
      timestamp: new Date(),
      status: 'completed'
    };

    const portfolio = await CarbonTrading.findOneAndUpdate(
      {
        msmeId,
        availableCredits: { $gte: rawAmount }
      },
      {
        $inc: { availableCredits: -rawAmount, usedCredits: rawAmount },
        $push: { transactions: offsetTx }
      },
      { new: true }
    );

    if (!portfolio) {
      const exists = await CarbonTrading.findOne({ msmeId }).select('availableCredits').lean();
      if (!exists) {
        return res.status(404).json({
          success: false,
          message: 'No trading portfolio found'
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Insufficient credits available'
      });
    }

    logger.info(`Carbon offset applied: ${rawAmount} tons`, {
      msmeId,
      transactionId: offsetTx._id
    });

    res.json({
      success: true,
      message: 'Carbon offset applied successfully',
      data: {
        transaction: offsetTx,
        portfolio: {
          availableCredits: portfolio.availableCredits,
          usedCredits: portfolio.usedCredits
        }
      }
    });

  } catch (error) {
    logger.error('Apply carbon offset error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon/trading/history
// @desc    Get carbon trading history
// @access  Private
router.get('/history', auth, auth.requireMSMEProfile, async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const msmeId = req.user.msmeId;

    const portfolio = await CarbonTrading.findOne({ msmeId });
    if (!portfolio) {
      return res.json({
        success: true,
        data: {
          transactions: [],
          pagination: { current: 1, pages: 0, total: 0 }
        }
      });
    }

    let transactions = portfolio.transactions;
    if (type) {
      transactions = transactions.filter(t => t.type === type);
    }

    // Sort by timestamp (newest first)
    transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedTransactions = transactions.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        transactions: paginatedTransactions,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(transactions.length / limit),
          total: transactions.length
        }
      }
    });

  } catch (error) {
    logger.error('Get carbon trading history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon/trading/market-trends
// @desc    Get carbon market trends and analytics
// @access  Private
router.get('/market-trends', auth, auth.requireMSMEProfile, requireMsmePlanFeature('carbonCredits'), async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get market data
    const marketData = await CarbonOffset.aggregate([
      {
        $match: {
          isActive: true,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            type: '$type',
            month: { $month: '$createdAt' },
            year: { $year: '$createdAt' }
          },
          averagePrice: { $avg: '$pricePerTon' },
          totalCredits: { $sum: '$availableCredits' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1 }
      }
    ]);

    // Get price trends
    const priceTrends = await CarbonOffset.aggregate([
      {
        $match: {
          isActive: true,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt'
            }
          },
          averagePrice: { $avg: '$pricePerTon' },
          minPrice: { $min: '$pricePerTon' },
          maxPrice: { $max: '$pricePerTon' }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    // Get type distribution
    const typeDistribution = await CarbonOffset.aggregate([
      {
        $match: { isActive: true }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          averagePrice: { $avg: '$pricePerTon' },
          totalCredits: { $sum: '$availableCredits' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        marketData,
        priceTrends,
        typeDistribution,
        period,
        generatedAt: new Date()
      }
    });

  } catch (error) {
    logger.error('Get carbon market trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;