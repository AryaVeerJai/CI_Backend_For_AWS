jest.mock('../services/agents/registry', () => ({
  getHandler: jest.fn()
}));

const { getHandler } = require('../services/agents/registry');
const orchestrationRuntimeService = require('../services/orchestrationRuntimeService');

describe('OrchestrationRuntimeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('executeRegisteredAgentTasks runs handlers sequentially by default', async () => {
    const handlerA = jest.fn().mockResolvedValue({ ok: 'a' });
    const handlerB = jest.fn().mockResolvedValue({ ok: 'b' });

    getHandler.mockImplementation((type) => {
      if (type === 'agent_a') return handlerA;
      if (type === 'agent_b') return handlerB;
      return null;
    });

    const results = await orchestrationRuntimeService.executeRegisteredAgentTasks([
      { type: 'agent_a', input: { value: 1 } },
      { type: 'agent_b', input: { value: 2 } }
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('completed');
    expect(results[1].status).toBe('completed');
    expect(handlerA).toHaveBeenCalledWith({ input: { value: 1 } });
    expect(handlerB).toHaveBeenCalledWith({ input: { value: 2 } });
  });

  test('executeRegisteredAgentTasks supports parallel mode', async () => {
    const handler = jest.fn().mockResolvedValue({ ok: true });
    getHandler.mockReturnValue(handler);

    const results = await orchestrationRuntimeService.executeRegisteredAgentTasks(
      [
        { type: 'agent_a', input: {} },
        { type: 'agent_b', input: {} }
      ],
      { mode: 'parallel' }
    );

    expect(results).toHaveLength(2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('executeRegisteredAgentTasks skips unknown handlers', async () => {
    getHandler.mockReturnValue(null);

    const results = await orchestrationRuntimeService.executeRegisteredAgentTasks([
      { type: 'missing_agent', input: {} }
    ]);

    expect(results[0]).toMatchObject({
      agent: 'missing_agent',
      status: 'skipped'
    });
  });

  test('executeCuratedPlan respects stage coordination modes', async () => {
    const handler = jest.fn().mockResolvedValue({ ok: true });
    getHandler.mockReturnValue(handler);

    const stageResults = await orchestrationRuntimeService.executeCuratedPlan(
      {
        stages: [
          {
            stage: 'core',
            agents: ['carbon_analyzer'],
            coordinationMode: 'sequential'
          },
          {
            stage: 'insights',
            agents: ['trend_analyzer', 'anomaly_detector'],
            coordinationMode: 'parallel'
          }
        ]
      },
      {
        buildTaskInput: (agentType) => ({ profile: agentType })
      }
    );

    expect(stageResults).toHaveLength(2);
    expect(stageResults[0].results).toHaveLength(1);
    expect(stageResults[1].results).toHaveLength(2);
    expect(handler).toHaveBeenCalledTimes(3);
  });
});
