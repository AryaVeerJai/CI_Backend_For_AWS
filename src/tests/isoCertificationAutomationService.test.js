jest.mock('../models/MSME', () => ({
  findById: jest.fn()
}));

jest.mock('../services/aiAgentService', () => ({
  complianceMonitorAgent: jest.fn(),
  isoEvidenceCollectorAgent: jest.fn(),
  isoGapClosurePlannerAgent: jest.fn(),
  isoAuditPackagerAgent: jest.fn()
}));

jest.mock('../services/msmeEmissionsOrchestrationService', () => ({
  orchestrateEmissions: jest.fn()
}));

const MSME = require('../models/MSME');
const aiAgentService = require('../services/aiAgentService');
const msmeEmissionsOrchestrationService = require('../services/msmeEmissionsOrchestrationService');
const isoCertificationAutomationService = require('../services/isoCertificationAutomationService');

describe('ISO certification automation service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('orchestrates automation pipeline and returns consolidated output', async () => {
    const msmeProfile = {
      _id: '507f1f77bcf86cd799439011',
      companyName: 'Acme Works',
      industry: 'manufacturing',
      businessDomain: 'manufacturing',
      business: {
        primaryProducts: 'Precision Gears'
      }
    };

    MSME.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(msmeProfile)
    });

    msmeEmissionsOrchestrationService.orchestrateEmissions.mockResolvedValue({
      orchestrationId: 'orch_iso_123',
      msmeId: msmeProfile._id,
      context: {
        dataQuality: { confidence: 0.82 },
        knownParameters: {},
        unknownParameters: {}
      },
      processMachineryProfile: {},
      agentOutputs: {
        carbonAnalysis: { totalEmissions: 110 },
        compliance: {
          status: 'non_compliant',
          readinessScore: 68,
          gapClosureChecklist: {
            overallReadinessScore: 68,
            openGaps: [{ id: 'g1' }],
            factorRegistry: [{ id: 'f1', factor: 0.8 }]
          }
        }
      }
    });

    aiAgentService.isoEvidenceCollectorAgent.mockResolvedValue({
      evidenceRegister: { factors: { evidenceCount: 4 } }
    });
    aiAgentService.isoGapClosurePlannerAgent.mockResolvedValue({
      actionPlan: [{ id: 'a1', status: 'open' }]
    });
    aiAgentService.isoAuditPackagerAgent.mockResolvedValue({
      certificationStatus: 'gap_closure_required'
    });

    const output = await isoCertificationAutomationService.automateCertification({
      msmeId: msmeProfile._id,
      transactions: [{ category: 'energy', amount: 1000 }]
    });

    expect(msmeEmissionsOrchestrationService.orchestrateEmissions).toHaveBeenCalled();
    expect(aiAgentService.isoEvidenceCollectorAgent).toHaveBeenCalled();
    expect(aiAgentService.isoGapClosurePlannerAgent).toHaveBeenCalled();
    expect(aiAgentService.isoAuditPackagerAgent).toHaveBeenCalled();
    expect(output.orchestrationId).toBe('orch_iso_123');
    expect(output.readinessScore).toBe(68);
    expect(output.certificationStatus).toBe('gap_closure_required');
  });
});
