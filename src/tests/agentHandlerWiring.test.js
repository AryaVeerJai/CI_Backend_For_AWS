const { handlers } = require('../services/agents/handlers/standardHandlers');
const recommendationEngineAgent = require('../services/agents/recommendationEngineAgent');
const reportGeneratorAgent = require('../services/agents/reportGeneratorAgent');

jest.mock('../services/agents/carbonAnalyzerAgent', () => ({
  analyzeTransactions: jest.fn(async () => ({
    totalEmissions: 600,
    categoryBreakdown: {
      energy: { emissions: 600, count: 2, amount: 1000 }
    },
    insights: [{ type: 'emission_peak' }],
    recommendations: [{ category: 'energy', title: 'Test', priority: 'high' }],
    esgScopeBreakdown: { scope1: 0, scope2: 600, scope3: 0 },
    carbonScore: 70,
    anomalies: []
  }))
}));

describe('standardHandlers agent wiring', () => {
  test('carbon_analyzer returns flat categoryBreakdown for legacy consumers', async () => {
    const result = await handlers.carbon_analyzer({
      input: {
        transactions: [{ category: 'energy', amount: 500 }],
        msmeData: { companyName: 'Test Co' }
      }
    });
    expect(result.error).toBeUndefined();
    expect(result.totalEmissions).toBe(600);
    expect(result.categoryBreakdown.energy).toBe(600);
    expect(result.breakdown.energy.total).toBe(600);
  });

  test('recommendation_engine delegates to recommendationEngineAgent', async () => {
    const spy = jest.spyOn(recommendationEngineAgent, 'generateRecommendations').mockResolvedValue({
      recommendations: [{ category: 'energy', title: 'Delegated', priority: 'high' }],
      totalGenerated: 1,
      categories: ['energy']
    });

    const result = await handlers.recommendation_engine({
      input: {
        carbonData: {
          totalEmissions: 600,
          categoryBreakdown: { energy: 600 }
        }
      }
    });

    expect(spy).toHaveBeenCalled();
    expect(result.recommendations[0].title).toBe('Delegated');
    spy.mockRestore();
  });

  test('report_generator delegates to reportGeneratorAgent', async () => {
    const spy = jest.spyOn(reportGeneratorAgent, 'generateReport').mockResolvedValue({
      summary: { title: 'Delegated report' },
      sections: [],
      charts: [],
      recommendations: [],
      reportingOutcomes: { frameworks: [], readinessByFramework: {}, disclosureHighlights: [] }
    });

    const result = await handlers.report_generator({
      input: {
        carbonData: {
          totalEmissions: 600,
          categoryBreakdown: { energy: 600 }
        }
      }
    });

    expect(spy).toHaveBeenCalled();
    expect(result.summary.title).toBe('Delegated report');
    spy.mockRestore();
  });

  test('anomaly_detector returns non-empty anomalies for outlier transactions', async () => {
    const result = await handlers.anomaly_detector({
      input: {
        transactions: [
          { category: 'energy', amount: 100, _computedEmissions: 10 },
          { category: 'energy', amount: 100, _computedEmissions: 10 },
          { category: 'energy', amount: 10000, _computedEmissions: 200 }
        ]
      }
    });
    expect(result.totalDetected).toBeGreaterThan(0);
    expect(result.severity).not.toBe('none');
  });

  test('trend_analyzer returns trends and predictions from transactions', async () => {
    const result = await handlers.trend_analyzer({
      input: {
        transactions: [
          { category: 'energy', amount: 100, date: '2025-01-01', _computedEmissions: 10 },
          { category: 'energy', amount: 100, date: '2025-02-01', _computedEmissions: 20 }
        ]
      }
    });
    expect(result.trends.emissions.monthly.length).toBeGreaterThan(0);
    expect(result.predictions).toBeDefined();
  });
});
