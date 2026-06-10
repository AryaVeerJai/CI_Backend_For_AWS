const carbonScoreCalculation = require('../../../shared/carbonScoreCalculation');
const CarbonCalculationService = require('../services/carbonCalculationService');

describe('carbonScoreCalculation', () => {
  test('scores low intensity higher than high intensity', () => {
    const low = carbonScoreCalculation.calculateCarbonScore(
      { totalCO2Emissions: 50, totalSpend: 100000, breakdown: {} },
      { businessDomain: 'other' }
    );
    const high = carbonScoreCalculation.calculateCarbonScore(
      { totalCO2Emissions: 5000, totalSpend: 100000, breakdown: {} },
      { businessDomain: 'other' }
    );
    expect(low).toBeGreaterThan(high);
  });

  test('applies renewable bonus from breakdown.energy.renewable share', () => {
    const withRenewable = carbonScoreCalculation.calculateCarbonScore(
      {
        totalCO2Emissions: 100,
        totalSpend: 100000,
        breakdown: {
          energy: { total: 100, renewable: 60, electricity: 40, fuel: 0 }
        }
      },
      { businessDomain: 'other' }
    );
    const withoutRenewable = carbonScoreCalculation.calculateCarbonScore(
      {
        totalCO2Emissions: 100,
        totalSpend: 100000,
        breakdown: {
          energy: { total: 100, renewable: 0, electricity: 100, fuel: 0 }
        }
      },
      { businessDomain: 'other' }
    );
    expect(withRenewable).toBe(withoutRenewable + 5);
  });

  test('does not treat grid electricity as renewable', () => {
    const gridOnly = carbonScoreCalculation.computeRenewableEnergyRatio({
      breakdown: { energy: { total: 800, electricity: 800, renewable: 0, fuel: 0 } }
    });
    expect(gridOnly).toBe(0);
  });

  test('applies recycling bonus from breakdown.waste.recycled share', () => {
    const withRecycling = carbonScoreCalculation.calculateCarbonScore(
      {
        totalCO2Emissions: 100,
        totalSpend: 100000,
        breakdown: { waste: { total: 100, recycled: 80, solid: 20, hazardous: 0 } }
      },
      { businessDomain: 'other' }
    );
    const withoutRecycling = carbonScoreCalculation.calculateCarbonScore(
      {
        totalCO2Emissions: 100,
        totalSpend: 100000,
        breakdown: { waste: { total: 100, recycled: 0, solid: 100, hazardous: 0 } }
      },
      { businessDomain: 'other' }
    );
    expect(withRecycling).toBe(withoutRecycling + 3);
  });

  test('uses annual turnover when assessment spend is missing but emissions exist', () => {
    const withTurnover = carbonScoreCalculation.calculateCarbonScore(
      { totalCO2Emissions: 100, breakdown: {} },
      { businessDomain: 'other', annualTurnover: 500000 }
    );
    const withRupeeOneSpend = carbonScoreCalculation.calculateCarbonScore(
      { totalCO2Emissions: 100, totalSpend: 1, breakdown: {} },
      { businessDomain: 'other' }
    );
    expect(withTurnover).toBeGreaterThan(withRupeeOneSpend);
    expect(withTurnover).toBeGreaterThan(10);
  });

  test('resolveAssessmentSpend avoids ₹1 fallback when emissions are present', () => {
    expect(carbonScoreCalculation.resolveAssessmentSpend(
      { totalCO2Emissions: 500 },
      { businessDomain: 'other' }
    )).toBe(100000);
    expect(carbonScoreCalculation.resolveAssessmentSpend(
      { totalCO2Emissions: 0 },
      { businessDomain: 'other' }
    )).toBe(1);
  });

  test('carbonCalculationService delegates to shared scorer', () => {
    const score = CarbonCalculationService.calculateCarbonScore(
      { totalCO2Emissions: 10, totalSpend: 50000, breakdown: {} },
      { businessDomain: 'consulting' }
    );
    const expected = carbonScoreCalculation.calculateCarbonScore(
      { totalCO2Emissions: 10, totalSpend: 50000, breakdown: {} },
      { businessDomain: 'consulting' }
    );
    expect(score).toBe(expected);
  });
});

describe('carbonCalculationService updateBreakdown', () => {
  let service;

  beforeAll(() => {
    service = CarbonCalculationService;
  });

  test('tracks renewable energy separately from grid electricity', () => {
    const breakdown = {
      energy: { electricity: 0, fuel: 0, renewable: 0, total: 0 },
      water: { consumption: 0, co2Emissions: 0 },
      waste: { solid: 0, hazardous: 0, recycled: 0, total: 0 },
      transportation: { distance: 0, co2Emissions: 0, vehicleCount: 0, fuelEfficiency: 0 },
      materials: { consumption: 0, co2Emissions: 0, type: 'mixed', supplierDistance: 0 },
      manufacturing: { productionVolume: 0, co2Emissions: 0, efficiency: 0, equipmentAge: 0 }
    };

    service.updateBreakdown(breakdown, { category: 'energy', subcategory: 'grid' }, 800);
    service.updateBreakdown(breakdown, { category: 'energy', subcategory: 'renewable' }, 100);

    expect(breakdown.energy.electricity).toBe(800);
    expect(breakdown.energy.renewable).toBe(100);
    expect(breakdown.energy.total).toBe(900);
  });

  test('calculateMSMECarbonFootprint sets totalAmount for intensity scoring', () => {
    const msmeData = { businessDomain: 'manufacturing', industry: 'manufacturing' };
    const transactions = [
      {
        category: 'energy',
        amount: 8000,
        subcategory: 'grid',
        industry: 'manufacturing'
      }
    ];
    const result = service.calculateMSMECarbonFootprint(msmeData, transactions);
    expect(result.totalAmount).toBe(8000);
    expect(result.totalSpend).toBe(8000);
    expect(result.carbonScore).toBeGreaterThan(10);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  test('tracks recycling waste separately from solid waste', () => {
    const breakdown = {
      energy: { electricity: 0, fuel: 0, renewable: 0, total: 0 },
      water: { consumption: 0, co2Emissions: 0 },
      waste: { solid: 0, hazardous: 0, recycled: 0, total: 0 },
      transportation: { distance: 0, co2Emissions: 0, vehicleCount: 0, fuelEfficiency: 0 },
      materials: { consumption: 0, co2Emissions: 0, type: 'mixed', supplierDistance: 0 },
      manufacturing: { productionVolume: 0, co2Emissions: 0, efficiency: 0, equipmentAge: 0 }
    };

    service.updateBreakdown(breakdown, { category: 'waste_management', subcategory: 'recycling' }, 12);
    service.updateBreakdown(breakdown, { category: 'waste_management', subcategory: 'solid' }, 30);

    expect(breakdown.waste.recycled).toBe(12);
    expect(breakdown.waste.solid).toBe(30);
    expect(breakdown.waste.total).toBe(42);
  });
});
