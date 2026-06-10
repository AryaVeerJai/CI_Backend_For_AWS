const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const CarbonAssessment = require('../models/CarbonAssessment');
const logger = require('../utils/logger');

// @route   GET /api/analytics/overview
// @desc    Get analytics overview
// @access  Private
router.get('/overview', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const msmeId = req.user.msmeId;

    const query = { msmeId };
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    // Get transaction data
    const transactions = await Transaction.find(query);
    
    // Get carbon assessment data
    const assessments = await CarbonAssessment.find({ msmeId })
      .sort({ createdAt: -1 })
      .limit(12);

    // Calculate overview metrics
    const overview = {
      transactions: {
        total: transactions.length,
        totalAmount: transactions.reduce((sum, t) => sum + t.amount, 0),
        totalCO2Emissions: transactions.reduce((sum, t) => sum + t.carbonFootprint.co2Emissions, 0),
        averageAmount: transactions.length > 0 ? 
          transactions.reduce((sum, t) => sum + t.amount, 0) / transactions.length : 0,
        averageCO2Emissions: transactions.length > 0 ? 
          transactions.reduce((sum, t) => sum + t.carbonFootprint.co2Emissions, 0) / transactions.length : 0
      },
      carbon: {
        currentScore: assessments[0]?.carbonScore || 0,
        totalAssessments: assessments.length,
        averageScore: assessments.length > 0 ? 
          assessments.reduce((sum, a) => sum + a.carbonScore, 0) / assessments.length : 0,
        trend: assessments.map(a => ({
          date: a.createdAt,
          score: a.carbonScore,
          emissions: a.totalCO2Emissions
        }))
      },
      sustainability: {
        greenTransactions: transactions.filter(t => t.sustainability.isGreen).length,
        sustainabilityScore: transactions.length > 0 ? 
          (transactions.filter(t => t.sustainability.isGreen).length / transactions.length) * 100 : 0,
        averageConfidence: transactions.length > 0 ? 
          transactions.reduce((sum, t) => sum + t.metadata.confidence, 0) / transactions.length : 0
      }
    };

    res.json({
      success: true,
      data: overview
    });

  } catch (error) {
    logger.error('Get analytics overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/analytics/trends
// @desc    Get trend analytics
// @access  Private
router.get('/trends', auth, async (req, res) => {
  try {
    const { period = 'monthly', startDate, endDate } = req.query;
    const msmeId = req.user.msmeId;

    const query = { msmeId };
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    let groupBy;
    switch (period) {
      case 'daily':
        groupBy = {
          year: { $year: '$date' },
          month: { $month: '$date' },
          day: { $dayOfMonth: '$date' }
        };
        break;
      case 'weekly':
        groupBy = {
          year: { $year: '$date' },
          week: { $week: '$date' }
        };
        break;
      case 'monthly':
      default:
        groupBy = {
          year: { $year: '$date' },
          month: { $month: '$date' }
        };
        break;
    }

    // Get transaction trends
    const transactionTrends = await Transaction.aggregate([
      { $match: query },
      {
        $group: {
          _id: groupBy,
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          totalCO2: { $sum: '$carbonFootprint.co2Emissions' },
          averageAmount: { $avg: '$amount' },
          averageCO2: { $avg: '$carbonFootprint.co2Emissions' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } }
    ]);

    // Get category trends
    const categoryTrends = await Transaction.aggregate([
      { $match: query },
      {
        $group: {
          _id: {
            category: '$category',
            year: { $year: '$date' },
            month: { $month: '$date' }
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          totalCO2: { $sum: '$carbonFootprint.co2Emissions' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Get source trends
    const sourceTrends = await Transaction.aggregate([
      { $match: query },
      {
        $group: {
          _id: {
            source: '$source',
            year: { $year: '$date' },
            month: { $month: '$date' }
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          totalCO2: { $sum: '$carbonFootprint.co2Emissions' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const trends = {
      period,
      transactions: transactionTrends,
      categories: categoryTrends,
      sources: sourceTrends
    };

    res.json({
      success: true,
      data: trends
    });

  } catch (error) {
    logger.error('Get trend analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/analytics/insights
// @desc    Get insights and recommendations
// @access  Private
router.get('/insights', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const msmeId = req.user.msmeId;

    const query = { msmeId };
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(query);
    const latestAssessment = await CarbonAssessment.findOne({ msmeId })
      .sort({ createdAt: -1 });

    const insights = {
      topCategories: {},
      topVendors: {},
      sustainabilityInsights: [],
      costOptimization: [],
      carbonReduction: [],
      recommendations: latestAssessment?.recommendations || []
    };

    // Analyze top categories
    const categoryAnalysis = {};
    transactions.forEach(transaction => {
      const category = transaction.category;
      if (!categoryAnalysis[category]) {
        categoryAnalysis[category] = {
          count: 0,
          totalAmount: 0,
          totalCO2: 0,
          averageAmount: 0,
          averageCO2: 0
        };
      }
      categoryAnalysis[category].count++;
      categoryAnalysis[category].totalAmount += transaction.amount;
      categoryAnalysis[category].totalCO2 += transaction.carbonFootprint.co2Emissions;
    });

    // Calculate averages
    Object.keys(categoryAnalysis).forEach(category => {
      const data = categoryAnalysis[category];
      data.averageAmount = data.totalAmount / data.count;
      data.averageCO2 = data.totalCO2 / data.count;
    });

    insights.topCategories = Object.entries(categoryAnalysis)
      .sort(([,a], [,b]) => b.totalAmount - a.totalAmount)
      .slice(0, 5)
      .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

    // Analyze top vendors
    const vendorAnalysis = {};
    transactions.forEach(transaction => {
      const vendor = transaction.vendor.name;
      if (!vendorAnalysis[vendor]) {
        vendorAnalysis[vendor] = {
          count: 0,
          totalAmount: 0,
          totalCO2: 0,
          category: transaction.category
        };
      }
      vendorAnalysis[vendor].count++;
      vendorAnalysis[vendor].totalAmount += transaction.amount;
      vendorAnalysis[vendor].totalCO2 += transaction.carbonFootprint.co2Emissions;
    });

    insights.topVendors = Object.entries(vendorAnalysis)
      .sort(([,a], [,b]) => b.totalAmount - a.totalAmount)
      .slice(0, 10)
      .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

    // Generate sustainability insights
    const greenTransactions = transactions.filter(t => t.sustainability.isGreen);
    const greenPercentage = transactions.length > 0 ? 
      (greenTransactions.length / transactions.length) * 100 : 0;

    if (greenPercentage < 20) {
      insights.sustainabilityInsights.push({
        type: 'warning',
        message: 'Low green transaction percentage. Consider sourcing from sustainable vendors.',
        percentage: greenPercentage
      });
    } else if (greenPercentage > 50) {
      insights.sustainabilityInsights.push({
        type: 'success',
        message: 'Excellent green transaction percentage. Keep up the good work!',
        percentage: greenPercentage
      });
    }

    // Generate cost optimization insights
    const highCostCategories = Object.entries(categoryAnalysis)
      .filter(([, data]) => data.averageAmount > 10000)
      .sort(([,a], [,b]) => b.averageAmount - a.averageAmount);

    highCostCategories.forEach(([category, data]) => {
      insights.costOptimization.push({
        category,
        averageAmount: data.averageAmount,
        suggestion: `Consider negotiating better rates for ${category} purchases`
      });
    });

    // Generate carbon reduction insights
    const highCarbonCategories = Object.entries(categoryAnalysis)
      .filter(([, data]) => data.averageCO2 > 100)
      .sort(([,a], [,b]) => b.averageCO2 - a.averageCO2);

    highCarbonCategories.forEach(([category, data]) => {
      insights.carbonReduction.push({
        category,
        averageCO2: data.averageCO2,
        suggestion: `Focus on reducing emissions in ${category} category`
      });
    });

    res.json({
      success: true,
      data: insights
    });

  } catch (error) {
    logger.error('Get insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;