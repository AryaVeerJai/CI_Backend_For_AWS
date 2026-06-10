jest.mock('../services/complianceHubService', () => ({
  loadMsmeReportingContext: jest.fn()
}));

jest.mock('../models/ComplianceHubRecord', () => ({
  findOne: jest.fn()
}));

jest.mock('../models/UserPrivacySettings', () => ({
  findOne: jest.fn()
}));

jest.mock('../services/isoCertificationAutomationService', () => ({
  automateCertification: jest.fn()
}));

const { loadMsmeReportingContext } = require('../services/complianceHubService');
const ComplianceHubRecord = require('../models/ComplianceHubRecord');
const UserPrivacySettings = require('../models/UserPrivacySettings');
const msmeAdvisoryOrchestrationService = require('../services/msmeAdvisoryOrchestrationService');

describe('msmeAdvisoryOrchestrationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadMsmeReportingContext.mockResolvedValue({
      msme: {
        companyName: 'Demo MSME',
        environmentalCompliance: { hasWasteManagement: true },
        operations: { waterSource: 'Municipal' }
      },
      transactions: [{ category: 'energy', quantificationMethod: 'activity', metadata: { kwh: 500 } }],
      bills: [{ _id: 'doc1' }],
      latestAssessment: { totalCO2Emissions: 12000, esgScopes: { scope1: { total: 1000 } } },
      totalKg: 12000
    });
    ComplianceHubRecord.findOne.mockReturnValue({
      lean: () => Promise.resolve({ supplierQuestionnaires: [] })
    });
    UserPrivacySettings.findOne.mockReturnValue({
      lean: () => Promise.resolve({ dataRetention: true, auditLogging: true, smsProcessing: true })
    });
  });

  test('runAdvisory returns trust panel and goal actions', async () => {
    const result = await msmeAdvisoryOrchestrationService.runAdvisory({
      msmeId: '507f1f77bcf86cd799439011',
      signupGoal: 'buyer_audit',
      period: 'annual'
    });

    expect(result.advisoryId).toMatch(/^adv_/);
    expect(result.trustPanel.inventoryQualityScore).toBeGreaterThan(0);
    expect(result.outputs.goalAdvisory.signupGoal).toBe('buyer_audit');
    expect(result.agentPipeline.length).toBe(5);
    expect(result.agentPipeline.every((s) => s.status === 'completed')).toBe(true);
  });

  test('rejects missing msme id', async () => {
    await expect(
      msmeAdvisoryOrchestrationService.runAdvisory({ msmeId: null })
    ).rejects.toThrow('MSME ID is required');
  });
});
