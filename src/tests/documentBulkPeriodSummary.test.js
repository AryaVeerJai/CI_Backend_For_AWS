const {
  normalizeDocumentBulkPeriodType,
  periodWiseKeyFromApiType,
  extractPeriodGroupsFromAssessment,
  buildPeriodSummaryPayload
} = require('../utils/documentBulkPeriodSummary');

describe('documentBulkPeriodSummary utils', () => {
  test('normalizes API period types and maps date_wise to datewise', () => {
    expect(normalizeDocumentBulkPeriodType('MONTHLY')).toBe('monthly');
    expect(normalizeDocumentBulkPeriodType('invalid')).toBe('monthly');
    expect(periodWiseKeyFromApiType('date_wise')).toBe('datewise');
    expect(periodWiseKeyFromApiType('monthly')).toBe('monthly');
  });

  test('extracts period groups from mobileBreakdown.periodWise', () => {
    const assessment = {
      assessmentType: 'automatic',
      mobileBreakdown: {
        source: 'document_bulk_upload',
        periodWise: {
          monthly: [
            {
              period: '2026-01',
              transactionCount: 2,
              totalAmount: 2500,
              totalCO2Emissions: 65
            }
          ]
        }
      }
    };

    const groups = extractPeriodGroupsFromAssessment(assessment, 'monthly');
    expect(groups).toHaveLength(1);
    expect(groups[0].period).toBe('2026-01');

    const summary = buildPeriodSummaryPayload({
      groups,
      periodType: 'monthly',
      assessment,
      source: 'assessment'
    });

    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0].periodStart).toBe('2026-01');
    expect(summary.groups[0].totalEmissions).toBe(65);
    expect(summary.totalTransactions).toBe(2);
  });

  test('prefers documentBulkMetrics periodSummaries when present', () => {
    const assessment = {
      documentBulkMetrics: {
        periodSummaries: {
          monthly: {
            groups: [
              {
                periodStart: '2025-12',
                totalTransactions: 4,
                totalAmount: 4000,
                totalEmissions: 120
              }
            ]
          }
        }
      },
      mobileBreakdown: {
        periodWise: {
          monthly: [{ period: '2025-11', transactionCount: 1, totalCO2Emissions: 10 }]
        }
      }
    };

    const groups = extractPeriodGroupsFromAssessment(assessment, 'monthly');
    expect(groups[0].periodStart).toBe('2025-12');
  });
});
