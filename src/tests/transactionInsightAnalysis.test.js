const {
  analyzeTransactionPatterns,
  detectEmissionAnomalies,
  detectSpendingAnomalies,
  analyzeEmissionTrends,
  calculateAnomalySeverity
} = require('../services/agents/transactionInsightAnalysis');
const {
  flattenCategoryBreakdown,
  normalizeCarbonAnalysisResponse,
  buildRecommendationBreakdown
} = require('../services/agents/carbonDataNormalization');

describe('transactionInsightAnalysis', () => {
  const transactions = [
    {
      _id: '1',
      category: 'energy',
      amount: 100,
      date: '2025-01-15',
      _computedEmissions: 10
    },
    {
      _id: '2',
      category: 'energy',
      amount: 100,
      date: '2025-02-15',
      _computedEmissions: 10
    },
    {
      _id: '3',
      category: 'energy',
      amount: 10000,
      date: '2025-03-15',
      _computedEmissions: 200
    }
  ];

  test('analyzeTransactionPatterns computes averages', () => {
    const patterns = analyzeTransactionPatterns(transactions);
    expect(patterns.transactionCount).toBe(3);
    expect(patterns.avgEmission).toBeCloseTo(73.33, 0);
    expect(patterns.byCategory.energy.count).toBe(3);
  });

  test('detectEmissionAnomalies flags high-emission outliers', () => {
    const patterns = analyzeTransactionPatterns(transactions);
    const anomalies = detectEmissionAnomalies(patterns);
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0].type).toBe('high_emission');
  });

  test('detectSpendingAnomalies flags high-spend outliers', () => {
    const patterns = analyzeTransactionPatterns(transactions);
    const anomalies = detectSpendingAnomalies(patterns);
    expect(anomalies.some((item) => item.type === 'high_spending')).toBe(true);
  });

  test('analyzeEmissionTrends returns monthly series', () => {
    const trends = analyzeEmissionTrends({ transactions });
    expect(trends.monthly.length).toBe(3);
    expect(['increasing', 'decreasing', 'stable']).toContain(trends.direction);
  });

  test('calculateAnomalySeverity escalates with high severity items', () => {
    expect(calculateAnomalySeverity([])).toBe('none');
    expect(calculateAnomalySeverity([{ severity: 'high' }])).toBe('high');
  });
});

describe('carbonDataNormalization', () => {
  test('flattenCategoryBreakdown supports nested and flat shapes', () => {
    const nested = {
      energy: { emissions: 100, count: 2 },
      water: 5
    };
    expect(flattenCategoryBreakdown(nested)).toEqual({
      energy: 100,
      water: 5
    });
  });

  test('normalizeCarbonAnalysisResponse preserves flat categoryBreakdown', () => {
    const normalized = normalizeCarbonAnalysisResponse({
      totalEmissions: 100,
      categoryBreakdown: {
        energy: { emissions: 80, count: 1 },
        waste_management: { emissions: 20, count: 1 }
      },
      insights: [],
      recommendations: []
    });
    expect(normalized.categoryBreakdown.energy).toBe(80);
    expect(normalized.categoryBreakdownDetailed.energy.emissions).toBe(80);
    expect(normalized.breakdown.energy.total).toBe(80);
  });

  test('buildRecommendationBreakdown maps transportation emissions', () => {
    const breakdown = buildRecommendationBreakdown({ transportation: 42 });
    expect(breakdown.transportation.co2Emissions).toBe(42);
  });
});
