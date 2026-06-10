const { safeNumber } = require('../../utils/safeNumber');

const getCategoryEmissions = (categoryBreakdown, category) => {
  const value = categoryBreakdown?.[category];
  if (typeof value === 'number') {
    return value;
  }
  if (value && typeof value === 'object') {
    return safeNumber(value.emissions ?? value.co2Emissions ?? value.total, 0);
  }
  return 0;
};

/**
 * Flat numeric map for legacy report helpers (generateCarbonSection, charts).
 */
const flattenCategoryBreakdown = (categoryBreakdown = {}) => {
  const flat = {};
  Object.entries(categoryBreakdown).forEach(([category, value]) => {
    flat[category] = getCategoryEmissions({ [category]: value }, category);
  });
  return flat;
};

/**
 * Recommendation-engine shape (expects breakdown.*.total / co2Emissions).
 */
const buildRecommendationBreakdown = (categoryBreakdown = {}) => {
  const flat = flattenCategoryBreakdown(categoryBreakdown);
  return {
    energy: {
      total: flat.energy || 0,
      co2Emissions: flat.energy || 0
    },
    waste: {
      total: flat.waste || flat.waste_management || 0,
      co2Emissions: flat.waste || flat.waste_management || 0
    },
    transportation: {
      total: flat.transportation || 0,
      co2Emissions: flat.transportation || 0
    },
    materials: {
      total: flat.raw_materials || flat.materials || 0,
      co2Emissions: flat.raw_materials || flat.materials || 0
    },
    water: {
      total: flat.water || 0,
      co2Emissions: flat.water || 0
    }
  };
};

/**
 * Normalize carbon analyzer output for downstream agents while preserving legacy fields.
 */
const normalizeCarbonAnalysisResponse = (analysis = {}) => {
  const detailed = analysis.categoryBreakdownDetailed || analysis.categoryBreakdown || {};
  const hasNestedValues = Object.values(detailed).some(
    (value) => value && typeof value === 'object' && !Array.isArray(value)
  );
  const detailedBreakdown = hasNestedValues ? detailed : null;
  const flatCategoryBreakdown = hasNestedValues
    ? flattenCategoryBreakdown(detailed)
    : flattenCategoryBreakdown(analysis.categoryBreakdown || {});

  const totalEmissions = safeNumber(
    analysis.totalEmissions
      ?? Object.values(flatCategoryBreakdown).reduce((sum, value) => sum + value, 0),
    0
  );

  return {
    ...analysis,
    totalEmissions,
    categoryBreakdown: flatCategoryBreakdown,
    ...(detailedBreakdown ? { categoryBreakdownDetailed: detailedBreakdown } : {}),
    breakdown: analysis.breakdown || buildRecommendationBreakdown(
      detailedBreakdown || flatCategoryBreakdown
    )
  };
};

/**
 * Enrich carbon payload passed to recommendation_engine from orchestration.
 */
const normalizeCarbonDataForRecommendations = (carbonData = {}) => {
  if (!carbonData || typeof carbonData !== 'object') {
    return carbonData;
  }
  if (carbonData.breakdown) {
    return carbonData;
  }
  return {
    ...carbonData,
    ...normalizeCarbonAnalysisResponse(carbonData)
  };
};

module.exports = {
  flattenCategoryBreakdown,
  buildRecommendationBreakdown,
  normalizeCarbonAnalysisResponse,
  normalizeCarbonDataForRecommendations,
  getCategoryEmissions
};
