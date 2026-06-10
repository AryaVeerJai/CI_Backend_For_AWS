const agentRegistry = require('../services/agents/registry');
const agentOrchestrationCuratorService = require('../services/agentOrchestrationCuratorService');

describe('ESG analyzer agent registration', () => {
  test('registry exposes esg_analyzer handler', () => {
    expect(agentRegistry.getSupportedTypes()).toContain('esg_analyzer');
    expect(agentRegistry.getHandler('esg_analyzer')).toEqual(expect.any(Function));
  });

  test('msme_emissions curated plan includes esg_analyzer stage', () => {
    const plan = agentOrchestrationCuratorService.buildEmissionsOrchestrationPlan({
      sectorProfile: { sector: 'manufacturing' },
      analysisContext: {
        transactions: Array.from({ length: 25 }, (_, i) => ({ id: i, amount: 1000 })),
        behaviorProfiles: { energy: { emissionsShare: 0.25, severity: 'high' } },
        dataQuality: { confidence: 0.8 }
      },
      msmeProfile: { businessDomain: 'manufacturing' },
      orchestrationOptions: {}
    });

    expect(agentOrchestrationCuratorService.planIncludesAgent(plan, 'esg_analyzer')).toBe(true);
    expect(plan.scope?.esgAgents).toContain('esg_analyzer');
  });
});
