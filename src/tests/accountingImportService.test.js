jest.mock('../models/Transaction', () => {
  const save = jest.fn().mockResolvedValue(undefined);
  return jest.fn().mockImplementation((payload) => ({
    ...payload,
    _id: 'txn-mock-id',
    save
  }));
});

jest.mock('../services/duplicateDetectionService', () => ({
  detectDuplicate: jest.fn().mockResolvedValue({ isDuplicate: false })
}));

jest.mock('../services/orchestrationManagerEventService', () => ({
  emitEvent: jest.fn()
}));

jest.mock('../services/agents/dataProcessorAgent', () => ({
  processTransactions: jest.fn().mockResolvedValue({
    classified: [],
    documentRequests: []
  })
}));

jest.mock('../models/MSME', () => ({
  findById: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue({
      _id: 'msme-1',
      industry: 'manufacturing',
      businessDomain: 'textiles'
    })
  })
}));

jest.mock('../services/carbonCalculationService', () => ({
  calculateTransactionCarbonFootprint: jest.fn(() => ({
    co2Emissions: 1.2,
    category: 'utilities'
  })),
  calculateTransactionCarbonFootprintForAgent: jest.fn(async () => ({
    co2Emissions: 2.4,
    category: 'utilities',
    calculationMethod: 'agent'
  }))
}));

const Transaction = require('../models/Transaction');
const duplicateDetectionService = require('../services/duplicateDetectionService');
const orchestrationManagerEventService = require('../services/orchestrationManagerEventService');
const dataProcessorAgent = require('../services/agents/dataProcessorAgent');
const carbonCalculationService = require('../services/carbonCalculationService');
const { persistParsedAccountingTransactions } = require('../services/accountingImportService');
const { HIGH_VALUE_THRESHOLD_INR } = require('../config/highValueTransactionPolicy');

describe('accountingImportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    duplicateDetectionService.detectDuplicate.mockResolvedValue({ isDuplicate: false });
    dataProcessorAgent.processTransactions.mockResolvedValue({
      classified: [{
        sourceId: 'hv-1',
        category: 'equipment',
        processingMetadata: { classification: { category: { value: 'equipment' } } }
      }],
      documentRequests: [{
        transactionId: 'hv-1',
        message: 'Please upload invoices'
      }]
    });
  });

  test('should defer high-value rows and request bill uploads', async () => {
    const parsedResult = {
      provider: 'tally',
      parsedCount: 2,
      validRows: [
        {
          rowIndex: 1,
          parsed: {
            sourceId: 'hv-1',
            amount: HIGH_VALUE_THRESHOLD_INR + 1,
            category: 'equipment',
            transactionType: 'purchase',
            description: 'Industrial boiler',
            date: new Date('2026-05-01')
          }
        },
        {
          rowIndex: 2,
          parsed: {
            sourceId: 'std-1',
            amount: 1200,
            category: 'utilities',
            transactionType: 'expense',
            description: 'Electricity',
            date: new Date('2026-05-02')
          }
        }
      ],
      invalidRows: []
    };

    const result = await persistParsedAccountingTransactions({
      msmeId: 'msme-1',
      organizationId: 'org-1',
      parsedResult
    });

    expect(result.actionRequired).toBe(true);
    expect(result.pendingBillUpload).toHaveLength(1);
    expect(result.pendingBillUpload[0].uploadRequest.workflow).toBe('high_value_accounting');
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].sourceId).toBe('std-1');
    expect(Transaction).toHaveBeenCalledTimes(1);
    expect(dataProcessorAgent.processTransactions).toHaveBeenCalled();
    expect(orchestrationManagerEventService.emitEvent).toHaveBeenCalledWith(
      'transactions.accounting_high_value_pending_bill_upload',
      expect.objectContaining({ sourceId: 'hv-1' }),
      'transactions'
    );
  });

  test('should import all rows when none are high-value', async () => {
    const parsedResult = {
      provider: 'tally',
      parsedCount: 1,
      validRows: [{
        rowIndex: 1,
        parsed: {
          sourceId: 'std-2',
          amount: 500,
          category: 'utilities',
          transactionType: 'expense',
          description: 'Water bill',
          date: new Date('2026-05-03')
        }
      }],
      invalidRows: []
    };

    const result = await persistParsedAccountingTransactions({
      msmeId: 'msme-1',
      organizationId: 'org-1',
      parsedResult
    });

    expect(result.actionRequired).toBe(false);
    expect(result.pendingBillUpload).toHaveLength(0);
    expect(result.imported).toHaveLength(1);
    expect(dataProcessorAgent.processTransactions).toHaveBeenCalled();
    expect(result.runAgents).toBe(true);
  });

  test('should defer all rows when every valid row is high-value', async () => {
    const parsedResult = {
      provider: 'zoho',
      parsedCount: 2,
      validRows: [
        {
          rowIndex: 1,
          parsed: {
            sourceId: 'hv-a',
            amount: HIGH_VALUE_THRESHOLD_INR,
            category: 'raw_materials',
            transactionType: 'purchase',
            description: 'Steel coils',
            date: new Date('2026-05-01')
          }
        },
        {
          rowIndex: 2,
          parsed: {
            sourceId: 'hv-b',
            amount: HIGH_VALUE_THRESHOLD_INR + 5000,
            transactionType: 'transport',
            description: 'Fleet lease',
            date: new Date('2026-05-02')
          }
        }
      ],
      invalidRows: []
    };

    const result = await persistParsedAccountingTransactions({
      msmeId: 'msme-1',
      organizationId: 'org-1',
      parsedResult
    });

    expect(result.actionRequired).toBe(true);
    expect(result.imported).toHaveLength(0);
    expect(result.pendingBillUpload).toHaveLength(2);
    expect(result.totals.pendingBillUpload).toBe(2);
    expect(Transaction).not.toHaveBeenCalled();
    expect(orchestrationManagerEventService.emitEvent).toHaveBeenCalledWith(
      'transactions.accounting_imported',
      expect.objectContaining({
        pendingBillUploadCount: 2,
        importedCount: 0
      }),
      'transactions'
    );
  });

  test('should record duplicates for standard rows without deferring them', async () => {
    duplicateDetectionService.detectDuplicate.mockResolvedValue({
      isDuplicate: true,
      reasons: ['matching_amount_and_date'],
      similarityScore: 0.95
    });

    const parsedResult = {
      provider: 'tally',
      parsedCount: 1,
      validRows: [{
        rowIndex: 4,
        parsed: {
          sourceId: 'dup-1',
          amount: 800,
          category: 'utilities',
          transactionType: 'expense',
          description: 'Duplicate utility bill',
          date: new Date('2026-05-04')
        }
      }],
      invalidRows: []
    };

    const result = await persistParsedAccountingTransactions({
      msmeId: 'msme-1',
      parsedResult
    });

    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]).toMatchObject({
      rowIndex: 4,
      sourceId: 'dup-1',
      similarityScore: 0.95
    });
    expect(result.imported).toHaveLength(0);
    expect(result.pendingBillUpload).toHaveLength(0);
    expect(Transaction).not.toHaveBeenCalled();
  });

  test('should attach agent document request and classification to pending uploads', async () => {
    dataProcessorAgent.processTransactions.mockResolvedValue({
      classified: [{
        sourceId: 'hv-enriched',
        processingMetadata: { classification: { category: { value: 'equipment' } } }
      }],
      documentRequests: [{
        transactionId: 'hv-enriched',
        message: 'Upload vendor invoice PDF'
      }]
    });

    const parsedResult = {
      provider: 'quickbooks',
      parsedCount: 1,
      validRows: [{
        rowIndex: 10,
        parsed: {
          sourceId: 'hv-enriched',
          amount: HIGH_VALUE_THRESHOLD_INR + 100,
          category: 'equipment',
          transactionType: 'purchase',
          description: 'Generator set',
          date: new Date('2026-05-10')
        }
      }],
      invalidRows: []
    };

    const result = await persistParsedAccountingTransactions({
      msmeId: 'msme-1',
      parsedResult
    });

    const pending = result.pendingBillUpload[0];
    expect(pending.uploadRequest.documentRequest.message).toBe('Upload vendor invoice PDF');
    expect(pending.uploadRequest.agentClassification).toEqual({
      classification: { category: { value: 'equipment' } }
    });
    expect(pending.uploadRequest.transactionPreview.importRowIndex).toBe(10);
  });

  test('should still create pending uploads when agent enrichment fails', async () => {
    dataProcessorAgent.processTransactions.mockRejectedValue(new Error('agent offline'));

    const parsedResult = {
      provider: 'tally',
      parsedCount: 1,
      validRows: [{
        rowIndex: 3,
        parsed: {
          sourceId: 'hv-agent-fail',
          amount: HIGH_VALUE_THRESHOLD_INR,
          category: 'maintenance',
          transactionType: 'expense',
          description: 'Plant overhaul',
          date: new Date('2026-05-03')
        }
      }],
      invalidRows: []
    };

    const result = await persistParsedAccountingTransactions({
      msmeId: 'msme-1',
      parsedResult
    });

    expect(result.pendingBillUpload).toHaveLength(1);
    expect(result.pendingBillUpload[0].sourceId).toBe('hv-agent-fail');
    expect(result.pendingBillUpload[0].uploadRequest.workflow).toBe('high_value_accounting');
    expect(result.pendingBillUpload[0].uploadRequest.documentRequest).toBeUndefined();
  });

  test('should use data processor and agent carbon path by default', async () => {
    dataProcessorAgent.processTransactions.mockResolvedValue({
      classified: [{
        sourceId: 'std-agent',
        category: 'energy',
        processingMetadata: { classification: { category: { value: 'energy' } } }
      }],
      documentRequests: []
    });

    const parsedResult = {
      provider: 'zoho',
      parsedCount: 1,
      validRows: [{
        rowIndex: 1,
        parsed: {
          sourceId: 'std-agent',
          amount: 1500,
          category: 'utilities',
          transactionType: 'expense',
          description: 'Factory power',
          date: new Date('2026-05-05')
        }
      }],
      invalidRows: []
    };

    const result = await persistParsedAccountingTransactions({
      msmeId: 'msme-1',
      organizationId: 'org-1',
      parsedResult
    });

    expect(result.runAgents).toBe(true);
    expect(result.imported).toHaveLength(1);
    expect(dataProcessorAgent.processTransactions).toHaveBeenCalled();
    expect(carbonCalculationService.calculateTransactionCarbonFootprintForAgent).toHaveBeenCalled();
    expect(carbonCalculationService.calculateTransactionCarbonFootprint).not.toHaveBeenCalled();
  });

  test('should use basic carbon path when runAgents is disabled', async () => {
    const parsedResult = {
      provider: 'zoho',
      parsedCount: 1,
      validRows: [{
        rowIndex: 1,
        parsed: {
          sourceId: 'std-basic',
          amount: 1500,
          category: 'utilities',
          transactionType: 'expense',
          description: 'Factory power',
          date: new Date('2026-05-05')
        }
      }],
      invalidRows: []
    };

    const result = await persistParsedAccountingTransactions({
      msmeId: 'msme-1',
      organizationId: 'org-1',
      parsedResult,
      runAgents: false
    });

    expect(result.runAgents).toBe(false);
    expect(result.imported).toHaveLength(1);
    expect(carbonCalculationService.calculateTransactionCarbonFootprint).toHaveBeenCalled();
    expect(carbonCalculationService.calculateTransactionCarbonFootprintForAgent).not.toHaveBeenCalled();
  });

  test('should surface invalid rows in the import summary', async () => {
    const parsedResult = {
      provider: 'tally',
      parsedCount: 2,
      validRows: [],
      invalidRows: [{
        rowIndex: 99,
        errors: ['missing_amount'],
        parsed: { sourceId: 'bad-row' }
      }]
    };

    const result = await persistParsedAccountingTransactions({
      msmeId: 'msme-1',
      parsedResult,
      receivedCount: 5
    });

    expect(result.invalidRows).toEqual([{
      rowIndex: 99,
      errors: ['missing_amount'],
      sourceId: 'bad-row'
    }]);
    expect(result.totals.received).toBe(5);
    expect(result.totals.invalid).toBe(1);
  });
});
