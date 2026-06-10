jest.mock('../services/aiAgentService', () => ({
  sectorProfilerAgent: jest.fn(),
  processMachineryProfilerAgent: jest.fn(),
  dataPrivacyAgent: jest.fn(),
  documentAnalyzerAgent: jest.fn(),
  dataProcessorAgent: jest.fn(),
  carbonAnalyzerAgent: jest.fn(),
  anomalyDetectorAgent: jest.fn(),
  trendAnalyzerAgent: jest.fn(),
  complianceMonitorAgent: jest.fn(),
  optimizationAdvisorAgent: jest.fn(),
  orchestrationAgent: jest.fn(),
  recommendationEngineAgent: jest.fn(),
  reportGeneratorAgent: jest.fn()
}));

jest.mock('../models/MSME', () => ({
  findById: jest.fn()
}));

jest.mock('../models/AIAgent', () => ({
  find: jest.fn()
}));

jest.mock('../models/Document', () => ({
  find: jest.fn()
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const aiAgentService = require('../services/aiAgentService');
const MSME = require('../models/MSME');
const AIAgent = require('../models/AIAgent');
const Document = require('../models/Document');
const orchestrationService = require('../services/msmeEmissionsOrchestrationService');

describe('MSME Emissions Orchestration Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Document.find.mockResolvedValue([]);
  });

  test('should merge orchestration options with defaults', () => {
    const options = orchestrationService.getOrchestrationOptions({
      thresholds: { energyShareHigh: 0.33 },
      orchestration: { emitReport: false },
      frameworks: {
        iso14067: {
          functionalUnit: '1 kg finished product'
        }
      }
    });

    expect(options.thresholds.energyShareHigh).toBe(0.33);
    expect(options.thresholds.minTransactionsForAnomaly).toBe(20);
    expect(options.orchestration.emitReport).toBe(false);
    expect(options.orchestration.emitRecommendations).toBe(true);
    expect(options.orchestration.onDemandAgents).toBe(true);
    expect(options.orchestration.maxParallelAgents).toBeNull();
    expect(options.frameworks.iso14064.enabled).toBe(true);
    expect(options.frameworks.iso14067.functionalUnit).toBe('1 kg finished product');
  });

  test('should derive profile signals from rich MSME manufacturing profile', () => {
    const profileSignals = orchestrationService.buildManufacturingProfileSignals({
      primaryEnergySource: 'Grid + Diesel',
      mainFuelsUsed: ['Diesel', 'LPG', 'Coal'],
      wasteManagementPractice: 'Landfill disposal',
      supplyChainType: 'Global export/import',
      logisticsMode: 'Road',
      certifications: ['ISO 14001', 'ZED'],
      regulatoryExposure: ['SPCB', 'CBAM'],
      digitalizationLevel: 'Advanced',
      carbonAccountingPractice: 'Full accounting',
      exportActivity: true,
      keyProducts: ['Fabric', 'Plastic compound', 'Synthetic blend'],
      numberOfEmployees: 220,
      plantAreaSqft: 65000,
      operationalDaysPerYear: 330,
      clusterAssociation: 'Industrial cluster'
    });

    expect(profileSignals.completeness.ratio).toBeGreaterThan(0.5);
    expect(profileSignals.complexityScore).toBeGreaterThan(0.6);
    expect(profileSignals.flags.exportIntensive).toBe(true);
    expect(profileSignals.flags.highRegulatoryExposure).toBe(true);
    expect(profileSignals.flags.energyIntensive).toBe(true);
    expect(profileSignals.flags.wasteIntensive).toBe(true);
    expect(profileSignals.flags.strongCertifications).toBe(true);
  });

  test('should tune orchestration thresholds from profile signals', () => {
    const defaults = orchestrationService.getOrchestrationOptions();
    const tuned = orchestrationService.applyManufacturingProfileOrchestrationTuning(
      defaults,
      {
        completeness: { ratio: 0.82 },
        complexityScore: 0.72,
        flags: {
          exportIntensive: true,
          highRegulatoryExposure: true,
          energyIntensive: true,
          wasteIntensive: true,
          advancedDigitalization: true,
          clusterAssociationPresent: true
        }
      }
    );

    expect(tuned.thresholds.minTransactionsForAnomaly).toBeLessThan(defaults.thresholds.minTransactionsForAnomaly);
    expect(tuned.thresholds.minTransactionsForTrends).toBeLessThan(defaults.thresholds.minTransactionsForTrends);
    expect(tuned.thresholds.energyShareHigh).toBeLessThan(defaults.thresholds.energyShareHigh);
    expect(tuned.thresholds.transportShareHigh).toBeLessThan(defaults.thresholds.transportShareHigh);
    expect(tuned.tuning.complianceStrictness).toBe('strict');
    expect(tuned.tuning.optimizationDepth).toBe('deep');
  });

  test('should compute transaction stats with missing values', () => {
    const transactions = [
      { category: 'energy', amount: 100 },
      { category: '', amount: 50 },
      { amount: 'abc' },
      { category: 'transportation' }
    ];

    const stats = orchestrationService.computeTransactionStats(transactions);

    expect(stats.totalCount).toBe(4);
    expect(stats.missingCategoryCount).toBe(2);
    expect(stats.missingAmountCount).toBe(1);
    expect(stats.invalidAmountCount).toBe(1);
    expect(stats.totalAmount).toBe(150);
    expect(stats.averageAmount).toBeCloseTo(37.5, 5);
  });

  test('should assess data quality with weighted confidence', () => {
    const transactions = [
      { category: 'energy', amount: 100 },
      { category: 'transportation', amount: -10 }
    ];
    const stats = orchestrationService.computeTransactionStats(transactions);
    const weights = orchestrationService.getOrchestrationOptions().weights;
    const quality = orchestrationService.assessDataQuality(stats, transactions, weights);

    expect(quality.completeness).toBeCloseTo(1, 5);
    expect(quality.consistency).toBeCloseTo(0.5, 5);
    expect(quality.coverage).toBeCloseTo(2 / 7, 5);
    expect(quality.confidence).toBeCloseTo(0.6357, 4);
  });

  test('should build orchestration plan with thresholds and outputs', () => {
    const orchestrationOptions = orchestrationService.getOrchestrationOptions({
      orchestration: { emitRecommendations: false }
    });
    const analysisContext = {
      transactions: Array.from({ length: 25 }, (_, index) => ({
        category: 'energy',
        amount: 100 + index
      })),
      behaviorProfiles: {
        energy: { emissionsShare: 0.3, severity: 'high' },
        waste: { emissionsShare: 0.2, severity: 'medium' }
      },
      dataQuality: { confidence: 0.8 }
    };
    const sectorProfile = { label: 'Manufacturing', orchestrationPlan: {} };
    const msmeProfile = {
      businessDomain: 'manufacturing',
      environmentalCompliance: {
        hasPollutionControlBoard: false,
        hasEnvironmentalClearance: false
      }
    };

    const plan = orchestrationService.buildOrchestrationPlan({
      sectorProfile,
      analysisContext,
      msmeProfile,
      orchestrationOptions
    });

    expect(plan.parallelAgents).toEqual(
      expect.arrayContaining(['anomaly_detector', 'trend_analyzer', 'compliance_monitor', 'optimization_advisor'])
    );
    expect(plan.outputs.recommendations).toBe(false);
    expect(plan.outputs.report).toBe(true);
  });

  test('should avoid default insight agents until demand signals require them', () => {
    const orchestrationOptions = orchestrationService.getOrchestrationOptions({
      frameworks: {
        iso14064: false,
        iso14067: false
      }
    });
    const analysisContext = {
      transactions: [{ category: 'energy', amount: 100 }],
      behaviorProfiles: {
        energy: { emissionsShare: 0.05, severity: 'low' },
        waste: { emissionsShare: 0.01, severity: 'low' },
        transportation: { emissionsShare: 0.01, severity: 'low' },
        materials: { emissionsShare: 0.01, severity: 'low' },
        manufacturing: { emissionsShare: 0.01, severity: 'low' }
      },
      dataQuality: { confidence: 0.9 },
      knownParameters: {},
      unknownParameters: { weightedParameters: [] },
      context: {
        frameworks: {
          iso14064: { enabled: false },
          iso14067: { enabled: false }
        },
        profileSignals: {
          completeness: { ratio: 1 },
          complexityScore: 0.1,
          flags: {}
        }
      }
    };

    const plan = orchestrationService.buildOrchestrationPlan({
      sectorProfile: { label: 'General MSME', orchestrationPlan: {} },
      analysisContext,
      msmeProfile: {
        businessDomain: 'services',
        environmentalCompliance: {
          hasPollutionControlBoard: true,
          hasEnvironmentalClearance: true
        }
      },
      orchestrationOptions
    });

    expect(plan.parallelAgents).toEqual([]);
    expect(plan.coordinationMode).toBe('sequential');
  });

  test('should preserve legacy eager insight agents when on-demand orchestration is disabled', () => {
    const orchestrationOptions = orchestrationService.getOrchestrationOptions({
      orchestration: { onDemandAgents: false },
      frameworks: {
        iso14064: false,
        iso14067: false
      }
    });

    const plan = orchestrationService.buildOrchestrationPlan({
      sectorProfile: { label: 'General MSME', orchestrationPlan: {} },
      analysisContext: {
        transactions: [{ category: 'energy', amount: 100 }],
        behaviorProfiles: {},
        dataQuality: { confidence: 0.9 },
        knownParameters: {},
        unknownParameters: { weightedParameters: [] },
        context: {
          frameworks: {
            iso14064: { enabled: false },
            iso14067: { enabled: false }
          },
          profileSignals: {
            completeness: { ratio: 1 },
            complexityScore: 0,
            flags: {}
          }
        }
      },
      msmeProfile: {
        businessDomain: 'services',
        environmentalCompliance: {
          hasPollutionControlBoard: true,
          hasEnvironmentalClearance: true
        }
      },
      orchestrationOptions
    });

    expect(plan.parallelAgents).toEqual([
      'anomaly_detector',
      'trend_analyzer',
      'compliance_monitor',
      'optimization_advisor'
    ]);
    expect(plan.coordinationMode).toBe('parallel');
  });

  test('should limit planned insight agents when max parallel agents is configured', () => {
    const orchestrationOptions = orchestrationService.getOrchestrationOptions({
      orchestration: { maxParallelAgents: 2 }
    });

    const plan = orchestrationService.buildOrchestrationPlan({
      sectorProfile: {
        label: 'Manufacturing',
        orchestrationPlan: {
          parallelAgents: [
            'anomaly_detector',
            'trend_analyzer',
            'compliance_monitor',
            'optimization_advisor'
          ]
        }
      },
      analysisContext: {
        transactions: Array.from({ length: 30 }, (_, index) => ({ category: 'energy', amount: index + 1 })),
        behaviorProfiles: {
          energy: { emissionsShare: 0.4, severity: 'high' }
        },
        dataQuality: { confidence: 0.9 },
        knownParameters: {},
        unknownParameters: { weightedParameters: [] },
        context: {
          frameworks: orchestrationOptions.frameworks,
          profileSignals: {
            completeness: { ratio: 1 },
            complexityScore: 0.7,
            flags: {}
          }
        }
      },
      msmeProfile: { businessDomain: 'manufacturing' },
      orchestrationOptions
    });

    expect(plan.parallelAgents).toEqual(['anomaly_detector', 'trend_analyzer']);
    expect(plan.rationale).toContain('Parallel insight agents limited to 2 by orchestration policy.');
  });

  test('should build parallel agent definitions with enriched inputs', async () => {
    const orchestrationOptions = orchestrationService.getOrchestrationOptions();
    const analysisContext = {
      transactions: [{ category: 'energy', amount: 100 }],
      carbonData: { totalEmissions: 10 },
      behaviorProfiles: { energy: { emissionsShare: 0.4, severity: 'high' } },
      context: { regulatoryContext: {} },
      processMachineryProfile: { processes: ['assembly'] },
      transactionStats: { totalCount: 1 },
      dataQuality: { confidence: 0.9 },
      orchestrationOptions
    };
    const orchestrationPlan = { parallelAgents: ['anomaly_detector', 'optimization_advisor'] };
    const coordinationContext = { interactions: [] };

    aiAgentService.anomalyDetectorAgent.mockResolvedValue({ anomalies: [] });
    aiAgentService.optimizationAdvisorAgent.mockResolvedValue({ optimizations: [] });

    const agents = orchestrationService.buildParallelAgentDefinitions(
      analysisContext,
      orchestrationPlan,
      coordinationContext
    );

    expect(agents).toHaveLength(2);
    await agents[0].handler();
    await agents[1].handler();

    expect(aiAgentService.anomalyDetectorAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ orchestrationOptions })
      })
    );
    expect(aiAgentService.optimizationAdvisorAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ orchestrationOptions })
      })
    );
  });

  test('should execute planned insight agents sequentially when coordination mode requires it', async () => {
    const order = [];
    const coordinationContext = {
      interactions: [],
      previousResults: {},
      warnings: []
    };
    const plannedAgents = [
      {
        type: 'anomaly_detector',
        stage: 'anomaly_detection',
        allowFailure: true,
        handler: jest.fn(async () => {
          order.push('anomaly-start');
          await Promise.resolve();
          order.push('anomaly-end');
          return { anomalies: [] };
        })
      },
      {
        type: 'trend_analyzer',
        stage: 'trend_analysis',
        allowFailure: true,
        handler: jest.fn(async () => {
          order.push('trend-start');
          await Promise.resolve();
          order.push('trend-end');
          return { trends: {} };
        })
      }
    ];

    const results = await orchestrationService.executeParallelAgents(
      plannedAgents,
      coordinationContext,
      {},
      'sequential'
    );

    expect(results).toEqual({
      anomaly_detector: { anomalies: [] },
      trend_analyzer: { trends: {} }
    });
    expect(order).toEqual([
      'anomaly-start',
      'anomaly-end',
      'trend-start',
      'trend-end'
    ]);
    expect(coordinationContext.interactions).toEqual([
      expect.objectContaining({ agentType: 'anomaly_detector', status: 'completed' }),
      expect.objectContaining({ agentType: 'trend_analyzer', status: 'completed' })
    ]);
  });

  test('should pass ISO framework context to compliance monitor agent', async () => {
    const orchestrationOptions = orchestrationService.getOrchestrationOptions();
    const analysisContext = {
      transactions: [{ category: 'energy', amount: 100 }],
      carbonData: { totalEmissions: 10 },
      behaviorProfiles: { energy: { emissionsShare: 0.4, severity: 'high' } },
      context: {
        regulatoryContext: {},
        frameworks: {
          iso14064: { enabled: true, baseYear: 2024 },
          iso14067: { enabled: true, functionalUnit: '1 unit' }
        }
      },
      processMachineryProfile: { processes: ['assembly'] },
      transactionStats: { totalCount: 1 },
      dataQuality: { confidence: 0.9 },
      knownParameters: {},
      unknownParameters: {},
      dynamicParameters: {},
      transactionTypeContext: {},
      msmeData: { companyName: 'Test MSME' },
      orchestrationOptions
    };
    const orchestrationPlan = { parallelAgents: ['compliance_monitor'] };
    const coordinationContext = { interactions: [] };

    aiAgentService.complianceMonitorAgent.mockResolvedValue({ status: 'compliant' });

    const agents = orchestrationService.buildParallelAgentDefinitions(
      analysisContext,
      orchestrationPlan,
      coordinationContext
    );

    expect(agents).toHaveLength(1);
    await agents[0].handler();

    expect(aiAgentService.complianceMonitorAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          frameworks: expect.objectContaining({
            iso14064: expect.objectContaining({ baseYear: 2024 }),
            iso14067: expect.objectContaining({ functionalUnit: '1 unit' })
          }),
          msmeData: expect.objectContaining({ companyName: 'Test MSME' })
        })
      })
    );
  });

  test('should orchestrate emissions with dynamic sector outputs', async () => {
    const msmeProfile = {
      _id: '507f1f77bcf86cd799439011',
      companyName: 'Test MSME',
      industry: 'manufacturing',
      businessDomain: 'manufacturing',
      companyType: 'small',
      manufacturingProfile: {
        primaryEnergySource: 'Grid Electricity',
        backupEnergySource: 'Diesel Generator',
        mainFuelsUsed: ['Diesel', 'LPG'],
        waterSource: 'Borewell + Municipal',
        wasteManagementPractice: 'Partial Recovery',
        keyProducts: ['Fabricated Components'],
        productionCapacityPerMonth: 150,
        productionCapacityUnit: 'Tons',
        nicCode: '2599',
        supplyChainType: 'B2B (OEM)',
        logisticsMode: 'Road',
        certifications: ['ISO 9001'],
        esgMaturityLevel: 'Basic',
        digitalizationLevel: 'Moderate',
        carbonAccountingPractice: 'None',
        regulatoryExposure: ['ZED', 'State Pollution Control Board'],
        clusterAssociation: 'Peenya Industrial Association'
      },
      business: { primaryProducts: 'metal parts' },
      contact: { address: { state: 'Karnataka', country: 'India' } },
      environmentalCompliance: {
        hasPollutionControlBoard: true,
        hasEnvironmentalClearance: true
      }
    };

    const transactions = [
      {
        category: 'energy',
        amount: 100,
        description: 'Electricity bill'
      }
    ];

    MSME.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(msmeProfile)
    });
    AIAgent.find.mockResolvedValue([
      { type: 'sector_profiler', name: 'Sector Profiler' },
      { type: 'process_machinery_profiler', name: 'Process Profiler' },
      { type: 'trend_analyzer', name: 'Trend Analyzer' }
    ]);

    aiAgentService.sectorProfilerAgent.mockResolvedValue({
      sector: 'manufacturing',
      label: 'Manufacturing',
      behaviorWeights: { energy: 1.2 },
      orchestrationPlan: {
        parallelAgents: ['trend_analyzer'],
        outputs: { recommendations: false, report: false }
      }
    });
    aiAgentService.dataPrivacyAgent.mockResolvedValue({
      redactedTransactions: transactions,
      redactionSummary: { totalTransactions: transactions.length }
    });
    aiAgentService.documentAnalyzerAgent.mockResolvedValue({
      derivedTransactions: [],
      summary: { totalDocuments: 0 }
    });
    aiAgentService.processMachineryProfilerAgent.mockResolvedValue({
      processes: ['assembly'],
      machinery: ['cnc_machines'],
      emissionFactors: [{ category: 'energy', value: 0.8 }],
      intensityProfile: { score: 0.4 }
    });
    aiAgentService.dataProcessorAgent.mockResolvedValue({ validated: transactions });
    aiAgentService.carbonAnalyzerAgent.mockResolvedValue({ totalEmissions: 10 });
    aiAgentService.trendAnalyzerAgent.mockResolvedValue({ trends: {} });

    const result = await orchestrationService.orchestrateEmissions({
      msmeId: msmeProfile._id,
      transactions,
      contextOverrides: {
        orchestrationOptions: {
          thresholds: {
            minTransactionsForAnomaly: 100,
            minTransactionsForTrends: 100,
            energyShareHigh: 1.1,
            wasteShareHigh: 1.1,
            transportShareHigh: 1.1,
            materialsShareHigh: 1.1,
            manufacturingShareHigh: 1.1
          },
          orchestration: {
            emitRecommendations: false,
            emitReport: false
          }
        }
      }
    });

    expect(result.processMachineryProfile).toBeDefined();
    expect(result.orchestrationPlan.outputs.recommendations).toBe(false);
    expect(result.agentOutputs.recommendations).toBeNull();
    expect(result.agentOutputs.report).toBeNull();
    expect(result.context.manufacturingProfile).toEqual(
      expect.objectContaining({
        nicCode: '2599',
        logisticsMode: 'Road',
        productionCapacityPerMonth: 150
      })
    );
    expect(result.context.knownParameters.metadata).toEqual(
      expect.objectContaining({
        nicCode: '2599',
        carbonAccountingPractice: 'None'
      })
    );
    expect(result.msmeSnapshot.manufacturingProfile).toEqual(
      expect.objectContaining({
        supplyChainType: 'B2B (OEM)',
        clusterAssociation: 'Peenya Industrial Association'
      })
    );
    expect(result.valueChainReport).toBeDefined();
    expect(result.valueChainReport.summary.totalTransactions).toBe(1);
    expect(result.valueChainReport.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'operations', transactionCount: 1 })
      ])
    );
    expect(aiAgentService.trendAnalyzerAgent).toHaveBeenCalled();
    expect(aiAgentService.anomalyDetectorAgent).toHaveBeenCalled();
    expect(aiAgentService.complianceMonitorAgent).toHaveBeenCalled();
  });

  describe('Orchestration agent coordination', () => {
    test('should apply orchestration updates into communication context', () => {
      const coordinationContext = { orchestrationId: 'orch_001' };

      orchestrationService.applyOrchestrationUpdate(coordinationContext, {
        stage: 'bootstrap',
        summary: { transactionCount: 4 },
        updatedAt: '2024-02-01T00:00:00.000Z',
        sharedContext: { region: 'south-india' },
        agentBriefings: { data_processor: { focus: 'data_enrichment' } },
        messages: [{ targets: ['broadcast'], message: 'sync', severity: 'info', timestamp: '2024-02-01T00:00:00.000Z' }]
      });

      expect(coordinationContext.communication).toBeDefined();
      expect(coordinationContext.communication.sharedContext).toEqual({ region: 'south-india' });
      expect(coordinationContext.communication.agentBriefings.data_processor.focus).toBe('data_enrichment');
      expect(coordinationContext.communication.messages).toHaveLength(1);
      expect(coordinationContext.communication.stageSummaries).toEqual([
        {
          stage: 'bootstrap',
          summary: { transactionCount: 4 },
          updatedAt: '2024-02-01T00:00:00.000Z'
        }
      ]);
    });

    test('should include agent briefing in coordination payload', () => {
      const coordinationContext = {
        communication: {
          agentBriefings: {
            trend_analyzer: { focus: 'trend_context', transactionCount: 2 }
          }
        }
      };

      const payload = orchestrationService.buildCoordinationPayload(
        coordinationContext,
        'trend_analyzer'
      );

      expect(payload.agentBriefing).toEqual({
        focus: 'trend_context',
        transactionCount: 2
      });
      expect(payload.communication).toBe(coordinationContext.communication);
    });

    test('should run orchestration agent and merge communication updates', async () => {
      const coordinationContext = {
        orchestrationId: 'orch_abc',
        interactions: [],
        previousResults: {},
        warnings: [],
        communication: orchestrationService.initializeCommunicationContext('orch_abc')
      };

      aiAgentService.orchestrationAgent.mockResolvedValue({
        stage: 'bootstrap',
        summary: { transactionCount: 2 },
        updatedAt: '2024-02-01T00:00:00.000Z',
        sharedContext: { orchestrationId: 'orch_abc' },
        agentBriefings: { data_processor: { focus: 'data_enrichment' } },
        messages: [
          {
            targets: ['broadcast'],
            message: 'coordination ready',
            severity: 'info',
            timestamp: '2024-02-01T00:00:00.000Z'
          }
        ]
      });

      await orchestrationService.runOrchestrationAgent({
        stage: 'bootstrap',
        msmeProfile: {
          companyName: 'Acme Works',
          industry: 'manufacturing',
          businessDomain: 'manufacturing',
          companyType: 'small',
          contact: { address: { state: 'Karnataka' } }
        },
        context: { businessDomain: 'manufacturing' },
        coordinationContext,
        agentAvailability: { orchestration_agent: { available: true } },
        transactions: [{ id: 1 }, { id: 2 }]
      });

      expect(aiAgentService.orchestrationAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            stage: 'bootstrap',
            orchestrationId: 'orch_abc'
          })
        })
      );
      expect(coordinationContext.communication.sharedContext).toEqual({ orchestrationId: 'orch_abc' });
      expect(coordinationContext.communication.agentBriefings.data_processor.focus).toBe('data_enrichment');
      expect(coordinationContext.communication.messages).toHaveLength(1);
      expect(coordinationContext.communication.stageSummaries).toHaveLength(1);
      expect(coordinationContext.interactions[0]).toEqual(expect.objectContaining({
        agentType: 'orchestration_agent',
        status: 'completed'
      }));
    });
  });
});
