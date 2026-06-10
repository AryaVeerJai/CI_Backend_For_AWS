const ghgGovernance = require('../../../shared/ghgInventoryGovernance');

describe('ghgInventoryGovernance', () => {
  test('excludes offset transactions from inventory', () => {
    const txn = {
      description: 'Purchased carbon credits VCS project',
      amount: 50000,
      category: 'services'
    };
    expect(ghgGovernance.isNonInventoryTransaction(txn)).toBe(true);
  });

  test('applies scope3 category boundary filter', () => {
    const boundary = {
      scope3CategoriesIncluded: [1, 2, 3],
      scope1StationaryCombustion: true,
      scope1MobileCombustion: true,
      scope1ProcessEmissions: true,
      scope1FugitiveEmissions: true,
      scope2LocationBased: true,
      scope2MarketBased: false
    };
    const txn = {
      category: 'transportation',
      description: 'Employee commute bus pass',
      amount: 1200,
      carbonFootprint: { estimatedScope: 'scope3' }
    };
    const { included, excluded } = ghgGovernance.applyBoundaryToTransactions([txn], boundary);
    expect(included.length + excluded.length).toBe(1);
  });

  test('blocks residual scope3 for BRSR without explicit flag', () => {
    const assessment = {
      totalCO2Emissions: 100,
      esgScopes: {},
      breakdown: {
        energy: { fuel: 30, electricity: 20 }
      }
    };
    const result = ghgGovernance.reconcileBrsrScopeTotals(assessment, { allowResidualScope3: false });
    expect(result.scope3).toBe(0);
    expect(result.methodologicalWarning).toContain('incomplete');
  });

  test('evaluateAssuranceReadiness flags spend-proxy dominance', () => {
    const evaluation = ghgGovernance.evaluateAssuranceReadiness({
      inventoryMetadata: {
        dataQualityMix: {
          tier_1_activity: 5,
          tier_2_spend_proxy: 90,
          tier_3_estimate: 5
        }
      },
      boundary: { baseYear: 2022 },
      transactions: []
    });
    expect(evaluation.assuranceReady).toBe(false);
    expect(evaluation.blockers.some((b) => b.code === 'DATA_QUALITY_SPEND_PROXY_DOMINANT')).toBe(true);
  });

  test('buildScope2DualReportWithInstruments uses contractual factor when provided', () => {
    const txn = {
      contractualEmissionFactor: 0.1,
      marketBasedInstruments: [{ type: 'ppa' }]
    };
    const report = ghgGovernance.buildScope2DualReportWithInstruments(txn, 80);
    expect(report.marketBasedKg).toBeLessThan(report.locationBasedKg);
    expect(report.reportingBasis).toBe('market_based_contractual_factor');
  });
});
