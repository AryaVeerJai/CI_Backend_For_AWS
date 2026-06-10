const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const CarbonAssessment = require('../models/CarbonAssessment');
const carbonForecastingService = require('../services/carbonForecastingService');
const { loadForecastContext } = require('../utils/forecastContext');
const { buildOrgDataFilter } = require('../utils/orgDataScope');
const logger = require('../utils/logger');

const requireForecastAccess = [
  auth,
  auth.requireRole('msme', 'enterprise'),
  auth.requireOperationalProfile
];

// @route   GET /api/carbon-forecasting/forecast
// @desc    Get carbon footprint forecast for MSME
// @access  Private
router.get('/forecast', ...requireForecastAccess, async (req, res) => {
  try {
    const { forecastPeriods = 12, confidenceLevel = 0.95, modelType = 'auto' } = req.query;

    const context = await loadForecastContext(req);
    if (!context) {
      return res.status(404).json({
        success: false,
        message: 'Operational profile not found'
      });
    }

    const { profile, historicalAssessments } = context;

    const forecastResult = await carbonForecastingService.generateCarbonFootprintForecast(
      profile,
      historicalAssessments,
      {
        forecastPeriods: parseInt(forecastPeriods),
        confidenceLevel: parseFloat(confidenceLevel),
        modelType: modelType
      }
    );

    if (!forecastResult.success) {
      if (forecastResult.errorCode === 'insufficient_data') {
        return res.status(422).json({
          success: false,
          errorCode: forecastResult.errorCode,
          message: forecastResult.message || 'Insufficient data for forecasting',
          data: {
            minimumAssessmentsRequired: 3,
            currentAssessments: historicalAssessments.length
          }
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Forecast generation failed',
        error: forecastResult.error
      });
    }

    // Save forecast predictions to latest assessment
    try {
      const latestAssessment = await CarbonAssessment.findOne(buildOrgDataFilter(req))
        .sort({ 'period.startDate': -1 });

      if (latestAssessment && forecastResult.data?.forecast?.data) {
        latestAssessment.predictions = forecastResult.data.forecast.data.map(f => ({
          month: f.date,
          predictedCO2: f.totalCO2,
          confidenceLower: f.confidenceInterval?.lower,
          confidenceUpper: f.confidenceInterval?.upper,
          modelUsed: forecastResult.data.model?.type || modelType,
          generatedAt: new Date()
        }));
        latestAssessment.forecastMetadata = {
          modelType: forecastResult.data.model?.type || modelType,
          accuracy: forecastResult.data.accuracy || {},
          lastForecastDate: new Date(),
          forecastPeriods: parseInt(forecastPeriods)
        };
        await latestAssessment.save();
      }
    } catch (saveError) {
      logger.warn('Failed to save forecast predictions to assessment:', saveError.message);
    }

    logger.info(`Carbon forecast generated for ${context.segment}: ${profile._id}`, {
      userId: req.user.userId,
      forecastPeriods,
      modelType
    });

    res.json({
      success: true,
      data: forecastResult.data
    });

  } catch (error) {
    logger.error('Carbon forecasting error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon-forecasting/trends
// @desc    Get carbon footprint trends and analytics
// @access  Private
router.get('/trends', ...requireForecastAccess, async (req, res) => {
  try {
    const { period = 'yearly' } = req.query;

    const context = await loadForecastContext(req);
    if (!context) {
      return res.status(404).json({
        success: false,
        message: 'Operational profile not found'
      });
    }

    // Get historical data based on period
    let dateFilter = {};
    const now = new Date();
    
    switch (period) {
      case 'monthly':
        dateFilter = {
          'period.startDate': {
            $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1)
          }
        };
        break;
      case 'quarterly':
        dateFilter = {
          'period.startDate': {
            $gte: new Date(now.getFullYear() - 2, 0, 1)
          }
        };
        break;
      case 'yearly':
      default:
        dateFilter = {
          'period.startDate': {
            $gte: new Date(now.getFullYear() - 3, 0, 1)
          }
        };
        break;
    }

    const assessments = await CarbonAssessment.find({
      ...buildOrgDataFilter(req),
      ...dateFilter
    }).sort({ 'period.startDate': 1 });

    // Calculate trends
    const trends = calculateTrends(assessments, period);
    
    res.json({
      success: true,
      data: trends
    });

  } catch (error) {
    logger.error('Carbon trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon-forecasting/benchmarks
// @desc    Get industry benchmarks and comparisons
// @access  Private
router.get('/benchmarks', ...requireForecastAccess, async (req, res) => {
  try {
    const context = await loadForecastContext(req);
    if (!context) {
      return res.status(404).json({
        success: false,
        message: 'Operational profile not found'
      });
    }

    const { profile: msme } = context;

    const latestAssessment = await CarbonAssessment.findOne(buildOrgDataFilter(req))
      .sort({ 'period.startDate': -1 });

    if (!latestAssessment) {
      return res.status(404).json({
        success: false,
        message: 'No carbon assessment found'
      });
    }

    // Calculate industry benchmarks
    const benchmarks = calculateIndustryBenchmarks(msme, latestAssessment);
    
    res.json({
      success: true,
      data: benchmarks
    });

  } catch (error) {
    logger.error('Carbon benchmarks error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// Helper function to calculate trends
function calculateTrends(assessments, period) {
  if (assessments.length === 0) {
    return {
      data: [],
      summary: {
        totalAssessments: 0,
        averageCO2: 0,
        trend: 'stable',
        changePercentage: 0
      }
    };
  }

  const data = assessments.map(assessment => ({
    date: assessment.period.startDate,
    totalCO2: assessment.totalCO2Emissions,
    carbonScore: assessment.carbonScore,
    breakdown: assessment.breakdown
  }));

  // Calculate summary statistics
  const totalCO2 = data.reduce((sum, d) => sum + d.totalCO2, 0);
  const averageCO2 = totalCO2 / data.length;
  
  // Calculate trend
  const firstHalf = data.slice(0, Math.floor(data.length / 2));
  const secondHalf = data.slice(Math.floor(data.length / 2));
  
  const firstHalfAvg = firstHalf.reduce((sum, d) => sum + d.totalCO2, 0) / firstHalf.length;
  const secondHalfAvg = secondHalf.reduce((sum, d) => sum + d.totalCO2, 0) / secondHalf.length;
  
  const changePercentage = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;
  
  let trend = 'stable';
  if (Math.abs(changePercentage) > 10) {
    trend = changePercentage > 0 ? 'increasing' : 'decreasing';
  }

  return {
    data,
    summary: {
      totalAssessments: assessments.length,
      averageCO2: Math.round(averageCO2),
      trend,
      changePercentage: Math.round(changePercentage * 10) / 10,
      period
    }
  };
}

// Helper function to calculate industry benchmarks
function calculateIndustryBenchmarks(msme, assessment) {
  // Industry-specific benchmarks (kg CO2 per ₹1000 turnover)
  const industryBenchmarks = {
    manufacturing: { average: 2.5, bestInClass: 1.2, worst: 4.0 },
    textiles: { average: 3.2, bestInClass: 1.8, worst: 5.0 },
    food: { average: 1.8, bestInClass: 1.0, worst: 3.0 },
    chemicals: { average: 4.5, bestInClass: 2.8, worst: 7.0 },
    electronics: { average: 2.8, bestInClass: 1.5, worst: 4.5 },
    automotive: { average: 3.8, bestInClass: 2.2, worst: 6.0 },
    pharmaceuticals: { average: 3.5, bestInClass: 2.0, worst: 5.5 }
  };

  // Company size multipliers
  const sizeMultipliers = {
    micro: 1.2,
    small: 1.0,
    medium: 0.8
  };

  const baseBenchmark = industryBenchmarks[msme.industry] || industryBenchmarks.manufacturing;
  const sizeMultiplier = sizeMultipliers[msme.companyType] || 1.0;

  const industryAverage = baseBenchmark.average * sizeMultiplier;
  const bestInClass = baseBenchmark.bestInClass * sizeMultiplier;
  const worstInClass = baseBenchmark.worst * sizeMultiplier;

  // Calculate MSME's performance
  const msmeIntensity = assessment.totalCO2Emissions / (msme.business.annualTurnover / 1000);
  
  let performance = 'average';
  if (msmeIntensity <= bestInClass * 1.1) {
    performance = 'excellent';
  } else if (msmeIntensity <= industryAverage * 0.9) {
    performance = 'good';
  } else if (msmeIntensity >= worstInClass * 0.9) {
    performance = 'poor';
  }

  return {
    msmeIntensity: Math.round(msmeIntensity * 100) / 100,
    industryAverage: Math.round(industryAverage * 100) / 100,
    bestInClass: Math.round(bestInClass * 100) / 100,
    worstInClass: Math.round(worstInClass * 100) / 100,
    performance,
    industry: msme.industry,
    companyType: msme.companyType,
    recommendations: generateBenchmarkRecommendations(msmeIntensity, industryAverage, bestInClass)
  };
}

// Helper function to generate benchmark recommendations
function generateBenchmarkRecommendations(msmeIntensity, industryAverage, bestInClass) {
  const recommendations = [];

  if (msmeIntensity > industryAverage) {
    recommendations.push({
      type: 'improvement',
      title: 'Above Industry Average',
      description: `Your carbon intensity is ${((msmeIntensity / industryAverage - 1) * 100).toFixed(1)}% above industry average. Focus on energy efficiency and waste reduction.`,
      priority: 'high'
    });
  }

  if (msmeIntensity > bestInClass * 1.5) {
    recommendations.push({
      type: 'excellence',
      title: 'Path to Best-in-Class',
      description: `You can reduce your carbon intensity by ${((msmeIntensity / bestInClass - 1) * 100).toFixed(1)}% to reach best-in-class performance.`,
      priority: 'medium'
    });
  }

  if (msmeIntensity <= bestInClass * 1.1) {
    recommendations.push({
      type: 'achievement',
      title: 'Best-in-Class Performance',
      description: 'Congratulations! You are performing at or near best-in-class levels for your industry.',
      priority: 'low'
    });
  }

  return recommendations;
}

module.exports = router;