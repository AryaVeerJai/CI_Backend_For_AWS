const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const CarbonAssessment = require('../models/CarbonAssessment');
const Transaction = require('../models/Transaction');
const MSME = require('../models/MSME');
const {
  normalizeStoredRecommendations,
  resolveAnalyticsRecommendations
} = require('../services/carbonAnalyticsRecommendationsService');
const carbonCalculationService = require('../services/carbonCalculationService');
const carbonCreditsService = require('../services/carbonCreditsService');
const documentProcessingService = require('../services/documentProcessingService');
const aiAgentService = require('../services/aiAgentService');
const AIAgent = require('../models/AIAgent');
const logger = require('../utils/logger');
const granularCategoryEmissionsService = require('../services/granularCategoryEmissionsService');
const { aggregateInventoryMetadata } = require('../../../shared/carbonEmissionAnalytics');
const { buildOrgDataFilter, getOrgScope, withOrgPayload, mergeOrgFilter } = require('../utils/orgDataScope');
const {
  normalizeDocumentBulkPeriodType,
  periodWiseKeyFromApiType,
  extractPeriodGroupsFromAssessment,
  buildPeriodSummaryPayload
} = require('../utils/documentBulkPeriodSummary');
const { getOperationalProfile } = require('../services/organizationProfileService');
const requireCarbonAccess = [
  auth,
  auth.requireRole('msme', 'enterprise'),
  auth.requireOrganizationProfile
];

const toAnalyticsNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const monthPeriodFromTransactionDate = (dateValue) => {
  if (!dateValue) return null;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const buildScopeMonthlyStackFromTransactions = (transactions) => {
  const map = new Map();
  (Array.isArray(transactions) ? transactions : []).forEach((t) => {
    const key = monthPeriodFromTransactionDate(t?.date);
    if (!key) return;
    const b = t?.carbonFootprint?.emissionBreakdown || {};
    const cur = map.get(key) || { period: key, scope1: 0, scope2: 0, scope3: 0 };
    cur.scope1 += toAnalyticsNumber(b.scope1);
    cur.scope2 += toAnalyticsNumber(b.scope2);
    cur.scope3 += toAnalyticsNumber(b.scope3);
    map.set(key, cur);
  });
  return Array.from(map.values())
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-24)
    .map((row) => {
      const [y, m] = row.period.split('-').map(Number);
      const label =
        !y || !m
          ? row.period
          : new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
      const total = row.scope1 + row.scope2 + row.scope3;
      return { ...row, label, total };
    });
};

const buildCo2Histogram = (transactions, bucketCount = 8) => {
  const emissions = (Array.isArray(transactions) ? transactions : [])
    .map((t) => toAnalyticsNumber(t?.carbonFootprint?.co2Emissions))
    .filter((e) => e > 0);
  if (emissions.length === 0) {
    return { buckets: [], min: 0, max: 0, sampleSize: 0 };
  }
  const min = Math.min(...emissions);
  const max = Math.max(...emissions);
  if (min === max) {
    return {
      buckets: [{ label: `${min.toFixed(2)} kg CO₂e`, min, max, count: emissions.length }],
      min,
      max,
      sampleSize: emissions.length
    };
  }
  const step = (max - min) / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    label: `${(min + i * step).toFixed(1)}–${(min + (i + 1) * step).toFixed(1)} kg CO₂e`,
    min: min + i * step,
    max: min + (i + 1) * step,
    count: 0
  }));
  emissions.forEach((e) => {
    let idx = Math.floor((e - min) / step);
    if (idx >= bucketCount) {
      idx = bucketCount - 1;
    }
    if (idx < 0) {
      idx = 0;
    }
    buckets[idx].count += 1;
  });
  return { buckets, min, max, sampleSize: emissions.length };
};

const flattenStoredAssessmentBreakdown = (b) => {
  if (!b || typeof b !== 'object') {
    return [];
  }
  const rows = [];
  const push = (label, co2) => {
    const v = toAnalyticsNumber(co2);
    if (v > 0) {
      rows.push({ label, co2: v });
    }
  };
  const energyTotal = toAnalyticsNumber(b.energy?.total);
  const energyParts =
    toAnalyticsNumber(b.energy?.electricity?.co2Emissions) + toAnalyticsNumber(b.energy?.fuel?.co2Emissions);
  push('Energy', energyTotal > 0 ? energyTotal : energyParts);
  push('Water', b.water?.co2Emissions);
  const wasteTotal = toAnalyticsNumber(b.waste?.total);
  const wasteParts =
    toAnalyticsNumber(b.waste?.solid?.co2Emissions) + toAnalyticsNumber(b.waste?.hazardous?.co2Emissions);
  push('Waste', wasteTotal > 0 ? wasteTotal : wasteParts);
  push('Transportation', b.transportation?.co2Emissions);
  push('Materials', b.materials?.co2Emissions);
  push('Manufacturing', b.manufacturing?.co2Emissions);
  return rows.sort((a, x) => x.co2 - a.co2);
};

const buildComplianceSnapshot = ({
  totalCO2,
  carbonScore,
  latestAssessment,
  txns,
  recommendationCount = 0
}) => {
  const hasAssessment = !!latestAssessment;
  const scoreOk = carbonScore >= 50;
  const footprintDocumented = hasAssessment && totalCO2 > 0;
  const dataCoverage = txns.length >= 5;
  const storedCount = Array.isArray(latestAssessment?.recommendations)
    ? latestAssessment.recommendations.length
    : 0;
  const resolvedCount = recommendationCount > 0 ? recommendationCount : storedCount;
  const improvementPipeline = resolvedCount > 0;

  const checks = [
    {
      id: 'footprint-record',
      label: 'Carbon footprint on record',
      status: footprintDocumented ? 'pass' : 'attention',
      detail: footprintDocumented
        ? `Latest total ${totalCO2.toFixed(1)} kg CO₂e in assessments`
        : 'Complete or sync an assessment to establish a baseline'
    },
    {
      id: 'transaction-coverage',
      label: 'Operational data coverage',
      status: dataCoverage ? 'pass' : 'attention',
      detail: dataCoverage
        ? `${txns.length} recent transactions available for hotspot analysis`
        : 'Import or classify more transactions for granular charts'
    },
    {
      id: 'performance-score',
      label: 'Carbon performance score',
      status: !hasAssessment ? 'attention' : scoreOk ? 'pass' : 'attention',
      detail: hasAssessment
        ? `Score ${Math.round(carbonScore)}/100 (${scoreOk ? 'meets' : 'below'} internal threshold)`
        : 'Score available after assessment'
    },
    {
      id: 'improvement-plan',
      label: 'Improvement backlog',
      status: improvementPipeline ? 'pass' : 'attention',
      detail: improvementPipeline
        ? `${resolvedCount} recommendation(s) available for your workspace`
        : 'Generate recommendations from assessment or AI review'
    }
  ];

  const passCount = checks.filter((c) => c.status === 'pass').length;
  return {
    checks,
    summary: `${passCount}/${checks.length} readiness checks passing`,
    readinessPercent: Math.round((passCount / checks.length) * 100)
  };
};

// @route   POST /api/carbon/assess
// @desc    Perform carbon footprint assessment
// @access  Private
router.post('/assess', requireCarbonAccess, async (req, res) => {
  try {
    const {
      assessmentType = 'automatic',
      startDate,
      endDate,
      period = 'monthly'
    } = req.body;

    const scope = getOrgScope(req);
    const msmeId = scope.msmeId;

    // Determine date range
    let dateRange;
    if (startDate && endDate) {
      dateRange = {
        startDate: new Date(startDate),
        endDate: new Date(endDate)
      };
    } else {
      // Default to last month
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

      dateRange = {
        startDate: lastMonth,
        endDate: endOfLastMonth
      };
    }

    // Get transactions for the period
    const transactions = await Transaction.find(
      mergeOrgFilter(req, {
        date: {
          $gte: dateRange.startDate,
          $lte: dateRange.endDate
        }
      })
    );

    const operational = await getOperationalProfile(req.user);
    if (!operational?.profile) {
      return res.status(404).json({
        success: false,
        message: 'Organization operational profile not found'
      });
    }
    const msmeData = operational.profile;

    // Calculate carbon footprint using AI agents if available
    let assessment;
    try {
      const carbonAnalyzerAgent = await AIAgent.findOne({ type: 'carbon_analyzer', isActive: true });

      if (carbonAnalyzerAgent) {
        // Use AI agent for enhanced analysis
        const task = await aiAgentService.createTask({
          agentId: carbonAnalyzerAgent._id,
          msmeId,
          taskType: 'carbon_analysis',
          input: { transactions, msmeData },
          priority: 'high'
        });

        // Wait for task completion (in production, this would be async)
        // Multi-agent–aligned transaction path (fuel/RAG runtime factors per transaction)
        assessment = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
          msmeData,
          transactions
        );

        // Enhance with AI insights if task completed
        if (task.status === 'completed' && task.output) {
          assessment.aiInsights = task.output.insights;
          assessment.aiRecommendations = task.output.recommendations;
          assessment.anomalies = task.output.anomalies;
        }
      } else {
        assessment = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
          msmeData,
          transactions
        );
      }
    } catch (error) {
      logger.warn('AI agent analysis failed, using traditional calculation:', error);
      assessment = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
        msmeData,
        transactions
      );
    }

    // Create carbon assessment record
    const carbonAssessment = new CarbonAssessment(withOrgPayload(req, {
      assessmentType,
      period: dateRange,
      totalCO2Emissions: assessment.totalCO2Emissions,
      breakdown: assessment.breakdown,
      esgScopes: assessment.esgScopes,
      carbonScore: assessment.carbonScore,
      recommendations: assessment.recommendations,
      transactionCount: assessment.transactionCount ?? transactions.length,
      totalAmount: assessment.totalAmount ?? assessment.totalSpend,
      status: 'completed'
    }));

    await carbonAssessment.save();

    if (typeof msmeData.save === 'function') {
      msmeData.carbonScore = assessment.carbonScore;
      msmeData.lastCarbonAssessment = new Date();
      await msmeData.save();
    } else if (scope.enterpriseId) {
      const Enterprise = require('../models/Enterprise');
      await Enterprise.findByIdAndUpdate(scope.enterpriseId, {
        carbonScore: assessment.carbonScore
      });
    }

    logger.info(`Carbon assessment completed for organization ${scope.organizationId}`, {
      assessmentId: carbonAssessment._id,
      totalCO2Emissions: assessment.totalCO2Emissions,
      carbonScore: assessment.carbonScore
    });

    res.json({
      success: true,
      message: 'Carbon assessment completed successfully',
      data: {
        assessment: carbonAssessment,
        summary: {
          totalCO2Emissions: assessment.totalCO2Emissions,
          carbonScore: assessment.carbonScore,
          recommendationsCount: assessment.recommendations.length
        }
      }
    });

  } catch (error) {
    logger.error('Carbon assessment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon/assessments
// @desc    Get carbon assessments for MSME
// @access  Private
router.get('/assessments', requireCarbonAccess, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const scope = getOrgScope(req);
    const msmeId = scope.msmeId;
    const orgFilter = buildOrgDataFilter(req);

    const query = { ...orgFilter };
    if (status) query.status = status;

    const assessments = await CarbonAssessment.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('msmeId', 'companyName')
      .lean();

    const msmeData = msmeId ? await MSME.findById(msmeId).lean() : null;
    const enrichedAssessments = await Promise.all(assessments.map(async (assessment) => {
      const periodTransactions = assessment?.period?.startDate && assessment?.period?.endDate
        ? await Transaction.find(
          mergeOrgFilter(req, {
            date: {
              $gte: assessment.period.startDate,
              $lte: assessment.period.endDate
            },
            isSpam: { $ne: true },
            isDuplicate: { $ne: true }
          })
        ).lean()
        : [];

      const enriched = msmeData
        ? carbonCalculationService.enrichAssessmentForAnalytics(assessment, msmeData, periodTransactions)
        : assessment;

      if (
        enriched
        && (!Array.isArray(enriched.recommendations) || enriched.recommendations.length === 0)
        && msmeData
      ) {
        try {
          enriched.recommendations = carbonCalculationService.generateRecommendations(enriched, msmeData);
        } catch (recommendationError) {
          logger.warn(`Unable to generate recommendations for assessment ${assessment._id}:`, recommendationError);
        }
      }

      return enriched;
    }));

    const total = await CarbonAssessment.countDocuments(query);

    res.json({
      success: true,
      data: {
        assessments: enrichedAssessments,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    logger.error('Get carbon assessments error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});


const findLatestDocumentBulkAssessment = async (orgFilter) => CarbonAssessment.findOne({
  ...orgFilter,
  $or: [
    { assessmentType: 'document_bulk' },
    { 'mobileBreakdown.source': 'document_bulk_upload' },
    { notes: /document_bulk_upload/i },
    { documentBulkSummary: { $exists: true, $ne: null } },
    { documentBatchSummary: { $exists: true, $ne: null } },
    { 'documentBulkMetrics.periodSummaries': { $exists: true, $ne: null } }
  ]
}).sort({ createdAt: -1 }).lean();

const buildPeriodSummaryFromTransactions = async (req, periodType, limit = 24) => {
  const transactions = await Transaction.find(
    mergeOrgFilter(req, {
      isSpam: { $ne: true },
      isDuplicate: { $ne: true }
    })
  )
    .sort({ date: -1 })
    .limit(5000)
    .lean();

  const periodWiseKey = periodWiseKeyFromApiType(periodType);
  const emissionsSummary = documentProcessingService.generatePeriodWiseEmissionsSummary(transactions);
  const groups = emissionsSummary?.periodWise?.[periodWiseKey] || [];
  const limitedGroups = limit > 0 ? groups.slice(-limit) : groups;

  return buildPeriodSummaryPayload({
    groups: limitedGroups,
    periodType,
    assessment: null,
    source: 'transactions'
  });
};

const getDocumentBulkAssessmentHandler = async (req, res) => {
  try {
    const orgFilter = buildOrgDataFilter(req);
    const normalizedPeriodType = normalizeDocumentBulkPeriodType(req.query.periodType);
    const limit = Math.max(0, toAnalyticsNumber(req.query.limit) || 24);

    const assessment = await findLatestDocumentBulkAssessment(orgFilter);
    let periodGroups = extractPeriodGroupsFromAssessment(assessment, normalizedPeriodType);

    if (limit > 0 && periodGroups.length > limit) {
      periodGroups = periodGroups.slice(-limit);
    }

    let periodSummary;
    if (periodGroups.length > 0) {
      periodSummary = buildPeriodSummaryPayload({
        groups: periodGroups,
        periodType: normalizedPeriodType,
        assessment,
        source: 'assessment'
      });
    } else {
      periodSummary = await buildPeriodSummaryFromTransactions(req, normalizedPeriodType, limit);
    }

    const hasPeriodData =
      (Array.isArray(periodSummary?.groups) && periodSummary.groups.length > 0) ||
      toAnalyticsNumber(periodSummary?.totalTransactions) > 0 ||
      toAnalyticsNumber(periodSummary?.totalEmissions) > 0;

    if (!assessment && !hasPeriodData) {
      return res.status(404).json({
        success: false,
        message: 'No document bulk assessment found'
      });
    }

    return res.json({
      success: true,
      data: {
        assessmentId: assessment?._id || null,
        generatedAt: assessment?.createdAt || new Date(),
        periodType: normalizedPeriodType,
        summary: periodSummary,
        metrics: assessment?.documentBulkMetrics || null,
        assessment: assessment || null
      }
    });
  } catch (error) {
    logger.error('Get document bulk assessment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
};

// @route   GET /api/carbon/assessments/document-bulk
// @desc    Alias for document-bulk-assessment (legacy client path)
// @access  Private
router.get('/assessments/document-bulk', requireCarbonAccess, getDocumentBulkAssessmentHandler);

// @route   GET /api/carbon/assessments/:id
// @desc    Get single carbon assessment
// @access  Private
router.get('/assessments/:id', requireCarbonAccess, async (req, res) => {
  try {
    const assessment = await CarbonAssessment.findOne(
      mergeOrgFilter(req, { _id: req.params.id })
    ).populate('msmeId', 'companyName');

    if (!assessment) {
      return res.status(404).json({
        success: false,
        message: 'Carbon assessment not found'
      });
    }

    res.json({
      success: true,
      data: assessment
    });

  } catch (error) {
    logger.error('Get carbon assessment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon/dashboard
// @desc    Get carbon dashboard data
// @access  Private
router.get('/dashboard', requireCarbonAccess, async (req, res) => {
  try {
    const scope = getOrgScope(req);
    const msmeId = scope.msmeId;
    const orgFilter = buildOrgDataFilter(req);
    const periodType = String(req.query.periodType || 'monthly').toLowerCase();
    const normalizedPeriodType = normalizeDocumentBulkPeriodType(periodType);

    // Get latest assessment
    const latestAssessment = await CarbonAssessment.findOne(orgFilter)
      .sort({ createdAt: -1 });
    const msmeData = msmeId ? await MSME.findById(msmeId) : null;

    // Get monthly trends
    const monthlyAssessments = await CarbonAssessment.find(orgFilter)
      .sort({ 'period.startDate': 1 })
      .limit(12);

    // Get transaction data for current month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const currentMonthTransactions = await Transaction.find(
      mergeOrgFilter(req, {
        date: {
          $gte: startOfMonth,
          $lte: endOfMonth
        }
      })
    );

    // Calculate current month emissions
    const currentMonthEmissions = currentMonthTransactions.reduce(
      (sum, t) => sum + t.carbonFootprint.co2Emissions, 0
    );

    // Get category breakdown for current month
    const categoryBreakdown = {};
    currentMonthTransactions.forEach(transaction => {
      const category = transaction.category;
      if (!categoryBreakdown[category]) {
        categoryBreakdown[category] = {
          count: 0,
          co2Emissions: 0,
          amount: 0
        };
      }
      categoryBreakdown[category].count++;
      categoryBreakdown[category].co2Emissions += transaction.carbonFootprint.co2Emissions;
      categoryBreakdown[category].amount += transaction.amount;
    });

    // Get recent transactions (latest 5) for the card
    const recentTransactions = await Transaction.find(
      mergeOrgFilter(req, {
        isSpam: { $ne: true },
        isDuplicate: { $ne: true }
      })
    )
      .sort({ date: -1 })
      .limit(5)
      .lean();

    const assessmentPeriodTransactions = latestAssessment?.period?.startDate && latestAssessment?.period?.endDate
      ? await Transaction.find(
        mergeOrgFilter(req, {
          date: {
            $gte: latestAssessment.period.startDate,
            $lte: latestAssessment.period.endDate
          },
          isSpam: { $ne: true },
          isDuplicate: { $ne: true }
        })
      ).lean()
      : await Transaction.find(
        mergeOrgFilter(req, {
          isSpam: { $ne: true },
          isDuplicate: { $ne: true }
        })
      ).lean();

    const enrichedLatestAssessment = latestAssessment && msmeData
      ? carbonCalculationService.enrichAssessmentForAnalytics(
        latestAssessment,
        msmeData,
        assessmentPeriodTransactions
      )
      : latestAssessment;

    const liveTransactionEmissionsKg = assessmentPeriodTransactions.reduce(
      (sum, transaction) => sum + Number(transaction?.carbonFootprint?.co2Emissions || 0),
      0
    );
    const assessmentEmissionsKg = Number(enrichedLatestAssessment?.totalCO2Emissions)
      || Number(latestAssessment?.totalCO2Emissions)
      || 0;
    const totalCO2Emissions = Math.max(assessmentEmissionsKg, liveTransactionEmissionsKg, currentMonthEmissions);

    const currentScore = carbonCalculationService.resolveCurrentCarbonScore({
      enrichedLatestAssessment,
      latestAssessment,
      msmeData,
      totalCO2Emissions,
      periodTransactions: assessmentPeriodTransactions
    });

    // Get top recommendations
    const recommendationAssessment = enrichedLatestAssessment || latestAssessment;
    let topRecommendations = recommendationAssessment && Array.isArray(recommendationAssessment.recommendations)
      ? recommendationAssessment.recommendations
      : [];
    if (topRecommendations.length === 0 && recommendationAssessment && msmeData) {
      try {
        topRecommendations = carbonCalculationService.generateRecommendations(
          recommendationAssessment,
          msmeData
        );
      } catch (recommendationError) {
        logger.warn(`Unable to generate dashboard recommendations for MSME ${msmeId}:`, recommendationError);
      }
    }
    topRecommendations = [...topRecommendations]
      .sort((a, b) => Number(b?.potentialCO2Reduction || 0) - Number(a?.potentialCO2Reduction || 0))
      .slice(0, 5);

    let greenCredits = {
      totalCredits: 0,
      availableCredits: 0,
      usedCredits: 0
    };
    if (msmeId) {
      const greenCreditsAccount = await carbonCreditsService.getMSMECredits(msmeId);
      greenCredits = carbonCreditsService.getCreditSummary(greenCreditsAccount);
    }

    // Fallback: if no transactions this month, use latest assessment data
    const effectiveEmissions = currentMonthEmissions > 0
      ? currentMonthEmissions
      : (latestAssessment?.totalCO2Emissions || 0);
    const effectiveTransactionCount = currentMonthTransactions.length > 0
      ? currentMonthTransactions.length
      : (latestAssessment?.transactionCount || 0);
    const effectiveCategoryBreakdown = Object.keys(categoryBreakdown).length > 0
      ? categoryBreakdown
      : (latestAssessment?.categoryBreakdown || {});

    const latestDocumentAssessment = await findLatestDocumentBulkAssessment(orgFilter);

    const requestedPeriodGroups = extractPeriodGroupsFromAssessment(
      latestDocumentAssessment,
      normalizedPeriodType
    );
    const requestedPeriodSummary = requestedPeriodGroups.length > 0
      ? buildPeriodSummaryPayload({
        groups: requestedPeriodGroups,
        periodType: normalizedPeriodType,
        assessment: latestDocumentAssessment,
        source: 'assessment'
      })
      : null;
    const keyData = {
      periodType: normalizedPeriodType,
      totalDocuments: latestDocumentAssessment?.documentBulkMetrics?.totalDocuments || 0,
      totalTransactions: requestedPeriodSummary?.totalTransactions
        || latestDocumentAssessment?.documentBulkMetrics?.totalTransactions
        || latestDocumentAssessment?.transactionCount
        || 0,
      totalAmount: requestedPeriodSummary?.totalAmount
        || latestDocumentAssessment?.documentBulkMetrics?.totalAmount
        || latestDocumentAssessment?.totalAmount
        || 0,
      totalEmissions: requestedPeriodSummary?.totalEmissions
        || latestDocumentAssessment?.documentBulkMetrics?.totalEmissions
        || latestDocumentAssessment?.totalCO2Emissions
        || 0,
      topCategory: (
        Array.isArray(requestedPeriodSummary?.topCategories) && requestedPeriodSummary.topCategories.length > 0
          ? requestedPeriodSummary.topCategories[0]
          : latestDocumentAssessment?.mobileBreakdown?.categoryBreakdown?.[0] || null
      )
    };

    const dashboard = {
      currentScore,
      currentMonthEmissions: effectiveEmissions,
      totalTransactions: effectiveTransactionCount,
      totalAssessments: await CarbonAssessment.countDocuments(orgFilter),
      monthlyTrend: monthlyAssessments.map(a => ({
        month: a.period.startDate.toISOString().substring(0, 7),
        co2Emissions: a.totalCO2Emissions,
        carbonScore: a.carbonScore
      })),
      categoryBreakdown: effectiveCategoryBreakdown,
      recentTransactions,
      topRecommendations,
      greenCredits,
      lastAssessmentDate: latestAssessment?.createdAt,
      nextAssessmentDue: latestAssessment ?
        new Date(latestAssessment.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000) : null,
      keyData,
      documentBulkMetrics: latestDocumentAssessment?.documentBulkMetrics || null
    };

    res.json({
      success: true,
      data: dashboard
    });

  } catch (error) {
    logger.error('Get carbon dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon/document-bulk-assessment
// @desc    Get latest document bulk emissions assessment with granular period summaries
// @access  Private
router.get('/document-bulk-assessment', requireCarbonAccess, getDocumentBulkAssessmentHandler);

// @route   PUT /api/carbon/recommendations/:id/implement
// @desc    Mark recommendation as implemented
// @access  Private
router.put('/recommendations/:id/implement', requireCarbonAccess, async (req, res) => {
  try {
    const { assessmentId, recommendationIndex } = req.body;
    const scope = getOrgScope(req);
    const msmeId = scope.msmeId;
    const orgFilter = buildOrgDataFilter(req);

    const assessment = await CarbonAssessment.findOne(
      mergeOrgFilter(req, { _id: assessmentId })
    );

    if (!assessment) {
      return res.status(404).json({
        success: false,
        message: 'Carbon assessment not found'
      });
    }

    if (recommendationIndex >= 0 && recommendationIndex < assessment.recommendations.length) {
      assessment.recommendations[recommendationIndex].isImplemented = true;
      await assessment.save();

      logger.info(`Recommendation implemented: ${assessmentId}`, {
        msmeId,
        recommendationIndex
      });

      res.json({
        success: true,
        message: 'Recommendation marked as implemented',
        data: assessment.recommendations[recommendationIndex]
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid recommendation index'
      });
    }

  } catch (error) {
    logger.error('Implement recommendation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/carbon/ai-analyze
// @desc    Perform AI-enhanced carbon analysis
// @access  Private
router.post('/ai-analyze', requireCarbonAccess, async (req, res) => {
  try {
    const {
      transactions,
      msmeData,
      analysisType = 'comprehensive',
      includeRecommendations = true,
      includeAnomalyDetection = true
    } = req.body;

    const scope = getOrgScope(req);
    const msmeId = scope.msmeId;
    const orgFilter = buildOrgDataFilter(req);

    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({
        success: false,
        message: 'Transactions data is required'
      });
    }

    // Get AI agents
    const carbonAnalyzerAgent = await AIAgent.findOne({ type: 'carbon_analyzer', isActive: true });
    const recommendationAgent = await AIAgent.findOne({ type: 'recommendation_engine', isActive: true });
    const anomalyAgent = await AIAgent.findOne({ type: 'anomaly_detector', isActive: true });

    if (!carbonAnalyzerAgent) {
      return res.status(503).json({
        success: false,
        message: 'AI carbon analyzer agent not available'
      });
    }

    const results = {
      analysisId: `ai_analysis_${Date.now()}`,
      timestamp: new Date(),
      agents: {
        carbonAnalyzer: carbonAnalyzerAgent ? 'active' : 'inactive',
        recommendationEngine: recommendationAgent ? 'active' : 'inactive',
        anomalyDetector: anomalyAgent ? 'active' : 'inactive'
      },
      results: {}
    };

    // Carbon Analysis
    try {
      const carbonTask = await aiAgentService.createTask({
        agentId: carbonAnalyzerAgent._id,
        msmeId,
        taskType: 'carbon_analysis',
        input: { transactions, msmeData },
        priority: 'high'
      });

      results.results.carbonAnalysis = {
        taskId: carbonTask.taskId,
        status: carbonTask.status,
        estimatedCompletion: new Date(Date.now() + 5 * 60 * 1000)
      };
    } catch (error) {
      logger.error('Carbon analysis task creation failed:', error);
      results.results.carbonAnalysis = {
        error: 'Failed to create carbon analysis task',
        fallback: 'Using traditional calculation'
      };
    }

    // Recommendations (if requested and agent available)
    if (includeRecommendations && recommendationAgent) {
      try {
        const recTask = await aiAgentService.createTask({
          agentId: recommendationAgent._id,
          msmeId,
          taskType: 'recommendation_generation',
          input: { transactions, msmeData },
          priority: 'medium'
        });

        results.results.recommendations = {
          taskId: recTask.taskId,
          status: recTask.status,
          estimatedCompletion: new Date(Date.now() + 3 * 60 * 1000)
        };
      } catch (error) {
        logger.error('Recommendation task creation failed:', error);
        results.results.recommendations = {
          error: 'Failed to create recommendation task'
        };
      }
    }

    // Anomaly Detection (if requested and agent available)
    if (includeAnomalyDetection && anomalyAgent) {
      try {
        const anomalyTask = await aiAgentService.createTask({
          agentId: anomalyAgent._id,
          msmeId,
          taskType: 'anomaly_detection',
          input: { transactions },
          priority: 'medium'
        });

        results.results.anomalyDetection = {
          taskId: anomalyTask.taskId,
          status: anomalyTask.status,
          estimatedCompletion: new Date(Date.now() + 2 * 60 * 1000)
        };
      } catch (error) {
        logger.error('Anomaly detection task creation failed:', error);
        results.results.anomalyDetection = {
          error: 'Failed to create anomaly detection task'
        };
      }
    }

    logger.info(`AI carbon analysis initiated for MSME ${msmeId}`, {
      analysisId: results.analysisId,
      transactionCount: transactions.length,
      agentsUsed: Object.keys(results.results).length
    });

    res.json({
      success: true,
      message: 'AI-enhanced carbon analysis initiated',
      data: results
    });

  } catch (error) {
    logger.error('AI carbon analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/carbon/ai-analytics-engine
// @desc    Run multi-agent carbon analytics synthesis engine
// @access  Private
router.post('/ai-analytics-engine', requireCarbonAccess, async (req, res) => {
  try {
    const { transactions = [] } = req.body || {};
    const scope = getOrgScope(req);
    const msmeId = scope.msmeId;
    const orgFilter = buildOrgDataFilter(req);

    const [carbonAnalyzerAgent, recommendationAgent, anomalyAgent, trendAgent] = await Promise.all([
      AIAgent.findOne({ type: 'carbon_analyzer', isActive: true }).lean(),
      AIAgent.findOne({ type: 'recommendation_engine', isActive: true }).lean(),
      AIAgent.findOne({ type: 'anomaly_detector', isActive: true }).lean(),
      AIAgent.findOne({ type: 'trend_analyzer', isActive: true }).lean()
    ]);

    const latestAssessmentRaw = await CarbonAssessment.findOne(orgFilter)
      .sort({ createdAt: -1 })
      .lean();

    const txns = Array.isArray(transactions) && transactions.length > 0
      ? transactions
      : await Transaction.find(
        mergeOrgFilter(req, {
          isSpam: { $ne: true },
          isDuplicate: { $ne: true }
        })
      ).sort({ date: -1 }).limit(150).lean();

    let msmeDataForAnalytics;
    try {
      const operational = await getOperationalProfile(req.user);
      msmeDataForAnalytics = operational?.profile;
    } catch {
      msmeDataForAnalytics = msmeId ? await MSME.findById(msmeId).lean() : null;
    }

    const latestAssessment = latestAssessmentRaw && msmeDataForAnalytics
      ? carbonCalculationService.enrichAssessmentForAnalytics(
        latestAssessmentRaw,
        msmeDataForAnalytics,
        txns
      )
      : latestAssessmentRaw;

    const categoryBreakdown = latestAssessment?.categoryBreakdown;
    const topCategoryEntry = Object.entries(
      categoryBreakdown && typeof categoryBreakdown === 'object' ? categoryBreakdown : {}
    )
      .sort(([, a], [, b]) => toAnalyticsNumber(b?.co2) - toAnalyticsNumber(a?.co2))[0];
    const topCategory = topCategoryEntry?.[0] || null;
    const topCategoryEmission = toAnalyticsNumber(topCategoryEntry?.[1]?.co2);
    const totalCO2 = toAnalyticsNumber(latestAssessment?.totalCO2Emissions);
    const carbonScore = toAnalyticsNumber(latestAssessment?.carbonScore);

    const categoryMap = {};
    txns.forEach((t) => {
      const cat = String(t?.category || 'other').toLowerCase();
      const co2 = toAnalyticsNumber(t?.carbonFootprint?.co2Emissions);
      if (!categoryMap[cat]) {
        categoryMap[cat] = { category: cat, co2: 0, count: 0 };
      }
      categoryMap[cat].co2 += co2;
      categoryMap[cat].count += 1;
    });
    const categoryFromTx = Object.values(categoryMap).sort((a, b) => b.co2 - a.co2);
    const topTxnCategory = categoryFromTx[0]?.category || null;
    const topTxnCategoryCo2 = categoryFromTx[0]?.co2 || 0;
    const displayTopCategory = topCategory || topTxnCategory;
    const displayTopCategoryEmission = topCategory ? topCategoryEmission : topTxnCategoryCo2;

    const txnTotalCo2 = txns.reduce(
      (s, t) => s + toAnalyticsNumber(t?.carbonFootprint?.co2Emissions),
      0
    );
    const pieByCategory = categoryFromTx.map((row) => ({
      key: row.category,
      label: row.category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      value: row.co2,
      count: row.count
    }));
    const pieShareDenominator = pieByCategory.reduce((s, p) => s + p.value, 0);

    let scope1 = 0;
    let scope2 = 0;
    let scope3 = 0;
    txns.forEach((t) => {
      const b = t?.carbonFootprint?.emissionBreakdown;
      scope1 += toAnalyticsNumber(b?.scope1);
      scope2 += toAnalyticsNumber(b?.scope2);
      scope3 += toAnalyticsNumber(b?.scope3);
    });
    const scopeSum = scope1 + scope2 + scope3;
    const scopeMixDenom = scopeSum > 0 ? scopeSum : txnTotalCo2;
    const scope1SharePct = scopeMixDenom > 0 && scopeSum > 0 ? (scope1 / scopeMixDenom) * 100 : 33.3;
    const scope2SharePct = scopeMixDenom > 0 && scopeSum > 0 ? (scope2 / scopeMixDenom) * 100 : 33.3;
    const scope3SharePct = scopeMixDenom > 0 && scopeSum > 0 ? (scope3 / scopeMixDenom) * 100 : 33.4;
    const dataDepthScore = Math.min(100, txns.length * 4);
    const categorySpreadScore = Math.min(100, categoryFromTx.length * 14);
    const scopeRadar = [
      { subject: 'Scope 1 mix %', value: Math.round(scope1SharePct * 10) / 10, fullMark: 100 },
      { subject: 'Scope 2 mix %', value: Math.round(scope2SharePct * 10) / 10, fullMark: 100 },
      { subject: 'Scope 3 mix %', value: Math.round(scope3SharePct * 10) / 10, fullMark: 100 },
      { subject: 'Data coverage', value: Math.round(dataDepthScore * 10) / 10, fullMark: 100 },
      { subject: 'Category breadth', value: Math.round(categorySpreadScore * 10) / 10, fullMark: 100 }
    ];

    const scoreBreakdown = latestAssessment?.scoreBreakdown || {};
    const perfRadar = [
      { subject: 'Energy efficiency', value: toAnalyticsNumber(scoreBreakdown.energyEfficiency) || carbonScore },
      { subject: 'Waste', value: toAnalyticsNumber(scoreBreakdown.wasteManagement) || carbonScore * 0.95 },
      { subject: 'Water', value: toAnalyticsNumber(scoreBreakdown.waterConservation) || carbonScore * 0.92 },
      { subject: 'Transport', value: toAnalyticsNumber(scoreBreakdown.transportation) || carbonScore * 0.9 },
      { subject: 'Materials', value: toAnalyticsNumber(scoreBreakdown.materialSourcing) || carbonScore * 0.88 },
      { subject: 'Process', value: toAnalyticsNumber(scoreBreakdown.processOptimization) || carbonScore * 0.93 },
      { subject: 'Controls', value: toAnalyticsNumber(scoreBreakdown.environmentalControls) || carbonScore * 0.91 }
    ].map((row) => ({ ...row, fullMark: 100 }));

    const stackedFromAssessment = flattenStoredAssessmentBreakdown(latestAssessment?.breakdown);
    const stackedEmissions = stackedFromAssessment.length
      ? [{ name: 'Assessment mix', ...stackedFromAssessment.reduce((acc, r) => ({ ...acc, [r.label]: r.co2 }), {}) }]
      : [];

    const hotspots = [...txns]
      .map((t, idx) => ({
        id: String(t?._id || idx),
        label: (t?.description || t?.category || `Transaction ${idx + 1}`).slice(0, 48),
        co2: toAnalyticsNumber(t?.carbonFootprint?.co2Emissions),
        category: t?.category || '—'
      }))
      .filter((h) => h.co2 > 0)
      .sort((a, b) => b.co2 - a.co2)
      .slice(0, 8);

    const co2Histogram = buildCo2Histogram(txns);
    const normalizedRecommendations = await resolveAnalyticsRecommendations({
      msmeId,
      latestAssessment,
      txns,
      categoryFromTx,
      displayTopCategory,
      displayTopCategoryEmission,
      scope1,
      scope2,
      scope3,
      txnTotalCo2,
      userContext: req.user
    });
    const recommendationCount = normalizedRecommendations.length;
    const improvementImpacts = normalizedRecommendations.slice(0, 8).map((r, i) => ({
      id: r.id,
      label: (r.title || `Action ${i + 1}`).slice(0, 40),
      impactKg:
        r.potentialCO2Reduction != null && r.potentialCO2Reduction > 0
          ? r.potentialCO2Reduction
          : Math.max(1, (totalCO2 || txnTotalCo2) * (0.12 - i * 0.012))
    }));

    const compliance = buildComplianceSnapshot({
      totalCO2: totalCO2 || txnTotalCo2,
      carbonScore,
      latestAssessment,
      txns,
      recommendationCount
    });

    const capabilityInsights = [
      {
        id: 'agent-carbon-analyzer',
        title: 'Carbon Analyzer Agent',
        status: carbonAnalyzerAgent ? 'active' : 'unavailable',
        capability: 'Computes category emissions and ESG scope attribution',
        summary: totalCO2 > 0
          ? `Latest assessment footprint is ${totalCO2.toFixed(1)} kg CO2.`
          : 'Awaiting assessment data to compute footprint insights.'
      },
      {
        id: 'agent-recommendation-engine',
        title: 'Recommendation Engine Agent',
        status: recommendationAgent ? 'active' : 'unavailable',
        capability: 'Synthesizes decarbonization actions with impact potential',
        summary: recommendationCount > 0
          ? `${recommendationCount} recommendations are currently available.`
          : 'No recommendations generated yet.'
      },
      {
        id: 'agent-anomaly-detector',
        title: 'Anomaly Detector Agent',
        status: anomalyAgent ? 'active' : 'unavailable',
        capability: 'Flags unusual carbon or spend emission spikes',
        summary: txns.length > 0
          ? `Monitoring ${txns.length} recent transactions for anomalous patterns.`
          : 'No transactions available for anomaly detection.'
      },
      {
        id: 'agent-trend-analyzer',
        title: 'Trend Analyzer Agent',
        status: trendAgent ? 'active' : 'unavailable',
        capability: 'Tracks trajectory and directional emission movement',
        summary: displayTopCategory
          ? `${String(displayTopCategory).replace(/_/g, ' ')} is the highest emitting category (${displayTopCategoryEmission.toFixed(1)} kg CO2).`
          : 'Insufficient data to identify top emitting category.'
      }
    ];

    const activeAgents = capabilityInsights.filter(agent => agent.status === 'active').length;
    const readinessScore = Math.round((activeAgents / capabilityInsights.length) * 100);

    const scopeMonthlyStack = buildScopeMonthlyStackFromTransactions(txns);

    const inventoryMetadata = aggregateInventoryMetadata(txns, {
      organizationalBoundary: {
        entityName: req.user?.organizationName || req.user?.companyName || null
      }
    });

    const scope3GhgChart = (inventoryMetadata.scope3ByCategory || []).map((row) => ({
      key: row.key,
      label: row.label,
      value: row.kgCO2e,
      sharePercent: row.sharePercent
    }));

    const dataQualityChart = Object.entries(inventoryMetadata.dataQualityMix || {})
      .filter(([, kg]) => toAnalyticsNumber(kg) > 0)
      .map(([tier, kg]) => ({
        tier,
        label: tier.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        kgCO2e: Math.round(toAnalyticsNumber(kg) * 100) / 100
      }));

    return res.json({
      success: true,
      data: {
        engine: {
          name: 'Multi-Agent Carbon Analytics Engine',
          version: '1.0.0',
          readinessScore,
          activeAgents,
          totalAgents: capabilityInsights.length
        },
        capabilities: capabilityInsights,
        benchmarks: {
          industryAverageKg: toAnalyticsNumber(latestAssessment?.benchmarks?.industryAverage),
          bestInClassKg: toAnalyticsNumber(latestAssessment?.benchmarks?.bestInClass),
          previousAssessmentKg: toAnalyticsNumber(latestAssessment?.benchmarks?.previousAssessment)
        },
        synthesis: {
          totalCO2Emissions: totalCO2,
          carbonScore,
          topEmittingCategory: displayTopCategory,
          recommendationCount,
          analyzedTransactions: txns.length,
          completenessScore: inventoryMetadata.completenessScore,
          unclassifiedScope3Kg: inventoryMetadata.unclassifiedScope3Kg,
          methodology: inventoryMetadata.methodology
        },
        inventoryMetadata,
        charts: {
          pieByCategory: pieByCategory.map((p) => ({
            ...p,
            sharePercent: pieShareDenominator > 0 ? Math.round((p.value / pieShareDenominator) * 1000) / 10 : 0
          })),
          scopeRadar,
          performanceRadar: perfRadar,
          stackedEmissions,
          co2Histogram,
          hotspots,
          improvementImpacts,
          recommendations: normalizedRecommendations.slice(0, 15),
          scopeMonthlyStack,
          scope3GhgChart,
          dataQualityChart,
          scope2Dual: inventoryMetadata.scope2DualReporting
        },
        compliance
      }
    });
  } catch (error) {
    logger.error('AI analytics engine error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to run multi-agent carbon analytics engine',
      ...clientErrorPayload(error)
    });
  }
});

const granularCategoryAssessmentHandler = async (req, res) => {
  try {
    const {
      msmeId: payloadMsmeId,
      useActualTransactions = true,
      includeHistorical = true,
      enableSyntheticBackfill = true,
      includeOrchestration = true,
      includeSyntheticTransactions = false,
      includeRawOrchestrationOutput = false,
      includeBreakdown = true,
      lookbackDays = 90,
      startDate
    } = req.body || {};

    const scope = getOrgScope(req);
    const msmeId = payloadMsmeId || scope.msmeId;
    if (!req.user?.organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization profile is required for granular category assessment'
      });
    }

    const operational = await getOperationalProfile(req.user);
    if (!operational?.profile) {
      return res.status(404).json({
        success: false,
        message: 'Organization operational profile not found'
      });
    }
    const msmeData = operational.profile.toObject
      ? operational.profile.toObject()
      : operational.profile;

    let inputTransactions = [];
    if (useActualTransactions) {
      const Transaction = require('../models/Transaction');
      inputTransactions = await Transaction.find(
        mergeOrgFilter(req, {
          isSpam: { $ne: true },
          isDuplicate: { $ne: true }
        })
      )
        .sort({ date: -1 })
        .limit(1000)
        .lean();
    }

    const result = await granularCategoryEmissionsService.calculateGranularCategoryEmissions({
      msmeId,
      msmeData,
      transactions: inputTransactions,
      options: {
        includeHistorical,
        enableSyntheticBackfill,
        includeOrchestration,
        includeSyntheticTransactions,
        lookbackDays,
        startDate
      }
    });

    if (!includeRawOrchestrationOutput && result?.orchestration?.agentOutputs) {
      result.orchestration.agentOutputs = undefined;
    }
    if (!includeBreakdown && result?.detailedResults) {
      result.detailedResults = undefined;
    }

    return res.json({
      success: true,
      message: 'Granular category carbon assessment completed successfully',
      data: result
    });
  } catch (error) {
    logger.error('Granular category carbon assessment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to complete granular category assessment',
      ...clientErrorPayload(error)
    });
  }
};

// @route   POST /api/carbon/granular-category-emissions
// @desc    Agentic AI granular emissions for all manufacturing and services categories
// @access  Private
router.post('/granular-category-emissions', requireCarbonAccess, granularCategoryAssessmentHandler);

// Backward-compatible alias
router.post('/granular-category-assessment', requireCarbonAccess, granularCategoryAssessmentHandler);

// @route   GET /api/carbon/ai-tasks/:taskId
// @desc    Get AI task results
// @access  Private
router.get('/ai-tasks/:taskId', requireCarbonAccess, async (req, res) => {
  try {
    const AITask = require('../models/AITask');
    const orgFilter = buildOrgDataFilter(req);
    const task = await AITask.findOne({
      taskId: req.params.taskId,
      ...orgFilter
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'AI task not found'
      });
    }

    res.json({
      success: true,
      data: {
        taskId: task.taskId,
        status: task.status,
        input: task.input,
        output: task.output,
        error: task.error,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        results: task.results
      }
    });

  } catch (error) {
    logger.error('Get AI task error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon/savings
// @desc    Get carbon savings data for MSME
// @access  Private
router.get('/savings', requireCarbonAccess, async (req, res) => {
  try {
    const { period = 'monthly', includeTrends = true } = req.query;
    const scope = getOrgScope(req);
    const msmeId = scope.msmeId;
    const orgFilter = buildOrgDataFilter(req);

    // Get current and previous assessments
    const currentAssessment = await CarbonAssessment.findOne(orgFilter)
      .sort({ createdAt: -1 });

    if (!currentAssessment) {
      return res.status(404).json({
        success: false,
        message: 'No carbon assessment found for this organization'
      });
    }

    // Get previous assessment based on period
    let previousAssessment = null;
    const periodDays = period === 'monthly' ? 30 : period === 'quarterly' ? 90 : 365;
    const cutoffDate = new Date(currentAssessment.createdAt.getTime() - periodDays * 24 * 60 * 60 * 1000);

    previousAssessment = await CarbonAssessment.findOne({
      ...orgFilter,
      createdAt: { $lt: cutoffDate }
    }).sort({ createdAt: -1 });

    const operational = await getOperationalProfile(req.user);
    if (!operational?.profile) {
      return res.status(404).json({
        success: false,
        message: 'Organization operational profile not found'
      });
    }
    const msmeData = operational.profile;

    // Calculate carbon savings
    const savings = carbonCalculationService.calculateCarbonSavings(
      msmeData,
      currentAssessment,
      previousAssessment
    );

    // Get trends if requested
    if (includeTrends) {
      const trendAssessments = await CarbonAssessment.find(orgFilter)
        .sort({ createdAt: -1 })
        .limit(12);

      const sortedTrendAssessments = [...trendAssessments].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );

      savings.trends.monthly = sortedTrendAssessments.map((assessment, index, list) => {
        const previous = index > 0 ? list[index - 1] : null;
        const periodSavings = previous
          ? previous.totalCO2Emissions - assessment.totalCO2Emissions
          : 0;

        return {
          month: assessment.createdAt.toISOString().substring(0, 7),
          totalCO2Emissions: assessment.totalCO2Emissions,
          carbonScore: assessment.carbonScore,
          savings: periodSavings
        };
      });

      // Calculate quarterly trends
      const quarterlyData = {};
      trendAssessments.forEach(assessment => {
        const quarter = Math.ceil((assessment.createdAt.getMonth() + 1) / 3);
        const year = assessment.createdAt.getFullYear();
        const key = `${year}-Q${quarter}`;

        if (!quarterlyData[key]) {
          quarterlyData[key] = {
            quarter: key,
            totalCO2Emissions: 0,
            carbonScore: 0,
            count: 0
          };
        }

        quarterlyData[key].totalCO2Emissions += assessment.totalCO2Emissions;
        quarterlyData[key].carbonScore += assessment.carbonScore;
        quarterlyData[key].count += 1;
      });

      savings.trends.quarterly = Object.values(quarterlyData).map(data => ({
        ...data,
        carbonScore: data.carbonScore / data.count
      })).sort((a, b) => a.quarter.localeCompare(b.quarter));
    }

    // Calculate additional metrics
    const additionalMetrics = {
      totalCO2Saved: savings.totalSavings,
      averageMonthlySavings: savings.totalSavings / (periodDays / 30),
      projectedAnnualSavings: savings.totalSavings * (365 / periodDays),
      costSavings: savings.totalSavings * 0.05, // Assuming ₹0.05 per kg CO2 saved
      environmentalImpact: {
        treesEquivalent: Math.round(savings.totalSavings / 22), // 1 tree absorbs ~22kg CO2/year
        carsOffRoad: Math.round(savings.totalSavings / 4600), // Average car emits ~4.6 tons CO2/year
        energySaved: Math.round(savings.totalSavings / 0.8) // 1 kWh = 0.8kg CO2
      }
    };

    const response = {
      success: true,
      data: {
        savings,
        additionalMetrics,
        currentAssessment: {
          id: currentAssessment._id,
          totalCO2Emissions: currentAssessment.totalCO2Emissions,
          carbonScore: currentAssessment.carbonScore,
          createdAt: currentAssessment.createdAt
        },
        previousAssessment: previousAssessment ? {
          id: previousAssessment._id,
          totalCO2Emissions: previousAssessment.totalCO2Emissions,
          carbonScore: previousAssessment.carbonScore,
          createdAt: previousAssessment.createdAt
        } : null,
        period,
        lastUpdated: new Date()
      }
    };

    res.json(response);

  } catch (error) {
    logger.error('Get carbon savings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon/savings/leaderboard
// @desc    Get carbon savings leaderboard
// @access  Private
router.get('/savings/leaderboard', requireCarbonAccess, async (req, res) => {
  try {
    const { limit = 10, period = 'monthly' } = req.query;

    // Get all MSMEs with recent assessments
    const periodDays = period === 'monthly' ? 30 : period === 'quarterly' ? 90 : 365;
    const cutoffDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    const assessments = await CarbonAssessment.find({
      createdAt: { $gte: cutoffDate },
      msmeId: { $exists: true, $ne: null },
      status: { $nin: ['draft', 'provisional'] },
      source: { $ne: 'mobile' }
    })
      .populate('msmeId', 'companyName companyType industry')
      .sort({ totalCO2Emissions: 1 }); // Lower emissions = better

    // Group by MSME and calculate savings
    const msmeSavings = {};
    assessments.forEach(assessment => {
      const msmeId = assessment.msmeId._id.toString();
      if (!msmeSavings[msmeId]) {
        msmeSavings[msmeId] = {
          msme: assessment.msmeId,
          assessments: [],
          totalEmissions: 0,
          averageScore: 0
        };
      }
      msmeSavings[msmeId].assessments.push(assessment);
      msmeSavings[msmeId].totalEmissions += assessment.totalCO2Emissions;
    });

    // Calculate average scores and sort
    const leaderboard = Object.values(msmeSavings)
      .map(msme => ({
        ...msme,
        averageScore: msme.assessments.reduce((sum, a) => sum + a.carbonScore, 0) / msme.assessments.length,
        assessmentCount: msme.assessments.length
      }))
      .sort((a, b) => b.averageScore - a.averageScore)
      .slice(0, parseInt(limit));

    res.json({
      success: true,
      data: {
        leaderboard,
        period,
        totalParticipants: Object.keys(msmeSavings).length,
        lastUpdated: new Date()
      }
    });

  } catch (error) {
    logger.error('Get carbon savings leaderboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/carbon/mobile-assess
// @desc    Store a server-verified mobile carbon assessment from synced transactions
// @access  Private
router.post('/mobile-assess', auth, async (req, res) => {
  try {
    const { assessedAt, transactions: bodyTransactions } = req.body;

    const userId = req.user._id || req.user.id;
    const msmeId = req.user.msmeId || null;

    if (!msmeId) {
      return res.status(400).json({
        success: false,
        message: 'MSME profile is required to save a server-verified assessment'
      });
    }

    const MSME = require('../models/MSME');
    const msmeData = await MSME.findById(msmeId).lean();
    if (!msmeData) {
      return res.status(404).json({
        success: false,
        message: 'MSME not found'
      });
    }

    const endDate = assessedAt ? new Date(assessedAt) : new Date();
    const startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);

    let transactions;
    if (Array.isArray(bodyTransactions) && bodyTransactions.length > 0) {
      transactions = bodyTransactions.map((t, index) => ({
        ...t,
        _id: t._id || `mobile-txn-${index}`,
        source: t.source || 'sms',
        sourceId: t.sourceId || `sms-${index}`,
        transactionType: t.transactionType || 'expense',
        date: t.date ? new Date(t.date) : endDate
      }));
    } else {
      transactions = await Transaction.find({
        msmeId,
        date: { $gte: startDate, $lte: endDate },
        isSpam: { $ne: true },
        isDuplicate: { $ne: true }
      }).lean();
    }

    const workingTxs = transactions.map((t) => ({ ...t }));
    const computed = carbonCalculationService.calculateMSMECarbonFootprint(msmeData, workingTxs);

    const totalCO2Emissions = Math.max(0, Number(computed.totalCO2Emissions) || 0);
    const carbonScore = Math.min(100, Math.max(0, Number(computed.carbonScore) || 0));

    const carbonAssessment = new CarbonAssessment({
      userId,
      msmeId,
      assessmentType: 'mobile',
      source: 'mobile',
      totalCO2Emissions,
      carbonScore,
      breakdown: computed.breakdown,
      esgScopes: computed.esgScopes,
      transactionCount: transactions.length,
      totalAmount: transactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
      mobileBreakdown: computed.breakdown || {},
      recommendations: Array.isArray(computed.recommendations) ? computed.recommendations : [],
      period: {
        startDate,
        endDate,
      },
      status: 'provisional',
    });

    await carbonAssessment.save();

    logger.info(`Mobile carbon assessment (server-computed) saved for user ${userId}, CO2: ${totalCO2Emissions}`);

    res.status(201).json({
      success: true,
      message: 'Carbon assessment saved successfully',
      data: {
        assessmentId: carbonAssessment._id,
        totalCO2Emissions: carbonAssessment.totalCO2Emissions,
        carbonScore: carbonAssessment.carbonScore,
        transactionCount: carbonAssessment.transactionCount,
        createdAt: carbonAssessment.createdAt,
      }
    });
  } catch (error) {
    logger.error('Save mobile carbon assessment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save carbon assessment',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/carbon/mobile-assessments
// @desc    Get previously saved mobile carbon assessments for this user
// @access  Private
router.get('/mobile-assessments', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const userId = req.user._id || req.user.id;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [assessments, total] = await Promise.all([
      CarbonAssessment.find({ userId, source: 'mobile' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select('totalCO2Emissions carbonScore transactionCount totalAmount mobileBreakdown recommendations status createdAt'),
      CarbonAssessment.countDocuments({ userId, source: 'mobile' }),
    ]);

    res.json({
      success: true,
      data: {
        assessments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        }
      }
    });
  } catch (error) {
    logger.error('Get mobile carbon assessments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch carbon assessments',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/carbon/assess-transactions
// @desc    Compute compliance-mode carbon assessment from a transaction batch (e.g. mobile SMS)
// @access  Private
router.post('/assess-transactions', auth, async (req, res) => {
  try {
    const { transactions = [], assessedAt } = req.body || {};
    const msmeId = req.user.msmeId || null;

    if (!msmeId) {
      return res.status(400).json({
        success: false,
        message: 'MSME profile is required for compliance inventory assessment'
      });
    }

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one transaction is required'
      });
    }

    const MSME = require('../models/MSME');
    const msmeData = await MSME.findById(msmeId).lean();
    if (!msmeData) {
      return res.status(404).json({
        success: false,
        message: 'MSME not found'
      });
    }

    const workingTxs = transactions.map((t, index) => ({
      ...t,
      _id: t._id || `mobile-txn-${index}`,
      source: t.source || 'sms',
      sourceId: t.sourceId || `sms-${index}`,
      transactionType: t.transactionType || 'expense',
      date: t.date ? new Date(t.date) : new Date()
    }));

    const computed = carbonCalculationService.calculateMSMECarbonFootprint(msmeData, workingTxs);
    const assessedAtIso = assessedAt ? new Date(assessedAt).toISOString() : new Date().toISOString();

    return res.json({
      success: true,
      message: 'Compliance inventory assessment completed',
      data: {
        assessment: {
          totalCO2Emissions: computed.totalCO2Emissions,
          breakdown: computed.breakdown,
          esgScopes: computed.esgScopes,
          carbonScore: computed.carbonScore,
          recommendations: computed.recommendations || [],
          transactionCount: workingTxs.length,
          totalAmount: workingTxs.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
          categoryBreakdown: computed.categoryBreakdown || {},
          inventoryMetadata: computed.inventoryMetadata || null,
          boundaryGovernance: computed.boundaryGovernance || null,
          assessedAt: assessedAtIso,
          reportingMode: 'compliance',
          carbonModelVersion: computed.carbonModelVersion || null
        }
      }
    });
  } catch (error) {
    logger.error('Assess transactions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to assess transactions',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;