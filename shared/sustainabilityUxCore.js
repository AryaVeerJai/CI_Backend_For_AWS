/**
 * Shared sustainability UX scoring and equivalency helpers (web + mobile).
 */

const IMPLEMENTED_RECOMMENDATIONS_STORAGE_KEY = 'ci-implemented-recommendations-v1';
const CARBON_WIZARD_DRAFT_STORAGE_KEY = 'ci-carbon-wizard-draft-v1';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function classifyDataQualityLevel(finalScore) {
  if (finalScore >= 75) {
    return { level: 'high', label: 'High confidence — multi-source inventory' };
  }
  if (finalScore >= 45) {
    return { level: 'medium', label: 'Medium confidence — partial evidence' };
  }
  return { level: 'low', label: 'Low confidence — more data needed' };
}

function computeEnvironmentalEquivalents(kgCo2) {
  const kg = Math.max(0, Number(kgCo2) || 0);
  return {
    treesEquivalent: Math.max(0, Math.round(kg / 21)),
    carsOffRoadDays: Math.max(0, Math.round(kg / 4.6)),
    kwhEquivalent: Math.max(0, Math.round(kg / 0.82))
  };
}

/**
 * Unified data-quality scoring with optional web (documents/scopes) and mobile (SMS) signals.
 */
function computeDataQualityScore(input = {}) {
  let score = 0;
  const hints = [];

  if (input.hasProfile) {
    score += input.platform === 'mobile' ? 30 : 25;
  } else {
    hints.push(
      input.platform === 'mobile'
        ? 'Complete company profile on web for sector defaults.'
        : 'Complete your company profile for sector-specific defaults.'
    );
  }

  if (input.hasAssessment && Number(input.carbonEmissionsKg) > 0) {
    score += input.platform === 'mobile' ? 40 : 35;
  } else {
    hints.push(
      input.platform === 'mobile'
        ? 'Run carbon analysis to establish your baseline.'
        : 'Run a carbon assessment to establish your baseline footprint.'
    );
  }

  if ((input.transactionCount ?? 0) > 0) {
    score += input.platform === 'mobile' ? 15 : 20;
  } else {
    hints.push(
      input.platform === 'mobile'
        ? 'Classify transactions for stronger operational data.'
        : 'Add or classify transactions to strengthen operational data.'
    );
  }

  if (input.platform === 'mobile') {
    if (input.hasSmsOrLocalData) {
      score += 15;
    } else {
      hints.push('Import bank SMS for spend-based signals.');
    }
  } else {
    if ((input.documentCount ?? 0) > 0) {
      score += 10;
    } else {
      hints.push('Upload utility bills or invoices for document-backed evidence.');
    }

    if (input.hasScopeBreakdown) {
      score += 10;
    } else {
      hints.push('Save an assessment with scope 1–3 splits for disclosure-ready reporting.');
    }

    if (typeof input.inventoryCompletenessScore === 'number' && input.inventoryCompletenessScore > 0) {
      score = Math.round((score * 0.65) + (clamp(input.inventoryCompletenessScore, 0, 100) * 0.35));
    }

    if (typeof input.activitySharePct === 'number' && input.activitySharePct < 20) {
      hints.push('Add metered kWh, liters, or kg on bills to raise activity-based data share.');
    }
  }

  const finalScore = clamp(score, 0, 100);
  const { level, label } = classifyDataQualityLevel(finalScore);

  return {
    score: finalScore,
    level,
    label: input.platform === 'mobile' ? label.replace(' — multi-source inventory', '').replace(' — partial evidence', '').replace(' — more data needed', '') : label,
    hints: hints.slice(0, 3)
  };
}

function computeCustomerHealthScore(parts) {
  const score = Math.round(
    parts.profileScore * 0.35
      + parts.dataOrWorkflowScore * 0.35
      + parts.assessmentOrReadinessScore * 0.3
  );
  const finalScore = clamp(score, 0, 100);
  let label = 'Getting started';
  if (finalScore >= 75) label = 'Strong — disclosure-ready trajectory';
  else if (finalScore >= 45) label = 'On track — finish key setup steps';

  return { score: finalScore, label };
}

module.exports = {
  IMPLEMENTED_RECOMMENDATIONS_STORAGE_KEY,
  CARBON_WIZARD_DRAFT_STORAGE_KEY,
  clamp,
  classifyDataQualityLevel,
  computeEnvironmentalEquivalents,
  computeDataQualityScore,
  computeCustomerHealthScore
};
