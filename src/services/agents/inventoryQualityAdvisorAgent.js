/**
 * Separates GHG inventory quality (method rigor) from operational data completeness.
 */
const { buildIsoGapClosureChecklist } = require('../isoGapClosureService');

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const computeActivitySharePct = (transactions = []) => {
  if (!transactions.length) return 0;
  const activityBased = transactions.filter((tx) => {
    const meta = tx.metadata || tx.carbonMetadata || {};
    return Boolean(
      meta.activityQuantity
      || meta.kwh
      || meta.liters
      || meta.kg
      || tx.quantificationMethod === 'activity'
      || tx.dataQuality === 'activity_based'
    );
  });
  return Math.round((activityBased.length / transactions.length) * 100);
};

const buildInventoryQuality = ({
  msmeData = {},
  transactions = [],
  dataQuality = {},
  gapClosureChecklist = null
}) => {
  const checklist = gapClosureChecklist || buildIsoGapClosureChecklist({
    msmeData,
    transactions,
    dataQuality
  });

  const activitySharePct = computeActivitySharePct(transactions);
  const boundaryScore = Number(checklist.sections?.boundaryDefinitions?.readinessScore) || 0;
  const factorScore = Number(checklist.sections?.factorRegistry?.readinessScore) || 0;
  const uncertaintyScore = Number(checklist.sections?.uncertaintyFields?.readinessScore) || 0;
  const scopeBreakdown = Boolean(
    dataQuality.hasScopeBreakdown
    || (dataQuality.scopeCoverage && dataQuality.scopeCoverage >= 2)
  );

  let score = 0;
  score += activitySharePct >= 40 ? 25 : activitySharePct >= 20 ? 15 : 5;
  score += boundaryScore * 0.2;
  score += factorScore * 0.25;
  score += uncertaintyScore * 0.15;
  score += scopeBreakdown ? 15 : 0;

  const inventoryQualityScore = clamp(Math.round(score), 0, 100);
  let level = 'low';
  let label = 'Low inventory rigor — improve boundaries and activity data';

  if (inventoryQualityScore >= 75) {
    level = 'high';
    label = 'High inventory rigor — suitable for limited assurance';
  } else if (inventoryQualityScore >= 45) {
    level = 'medium';
    label = 'Medium inventory rigor — close factor and uncertainty gaps';
  }

  const hints = [];
  if (activitySharePct < 30) {
    hints.push('Increase metered kWh, fuel litres, or material kg on bills to raise activity-based share.');
  }
  if (boundaryScore < 70) {
    hints.push('Confirm organizational and operational boundaries in company profile.');
  }
  if (factorScore < 70) {
    hints.push('Document emission factor sources and versions in the factor registry.');
  }
  if (uncertaintyScore < 50) {
    hints.push('Add uncertainty ranges for major emission sources before external assurance.');
  }

  const dataCompletenessScore = clamp(
    Number(dataQuality.score ?? dataQuality.completenessScore ?? 0),
    0,
    100
  );

  return {
    inventoryQualityScore,
    dataCompletenessScore,
    level,
    label,
    activitySharePct,
    scopeBreakdown,
    boundaryReadiness: boundaryScore,
    factorRegistryReadiness: factorScore,
    uncertaintyReadiness: uncertaintyScore,
    combinedUncertaintyNote:
      uncertaintyScore >= 60
        ? 'Uncertainty methodology partially documented.'
        : 'Disclose ± ranges only after uncertainty fields are populated.',
    hints: hints.slice(0, 4),
    checklistSummary: {
      overallReadinessScore: checklist.overallReadinessScore,
      openGapCount: Array.isArray(checklist.openGaps) ? checklist.openGaps.length : 0
    }
  };
};

module.exports = {
  buildInventoryQuality,
  async execute(task = {}) {
    const { input = {} } = task;
    return buildInventoryQuality(input);
  }
};
