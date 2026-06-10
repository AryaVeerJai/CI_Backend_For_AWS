const {
  applyOperationalBoundaryToWorkflowEstimate,
  scope3CategoryIncluded
} = require('../../../shared/ghgBoundaryCalculation');

describe('ghgBoundaryCalculation', () => {
  test('scope3CategoryIncluded respects operational boundary list', () => {
    expect(scope3CategoryIncluded({ scope3CategoriesIncluded: [1, 4] }, 7)).toBe(false);
    expect(scope3CategoryIncluded({ scope3CategoriesIncluded: [1, 4, 7] }, 7)).toBe(true);
  });

  test('applyOperationalBoundaryToWorkflowEstimate zeros excluded scope components', () => {
    const estimate = {
      machineryEmissions: 100,
      rawMaterialEmissions: 50,
      packagingMaterialEmissions: 10,
      processAuxiliaryEmissions: 20,
      commuteEmissions: 30,
      supplyChainEmissions: 40,
      totalCO2Emissions: 250,
      processEmissions: 180,
      scope3Emissions: 70
    };

    const filtered = applyOperationalBoundaryToWorkflowEstimate(estimate, {
      scope1StationaryCombustion: false,
      scope1ProcessEmissions: true,
      scope3CategoriesIncluded: [7]
    });

    expect(filtered.machineryEmissions).toBe(0);
    expect(filtered.rawMaterialEmissions).toBe(0);
    expect(filtered.processAuxiliaryEmissions).toBe(20);
    expect(filtered.commuteEmissions).toBe(30);
    expect(filtered.supplyChainEmissions).toBe(0);
    expect(filtered.scope1Emissions).toBe(20);
    expect(filtered.scope3Emissions).toBe(30);
    expect(filtered.totalCO2Emissions).toBe(50);
  });
});
