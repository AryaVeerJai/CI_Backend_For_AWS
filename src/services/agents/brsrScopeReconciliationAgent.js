const ghgGovernance = require('../../../../shared/ghgInventoryGovernance');

/**
 * Agent: reconciles BRSR scope totals — blocks residual Scope 3 unless explicitly allowed.
 */
const execute = async (task = {}) => {
  const { input = {} } = task;
  const assessment = input.assessment || {};
  const allowResidual = input.allowResidualScope3 === true
    || input.frameworks?.brsr?.allowResidualScope3 === true;

  const reconciliation = ghgGovernance.reconcileBrsrScopeTotals(assessment, {
    allowResidualScope3: allowResidual
  });

  const disclosureReady = reconciliation.scopesExplicitlyMeasured
    || (allowResidual && reconciliation.residualScope3Used);

  return {
    agent: 'brsr_scope_reconciliation',
    reconciliation,
    disclosureReady,
    brsrPrinciple6Ready: disclosureReady && !reconciliation.methodologicalWarning,
    recommendations: disclosureReady
      ? []
      : [
        {
          priority: 'high',
          action: 'Run full emissions assessment with explicit esgScopes before BRSR Principle 6 filing.'
        },
        {
          priority: 'medium',
          action: 'Complete Scope 3 category mapping for all material indirect emissions.'
        }
      ],
    generatedAt: new Date().toISOString()
  };
};

module.exports = { execute };
