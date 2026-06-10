const msmeEmissionsCuratedExecutor = require('../services/msmeEmissionsCuratedExecutor');

describe('MsmeEmissionsCuratedExecutor', () => {
  const orchestrationOptions = {
    orchestration: { skipDocumentAnalysisWhenEmpty: true }
  };

  test('shouldRunDocumentAnalyzer respects document presence and skip flag', () => {
    expect(msmeEmissionsCuratedExecutor.shouldRunDocumentAnalyzer([], orchestrationOptions)).toBe(false);
    expect(msmeEmissionsCuratedExecutor.shouldRunDocumentAnalyzer([{ id: 'd1' }], orchestrationOptions)).toBe(true);
    expect(msmeEmissionsCuratedExecutor.shouldRunDocumentAnalyzer([], {
      orchestration: { skipDocumentAnalysisWhenEmpty: false }
    })).toBe(true);
  });

  test('buildDocumentAnalyzerTask shapes agent input', () => {
    const task = msmeEmissionsCuratedExecutor.buildDocumentAnalyzerTask({
      documents: [{ id: 'doc-1' }],
      msmeProfile: { _id: 'msme-1' },
      baseContext: { region: 'west-india' },
      coordinationPayload: { agentBriefing: 'brief' }
    });

    expect(task.input.documents).toHaveLength(1);
    expect(task.input.msmeData._id).toBe('msme-1');
    expect(task.input.context.region).toBe('west-india');
    expect(task.input.agentBriefing).toBe('brief');
  });

  test('buildParallelAgentTask returns payloads for insight agents', () => {
    const analysisContext = {
      transactions: [{ amount: 100 }],
      carbonData: { totalEmissions: 10 },
      behaviorProfiles: {},
      context: {
        regulatoryContext: [],
        frameworks: {},
        processContext: []
      },
      orchestrationOptions: { thresholds: { minTransactionsForAnomaly: 5 } },
      policyUpdates: [],
      knownParameters: {},
      unknownParameters: [],
      dynamicParameters: {},
      transactionTypeContext: {},
      dataQuality: { confidence: 0.7 },
      processMachineryProfile: {},
      inventoryGovernance: null,
      msmeData: { _id: 'msme-1' },
      transactionStats: {}
    };

    const anomalyTask = msmeEmissionsCuratedExecutor.buildParallelAgentTask(
      'anomaly_detector',
      analysisContext,
      { agentBriefing: 'anomaly' }
    );
    expect(anomalyTask.input.transactions).toHaveLength(1);
    expect(anomalyTask.input.thresholds.minTransactionsForAnomaly).toBe(5);
    expect(anomalyTask.input.agentBriefing).toBe('anomaly');

    const trendTask = msmeEmissionsCuratedExecutor.buildParallelAgentTask(
      'trend_analyzer',
      analysisContext
    );
    expect(trendTask.input.data.carbonData.totalEmissions).toBe(10);

    expect(msmeEmissionsCuratedExecutor.getParallelAgentStage('compliance_monitor')).toBe('compliance_check');
    expect(msmeEmissionsCuratedExecutor.buildParallelAgentTask('unknown_agent', analysisContext)).toBeNull();
  });

  test('shouldRunDataPrivacy requires transactions', () => {
    expect(msmeEmissionsCuratedExecutor.shouldRunDataPrivacy([])).toBe(false);
    expect(msmeEmissionsCuratedExecutor.shouldRunDataPrivacy([{ amount: 10 }])).toBe(true);
  });

  test('buildDataPrivacyTask shapes agent input', () => {
    const task = msmeEmissionsCuratedExecutor.buildDataPrivacyTask({
      transactions: [{ amount: 50 }],
      msmeProfile: { _id: 'msme-2' },
      baseContext: { policyUpdates: [{ id: 'p1' }] },
      coordinationPayload: { agentBriefing: 'privacy' }
    });

    expect(task.input.transactions).toHaveLength(1);
    expect(task.input.msmeData._id).toBe('msme-2');
    expect(task.input.policyUpdates).toHaveLength(1);
    expect(task.input.agentBriefing).toBe('privacy');
    expect(msmeEmissionsCuratedExecutor.getPreProcessingStage('data_privacy')).toBe('data_privacy');
  });

  test('shouldRunRecommendationEngine respects plan outputs and agent inclusion', () => {
    const planWithAgent = {
      stages: [{ stage: 'post_processing', agents: ['recommendation_engine'] }],
      outputs: { recommendations: true }
    };
    const planWithoutOutput = {
      stages: [{ stage: 'post_processing', agents: ['recommendation_engine'] }],
      outputs: { recommendations: false }
    };

    expect(msmeEmissionsCuratedExecutor.shouldRunRecommendationEngine(planWithAgent)).toBe(true);
    expect(msmeEmissionsCuratedExecutor.shouldRunRecommendationEngine(planWithoutOutput)).toBe(false);
    expect(msmeEmissionsCuratedExecutor.shouldRunRecommendationEngine({
      stages: [{ stage: 'post_processing', agents: ['report_generator'] }],
      outputs: { recommendations: true }
    })).toBe(false);
  });

  test('buildRecommendationEngineTask shapes agent input', () => {
    const analysisContext = {
      carbonData: { totalEmissions: 42 },
      transactions: [{ amount: 100 }],
      msmeData: { _id: 'msme-3' },
      behaviorProfiles: {},
      context: {},
      knownParameters: {},
      unknownParameters: [],
      dynamicParameters: {},
      transactionTypeContext: {},
      orchestrationOptions: { thresholds: {} }
    };
    const parallelResults = {
      trend_analyzer: { trends: [{ label: 'up' }] },
      anomaly_detector: { flags: [] },
      compliance_monitor: { status: 'ok' },
      optimization_advisor: { tips: [] }
    };

    const task = msmeEmissionsCuratedExecutor.buildRecommendationEngineTask({
      analysisContext,
      parallelResults,
      processMachineryProfile: { lines: [] },
      coordinationPayload: { agentBriefing: 'reco' }
    });

    expect(task.input.carbonData.totalEmissions).toBe(42);
    expect(task.input.trends).toHaveLength(1);
    expect(task.input.processMachineryProfile.lines).toEqual([]);
    expect(task.input.agentBriefing).toBe('reco');
    expect(msmeEmissionsCuratedExecutor.getPostProcessingStage('recommendation_engine'))
      .toBe('recommendation_generation');
  });

  test('shouldRunReportGenerator respects plan outputs and agent inclusion', () => {
    const planWithAgent = {
      stages: [{ stage: 'post_processing', agents: ['report_generator'] }],
      outputs: { report: true }
    };
    const planWithoutOutput = {
      stages: [{ stage: 'post_processing', agents: ['report_generator'] }],
      outputs: { report: false }
    };

    expect(msmeEmissionsCuratedExecutor.shouldRunReportGenerator(planWithAgent)).toBe(true);
    expect(msmeEmissionsCuratedExecutor.shouldRunReportGenerator(planWithoutOutput)).toBe(false);
    expect(msmeEmissionsCuratedExecutor.shouldRunReportGenerator({
      stages: [{ stage: 'post_processing', agents: ['recommendation_engine'] }],
      outputs: { report: true }
    })).toBe(false);
  });

  test('buildReportGeneratorTask shapes agent input', () => {
    const analysisContext = {
      carbonData: { totalEmissions: 99 },
      behaviorProfiles: {},
      context: { region: 'south-india' },
      knownParameters: {},
      unknownParameters: [],
      dynamicParameters: {},
      transactionTypeContext: {},
      orchestrationOptions: { thresholds: {} }
    };
    const parallelResults = {
      trend_analyzer: { trends: { emissions: { monthly: [] } } }
    };

    const task = msmeEmissionsCuratedExecutor.buildReportGeneratorTask({
      analysisContext,
      parallelResults,
      recommendations: { recommendations: [{ title: 'Solar' }] },
      processMachineryProfile: { lines: ['line-a'] },
      coordinationPayload: { agentBriefing: 'report' },
      extras: { reportingFrameworks: ['BRSR'] }
    });

    expect(task.input.carbonData.totalEmissions).toBe(99);
    expect(task.input.trends).toEqual({ emissions: { monthly: [] } });
    expect(task.input.recommendations).toHaveLength(1);
    expect(task.input.reportingFrameworks).toEqual(['BRSR']);
    expect(task.input.agentBriefing).toBe('report');
    expect(msmeEmissionsCuratedExecutor.getPostProcessingStage('report_generator'))
      .toBe('report_generation');
  });
});
