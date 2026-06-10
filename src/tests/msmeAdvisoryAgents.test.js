const inventoryQualityAdvisorAgent = require('../services/agents/inventoryQualityAdvisorAgent');
const buyerRequestAdvisorAgent = require('../services/agents/buyerRequestAdvisorAgent');
const msmeGoalAdvisorAgent = require('../services/agents/msmeGoalAdvisorAgent');
const dpdpPrivacyAdvisorAgent = require('../services/agents/dpdpPrivacyAdvisorAgent');
const environmentalKpiAdvisorAgent = require('../services/agents/environmentalKpiAdvisorAgent');

describe('MSME advisory agents', () => {
  test('inventory quality separates completeness from rigor', async () => {
    const result = await inventoryQualityAdvisorAgent.execute({
      input: {
        msmeData: { companyName: 'Test MSME Pvt Ltd' },
        transactions: [
          { category: 'energy', quantificationMethod: 'activity', metadata: { kwh: 1000 } },
          { category: 'transport', description: 'diesel delivery' }
        ],
        dataQuality: { score: 80, hasScopeBreakdown: true }
      }
    });

    expect(result.inventoryQualityScore).toBeGreaterThan(0);
    expect(result.dataCompletenessScore).toBe(80);
    expect(result.activitySharePct).toBe(50);
  });

  test('buyer request advisor lists open questionnaires', async () => {
    const result = await buyerRequestAdvisorAgent.execute({
      input: {
        supplierQuestionnaires: [
          {
            buyerName: 'Buyer Co',
            framework: 'brsr_core',
            status: 'draft',
            dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
          }
        ],
        documentCount: 2,
        totalEmissionsKg: 5000,
        inventoryQuality: { inventoryQualityScore: 70 }
      }
    });

    expect(result.openRequestCount).toBe(1);
    expect(result.inbox[0].urgency).toBe('high');
  });

  test('goal advisor prioritizes green finance actions', async () => {
    const result = await msmeGoalAdvisorAgent.execute({
      input: {
        signupGoal: 'green_finance',
        inventoryQuality: { inventoryQualityScore: 55, hints: [] },
        buyerAdvisory: { openRequestCount: 0 },
        environmentalKpi: { readinessScore: 30 },
        dpdpAdvisory: { openIssues: [] },
        dataCompletenessScore: 60
      }
    });

    expect(result.signupGoal).toBe('green_finance');
    expect(result.prioritizedActions.some((a) => a.id === 'green_loans')).toBe(true);
  });

  test('DPDP advisor flags SMS consent mismatch', async () => {
    const result = await dpdpPrivacyAdvisorAgent.execute({
      input: {
        privacySettings: { smsProcessing: false, dataRetention: true, auditLogging: true },
        processingFlags: { smsEnabled: true }
      }
    });

    expect(result.openIssues.length).toBeGreaterThan(0);
    expect(result.status).toBe('needs_attention');
  });

  test('environmental KPI advisor detects missing water data', async () => {
    const result = await environmentalKpiAdvisorAgent.execute({
      input: {
        msmeData: {
          environmentalCompliance: { hasWasteManagement: false },
          operations: {}
        },
        transactions: []
      }
    });

    expect(result.kpis.some((k) => k.id === 'water_withdrawal')).toBe(true);
    expect(result.readinessScore).toBeLessThan(50);
  });
});
