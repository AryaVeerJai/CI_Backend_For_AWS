const aiAgentService = require('../services/aiAgentService');

describe('aiAgentService advanced coordination merge', () => {
  test('exposes coordination strategies from merged core', () => {
    expect(aiAgentService.coordinationStrategies.has('adaptive')).toBe(true);
    expect(aiAgentService.consensusAlgorithms.has('ensemble')).toBe(true);
    expect(aiAgentService.loadBalancingStrategies.has('predictive')).toBe(true);
  });

  test('executeAdvancedCoordination runs adaptive strategy', async () => {
    const result = await aiAgentService.executeAdvancedCoordination(
      ['agent-1', 'agent-2'],
      'carbon_analysis',
      { sample: true },
      'parallel'
    );
    expect(result.strategy).toBe('parallel');
  });
});
