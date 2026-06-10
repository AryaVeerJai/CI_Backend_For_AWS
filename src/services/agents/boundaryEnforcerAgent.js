const ghgGovernance = require('../../../../shared/ghgInventoryGovernance');
const { normalizeGhgOperationalBoundary } = require('../../utils/ghgBoundaryFields');

/**
 * Agent: enforces operational boundary on transaction set before inventory rollup.
 */
const execute = async (task = {}) => {
  const { input = {} } = task;
  const msmeData = input.msmeData || {};
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  const boundary = normalizeGhgOperationalBoundary(
    msmeData.operations?.ghgOperationalBoundary || input.operationalBoundary || {},
    {}
  );

  const enriched = transactions.map((t) => ghgGovernance.enrichTransactionForInventory(t, boundary));
  const { included, excluded } = ghgGovernance.applyBoundaryToTransactions(enriched, boundary);

  const scope3ExcludedByCategory = {};
  excluded.forEach((row) => {
    const cat = row.boundaryEvaluation?.scope3CategoryNumber;
    if (cat) {
      scope3ExcludedByCategory[cat] = (scope3ExcludedByCategory[cat] || 0) + 1;
    }
  });

  return {
    agent: 'boundary_enforcer',
    boundary,
    includedCount: included.length,
    excludedCount: excluded.length,
    includedTransactions: included,
    excludedTransactions: excluded,
    scope3ExcludedByCategory,
    notes: [
      'Transactions outside operational boundary are excluded from corporate inventory totals.',
      'Offsets, credits, and non-inventory scopes are reported separately per GHG Protocol.'
    ],
    generatedAt: new Date().toISOString()
  };
};

module.exports = { execute };
