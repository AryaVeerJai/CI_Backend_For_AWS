const { handlers } = require('../services/agents/handlers/standardHandlers');

describe('ISO certification automation agents', () => {
  test('iso evidence collector builds evidence register', async () => {
    const output = await handlers.iso_evidence_collector({
      input: {
        msmeData: {
          companyName: 'Acme Works',
          business: {
            primaryProducts: 'Precision Gears'
          }
        },
        transactions: [{ category: 'energy', amount: 1000 }],
        documents: [{ id: 'doc_1' }],
        frameworks: {
          iso14064: {
            boundaryDefinitions: {
              organizationalBoundary: 'India operations'
            }
          },
          iso14067: {
            functionalUnit: '1 unit'
          }
        },
        context: {
          dataQuality: { confidence: 0.8 }
        }
      }
    });

    expect(output.certificationStage).toBe('evidence_collection');
    expect(output.evidenceRegister).toBeDefined();
    expect(output.evidenceRegister.factors.records.length).toBeGreaterThan(0);
  });

  test('iso gap closure planner emits actionable plan', async () => {
    const output = await handlers.iso_gap_closure_planner({
      input: {
        msmeData: { companyName: 'Acme Works' },
        frameworks: {
          iso14064: { enabled: true },
          iso14067: { enabled: true }
        },
        context: {
          dataQuality: { confidence: 0.2 }
        }
      }
    });

    expect(output.certificationStage).toBe('gap_closure_planning');
    expect(Array.isArray(output.actionPlan)).toBe(true);
  });

  test('iso audit packager returns certification status', async () => {
    const output = await handlers.iso_audit_packager({
      input: {
        gapClosureChecklist: {
          overallReadinessScore: 92
        },
        evidenceRegister: {
          boundary: { evidenceCount: 4 },
          factors: { evidenceCount: 6 },
          uncertainty: { evidenceCount: 3 },
          productCFP: { evidenceCount: 4 }
        },
        actionPlan: [{ id: 'a1', status: 'closed' }]
      }
    });

    expect(output.certificationStage).toBe('audit_packaging');
    expect(output.certificationStatus).toBe('ready_for_external_verification');
  });
});
