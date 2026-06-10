const Recommendation = require('../models/Recommendation');
const carbonCalculationService = require('./carbonCalculationService');
const recommendationEngineAgent = require('./agents/recommendationEngineAgent');
const { getOperationalProfile } = require('./organizationProfileService');
const logger = require('../utils/logger');

const toAnalyticsNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeStoredRecommendations = (raw) => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((r, i) => {
    if (typeof r === 'string') {
      return {
        id: `rec-${i + 1}`,
        title: r.length > 90 ? `${r.slice(0, 87)}…` : r,
        description: r,
        priority: 'medium',
        potentialCO2Reduction: null
      };
    }
    return {
      id: String(r.id || r._id || `rec-${i + 1}`),
      title: r.title || r.category || 'Recommendation',
      description: r.description || '',
      priority: r.priority || 'medium',
      potentialCO2Reduction:
        r.potentialCO2Reduction != null ? toAnalyticsNumber(r.potentialCO2Reduction) : null
    };
  });
};

const formatCategoryLabel = (category) =>
  String(category || 'other')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const buildTransactionFallbackRecommendations = ({
  categoryFromTx = [],
  displayTopCategory,
  displayTopCategoryEmission,
  scope1,
  scope2,
  scope3,
  txnTotalCo2
}) => {
  const recommendations = [];
  const total = toAnalyticsNumber(txnTotalCo2);
  const top = categoryFromTx[0];
  const topCategory = displayTopCategory || top?.category;
  const topCo2 = displayTopCategoryEmission > 0 ? displayTopCategoryEmission : toAnalyticsNumber(top?.co2);

  if (topCategory && topCo2 > 0) {
    recommendations.push({
      id: 'rec-fallback-top-category',
      title: `Prioritize ${formatCategoryLabel(topCategory)} reductions`,
      description:
        `${formatCategoryLabel(topCategory)} is your highest-emitting category in recent transactions. Review suppliers, usage intensity, and low-carbon alternatives in this area first.`,
      priority: 'high',
      potentialCO2Reduction: Math.round(topCo2 * 0.2 * 10) / 10
    });
  }

  const scopeSum = scope1 + scope2 + scope3;
  if (scopeSum > 0) {
    const scopeShares = [
      {
        key: 'scope2',
        label: 'Scope 2 (energy)',
        kg: scope2,
        action: 'Shift to renewable power or improve metering on electricity and fuel purchases.'
      },
      {
        key: 'scope3',
        label: 'Scope 3 (value chain)',
        kg: scope3,
        action: 'Engage key suppliers and consolidate shipments to cut upstream and logistics emissions.'
      },
      {
        key: 'scope1',
        label: 'Scope 1 (direct)',
        kg: scope1,
        action: 'Tune combustion equipment, refrigerants, and on-site fuel use for measurable direct reductions.'
      }
    ].sort((a, b) => b.kg - a.kg);
    const dominant = scopeShares[0];
    if (dominant.kg > 0) {
      recommendations.push({
        id: `rec-fallback-${dominant.key}`,
        title: `Focus on ${dominant.label}`,
        description: dominant.action,
        priority: 'medium',
        potentialCO2Reduction: Math.round(dominant.kg * 0.15 * 10) / 10
      });
    }
  }

  if (total > 0 && recommendations.length < 3) {
    recommendations.push({
      id: 'rec-fallback-data-quality',
      title: 'Improve transaction classification',
      description:
        'Classify more operational transactions with categories and carbon footprints so reduction targets and recommendations reflect your real emission profile.',
      priority: 'medium',
      potentialCO2Reduction: Math.round(total * 0.08 * 10) / 10
    });
  }

  return recommendations;
};

const resolveAnalyticsRecommendations = async ({
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
  userContext
}) => {
  const stored = normalizeStoredRecommendations(latestAssessment?.recommendations);
  if (stored.length > 0) {
    return stored;
  }

  if (msmeId) {
    const persisted = await Recommendation.find({
      msmeId,
      status: { $in: ['pending', 'in_progress'] }
    })
      .sort({ priority: 1, createdAt: -1 })
      .limit(15)
      .lean();
    if (persisted.length > 0) {
      return normalizeStoredRecommendations(persisted);
    }
  }

  let msmeData;
  try {
    const operational = await getOperationalProfile(userContext);
    msmeData = operational?.profile;
  } catch (profileErr) {
    logger.warn('Operational profile unavailable for recommendation synthesis:', profileErr);
  }

  if (latestAssessment?.breakdown && msmeData) {
    try {
      const generated = carbonCalculationService.generateRecommendations(latestAssessment, msmeData);
      const fromAssessment = normalizeStoredRecommendations(generated);
      if (fromAssessment.length > 0) {
        return fromAssessment;
      }
    } catch (calcErr) {
      logger.warn('Assessment recommendation generation failed:', calcErr);
    }
  }

  try {
    const engineResult = await recommendationEngineAgent.generateRecommendations({
      carbonData: latestAssessment || undefined,
      transactions: txns,
      msmeData: msmeData || undefined
    });
    const fromEngine = normalizeStoredRecommendations(engineResult?.recommendations);
    if (fromEngine.length > 0) {
      return fromEngine;
    }
  } catch (engineErr) {
    logger.warn('Recommendation engine synthesis failed:', engineErr);
  }

  return buildTransactionFallbackRecommendations({
    categoryFromTx,
    displayTopCategory,
    displayTopCategoryEmission,
    scope1,
    scope2,
    scope3,
    txnTotalCo2
  });
};

module.exports = {
  normalizeStoredRecommendations,
  buildTransactionFallbackRecommendations,
  resolveAnalyticsRecommendations
};
