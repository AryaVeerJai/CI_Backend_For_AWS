jest.mock('../config/aiService', () => ({}));
jest.mock('../services/aiDataExtractionService', () => {
  return jest.fn().mockImplementation(() => ({}));
});
jest.mock('../services/advancedCarbonCalculationService', () => {
  return jest.fn().mockImplementation(() => ({}));
});
jest.mock('../services/aiAgentService', () => ({}));
jest.mock('../services/verifiedKnowledgeRagService', () => ({
  classifyUnknownFields: jest.fn(() => ({}))
}));

const carbonCalculationService = require('../services/carbonCalculationService');
const { buildBRSRReport } = require('../services/brsrReportingService');
const documentProcessingService = require('../services/documentProcessingService');

describe('DocumentProcessingService bulk emission summary', () => {
  test('should build annual, monthly, weekly and date-wise summaries', () => {
    const transactions = [
      {
        date: '2026-01-03T10:00:00.000Z',
        amount: 1000,
        category: 'energy',
        subcategory: 'electricity',
        source: 'manual',
        carbonFootprint: { co2Emissions: 25 }
      },
      {
        date: '2026-01-09T10:00:00.000Z',
        amount: 1500,
        category: 'transportation',
        subcategory: 'freight',
        source: 'manual',
        carbonFootprint: { co2Emissions: 40 }
      },
      {
        date: '2026-02-01T10:00:00.000Z',
        amount: 500,
        category: 'energy',
        subcategory: 'diesel',
        source: 'manual',
        carbonFootprint: { co2Emissions: 15 }
      }
    ];

    const summary = documentProcessingService.generatePeriodWiseEmissionsSummary(transactions);

    expect(summary.totalTransactions).toBe(3);
    expect(summary.totalAmount).toBe(3000);
    expect(summary.totalCO2Emissions).toBe(80);

    expect(summary.periodWise.annual).toHaveLength(1);
    expect(summary.periodWise.annual[0].period).toBe('2026');
    expect(summary.periodWise.annual[0].totalCO2Emissions).toBe(80);

    expect(summary.periodWise.monthly).toEqual(expect.arrayContaining([
      expect.objectContaining({ period: '2026-01', transactionCount: 2, totalCO2Emissions: 65 }),
      expect.objectContaining({ period: '2026-02', transactionCount: 1, totalCO2Emissions: 15 })
    ]));

    expect(summary.periodWise.weekly.length).toBeGreaterThan(0);
    expect(summary.periodWise.datewise).toEqual(expect.arrayContaining([
      expect.objectContaining({ period: '2026-01-03', totalCO2Emissions: 25 }),
      expect.objectContaining({ period: '2026-01-09', totalCO2Emissions: 40 }),
      expect.objectContaining({ period: '2026-02-01', totalCO2Emissions: 15 })
    ]));
    expect(summary.categoryBreakdown[0].category).toBe('energy');
  });

  test.each([
    'manufacturing',
    'trading',
    'services',
    'export_import',
    'retail',
    'wholesale',
    'e_commerce',
    'consulting',
    'logistics',
    'agriculture',
    'handicrafts',
    'food_processing',
    'textiles',
    'electronics',
    'automotive',
    'construction',
    'healthcare',
    'education',
    'tourism',
    'other'
  ])('should support mocked bulk upload emissions, recommendations and reporting for %s sector', async (businessDomain) => {
    const msme = {
      companyName: `${businessDomain} MSME`,
      companyType: 'small',
      industry: businessDomain,
      businessDomain,
      establishmentYear: 2018,
      udyamRegistrationNumber: 'UDYAM-KA-01-1234567',
      gstNumber: '29ABCDE1234F1Z5',
      panNumber: 'ABCDE1234F',
      business: {
        annualTurnover: 42000000,
        numberOfEmployees: 90,
        manufacturingUnits: 1
      },
      contact: {
        address: {
          state: 'Karnataka',
          city: 'Bengaluru',
          country: 'India'
        }
      },
      environmentalCompliance: {
        hasEnvironmentalClearance: true,
        hasPollutionControlBoard: true,
        hasWasteManagement: true
      }
    };

    const mockedBulkUploadTransactions = [
      {
        date: '2026-01-03T10:00:00.000Z',
        amount: 8000,
        category: 'energy',
        subcategory: 'grid',
        source: 'document_bulk_upload'
      },
      {
        date: '2026-01-09T10:00:00.000Z',
        amount: 8000,
        category: 'energy',
        subcategory: 'grid',
        source: 'document_bulk_upload'
      },
      {
        date: '2026-01-15T10:00:00.000Z',
        amount: 1200,
        category: 'waste_management',
        subcategory: 'solid',
        source: 'document_bulk_upload'
      },
      {
        date: '2026-01-21T10:00:00.000Z',
        amount: 7000,
        category: 'raw_materials',
        subcategory: 'steel',
        source: 'document_bulk_upload'
      },
      {
        date: '2026-01-27T10:00:00.000Z',
        amount: 10000,
        category: 'transportation',
        subcategory: 'diesel',
        source: 'document_bulk_upload'
      }
    ];

    const summary = documentProcessingService.generatePeriodWiseEmissionsSummary(mockedBulkUploadTransactions);
    const assessment = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
      msme,
      summary.granularTransactions
    );
    assessment.period = {
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-01-31T23:59:59.000Z')
    };

    const report = buildBRSRReport({
      msme,
      assessment,
      assessmentHistory: [],
      transactions: summary.granularTransactions,
      requestedPeriod: 'monthly'
    });

    expect(summary.totalTransactions).toBe(mockedBulkUploadTransactions.length);
    expect(summary.totalCO2Emissions).toBeGreaterThan(0);
    expect(summary.periodWise.monthly).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ period: '2026-01' })
      ])
    );
    expect(assessment.totalCO2Emissions).toBeGreaterThan(0);
    expect(assessment.recommendations.length).toBeGreaterThan(0);
    expect(report.reportType).toBe('BRSR');
    expect(report.valueChain.summary.totalTransactions).toBe(mockedBulkUploadTransactions.length);
    expect(report.environmental.greenhouseGasEmissions.total).toBeGreaterThan(0);
  });
});
