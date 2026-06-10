const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const AIDataExtractionService = require('../services/aiDataExtractionService');
const carbonCalculationService = require('../services/carbonCalculationService');
const IntelligentPatternRecognitionService = require('../services/intelligentPatternRecognitionService');
const AICarbonScoringService = require('../services/aiCarbonScoringService');
const carbonRating = require('../../../shared/carbonRating');
const realTimeMonitoring = require('../services/realTimeMonitoringInstance');
const orchestrationManagerEventService = require('../services/orchestrationManagerEventService');
const MSME = require('../models/MSME');
const CarbonAssessment = require('../models/CarbonAssessment');
const auth = require('../middleware/auth');
const { resolveAuthorizedMsmeId } = require('../utils/msmeAuthorization');
const logger = require('../utils/logger');
const { createOrchestrationEventEmitter } = require('../utils/orchestrationEvents');

// Initialize services
const aiDataExtraction = new AIDataExtractionService();
const advancedCarbonCalculation = carbonCalculationService.getAdvancedCalculationService();
const patternRecognition = new IntelligentPatternRecognitionService();
const carbonScoring = new AICarbonScoringService();

const emitOrchestrationEvent = createOrchestrationEventEmitter(
  orchestrationManagerEventService,
  'ai-carbon-analysis'
);

const mapAdvancedScopeBreakdownToESGScopes = (scopeBreakdown = {}) => {
  const scope1CO2 = Number(scopeBreakdown?.scope1?.co2) || 0;
  const scope2CO2 = Number(scopeBreakdown?.scope2?.co2) || 0;
  const scope3CO2 = Number(scopeBreakdown?.scope3?.co2) || 0;

  return {
    scope1: {
      total: scope1CO2,
      breakdown: {
        directFuel: Number(scopeBreakdown?.scope1?.breakdown?.directFuel) || scope1CO2,
        directTransport: Number(scopeBreakdown?.scope1?.breakdown?.directTransport) || 0,
        directManufacturing: Number(scopeBreakdown?.scope1?.breakdown?.directManufacturing) || 0,
        fugitiveEmissions: 0
      },
      description: 'Direct emissions from owned or controlled sources'
    },
    scope2: {
      total: scope2CO2,
      breakdown: {
        electricity: Number(scopeBreakdown?.scope2?.breakdown?.electricity) || scope2CO2,
        heating: Number(scopeBreakdown?.scope2?.breakdown?.heating) || 0,
        cooling: Number(scopeBreakdown?.scope2?.breakdown?.cooling) || 0,
        steam: Number(scopeBreakdown?.scope2?.breakdown?.steam) || 0
      },
      description: 'Indirect emissions from purchased energy'
    },
    scope3: {
      total: scope3CO2,
      breakdown: {
        purchasedGoods: Number(scopeBreakdown?.scope3?.breakdown?.purchasedGoods) || 0,
        transportation: Number(scopeBreakdown?.scope3?.breakdown?.transportation) || 0,
        wasteDisposal: Number(scopeBreakdown?.scope3?.breakdown?.wasteDisposal) || 0,
        businessTravel: 0,
        employeeCommuting: 0,
        leasedAssets: 0,
        investments: 0,
        other: Number(scopeBreakdown?.scope3?.breakdown?.other) || 0
      },
      description: 'All other indirect emissions in the value chain'
    }
  };
};

const authenticateToken = auth;

// AI Data Extraction Endpoints

// Backwards-compatible single endpoint expected by legacy clients.
router.post('/extract', authenticateToken, async (req, res) => {
  try {
    const { smsData, emailData, text, source = 'unknown' } = req.body || {};

    if (Array.isArray(smsData)) {
      const results = await aiDataExtraction.processSMSData(smsData);
      return res.json({
        success: true,
        data: results,
        message: 'SMS data processed successfully'
      });
    }

    if (Array.isArray(emailData)) {
      const results = await aiDataExtraction.processEmailData(emailData);
      return res.json({
        success: true,
        data: results,
        message: 'Email data processed successfully'
      });
    }

    if (text) {
      const result = await aiDataExtraction.extractCarbonDataFromText(text, source);
      return res.json({
        success: true,
        data: result,
        message: 'Text processed successfully'
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Provide smsData[], emailData[] or text'
    });
  } catch (error) {
    logger.error('Error processing extract request:', error);
    return res.status(500).json({ error: 'Failed to process extract request' });
  }
});

// Extract carbon data from SMS
router.post('/extract/sms', authenticateToken, async (req, res) => {
  try {
    const { smsData } = req.body;
    
    if (!smsData || !Array.isArray(smsData)) {
      return res.status(400).json({ error: 'SMS data array is required' });
    }

    const results = await aiDataExtraction.processSMSData(smsData);
    
    res.json({
      success: true,
      data: results,
      message: 'SMS data processed successfully'
    });

  } catch (error) {
    logger.error('Error processing SMS data:', error);
    res.status(500).json({ error: 'Failed to process SMS data' });
  }
});

// Extract carbon data from emails
router.post('/extract/email', authenticateToken, async (req, res) => {
  try {
    const { emailData } = req.body;
    
    if (!emailData || !Array.isArray(emailData)) {
      return res.status(400).json({ error: 'Email data array is required' });
    }

    const results = await aiDataExtraction.processEmailData(emailData);
    
    res.json({
      success: true,
      data: results,
      message: 'Email data processed successfully'
    });

  } catch (error) {
    logger.error('Error processing email data:', error);
    res.status(500).json({ error: 'Failed to process email data' });
  }
});

// Extract carbon data from any text
router.post('/extract/text', authenticateToken, async (req, res) => {
  try {
    const { text, source = 'unknown' } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text content is required' });
    }

    const result = await aiDataExtraction.extractCarbonDataFromText(text, source);
    
    res.json({
      success: true,
      data: result,
      message: 'Text processed successfully'
    });

  } catch (error) {
    logger.error('Error processing text:', error);
    res.status(500).json({ error: 'Failed to process text' });
  }
});

// Advanced Carbon Calculation Endpoints

// Calculate advanced carbon footprint
router.post('/calculate/advanced', authenticateToken, async (req, res) => {
  try {
    const { extractedData, msmeId: requestedMsmeId } = req.body;
    
    if (!extractedData) {
      return res.status(400).json({ error: 'Extracted data is required' });
    }

    const access = resolveAuthorizedMsmeId(req, requestedMsmeId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const { msmeId } = access;

    // Get MSME profile
    const msmeProfile = await MSME.findById(msmeId);
    if (!msmeProfile) {
      return res.status(404).json({ error: 'MSME not found' });
    }

    const calculation = await advancedCarbonCalculation.calculateAdvancedCarbonFootprint(
      extractedData, 
      msmeProfile
    );

    // Save calculation to database
    const carbonAssessment = new CarbonAssessment({
      msmeId,
      assessmentType: 'automatic',
      period: {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        endDate: new Date()
      },
      totalCO2Emissions: calculation.totalCO2Emissions,
      breakdown: calculation.breakdown,
      esgScopes: mapAdvancedScopeBreakdownToESGScopes(calculation.scopeBreakdown),
      industryAdjustment: calculation.industryAdjustment,
      carbonScore: calculation.carbonScore,
      sustainabilityRating: calculation.sustainabilityRating,
      mlInsights: calculation.mlInsights,
      recommendations: calculation.recommendations
    });

    await carbonAssessment.save();

    emitOrchestrationEvent('carbon.advanced_calculation.completed', {
      msmeId,
      carbonAssessmentId: carbonAssessment._id?.toString(),
      carbonData: calculation
    });

    res.json({
      success: true,
      data: calculation,
      message: 'Advanced carbon footprint calculated successfully'
    });

  } catch (error) {
    logger.error('Error calculating advanced carbon footprint:', error);
    res.status(500).json({ error: 'Failed to calculate carbon footprint' });
  }
});

// Predict future emissions
router.post('/predict/emissions', authenticateToken, async (req, res) => {
  try {
    const { msmeId: requestedMsmeId, timeHorizon = 12 } = req.body;
    const access = resolveAuthorizedMsmeId(req, requestedMsmeId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const { msmeId } = access;

    // Get historical data
    const historicalData = await CarbonAssessment.find({ msmeId })
      .sort({ 'period.endDate': -1 })
      .limit(12)
      .select('totalCO2Emissions period.endDate');

    const predictions = await advancedCarbonCalculation.predictFutureEmissions(
      historicalData, 
      timeHorizon
    );

    emitOrchestrationEvent('carbon.emissions.predicted', {
      msmeId,
      timeHorizon,
      predictions
    });

    res.json({
      success: true,
      data: predictions,
      message: 'Future emissions predicted successfully'
    });

  } catch (error) {
    logger.error('Error predicting future emissions:', error);
    res.status(500).json({ error: 'Failed to predict future emissions' });
  }
});

// Pattern Recognition Endpoints

// Analyze business activities from text
router.post('/analyze/activities', authenticateToken, async (req, res) => {
  try {
    const { text, source = 'unknown' } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text content is required' });
    }

    const analysis = await patternRecognition.analyzeBusinessActivity(text, source);
    
    res.json({
      success: true,
      data: analysis,
      message: 'Business activities analyzed successfully'
    });

  } catch (error) {
    logger.error('Error analyzing business activities:', error);
    res.status(500).json({ error: 'Failed to analyze business activities' });
  }
});

// Analyze multiple text patterns
router.post('/analyze/patterns', authenticateToken, async (req, res) => {
  try {
    const { texts } = req.body;
    
    if (!texts || !Array.isArray(texts)) {
      return res.status(400).json({ error: 'Texts array is required' });
    }

    const results = await patternRecognition.analyzeTextPatterns(texts);
    
    res.json({
      success: true,
      data: results,
      message: 'Text patterns analyzed successfully'
    });

  } catch (error) {
    logger.error('Error analyzing text patterns:', error);
    res.status(500).json({ error: 'Failed to analyze text patterns' });
  }
});

// Detect anomalies
router.post('/detect/anomalies', authenticateToken, async (req, res) => {
  try {
    const { msmeId: requestedMsmeId, currentData } = req.body;
    
    if (!currentData) {
      return res.status(400).json({ error: 'Current data is required' });
    }

    const access = resolveAuthorizedMsmeId(req, requestedMsmeId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const { msmeId } = access;

    // Get historical data
    const historicalData = await CarbonAssessment.find({ msmeId })
      .sort({ 'period.endDate': -1 })
      .limit(10)
      .select('totalCO2Emissions breakdown period.endDate');

    const anomalies = await patternRecognition.detectAnomalies(historicalData, currentData);

    emitOrchestrationEvent('carbon.anomalies.detected', {
      msmeId,
      anomalies,
      currentData
    });
    
    res.json({
      success: true,
      data: anomalies,
      message: 'Anomalies detected successfully'
    });

  } catch (error) {
    logger.error('Error detecting anomalies:', error);
    res.status(500).json({ error: 'Failed to detect anomalies' });
  }
});

// AI Carbon Scoring Endpoints

// Calculate AI carbon score
router.post('/score/calculate', authenticateToken, async (req, res) => {
  try {
    const { carbonData, msmeId: requestedMsmeId } = req.body;
    
    if (!carbonData) {
      return res.status(400).json({ error: 'Carbon data is required' });
    }

    const access = resolveAuthorizedMsmeId(req, requestedMsmeId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const { msmeId } = access;

    // Get MSME profile
    const msmeProfile = await MSME.findById(msmeId);
    if (!msmeProfile) {
      return res.status(404).json({ error: 'MSME not found' });
    }

    // Get historical data for trend analysis
    const historicalData = await CarbonAssessment.find({ msmeId })
      .sort({ 'period.endDate': -1 })
      .limit(6)
      .select('totalCO2Emissions breakdown carbonScore sustainabilityRating period.endDate');

    const score = await carbonScoring.calculateAICarbonScore(
      carbonData, 
      msmeProfile, 
      historicalData
    );

    emitOrchestrationEvent('carbon.score.calculated', {
      msmeId,
      score
    });

    res.json({
      success: true,
      data: score,
      message: 'AI carbon score calculated successfully'
    });

  } catch (error) {
    logger.error('Error calculating AI carbon score:', error);
    res.status(500).json({ error: 'Failed to calculate AI carbon score' });
  }
});

// Generate sustainability report
router.post('/report/sustainability', authenticateToken, async (req, res) => {
  try {
    const { msmeId: requestedMsmeId, carbonData, predictions } = req.body;
    
    if (!carbonData) {
      return res.status(400).json({ error: 'Carbon data is required' });
    }

    const access = resolveAuthorizedMsmeId(req, requestedMsmeId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const { msmeId } = access;

    // Get MSME profile
    const msmeProfile = await MSME.findById(msmeId);
    if (!msmeProfile) {
      return res.status(404).json({ error: 'MSME not found' });
    }

    const score = await carbonScoring.calculateAICarbonScore(
      carbonData,
      msmeProfile
    );

    const report = await carbonScoring.generateSustainabilityReport(
      score,
      msmeProfile
    );

    emitOrchestrationEvent('carbon.sustainability_report.generated', {
      msmeId,
      report
    });

    res.json({
      success: true,
      data: report,
      message: 'Sustainability report generated successfully'
    });

  } catch (error) {
    logger.error('Error generating sustainability report:', error);
    res.status(500).json({ error: 'Failed to generate sustainability report' });
  }
});

// Real-time Monitoring Endpoints

// Start monitoring
router.post('/monitoring/start', authenticateToken, async (req, res) => {
  try {
    const { msmeId: requestedMsmeId, options = {} } = req.body;
    const access = resolveAuthorizedMsmeId(req, requestedMsmeId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const { msmeId } = access;

    const sessionId = await realTimeMonitoring.startMonitoring(msmeId, options);
    
    res.json({
      success: true,
      data: { sessionId },
      message: 'Monitoring started successfully'
    });

  } catch (error) {
    logger.error('Error starting monitoring:', error);
    res.status(500).json({ error: 'Failed to start monitoring' });
  }
});

// Stop monitoring
router.post('/monitoring/stop', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    await realTimeMonitoring.stopMonitoring(sessionId);
    
    res.json({
      success: true,
      message: 'Monitoring stopped successfully'
    });

  } catch (error) {
    logger.error('Error stopping monitoring:', error);
    res.status(500).json({ error: 'Failed to stop monitoring' });
  }
});

// Update carbon data for monitoring
router.post('/monitoring/update', authenticateToken, async (req, res) => {
  try {
    const { msmeId: requestedMsmeId, carbonData } = req.body;
    
    if (!carbonData) {
      return res.status(400).json({ error: 'Carbon data is required' });
    }

    const access = resolveAuthorizedMsmeId(req, requestedMsmeId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const { msmeId } = access;

    await realTimeMonitoring.updateCarbonData(msmeId, carbonData);
    
    res.json({
      success: true,
      message: 'Carbon data updated successfully'
    });

  } catch (error) {
    logger.error('Error updating carbon data:', error);
    res.status(500).json({ error: 'Failed to update carbon data' });
  }
});

// Get monitoring status
router.get('/monitoring/status/:msmeId', authenticateToken, async (req, res) => {
  try {
    const access = resolveAuthorizedMsmeId(req, req.params.msmeId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const { msmeId } = access;
    
    const status = realTimeMonitoring.getMonitoringStatus(msmeId);
    
    res.json({
      success: true,
      data: status,
      message: 'Monitoring status retrieved successfully'
    });

  } catch (error) {
    logger.error('Error getting monitoring status:', error);
    res.status(500).json({ error: 'Failed to get monitoring status' });
  }
});

// Get alert history
router.get('/monitoring/alerts/:msmeId', authenticateToken, async (req, res) => {
  try {
    const access = resolveAuthorizedMsmeId(req, req.params.msmeId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const { msmeId } = access;
    const { limit = 50 } = req.query;
    
    const alerts = realTimeMonitoring.getAlertHistory(msmeId, parseInt(limit));
    
    res.json({
      success: true,
      data: alerts,
      message: 'Alert history retrieved successfully'
    });

  } catch (error) {
    logger.error('Error getting alert history:', error);
    res.status(500).json({ error: 'Failed to get alert history' });
  }
});

// Get trend analysis
router.get('/monitoring/trends/:msmeId', authenticateToken, async (req, res) => {
  try {
    const access = resolveAuthorizedMsmeId(req, req.params.msmeId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const { msmeId } = access;
    
    const trends = realTimeMonitoring.getTrendAnalysis(msmeId);
    
    res.json({
      success: true,
      data: trends,
      message: 'Trend analysis retrieved successfully'
    });

  } catch (error) {
    logger.error('Error getting trend analysis:', error);
    res.status(500).json({ error: 'Failed to get trend analysis' });
  }
});

// Get predictions
router.get('/monitoring/predictions/:msmeId', authenticateToken, async (req, res) => {
  try {
    const access = resolveAuthorizedMsmeId(req, req.params.msmeId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const { msmeId } = access;
    
    const predictions = realTimeMonitoring.getPredictions(msmeId);
    
    res.json({
      success: true,
      data: predictions,
      message: 'Predictions retrieved successfully'
    });

  } catch (error) {
    logger.error('Error getting predictions:', error);
    res.status(500).json({ error: 'Failed to get predictions' });
  }
});

// Update alert thresholds
router.put('/monitoring/thresholds', authenticateToken, async (req, res) => {
  try {
    const { sessionId, thresholds } = req.body;
    
    if (!sessionId || !thresholds) {
      return res.status(400).json({ error: 'Session ID and thresholds are required' });
    }

    realTimeMonitoring.updateAlertThresholds(sessionId, thresholds);
    
    res.json({
      success: true,
      message: 'Alert thresholds updated successfully'
    });

  } catch (error) {
    logger.error('Error updating alert thresholds:', error);
    res.status(500).json({ error: 'Failed to update alert thresholds' });
  }
});

// Get system status
router.get('/system/status', authenticateToken, async (req, res) => {
  try {
    const status = realTimeMonitoring.getSystemStatus();
    
    res.json({
      success: true,
      data: status,
      message: 'System status retrieved successfully'
    });

  } catch (error) {
    logger.error('Error getting system status:', error);
    res.status(500).json({ error: 'Failed to get system status' });
  }
});

// Comprehensive Analysis Endpoint

// Complete AI analysis pipeline
router.post('/analyze/complete', authenticateToken, async (req, res) => {
  try {
    const { msmeId: requestedMsmeId, smsData = [], emailData = [], textData = [] } = req.body;
    const access = resolveAuthorizedMsmeId(req, requestedMsmeId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const { msmeId } = access;

    // Get MSME profile
    const msmeProfile = await MSME.findById(msmeId);
    if (!msmeProfile) {
      return res.status(404).json({ error: 'MSME not found' });
    }

    const results = {
      dataExtraction: {},
      carbonCalculation: {},
      patternAnalysis: {},
      carbonScoring: {},
      recommendations: [],
      insights: []
    };

    // Step 1: Extract data from all sources
    if (smsData.length > 0) {
      results.dataExtraction.sms = await aiDataExtraction.processSMSData(smsData);
    }
    
    if (emailData.length > 0) {
      results.dataExtraction.email = await aiDataExtraction.processEmailData(emailData);
    }
    
    if (textData.length > 0) {
      results.dataExtraction.text = await Promise.all(
        textData.map(text => aiDataExtraction.extractCarbonDataFromText(text.content, text.source))
      );
    }

    // Step 2: Aggregate extracted data
    const aggregatedData = aggregateExtractedData(results.dataExtraction);

    // Step 3: Calculate advanced carbon footprint
    results.carbonCalculation = await advancedCarbonCalculation.calculateAdvancedCarbonFootprint(
      aggregatedData, 
      msmeProfile
    );

    // Step 4: Analyze patterns
    const allTexts = [
      ...smsData.map(sms => ({ content: sms.message, source: 'sms' })),
      ...emailData.map(email => ({ content: email.content, source: 'email' })),
      ...textData
    ];

    if (allTexts.length > 0) {
      results.patternAnalysis = await patternRecognition.analyzeTextPatterns(allTexts);
    }

    // Step 5: Calculate AI carbon score
    results.carbonScoring = await carbonScoring.calculateAICarbonScore(
      results.carbonCalculation, 
      msmeProfile
    );

    // Step 6: Generate comprehensive recommendations
    results.recommendations = [
      ...results.carbonCalculation.recommendations,
      ...results.carbonScoring.recommendations
    ];

    // Step 7: Generate insights
    results.insights = [
      ...results.carbonCalculation.mlInsights,
      ...results.carbonScoring.insights
    ];

    // Save results to database
    const carbonAssessment = new CarbonAssessment({
      msmeId,
      assessmentType: 'ai_comprehensive',
      period: {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date()
      },
      totalCO2Emissions: results.carbonCalculation.totalCO2Emissions,
      breakdown: results.carbonCalculation.breakdown,
      esgScopes: mapAdvancedScopeBreakdownToESGScopes(results.carbonCalculation.scopeBreakdown),
      carbonScore: results.carbonScoring.overall,
      sustainabilityRating: results.carbonScoring.overallRating
        || carbonRating.getRating(results.carbonScoring.overall),
      mlInsights: results.insights,
      recommendations: results.recommendations,
      aiAnalysis: results
    });

    await carbonAssessment.save();

    emitOrchestrationEvent('carbon.analysis.completed', {
      msmeId,
      carbonAssessmentId: carbonAssessment._id?.toString(),
      carbonData: results.carbonCalculation,
      carbonScore: results.carbonScoring?.overall
    });

    res.json({
      success: true,
      data: results,
      message: 'Complete AI analysis performed successfully'
    });

  } catch (error) {
    logger.error('Error performing complete AI analysis:', error);
    res.status(500).json({ error: 'Failed to perform complete AI analysis' });
  }
});

// Helper function to aggregate extracted data
function aggregateExtractedData(dataExtraction) {
  const aggregated = {
    energy: { electricity: { consumption: 0 }, fuel: { consumption: 0 }, renewable: { percentage: 0 } },
    materials: { rawMaterials: { quantity: 0 }, packaging: { quantity: 0 } },
    transportation: { distance: 0, fuelConsumption: 0 },
    waste: { solid: { quantity: 0 }, hazardous: { quantity: 0 } },
    water: { consumption: 0 }
  };

  // Aggregate data from all sources
  Object.values(dataExtraction).forEach(sourceData => {
    if (Array.isArray(sourceData)) {
      sourceData.forEach(item => {
        if (item.analysis && item.analysis.extractedData) {
          const data = item.analysis.extractedData;
          
          // Aggregate energy data
          if (data.energy) {
            aggregated.energy.electricity.consumption += data.energy.electricity?.consumption || 0;
            aggregated.energy.fuel.consumption += data.energy.fuel?.consumption || 0;
            aggregated.energy.renewable.percentage = Math.max(
              aggregated.energy.renewable.percentage, 
              data.energy.renewable?.percentage || 0
            );
          }
          
          // Aggregate material data
          if (data.materials) {
            aggregated.materials.rawMaterials.quantity += data.materials.rawMaterials?.quantity || 0;
            aggregated.materials.packaging.quantity += data.materials.packaging?.quantity || 0;
          }
          
          // Aggregate transportation data
          if (data.transportation) {
            aggregated.transportation.distance += data.transportation.distance || 0;
            aggregated.transportation.fuelConsumption += data.transportation.fuelConsumption || 0;
          }
          
          // Aggregate waste data
          if (data.waste) {
            aggregated.waste.solid.quantity += data.waste.solid?.quantity || 0;
            aggregated.waste.hazardous.quantity += data.waste.hazardous?.quantity || 0;
          }
          
          // Aggregate water data
          if (data.water) {
            aggregated.water.consumption += data.water.consumption || 0;
          }
        }
      });
    }
  });

  return aggregated;
}

module.exports = router;
