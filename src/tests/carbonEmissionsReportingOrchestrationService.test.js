jest.mock('../models/MSME', () => ({
  findById: jest.fn()
}));

jest.mock('../models/Transaction', () => ({
  find: jest.fn()
}));

jest.mock('../models/Document', () => ({
  find: jest.fn()
}));

jest.mock('../models/CarbonAssessment', () => ({
  find: jest.fn()
}));

jest.mock('../services/orchestrationManagerEventService', () => ({
  triggerOrchestration: jest.fn()
}));

jest.mock('../services/aiAgentService', () => ({
  complianceMonitorAgent: jest.fn(),
  isoEvidenceCollectorAgent: jest.fn(),
  isoGapClosurePlannerAgent: jest.fn(),
  isoAuditPackagerAgent: jest.fn(),
  reportGeneratorAgent: jest.fn()
}));

jest.mock('../services/carbonCalculationService', () => ({
  calculateMSMECarbonFootprintAsync: jest.fn()
}));

jest.mock('../services/carbonCreditsService', () => ({
  getMSMECredits: jest.fn(),
  getCreditSummary: jest.fn()
}));

jest.mock('../services/brsrReportingService', () => ({
  buildBRSRReport: jest.fn()
}));

jest.mock('../services/isoGapClosureService', () => ({
  buildIsoGapClosureChecklist: jest.fn()
}));

const MSME = require('../models/MSME');
const Transaction = require('../models/Transaction');
const Document = require('../models/Document');
const CarbonAssessment = require('../models/CarbonAssessment');
const orchestrationManagerEventService = require('../services/orchestrationManagerEventService');
const aiAgentService = require('../services/aiAgentService');
const carbonCalculationService = require('../services/carbonCalculationService');
const { buildBRSRReport } = require('../services/brsrReportingService');
const { buildIsoGapClosureChecklist } = require('../services/isoGapClosureService');
const carbonEmissionsReportingOrchestrationService = require('../services/carbonEmissionsReportingOrchestrationService');

const mockLeanQuery = (value) => ({
  lean: jest.fn().mockResolvedValue(value),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis()
});

describe('carbonEmissionsReportingOrchestrationService', () => {
  const msmeId = '507f1f77bcf86cd799439011';
  const msme = {
    _id: msmeId,
    companyName: 'Test MSME',
    businessDomain: 'manufacturing'
  };
  const transactions = [
    { _id: 'tx1', category: 'energy', amount: 12000, date: new Date() },
    { _id: 'tx2', category: 'fuel', amount: 8000, date: new Date() }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    MSME.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(msme) });
    Transaction.find.mockReturnValue(mockLeanQuery(transactions));
    Document.find.mockReturnValue(mockLeanQuery([]));
    CarbonAssessment.find.mockReturnValue(mockLeanQuery([]));
    orchestrationManagerEventService.triggerOrchestration.mockResolvedValue({
      orchestrationId: 'orch_test_1',
      emissionsSummary: { totalEmissions: 120, primaryBehaviors: ['energy'] },
      valueChainReport: { partners: [] },
      context: { frameworks: { iso14064: { enabled: true } }, dataQuality: { confidence: 0.8 } },
      agentOutputs: {
        carbonAnalysis: {
          totalEmissions: 120,
          categoryBreakdown: { energy: 80, fuel: 40 }
        },
        recommendations: [{ title: 'Switch to LED lighting' }],
        trends: { trends: { emissions: { direction: 'stable' } } }
      },
      orchestrationPlan: { stages: ['analyze'] },
      warnings: []
    });
    aiAgentService.complianceMonitorAgent.mockResolvedValue({
      status: 'compliant',
      readinessScore: 82,
      issues: [],
      frameworks: { iso14064: { readinessScore: 82, status: 'aligned' } }
    });
    aiAgentService.isoEvidenceCollectorAgent.mockResolvedValue({ evidenceRegister: {} });
    aiAgentService.isoGapClosurePlannerAgent.mockResolvedValue({ actionPlan: [] });
    aiAgentService.reportGeneratorAgent.mockResolvedValue({
      summary: { totalEmissionsKg: 120 },
      reportingOutcomes: { overallReadinessScore: 82 }
    });
    buildIsoGapClosureChecklist.mockReturnValue({
      overallReadinessScore: 78,
      openGaps: [{ title: 'Boundary definition' }]
    });
    buildBRSRReport.mockReturnValue({
      brsrComplianceSummary: { overallStatus: 'in_progress', readinessScore: 74, openGaps: [] }
    });
    carbonCalculationService.calculateMSMECarbonFootprintAsync.mockResolvedValue({
      totalCO2Emissions: 120
    });
  });

  test('orchestrates emissions and reporting outcomes for BRSR and ISO frameworks', async () => {
    const result = await carbonEmissionsReportingOrchestrationService.orchestrate({
      msmeId,
      period: 'annual',
      frameworks: ['BRSR', 'ISO14064']
    });

    expect(orchestrationManagerEventService.triggerOrchestration).toHaveBeenCalledTimes(1);
    expect(aiAgentService.complianceMonitorAgent).toHaveBeenCalled();
    expect(aiAgentService.reportGeneratorAgent).toHaveBeenCalled();
    expect(buildBRSRReport).toHaveBeenCalled();
    expect(result.orchestrationPattern).toBe('emissions_and_reporting_multi_agent');
    expect(result.frameworks).toEqual(['BRSR', 'ISO14064']);
    expect(result.emissions.summary.totalEmissions).toBe(120);
    expect(result.reporting.frameworkReports.BRSR).toBeDefined();
    expect(result.reporting.narrativeReport.summary.totalEmissionsKg).toBe(120);
  });

  test('rejects orchestration when transactions are unavailable', async () => {
    Transaction.find.mockReturnValue(mockLeanQuery([]));

    await expect(carbonEmissionsReportingOrchestrationService.orchestrate({
      msmeId,
      frameworks: ['BRSR']
    })).rejects.toThrow('Transactions are required');
  });
});
