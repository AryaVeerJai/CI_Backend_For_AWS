const {
  buildTransactionFallbackRecommendations,
  normalizeStoredRecommendations
} = require('../services/carbonAnalyticsRecommendationsService');

describe('carbonAnalyticsRecommendationsService', () => {
  describe('normalizeStoredRecommendations', () => {
    it('preserves document ids when normalizing stored recommendations', () => {
      const result = normalizeStoredRecommendations([
        {
          _id: '507f1f77bcf86cd799439011',
          title: 'Solar rooftop',
          description: 'Install PV',
          priority: 'high',
          potentialCO2Reduction: 42
        }
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('507f1f77bcf86cd799439011');
      expect(result[0].title).toBe('Solar rooftop');
      expect(result[0].potentialCO2Reduction).toBe(42);
    });
  });

  describe('buildTransactionFallbackRecommendations', () => {
    it('returns category and scope guidance when transaction emissions exist', () => {
      const recs = buildTransactionFallbackRecommendations({
        categoryFromTx: [{ category: 'electricity', co2: 120, count: 4 }],
        displayTopCategory: 'electricity',
        displayTopCategoryEmission: 120,
        scope1: 10,
        scope2: 80,
        scope3: 30,
        txnTotalCo2: 120
      });
      expect(recs.length).toBeGreaterThanOrEqual(2);
      expect(recs.some((r) => r.title.includes('Electricity'))).toBe(true);
      expect(recs.some((r) => r.id.includes('scope'))).toBe(true);
    });

    it('returns empty list when there is no emission signal', () => {
      const recs = buildTransactionFallbackRecommendations({
        categoryFromTx: [],
        scope1: 0,
        scope2: 0,
        scope3: 0,
        txnTotalCo2: 0
      });
      expect(recs).toEqual([]);
    });
  });
});
