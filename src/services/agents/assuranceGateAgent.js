const ghgGovernance = require('../../../../shared/ghgInventoryGovernance');
const { normalizeGhgOperationalBoundary } = require('../../utils/ghgBoundaryFields');

/**
 * Agent: evaluates ISO 14064-style assurance readiness from data quality and boundary completeness.
 */
const execute = async (task = {}) => {
  const { input = {} } = task;
  const msmeData = input.msmeData || {};
  const transactions = input.includedTransactions
    || input.transactions
    || [];
  const inventoryMetadata = input.inventoryMetadata
    || input.assessment?.inventoryMetadata
    || {};
  const boundary = normalizeGhgOperationalBoundary(
    msmeData.operations?.ghgOperationalBoundary || input.boundary || {},
    {}
  );

  const evaluation = ghgGovernance.evaluateAssuranceReadiness({
    inventoryMetadata,
    boundary,
    transactions,
    options: input.assuranceOptions || input.frameworks?.iso14064 || {}
  });

  const isoChecks = [
    {
      id: 'base_year',
      passed: Boolean(boundary.baseYear),
      message: boundary.baseYear
        ? `Base year ${boundary.baseYear} configured`
        : 'Base year missing on operational boundary'
    },
    {
      id: 'scope3_categories',
      passed: Array.isArray(boundary.scope3CategoriesIncluded)
        && boundary.scope3CategoriesIncluded.length >= 3,
      message: `Scope 3 categories in boundary: ${(boundary.scope3CategoriesIncluded || []).join(', ')}`
    },
    {
      id: 'data_quality_mix',
      passed: evaluation.assuranceReady,
      message: evaluation.assuranceReady
        ? 'Data quality mix meets assurance gate thresholds'
        : (evaluation.blockers[0]?.message || 'Data quality below assurance threshold')
    }
  ];

  return {
    agent: 'assurance_gate',
    evaluation,
    isoChecks,
    recommendedAssuranceLevel: evaluation.assuranceReady ? 'limited' : 'internal_review_only',
    generatedAt: new Date().toISOString()
  };
};

module.exports = { execute };
