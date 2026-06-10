const agentGraphOrchestratorService = require('../services/agentGraphOrchestratorService');

describe('AgentGraphOrchestratorService', () => {
  test('compiles workflow graph with dependency levels', () => {
    const graph = agentGraphOrchestratorService.compileWorkflowGraph([
      { stepId: 'ingest', dependencies: [] },
      { stepId: 'analyze', dependencies: ['ingest'] },
      { stepId: 'recommend', dependencies: ['analyze'] },
      { stepId: 'report', dependencies: ['analyze'] }
    ]);

    expect(graph.entryNodes).toEqual(['ingest']);
    expect(graph.terminalNodes.sort()).toEqual(['recommend', 'report']);
    expect(graph.parallelGroups).toEqual([
      ['ingest'],
      ['analyze'],
      ['recommend', 'report']
    ]);
    expect(graph.dependenciesIndex.recommend.dependencies).toContain('analyze');
  });

  test('executes conditional routes similar to graph branching', async () => {
    const graph = agentGraphOrchestratorService.compileWorkflowGraph([
      {
        stepId: 'router',
        dependencies: [],
        conditions: {
          routes: [
            {
              to: 'high_path',
              when: { path: 'output.score', operator: 'gte', value: 0.7 }
            },
            { to: 'low_path', default: true }
          ]
        }
      },
      { stepId: 'high_path', dependencies: [] },
      { stepId: 'low_path', dependencies: [] }
    ]);

    const result = await agentGraphOrchestratorService.executeGraph({
      graph,
      initialState: {},
      runNode: async ({ nodeId }) => {
        if (nodeId === 'router') {
          return {
            output: { score: 0.9 }
          };
        }

        return {
          output: { branch: nodeId }
        };
      },
      options: { maxConcurrency: 2 }
    });

    expect(result.status).toBe('completed');
    expect(result.nodeStatuses.router).toBe('completed');
    expect(result.nodeStatuses.high_path).toBe('completed');
    expect(result.nodeStatuses.low_path).toBe('skipped');
    expect(result.finalState.nodeOutputs.high_path).toEqual({ branch: 'high_path' });
  });

  test('skips node when runIf condition is false', async () => {
    const graph = agentGraphOrchestratorService.compileWorkflowGraph([
      { stepId: 'source', dependencies: [] },
      {
        stepId: 'gated',
        dependencies: ['source'],
        conditions: {
          runIf: {
            path: 'state.nodeOutputs.source.shouldRun',
            operator: 'eq',
            value: true
          }
        }
      }
    ]);

    const result = await agentGraphOrchestratorService.executeGraph({
      graph,
      runNode: async ({ nodeId }) => {
        if (nodeId === 'gated') {
          throw new Error('gated node should not execute');
        }

        return { output: { shouldRun: false } };
      }
    });

    expect(result.nodeStatuses.source).toBe('completed');
    expect(result.nodeStatuses.gated).toBe('skipped');
  });

  test('retries failed node execution based on retryPolicy', async () => {
    const graph = agentGraphOrchestratorService.compileWorkflowGraph([
      {
        stepId: 'unstable',
        dependencies: [],
        retryPolicy: {
          maxRetries: 1,
          retryDelay: 0
        }
      }
    ]);

    let calls = 0;
    const result = await agentGraphOrchestratorService.executeGraph({
      graph,
      runNode: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('fail once');
        }
        return { output: { ok: true } };
      }
    });

    expect(result.nodeStatuses.unstable).toBe('completed');
    expect(result.nodeResults.unstable.attempts).toBe(2);
    expect(result.finalState.nodeOutputs.unstable).toEqual({ ok: true });
  });
});
