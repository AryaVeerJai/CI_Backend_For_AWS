const { computeProductCarbonFootprint } = require('../services/productCfpService');

describe('Product CFP Service (ISO 14067)', () => {
  test('allocates transaction emissions to assigned products by share', () => {
    const result = computeProductCarbonFootprint({
      msmeData: {
        business: {
          primaryProducts: 'Widget A, Widget B',
          functionalUnit: '1 widget'
        }
      },
      frameworks: {
        iso14067: {
          functionalUnit: '1 widget',
          allocationMethod: 'economic_allocation'
        }
      },
      transactions: [
        {
          category: 'raw_materials',
          amount: 10000,
          carbonFootprint: {
            co2Emissions: 100,
            metrics: { estimatedScope: 'scope3' }
          },
          productAttribution: {
            assignedProducts: [
              { productName: 'Widget A', allocationPercent: 60 },
              { productName: 'Widget B', allocationPercent: 40 }
            ]
          }
        },
        {
          category: 'energy',
          amount: 5000,
          carbonFootprint: {
            co2Emissions: 50,
            metrics: { estimatedScope: 'scope2' }
          },
          productAttribution: {
            assignedProducts: [
              { productName: 'Widget A', allocationPercent: 100 }
            ]
          }
        }
      ]
    });

    expect(result.standard).toBe('ISO 14067');
    expect(result.productCount).toBe(2);
    expect(result.totalAssignedKgCo2e).toBe(150);
    expect(result.inventoryCoveragePercent).toBe(100);

    const widgetA = result.products.find((product) => product.productName === 'Widget A');
    const widgetB = result.products.find((product) => product.productName === 'Widget B');

    expect(widgetA.totalKgCo2e).toBe(110);
    expect(widgetB.totalKgCo2e).toBe(40);
    expect(widgetA.stageBreakdown.upstream).toBe(60);
    expect(widgetA.stageBreakdown.operations).toBe(50);
    expect(widgetB.stageBreakdown.upstream).toBe(40);
  });

  test('tracks unassigned emissions separately', () => {
    const result = computeProductCarbonFootprint({
      msmeData: { business: { primaryProducts: 'Widget A' } },
      transactions: [
        {
          category: 'raw_materials',
          carbonFootprint: { co2Emissions: 80, metrics: { estimatedScope: 'scope3' } },
          productAttribution: { assignedProducts: [{ productName: 'Widget A', allocationPercent: 100 }] }
        },
        {
          category: 'other',
          carbonFootprint: { co2Emissions: 20, metrics: { estimatedScope: 'scope3' } }
        }
      ]
    });

    expect(result.unassignedKgCo2e).toBe(20);
    expect(result.totalAssignedKgCo2e).toBe(80);
    expect(result.inventoryCoveragePercent).toBe(80);
  });
});
