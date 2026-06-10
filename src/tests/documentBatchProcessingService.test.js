jest.mock('../services/carbonCalculationService', () => ({
  calculateTransactionCarbonFootprint: jest.fn((transaction) => ({
    co2Emissions: Number(transaction.amount || 0) * 0.1,
    emissionFactor: 0.1,
    calculationMethod: 'mock'
  })),
  calculateTransactionCarbonFootprintForAgent: jest.fn(async (transaction) => ({
    co2Emissions: Number(transaction.amount || 0) * 0.1,
    emissionFactor: 0.1,
    calculationMethod: 'mock'
  })),
  ensureCarbonFootprintMetrics: jest.fn((_transaction, footprint = {}) => ({
    ...footprint,
    co2Emissions: Number(footprint.co2Emissions ?? 0),
    emissionFactor: Number(footprint.emissionFactor ?? 0),
    calculationMethod: footprint.calculationMethod || 'mock',
    emissionBreakdown: footprint.emissionBreakdown || {
      scope1: 0,
      scope2: 0,
      scope3: Number(footprint.co2Emissions ?? 0)
    }
  })),
  calculateMSMECarbonFootprint: jest.fn(() => ({
    totalCO2Emissions: 0,
    breakdown: {},
    esgScopes: {},
    carbonScore: 80,
    recommendations: []
  })),
  resolveRegion: jest.fn(() => 'north-india')
}));

jest.mock('../services/duplicateDetectionService', () => ({
  detectDuplicate: jest.fn()
}));

jest.mock('../models/Transaction', () => {
  return jest.fn().mockImplementation(function MockTransaction(payload) {
    this._id = payload.sourceId || `txn_${Date.now()}`;
    this.payload = payload;
    this.save = jest.fn().mockResolvedValue(this);
    this.toObject = jest.fn(() => ({
      _id: this._id,
      ...payload
    }));
    Object.assign(this, payload);
  });
});

jest.mock('../services/orchestrationManagerEventService', () => ({
  emitEvent: jest.fn()
}));

const aiAgentService = require('../services/aiAgentService');
const duplicateDetectionService = require('../services/duplicateDetectionService');
const Transaction = require('../models/Transaction');
const documentProcessingService = require('../services/documentProcessingService');

describe('Document Processing Service - Batch AI and deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should parse multiple documents into transactions with AI pipeline', async () => {
    jest.spyOn(aiAgentService, 'documentAnalyzerAgent').mockResolvedValue({
      summary: {
        totalDocuments: 2,
        processedDocuments: 2
      },
      derivedTransactions: [
        {
          source: 'document',
          sourceId: 'doc-1',
          transactionType: 'expense',
          amount: 1200,
          currency: 'INR',
          description: 'Electricity bill payment',
          vendor: { name: 'Utility Board' },
          category: 'energy',
          subcategory: 'grid',
          date: new Date('2026-02-01T00:00:00.000Z')
        }
      ]
    });
    jest.spyOn(aiAgentService, 'dataProcessorAgent').mockResolvedValue({
      validated: [
        {
          source: 'document',
          sourceId: 'doc-1',
          transactionType: 'expense',
          amount: 1200,
          currency: 'INR',
          description: 'Electricity bill payment',
          vendor: { name: 'Utility Board' },
          category: 'energy',
          subcategory: 'grid',
          date: new Date('2026-02-01T00:00:00.000Z')
        }
      ],
      statistics: {
        totalProcessed: 1,
        successfullyClassified: 1
      }
    });
    jest.spyOn(aiAgentService, 'carbonAnalyzerAgent').mockResolvedValue({
      totalEmissions: 120,
      categoryBreakdown: { energy: 120 }
    });

    const documents = [
      {
        _id: { toString: () => 'doc-1' },
        msmeId: 'msme-1',
        status: 'processed',
        documentType: 'bill',
        extractedData: {
          amount: 1200,
          currency: 'INR',
          date: new Date('2026-02-01T00:00:00.000Z'),
          description: 'Electricity bill payment',
          vendor: { name: 'Utility Board' },
          category: 'energy',
          subcategory: 'grid'
        }
      },
      {
        _id: { toString: () => 'doc-2' },
        msmeId: 'msme-1',
        status: 'processed',
        documentType: 'invoice',
        extractedData: {
          amount: 800,
          currency: 'INR',
          date: new Date('2026-02-02T00:00:00.000Z'),
          description: 'Water utility payment',
          vendor: { name: 'Water Board' },
          category: 'water',
          subcategory: 'general'
        }
      }
    ];

    const result = await documentProcessingService.parseMultipleDocumentsIntoTransactions(
      documents,
      { businessDomain: 'services' }
    );

    expect(result.totalDocuments).toBe(2);
    expect(result.parsedTransactions).toHaveLength(1);
    expect(result.parsedTransactions[0].carbonFootprint.co2Emissions).toBeCloseTo(120);
    expect(result.carbonAnalysis.totalEmissions).toBe(120);
    expect(aiAgentService.documentAnalyzerAgent).toHaveBeenCalled();
    expect(aiAgentService.dataProcessorAgent).toHaveBeenCalled();
    expect(aiAgentService.carbonAnalyzerAgent).toHaveBeenCalled();
  });

  test('should skip creating duplicate document transactions', async () => {
    duplicateDetectionService.detectDuplicate
      .mockResolvedValueOnce({
        isDuplicate: true,
        duplicateType: 'exact',
        similarityScore: 0.99,
        matchedTransaction: { _id: 'txn-existing-1' },
        reasons: ['Cross-channel transaction match (sms ↔ manual)']
      })
      .mockResolvedValueOnce({
        isDuplicate: false,
        duplicateType: null,
        similarityScore: 0,
        matchedTransaction: null,
        reasons: []
      });

    const document = {
      _id: { toString: () => 'doc-100' },
      msmeId: 'msme-100',
      documentType: 'invoice',
      originalName: 'office-invoice.pdf',
      extractedData: {
        currency: 'INR',
        description: 'Office supplies invoice',
        vendor: { name: 'ABC Stationery' },
        referenceNumber: 'INV-9001'
      },
      processingResults: {
        confidence: 0.92
      },
      carbonFootprint: {
        co2Emissions: 150,
        emissionFactor: 0.1
      }
    };

    const itemFootprints = [
      {
        name: 'A4 paper',
        total: 500,
        category: 'raw_materials',
        subcategory: 'general',
        carbonFootprint: { co2Emissions: 50, emissionFactor: 0.1 }
      },
      {
        name: 'Printer ink',
        total: 1000,
        category: 'raw_materials',
        subcategory: 'general',
        carbonFootprint: { co2Emissions: 100, emissionFactor: 0.1 }
      }
    ];

    const result = await documentProcessingService.createTransactionsFromDocument(document, itemFootprints);

    expect(result.createdTransactions).toHaveLength(1);
    expect(result.skippedDuplicates).toHaveLength(1);
    expect(result.skippedDuplicates[0].matchedTransactionId).toBe('txn-existing-1');
    expect(Transaction).toHaveBeenCalledTimes(1);
    expect(duplicateDetectionService.detectDuplicate).toHaveBeenCalledTimes(2);
  });
});
