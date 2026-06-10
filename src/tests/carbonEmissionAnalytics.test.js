const {
  resolveQuantificationMethod,
  resolveScope3GhgCategory,
  aggregateInventoryMetadata,
  buildScope2DualReport,
  QUANTIFICATION_METHODS
} = require('../../../shared/carbonEmissionAnalytics');

describe('carbonEmissionAnalytics', () => {
  test('resolveQuantificationMethod prefers activity when quantity and unit present', () => {
    const method = resolveQuantificationMethod({
      category: 'energy',
      amount: 5000,
      quantity: 120,
      unit: 'kWh'
    });
    expect(method).toBe(QUANTIFICATION_METHODS.ACTIVITY);
  });

  test('resolveScope3GhgCategory maps waste to cat5', () => {
    expect(resolveScope3GhgCategory({ category: 'waste_management' })).toBe('cat5_waste');
  });

  test('buildScope2DualReport lowers market-based for renewable signals', () => {
    const dual = buildScope2DualReport(
      { subcategory: 'renewable', sustainability: { isGreen: true } },
      100
    );
    expect(dual.locationBasedKg).toBe(100);
    expect(dual.marketBasedKg).toBeLessThan(100);
  });

  test('aggregateInventoryMetadata rolls up scope and data quality', () => {
    const meta = aggregateInventoryMetadata([
      {
        category: 'energy',
        carbonFootprint: {
          co2Emissions: 80,
          quantificationMethod: 'spend_proxy',
          dataQualityTier: 'tier_2_spend_proxy',
          emissionBreakdown: { scope1: 0, scope2: 80, scope3: 0 }
        }
      },
      {
        category: 'raw_materials',
        carbonFootprint: {
          co2Emissions: 40,
          quantificationMethod: 'spend_proxy',
          dataQualityTier: 'tier_2_spend_proxy',
          ghgScope3Category: 'cat1_purchased_goods',
          emissionBreakdown: { scope1: 0, scope2: 0, scope3: 40 }
        }
      }
    ]);

    expect(meta.scopeTotals.scope2LocationBased).toBe(80);
    expect(meta.scopeTotals.scope3).toBe(40);
    expect(meta.completenessScore).toBeGreaterThan(0);
    expect(meta.scope3ByCategory.length).toBeGreaterThan(0);
  });
});
