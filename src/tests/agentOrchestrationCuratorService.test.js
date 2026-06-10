const agentOrchestrationCuratorService = require('../services/agentOrchestrationCuratorService');

describe('AgentOrchestrationCuratorService', () => {
  test('returns agent catalog and pipeline templates', () => {
    const catalog = agentOrchestrationCuratorService.getAgentCatalog();
    const pipelines = agentOrchestrationCuratorService.getPipelineTemplates();

    expect(catalog.agents.length).toBeGreaterThan(20);
    expect(catalog.supportedTypes).toContain('carbon_analyzer');
    expect(pipelines.some((pipeline) => pipeline.id === 'msme_emissions')).toBe(true);
    expect(pipelines.some((pipeline) => pipeline.id === 'msme_advisory')).toBe(true);
  });

  test('builds curated MSME emissions plan with parallel insight agents', () => {
    const plan = agentOrchestrationCuratorService.buildEmissionsOrchestrationPlan({
      sectorProfile: { sector: 'textiles', label: 'Textiles' },
      analysisContext: {
        transactions: Array.from({ length: 25 }, (_, index) => ({
          id: index,
          amount: 1000,
          category: 'energy'
        })),
        behaviorProfiles: {
          energy: { severity: 'high', emissionsShare: 0.35 }
        },
        knownParameters: { processes: ['weaving'] },
        unknownParameters: {
          weightedParameters: [{ name: 'unknown_dye', weight: 0.4 }]
        },
        dataQuality: { confidence: 0.55 },
        context: {
          profileSignals: {
            completeness: { ratio: 0.4 },
            complexityScore: 0.7,
            flags: { exportIntensive: true }
          },
          frameworks: { iso14064: { enabled: true } }
        }
      },
      msmeProfile: {
        businessDomain: 'textiles',
        environmentalCompliance: { hasPollutionControlBoard: false }
      },
      orchestrationOptions: {
        thresholds: {
          minTransactionsForAnomaly: 20,
          minTransactionsForTrends: 12,
          energyShareHigh: 0.2
        },
        orchestration: {
          preferParallel: true,
          emitRecommendations: true,
          emitReport: true
        }
      }
    });

    expect(plan.pipelineId).toBe('msme_emissions');
    expect(plan.parallelAgents).toContain('anomaly_detector');
    expect(plan.parallelAgents).toContain('compliance_monitor');
    expect(plan.coordinationMode).toBe('parallel');
    expect(plan.verifiedSourceGate.run).toBe(true);
    expect(plan.rationale.length).toBeGreaterThan(3);
    expect(plan.scope.coreAgents).toEqual(['data_processor', 'carbon_analyzer']);
  });

  test('skips verified-source RAG when no unknown parameters', () => {
    const gate = agentOrchestrationCuratorService.shouldRunVerifiedSourceRag({
      unknownParameters: { weightedParameters: [] },
      dataQuality: { confidence: 0.9 },
      orchestrationOptions: {}
    });

    expect(gate.run).toBe(false);
  });

  test('builds curated advisory pipeline plan', () => {
    const plan = agentOrchestrationCuratorService.buildCuratedPlan({
      pipelineId: 'msme_advisory',
      context: {}
    });

    expect(plan.pipelineId).toBe('msme_advisory');
    expect(plan.stages.some((stage) => stage.agents.includes('inventory_quality_advisor'))).toBe(true);
    expect(plan.stages.some((stage) => stage.agents.includes('msme_goal_advisor'))).toBe(true);
  });

  test('converts curated plan to graph steps when agent ids are mapped', () => {
    const plan = agentOrchestrationCuratorService.buildCuratedPlan({
      pipelineId: 'ghg_boundary',
      context: {}
    });

    const steps = agentOrchestrationCuratorService.toGraphSteps(plan, {
      organizational_boundary_agent: 'org-agent-id',
      operational_boundary_agent: 'ops-agent-id',
      ghg_boundary_orchestrator: 'merge-agent-id'
    });

    expect(steps.length).toBe(3);
    expect(steps.some((step) => step.stepId.startsWith('boundary_'))).toBe(true);
  });
});
