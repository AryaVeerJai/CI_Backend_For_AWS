const carbonRating = require('../../../shared/carbonRating');
const carbonCalculationService = require('../services/carbonCalculationService');

describe('carbonRating', () => {
  test('maps 0-100 scores to canonical letter grades', () => {
    expect(carbonRating.getRating(95)).toBe('A+');
    expect(carbonRating.getRating(85)).toBe('A');
    expect(carbonRating.getRating(75)).toBe('B+');
    expect(carbonRating.getRating(55)).toBe('C+');
    expect(carbonRating.getRating(35)).toBe('D');
    expect(carbonRating.getRating(10)).toBe('F');
  });

  test('normalizes legacy 0-1 AI scores to 0-100', () => {
    expect(carbonRating.normalizeScore(0.85)).toBe(85);
    expect(carbonRating.getRating(0.85)).toBe('A');
  });

  test('provides consistent labels and colors', () => {
    expect(carbonRating.getScoreLabel(82)).toBe('Excellent');
    expect(carbonRating.getScoreColor(82)).toBe(carbonRating.GRADE_COLORS['A+']);
    expect(carbonRating.getGradeColor('B+')).toBe(carbonRating.GRADE_COLORS['B+']);
  });
});

describe('carbonCalculationService AI canonical scoring', () => {
  test('maps advanced calculation output to canonical score', () => {
    const calculation = {
      totalCO2Emissions: 50,
      totalSpend: 100000,
      breakdown: {
        energy: {
          co2: 30,
          details: { renewable: 50, fuelCO2: 5 }
        },
        waste: {
          co2: 10,
          details: { solid: 8, recycled: 2 }
        }
      }
    };
    const msmeProfile = { businessDomain: 'consulting' };
    const result = carbonCalculationService.applyCanonicalCarbonScore(calculation, msmeProfile);

    expect(result.carbonScore).toBeGreaterThan(0);
    expect(result.sustainabilityRating).toBe(carbonRating.getRating(result.carbonScore));
  });
});
