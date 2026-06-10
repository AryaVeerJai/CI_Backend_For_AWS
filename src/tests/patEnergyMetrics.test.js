const {
  computePatEnergyMetrics,
  computeTransactionToe,
  isDesignatedConsumer
} = require('../../../shared/patEnergyMetrics');

describe('PAT energy metrics', () => {
  test('converts metered electricity kWh to toe', () => {
    const result = computeTransactionToe({
      category: 'energy',
      subcategory: 'grid',
      quantity: 11630,
      unit: 'kWh',
      amount: 93040
    });

    expect(result.method).toBe('electricity_kwh');
    expect(result.toe).toBeCloseTo(1, 3);
  });

  test('computes SEC when production output is provided', () => {
    const metrics = computePatEnergyMetrics({
      enterpriseProfile: {
        industry: 'cement',
        regulatoryMandates: { patScheme: true },
        productionVolume: 1000,
        productionUnit: 'tonne'
      },
      transactions: [
        {
          category: 'energy',
          subcategory: 'grid',
          quantity: 11630,
          unit: 'kWh',
          carbonFootprint: { co2Emissions: 800 }
        },
        {
          category: 'transportation',
          subcategory: 'diesel',
          quantity: 1000,
          unit: 'liter',
          carbonFootprint: { co2Emissions: 2680 }
        }
      ]
    });

    expect(metrics.designatedConsumer).toBe(true);
    expect(metrics.totalEnergyToe).toBeCloseTo(1.84, 2);
    expect(metrics.specificEnergyConsumption).toBeCloseTo(0.00184, 3);
    expect(metrics.secUnit).toBe('toe/tonne');
    expect(metrics.energyEmissionsKgCo2e).toBe(3480);
  });

  test('identifies designated consumers by sector', () => {
    expect(isDesignatedConsumer({ industry: 'iron_steel' })).toBe(true);
    expect(isDesignatedConsumer({ industry: 'food_processing' })).toBe(false);
  });
});
