jest.mock('../models/Transaction', () => ({
  find: jest.fn()
}));

jest.mock('../models/MSME', () => ({
  findById: jest.fn()
}));

jest.mock('../services/accountingSyncService', () => ({
  listConnectorStatuses: jest.fn(),
  syncProviderTransactions: jest.fn()
}));

jest.mock('../services/accountingImportService', () => ({
  persistParsedAccountingTransactions: jest.fn()
}));

jest.mock('../services/carbonCalculationService', () => ({
  calculateMSMECarbonFootprintAsync: jest.fn()
}));

jest.mock('../services/msmeEmissionsOrchestrationService', () => ({
  orchestrateEmissions: jest.fn()
}));

const Transaction = require('../models/Transaction');
const MSME = require('../models/MSME');
const accountingSyncService = require('../services/accountingSyncService');
const { persistParsedAccountingTransactions } = require('../services/accountingImportService');
const carbonCalculationService = require('../services/carbonCalculationService');
const msmeEmissionsOrchestrationService = require('../services/msmeEmissionsOrchestrationService');
const {
  syncConnectorsAndCalculateCarbon,
  runPostImportCarbonAnalysis,
  resolveCarbonPipelineOptions
} = require('../services/msmeConnectorCarbonService');

describe('msmeConnectorCarbonService', () => {
  const req = {
    user: {
      msmeId: 'msme-1',
      organizationId: 'org-1',
      legalName: 'Acme Pvt Ltd'
    },
    body: {}
  };

  beforeEach(() => {
    jest.clearAllMocks();

    MSME.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: 'msme-1',
        companyName: 'Acme Pvt Ltd',
        industry: 'manufacturing'
      })
    });

    accountingSyncService.listConnectorStatuses.mockResolvedValue([
      {
        id: 'zoho',
        supportsApiSync: true,
        api: { syncReady: true }
      },
      {
        id: 'busy',
        supportsApiSync: false,
        api: { syncReady: false }
      }
    ]);

    accountingSyncService.syncProviderTransactions.mockResolvedValue({
      fetchedCount: 2,
      parsedResult: {
        provider: 'zoho',
        parsedCount: 2,
        validRows: [],
        invalidRows: []
      }
    });

    persistParsedAccountingTransactions.mockResolvedValue({
      imported: [{ id: 'txn-1', sourceId: 'z-1' }],
      totals: { imported: 1 }
    });

    Transaction.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{
          _id: 'txn-1',
          sourceId: 'z-1',
          amount: 1000,
          category: 'utilities'
        }])
      })
    });

    carbonCalculationService.calculateMSMECarbonFootprintAsync.mockResolvedValue({
      totalCO2Emissions: 12.5
    });

    msmeEmissionsOrchestrationService.orchestrateEmissions.mockResolvedValue({
      orchestrationId: 'orch-1',
      status: 'completed'
    });
  });

  test('syncs API-ready connectors and runs multi-agent carbon orchestration', async () => {
    const result = await syncConnectorsAndCalculateCarbon(req, {
      runAgents: true,
      runOrchestration: true
    });

    expect(accountingSyncService.syncProviderTransactions).toHaveBeenCalledWith(
      'zoho',
      expect.objectContaining({ msmeId: 'msme-1', organizationId: 'org-1' })
    );
    expect(persistParsedAccountingTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        runAgents: true,
        msmeData: expect.objectContaining({ _id: 'msme-1' })
      })
    );
    expect(carbonCalculationService.calculateMSMECarbonFootprintAsync).toHaveBeenCalled();
    expect(msmeEmissionsOrchestrationService.orchestrateEmissions).toHaveBeenCalledWith(
      expect.objectContaining({
        msmeId: 'msme-1',
        transactions: expect.arrayContaining([
          expect.objectContaining({ _id: 'txn-1' })
        ])
      })
    );
    expect(result.syncResults).toHaveLength(1);
    expect(result.connectorTransactions.count).toBe(1);
    expect(result.orchestration.orchestrationId).toBe('orch-1');
  });

  test('skips orchestration when disabled', async () => {
    await syncConnectorsAndCalculateCarbon(req, {
      runAgents: true,
      runOrchestration: false
    });

    expect(msmeEmissionsOrchestrationService.orchestrateEmissions).not.toHaveBeenCalled();
    expect(carbonCalculationService.calculateMSMECarbonFootprintAsync).toHaveBeenCalled();
  });

  test('resolveCarbonPipelineOptions defaults agents and orchestration to enabled', () => {
    expect(resolveCarbonPipelineOptions({})).toEqual({
      runAgents: true,
      runOrchestration: true
    });
    expect(resolveCarbonPipelineOptions({ runAgents: false, runOrchestration: 'false' })).toEqual({
      runAgents: false,
      runOrchestration: false
    });
  });

  test('runPostImportCarbonAnalysis assesses imported transactions', async () => {
    const result = await runPostImportCarbonAnalysis({
      msmeId: 'msme-1',
      organizationId: 'org-1',
      importedIds: ['txn-1'],
      runAgents: true,
      runOrchestration: true,
      msmeData: { _id: 'msme-1', industry: 'manufacturing' }
    });

    expect(carbonCalculationService.calculateMSMECarbonFootprintAsync).toHaveBeenCalled();
    expect(msmeEmissionsOrchestrationService.orchestrateEmissions).toHaveBeenCalled();
    expect(result.connectorTransactions.count).toBe(1);
    expect(result.carbonAssessment.totalCO2Emissions).toBe(12.5);
  });
});
