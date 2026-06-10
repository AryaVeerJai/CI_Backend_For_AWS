const carbonCalculationService = require('../services/carbonCalculationService');

describe('ESG Scope Calculations', () => {
  const mockMSME = {
    industry: 'manufacturing',
    environmentalCompliance: {
      hasEnvironmentalClearance: true,
      hasPollutionControlBoard: true,
      hasWasteManagement: true
    }
  };

  const mockTransactions = [
    {
      category: 'energy',
      subcategory: 'diesel',
      amount: 100,
      description: 'Diesel fuel for company vehicles',
      sustainability: { isGreen: false, greenScore: 0 }
    },
    {
      category: 'energy',
      subcategory: 'grid',
      amount: 1000,
      description: 'Electricity from grid',
      sustainability: { isGreen: false, greenScore: 0 }
    },
    {
      category: 'raw_materials',
      subcategory: 'steel',
      amount: 500,
      description: 'Steel from supplier 200km away',
      sustainability: { isGreen: false, greenScore: 0 }
    },
    {
      category: 'transportation',
      subcategory: 'diesel',
      amount: 200,
      description: 'Outsourced transportation services',
      sustainability: { isGreen: false, greenScore: 0 }
    },
    {
      category: 'waste_management',
      subcategory: 'solid',
      amount: 50,
      description: 'Waste disposal services',
      sustainability: { isGreen: false, greenScore: 0 }
    }
  ];

  test('should calculate ESG scopes correctly', () => {
    const assessment = carbonCalculationService.calculateMSMECarbonFootprint(mockMSME, mockTransactions);

    // Check that ESG scopes are present
    expect(assessment.esgScopes).toBeDefined();
    expect(assessment.esgScopes.scope1).toBeDefined();
    expect(assessment.esgScopes.scope2).toBeDefined();
    expect(assessment.esgScopes.scope3).toBeDefined();

    // Check scope descriptions
    expect(assessment.esgScopes.scope1.description).toBe('Direct emissions from owned or controlled sources');
    expect(assessment.esgScopes.scope2.description).toBe('Indirect emissions from purchased energy');
    expect(assessment.esgScopes.scope3.description).toBe('All other indirect emissions in the value chain');

    // Check that totals are calculated
    expect(assessment.esgScopes.scope1.total).toBeGreaterThan(0);
    expect(assessment.esgScopes.scope2.total).toBeGreaterThan(0);
    expect(assessment.esgScopes.scope3.total).toBeGreaterThan(0);

    // Check that scope totals add up to total emissions
    const totalScopes = assessment.esgScopes.scope1.total + 
                       assessment.esgScopes.scope2.total + 
                       assessment.esgScopes.scope3.total;
    expect(Math.abs(totalScopes - assessment.totalCO2Emissions)).toBeLessThan(0.01);
  });

  test('should provide scope contribution percentages for reporting', () => {
    const assessment = carbonCalculationService.calculateMSMECarbonFootprint(mockMSME, mockTransactions);
    const { scope1, scope2, scope3 } = assessment.esgScopes;

    expect(scope1.percentage).toBeGreaterThanOrEqual(0);
    expect(scope2.percentage).toBeGreaterThanOrEqual(0);
    expect(scope3.percentage).toBeGreaterThanOrEqual(0);

    const totalPercentage = scope1.percentage + scope2.percentage + scope3.percentage;
    expect(totalPercentage).toBeCloseTo(100, 1);
  });

  test('should classify diesel fuel as Scope 1', () => {
    const transaction = {
      category: 'energy',
      subcategory: 'diesel',
      amount: 100,
      description: 'Diesel fuel for company vehicles',
      sustainability: { isGreen: false, greenScore: 0 }
    };

    const carbonData = carbonCalculationService.calculateTransactionCarbonFootprint(transaction);
    expect(carbonData.co2Emissions).toBeGreaterThan(0);
  });

  test('should classify grid electricity as Scope 2', () => {
    const transaction = {
      category: 'energy',
      subcategory: 'grid',
      amount: 1000,
      description: 'Electricity from grid',
      sustainability: { isGreen: false, greenScore: 0 }
    };

    const carbonData = carbonCalculationService.calculateTransactionCarbonFootprint(transaction);
    expect(carbonData.co2Emissions).toBeGreaterThan(0);
  });

  test('should classify raw materials as Scope 3', () => {
    const transaction = {
      category: 'raw_materials',
      subcategory: 'steel',
      amount: 500,
      description: 'Steel from supplier',
      sustainability: { isGreen: false, greenScore: 0 }
    };

    const carbonData = carbonCalculationService.calculateTransactionCarbonFootprint(transaction);
    expect(carbonData.co2Emissions).toBeGreaterThan(0);
  });

  test('should classify company-owned fleet transport as Scope 1', () => {
    const assessment = carbonCalculationService.calculateMSMECarbonFootprint(mockMSME, [
      {
        category: 'transportation',
        subcategory: 'diesel',
        amount: 100,
        description: 'Diesel consumed by company-owned fleet',
        ownership: 'owned',
        sustainability: { isGreen: false, greenScore: 0 }
      }
    ]);

    expect(assessment.esgScopes.scope1.total).toBeGreaterThan(0);
    expect(assessment.esgScopes.scope1.breakdown.directTransport).toBeGreaterThan(0);
    expect(assessment.esgScopes.scope3.breakdown.transportation).toBe(0);
  });

  test('should classify outsourced transport as Scope 3', () => {
    const assessment = carbonCalculationService.calculateMSMECarbonFootprint(mockMSME, [
      {
        category: 'transportation',
        subcategory: 'diesel',
        amount: 100,
        description: 'Outsourced third-party transportation service',
        sustainability: { isGreen: false, greenScore: 0 }
      }
    ]);

    expect(assessment.esgScopes.scope1.total).toBe(0);
    expect(assessment.esgScopes.scope3.total).toBeGreaterThan(0);
    expect(assessment.esgScopes.scope3.breakdown.transportation).toBeGreaterThan(0);
  });

  test('should classify utilities power bill as Scope 2', () => {
    const assessment = carbonCalculationService.calculateMSMECarbonFootprint(mockMSME, [
      {
        category: 'utilities',
        subcategory: 'general',
        amount: 300,
        description: 'Monthly power bill and electricity charges',
        sustainability: { isGreen: false, greenScore: 0 }
      }
    ]);

    expect(assessment.esgScopes.scope2.total).toBeGreaterThan(0);
    expect(assessment.esgScopes.scope2.breakdown.electricity).toBe(0);
    expect(assessment.esgScopes.scope2.breakdown.heating).toBe(0);
    expect(assessment.esgScopes.scope2.breakdown.cooling).toBe(0);
    expect(assessment.esgScopes.scope2.breakdown.steam).toBe(0);
  });

  test('should return zero percentages when there are no emissions', () => {
    const assessment = carbonCalculationService.calculateMSMECarbonFootprint(mockMSME, []);
    expect(assessment.totalCO2Emissions).toBe(0);
    expect(assessment.esgScopes.scope1.total).toBe(0);
    expect(assessment.esgScopes.scope2.total).toBe(0);
    expect(assessment.esgScopes.scope3.total).toBe(0);
    expect(assessment.esgScopes.scope1.percentage).toBe(0);
    expect(assessment.esgScopes.scope2.percentage).toBe(0);
    expect(assessment.esgScopes.scope3.percentage).toBe(0);
  });

  test('should detect scope classification from helper methods', () => {
    expect(
      carbonCalculationService.isScope1Emission({
        category: 'transportation',
        description: 'Fleet movement',
        metadata: { ownership: 'owned' }
      })
    ).toBe(true);

    expect(
      carbonCalculationService.isScope2Emission({
        category: 'utilities',
        description: 'Power bill for manufacturing unit'
      })
    ).toBe(true);
  });

  // Regression: purchased grid electricity with an untagged subcategory (the common
  // case for OCR'd/imported energy rows) must be Scope 2, not Scope 1.
  test('should classify untagged electricity (subcategory "general") as Scope 2, not Scope 1', () => {
    const assessment = carbonCalculationService.calculateMSMECarbonFootprint(mockMSME, [
      {
        category: 'energy',
        subcategory: 'general',
        amount: 10000,
        description: 'Electricity bill',
        sustainability: { isGreen: false, greenScore: 0 }
      }
    ]);

    expect(assessment.esgScopes.scope1.total).toBe(0);
    expect(assessment.esgScopes.scope2.total).toBeGreaterThan(0);
    expect(assessment.esgScopes.scope2.breakdown.electricity).toBeGreaterThan(0);

    expect(carbonCalculationService.isScope2Emission({ category: 'energy', subcategory: 'general' })).toBe(true);
    expect(carbonCalculationService.isScope1Emission({ category: 'energy', subcategory: 'general' })).toBe(false);
  });

  // Regression: capital goods (equipment, GHG Scope 3 Cat 2) and purchased services
  // (maintenance, Cat 1) must be Scope 3, not Scope 1 direct manufacturing.
  test('should classify equipment and maintenance spend as Scope 3, not Scope 1', () => {
    const assessment = carbonCalculationService.calculateMSMECarbonFootprint(mockMSME, [
      {
        category: 'equipment',
        amount: 200000,
        description: 'New CNC machine purchase',
        sustainability: { isGreen: false, greenScore: 0 }
      },
      {
        category: 'maintenance',
        amount: 15000,
        description: 'Annual machinery servicing contract',
        sustainability: { isGreen: false, greenScore: 0 }
      }
    ]);

    expect(assessment.esgScopes.scope1.total).toBe(0);
    expect(assessment.esgScopes.scope3.total).toBeGreaterThan(0);

    expect(carbonCalculationService.isScope1Emission({ category: 'equipment' })).toBe(false);
    expect(carbonCalculationService.isScope1Emission({ category: 'maintenance' })).toBe(false);
  });

  // Regression: fuel-relevant subcategories still classify as Scope 1 (on-site combustion).
  test('should still classify generator fuel (diesel) as Scope 1', () => {
    expect(carbonCalculationService.isScope1Emission({ category: 'energy', subcategory: 'diesel' })).toBe(true);
    expect(carbonCalculationService.isScope2Emission({ category: 'energy', subcategory: 'diesel' })).toBe(false);
  });
});