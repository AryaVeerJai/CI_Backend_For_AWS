const carbonCreditsService = require('../services/carbonCreditsService');

describe('CarbonCreditsService ICM workflow mapping', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('maps Platform aliases to canonical ICM workflow', () => {
    expect(carbonCreditsService.resolveICMWorkflowIdentifier('Platform')).toBe('icm_platform_workflow');
    expect(carbonCreditsService.resolveICMWorkflowIdentifier('platform_workflow')).toBe('icm_platform_workflow');
    expect(carbonCreditsService.resolveICMWorkflowIdentifier('ICM Platform')).toBe('icm_platform_workflow');
    expect(carbonCreditsService.resolveICMWorkflowIdentifier('unknown')).toBeNull();
  });

  test('buildRegistrySyncPayload maps workflow metadata to ICM workflow', () => {
    const payload = carbonCreditsService.buildRegistrySyncPayload({
      msmeId: 'msme-42',
      allocatedCredits: 120,
      availableCredits: 95,
      usedCredits: 15,
      retiredCredits: 10,
      totalCO2Reduced: 1000,
      allocationHistory: [],
      transactions: []
    }, {
      workflowType: 'Platform',
      requestedBy: 'admin-user'
    });

    expect(payload.metadata).toEqual(expect.objectContaining({
      workflowType: 'Platform',
      requestedBy: 'admin-user',
      operation: 'sync',
      workflowInput: 'Platform',
      workflow: 'icm_platform_workflow',
      icmWorkflow: 'icm_platform_workflow'
    }));
  });

  test('retirement payload is tagged with canonical ICM workflow', async () => {
    const mockRegistryResponse = {
      data: {
        accountId: 'ICM-900',
        availableCredits: 50,
        retiredCredits: 20
      }
    };
    const recordRetirement = jest.fn().mockResolvedValue(mockRegistryResponse);

    carbonCreditsService.registryClient = {
      isConfigured: () => true,
      recordRetirement
    };

    jest.spyOn(carbonCreditsService, 'updateRegistrySyncState').mockResolvedValue();

    await carbonCreditsService.recordRetirementInRegistry(
      'msme-42',
      10,
      'voluntary retirement',
      { availableCredits: 50, retiredCredits: 20, markModified: () => {} }
    );

    expect(recordRetirement).toHaveBeenCalledWith('msme-42', expect.objectContaining({
      metadata: expect.objectContaining({
        operation: 'retirement',
        workflowInput: 'Platform',
        workflow: 'icm_platform_workflow',
        icmWorkflow: 'icm_platform_workflow'
      })
    }));
  });
});
