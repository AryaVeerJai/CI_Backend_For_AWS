jest.mock('../models/CarbonCredits', () => ({
  MSMECarbonCredits: {
    findOne: jest.fn()
  },
  CarbonCredits: {
    findOne: jest.fn()
  },
  CarbonCreditTransaction: {
    find: jest.fn()
  }
}));

jest.mock('../models/CarbonAssessment', () => ({
  find: jest.fn()
}));

jest.mock('../models/MSME', () => ({}));

jest.mock('../services/indianCarbonMarketRegistryClient', () => {
  return jest.fn().mockImplementation(() => ({
    isConfigured: jest.fn().mockReturnValue(false),
    getConfigurationStatus: jest.fn().mockReturnValue({
      enabled: false,
      configured: false
    })
  }));
});

const carbonCreditsService = require('../services/carbonCreditsService');
const { MSMECarbonCredits } = require('../models/CarbonCredits');
const CarbonAssessment = require('../models/CarbonAssessment');

const createMockCreditsRecord = (overrides = {}) => ({
  msmeId: { _id: 'msme-1', toString: () => 'msme-1' },
  allocatedCredits: 0,
  availableCredits: 0,
  usedCredits: 0,
  retiredCredits: 0,
  totalCO2Reduced: 0,
  allocationHistory: [],
  transactions: [],
  registryIntegration: {},
  markModified: jest.fn(),
  save: jest.fn().mockResolvedValue(true),
  ...overrides
});

describe('CarbonCreditsService ICM workflow features', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    CarbonAssessment.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    });
  });

  test('sets baseline from latest assessment when baseline not provided', async () => {
    const record = createMockCreditsRecord();
    MSMECarbonCredits.findOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(record)
    });
    CarbonAssessment.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { _id: 'assessment-1', totalCO2Emissions: 1000, createdAt: new Date('2026-04-12T00:00:00Z') }
      ])
    });

    const baseline = await carbonCreditsService.setICMWorkflowBaseline('msme-1', {
      baselineCO2Emissions: 1000,
      source: 'platform',
      metadata: { workflow: 'Platform' }
    });

    expect(baseline.baseline.co2Emissions).toBe(1000);
    expect(baseline.baseline.assessmentId).toBeNull();
    expect(baseline.baseline.source).toBe('platform');
    expect(baseline.workflowId).toBe('icm_platform_workflow');
    expect(record.markModified).toHaveBeenCalledWith('registryIntegration');
    expect(record.save).toHaveBeenCalled();
  });

  test('tracks emission reduction against stored baseline', async () => {
    const record = createMockCreditsRecord({
      registryIntegration: {
        icmWorkflow: {
          baseline: {
            co2Emissions: 1000
          }
        }
      }
    });
    MSMECarbonCredits.findOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(record)
    });

    const tracking = await carbonCreditsService.trackICMEmissionReduction('msme-1', {
      currentCO2Emissions: 820,
      source: 'platform',
      metadata: { workflow: 'Platform' }
    });

    expect(tracking.currentCO2Emissions).toBe(820);
    expect(tracking.reductionKgCO2).toBe(180);
    expect(tracking.reductionPercent).toBe(18);
    expect(tracking.workflowId).toBe('icm_platform_workflow');
    expect(record.registryIntegration.icmWorkflow.reductionTracking.history[0]).toEqual(expect.objectContaining({
      co2Emissions: 820,
      reductionKgCO2: 180,
      reductionPercent: 18,
      source: 'platform'
    }));
  });

  test('quantifies credits from tracked reduction and credit factor', async () => {
    const record = createMockCreditsRecord({
      registryIntegration: {
        icmWorkflow: {
          reductionTracking: {
            latestReductionKgCO2: 180
          },
          creditQuantification: {
            creditPerKgCO2: 0.2,
            history: []
          }
        }
      }
    });
    MSMECarbonCredits.findOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(record)
    });

    const quantification = await carbonCreditsService.quantifyICMCredits('msme-1', {
      source: 'platform',
      metadata: { workflow: 'Platform' }
    });

    expect(quantification.creditPerKgCO2).toBe(0.2);
    expect(quantification.quantifiedCredits).toBe(36);
    expect(quantification.totalQuantifiedCredits).toBe(36);
    expect(quantification.workflowId).toBe('icm_platform_workflow');
    expect(record.registryIntegration.icmWorkflow.creditQuantification.history[0]).toEqual(expect.objectContaining({
      reductionKgCO2: 180,
      credits: 36
    }));
  });
});
