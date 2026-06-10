const { handlers } = require('../services/agents/handlers/standardHandlers');

describe('Orchestration Agent Handler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-02-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('builds shared context and agent briefings', async () => {
    const result = await handlers.orchestration_agent({
      input: {
        stage: 'context_enrichment',
        orchestrationId: 'orch_123',
        msmeSnapshot: {
          companyName: 'Acme Works',
          industry: 'manufacturing',
          businessDomain: 'manufacturing',
          companyType: 'small',
          location: 'Karnataka'
        },
        context: {
          businessDomain: 'manufacturing',
          industry: 'manufacturing',
          region: 'south-india',
          season: 'monsoon',
          dataQuality: {
            confidence: 0.72,
            completeness: 0.8,
            consistency: 0.7,
            coverage: 0.6
          },
          knownParameters: {
            processes: ['cutting', 'welding'],
            machinery: ['cnc'],
            waterConsumption: { total: 120 },
            fuelConsumption: { total: 50 },
            wasteGeneration: { total: 10 },
            materialsConsumption: { total: 400 },
            chemicalsConsumption: { total: 5 },
            airPollution: { pollutants: ['pm2.5', 'co2'] }
          },
          unknownParameters: {
            needsReview: false,
            detectedCategories: [],
            weightedParameters: []
          },
          policyUpdates: { status: 'active' }
        },
        transactions: [{ id: 1 }, { id: 2 }, { id: 3 }],
        processedTransactions: [{ id: 1 }, { id: 2 }],
        orchestrationPlan: {
          coordinationMode: 'parallel',
          parallelAgents: ['trend_analyzer'],
          outputs: { recommendations: true, report: true }
        },
        agentOutputs: {
          documentAnalysis: {
            summary: {
              totalDocuments: 2,
              processedDocuments: 2,
              categoryBreakdown: { energy: 1 },
              vendorBreakdown: { 'Acme Energy': 1 }
            }
          }
        }
      }
    });

    expect(result.stage).toBe('context_enrichment');
    expect(result.sharedContext.transactionCount).toBe(2);
    expect(result.sharedContext.dataQuality).toEqual(expect.objectContaining({
      confidence: 0.72,
      completeness: 0.8,
      consistency: 0.7,
      coverage: 0.6
    }));
    expect(result.sharedContext.knownParameters).toEqual(expect.objectContaining({
      processCount: 2,
      machineryCount: 1,
      waterConsumption: 120,
      fuelConsumption: 50
    }));
    expect(result.sharedContext.documentContext).toEqual(expect.objectContaining({
      totalDocuments: 2,
      processedDocuments: 2,
      categoryCount: 1,
      vendorCount: 1
    }));
    expect(result.agentBriefings.data_processor).toEqual(expect.objectContaining({
      focus: 'data_enrichment',
      transactionCount: 2
    }));
    expect(result.agentBriefings.carbon_analyzer).toEqual(expect.objectContaining({
      focus: 'emissions_analysis',
      transactionCount: 2
    }));
    expect(result.messages).toHaveLength(0);
  });

  test('emits coordination messages for risk signals', async () => {
    const result = await handlers.orchestration_agent({
      input: {
        stage: 'core_analysis_complete',
        orchestrationId: 'orch_risk',
        context: {
          dataQuality: { confidence: 0.4 },
          unknownParameters: {
            needsReview: true,
            detectedCategories: ['misc'],
            weightedParameters: [{ name: 'misc', weight: 0.4 }]
          },
          policyUpdates: { status: 'placeholder' }
        },
        transactions: [{}, {}, {}],
        agentOutputs: {
          documentAnalysis: {
            summary: {
              totalDocuments: 0,
              processedDocuments: 0
            }
          }
        }
      }
    });

    const dataQualityMessage = result.messages.find(message =>
      message.message.includes('Data quality is below target'));
    expect(dataQualityMessage).toEqual(expect.objectContaining({
      severity: 'warning'
    }));
    expect(dataQualityMessage.targets).toEqual(expect.arrayContaining(['broadcast']));

    const unknownMessage = result.messages.find(message =>
      message.message.includes('Unknown parameters detected'));
    expect(unknownMessage.targets).toEqual(expect.arrayContaining([
      'anomaly_detector',
      'compliance_monitor'
    ]));

    const ragWarning = result.messages.find(message =>
      message.message.includes('verified-source RAG resolution'));
    expect(ragWarning).toBeDefined();
    expect(ragWarning.targets).toEqual(expect.arrayContaining([
      'verified_source_rag',
      'data_processor'
    ]));

    const policyMessage = result.messages.find(message =>
      message.message.includes('Policy updates are placeholders'));
    expect(policyMessage.targets).toEqual(expect.arrayContaining(['compliance_monitor']));

    const documentMessage = result.messages.find(message =>
      message.message.includes('No document context available'));
    expect(documentMessage.targets).toEqual(expect.arrayContaining(['data_processor']));
  });
});
