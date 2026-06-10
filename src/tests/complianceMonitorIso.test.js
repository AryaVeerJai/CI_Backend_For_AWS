const { handlers, helpers } = require('../services/agents/handlers/standardHandlers');

describe('ISO compliance monitor agent', () => {
  test('evaluates ISO 14064 readiness with strong evidence', () => {
    const result = helpers.evaluateIso14064({
      msmeData: {
        companyName: 'Acme Works',
        business: {
          primaryProducts: 'Metal Components'
        }
      },
      carbonData: {
        totalEmissions: 120.5,
        categoryBreakdown: {
          energy: 60,
          transportation: 20,
          waste: 15,
          materials: 25
        }
      },
      transactions: [
        { category: 'energy', amount: 1000 },
        { category: 'transportation', amount: 450 }
      ],
      knownParameters: {
        msmeProfile: { businessDomain: 'manufacturing' }
      },
      unknownParameters: {
        weightedParameters: []
      },
      dataQuality: {
        confidence: 0.9
      },
      context: {
        frameworks: {
          iso14064: {
            enabled: true,
            baseYear: 2024,
            methodology: {
              protocolReference: 'ISO 14064-1:2018'
            },
            governance: {
              inventoryManager: 'Sustainability Manager',
              evidenceRetentionYears: 8
            },
            recalculationPolicy: {
              policyStatement: 'Recalculate on structural changes',
              triggers: ['acquisition', 'factor_update']
            },
            verification: {
              assuranceLevel: 'limited',
              boundaryCoverage: 'organizational_control',
              evidencePackVersion: 'v1.2'
            }
          }
        }
      }
    });

    expect(result.enabled).toBe(true);
    expect(result.framework).toBe('ISO 14064');
    expect(result.readinessScore).toBeGreaterThanOrEqual(80);
    expect(result.issues).toHaveLength(0);
    expect(result.controlSummary.methodologyDeclared).toBe(true);
    expect(result.controlSummary.inventoryManager).toBe('Sustainability Manager');
    expect(result.controlSummary.recalculationPolicyPresent).toBe(true);
    expect(result.controlSummary.verificationReady).toBe(true);
    expect(result.controlSummary.evidenceRetentionYears).toBe(8);
  });

  test('evaluates ISO 14067 gaps when functional unit is missing', () => {
    const result = helpers.evaluateIso14067({
      msmeData: {
        companyName: 'Acme Works',
        business: {
          manufacturingWorkflow: {
            units: [{ products: ['Precision Gears'] }]
          }
        }
      },
      transactions: [],
      knownParameters: {
        processes: ['machining'],
        machinery: ['cnc']
      },
      dataQuality: {
        confidence: 0.8
      },
      context: {
        frameworks: {
          iso14067: {
            enabled: true,
            requireFunctionalUnit: true,
            requireBoundaryDefinition: false,
            requireProductLevelLci: false,
            minBoundaryRigorScore: 0,
            minLciGranularityScore: 0
          }
        }
      }
    });

    const missingFunctionalUnitIssue = result.issues.find(issue => issue.code === 'ISO14067_FUNCTIONAL_UNIT_MISSING');
    expect(result.enabled).toBe(true);
    expect(result.framework).toBe('ISO 14067');
    expect(missingFunctionalUnitIssue).toBeDefined();
  });

  test('passes ISO 14067 boundary and product-level LCI checks when strong signals are present', () => {
    const result = helpers.evaluateIso14067({
      msmeData: {
        companyName: 'Acme Works',
        business: {
          manufacturingWorkflow: {
            units: [{ products: ['Precision Gears'] }],
            employees: [{ name: 'A' }]
          }
        }
      },
      transactions: [{ transactionType: 'sale', description: 'Dispatch to buyer' }],
      knownParameters: {
        processes: ['machining'],
        machinery: ['cnc'],
        materialsConsumption: { total: 300 }
      },
      dataQuality: {
        confidence: 0.9
      },
      context: {
        frameworks: {
          iso14067: {
            enabled: true,
            functionalUnit: '1 unit',
            allocationMethod: 'mass',
            requireBoundaryDefinition: true,
            requireProductLevelLci: true,
            minBoundaryRigorScore: 0.6,
            minLciGranularityScore: 0.6
          }
        },
        iso14067Signals: {
          boundaryRigorScore: 0.8,
          boundaryDescription: 'Cradle-to-grave boundary with documented exclusions',
          systemBoundaryType: 'cradle_to_grave',
          lciGranularityScore: 0.85,
          lciRecordCount: 24
        }
      }
    });

    const checkMap = new Map(result.checks.map(check => [check.id, check]));
    expect(checkMap.get('boundary_definition')?.passed).toBe(true);
    expect(checkMap.get('boundary_rigor')?.passed).toBe(true);
    expect(checkMap.get('product_level_lci')?.passed).toBe(true);
    expect(result.issues.find(issue => issue.code === 'ISO14067_BOUNDARY_RIGOR_LOW')).toBeUndefined();
    expect(result.issues.find(issue => issue.code === 'ISO14067_LCI_GRANULARITY_LOW')).toBeUndefined();
  });

  test('compliance monitor aggregates ISO framework outcomes', async () => {
    const output = await handlers.compliance_monitor({
      input: {
        msmeData: {
          companyName: 'Acme Works',
          business: {
            manufacturingWorkflow: {
              units: [{ products: ['Precision Gears'] }]
            }
          }
        },
        carbonData: {
          totalEmissions: 0,
          categoryBreakdown: {}
        },
        transactions: [],
        knownParameters: {},
        unknownParameters: { weightedParameters: [{ name: 'misc', weight: 0.4 }] },
        dataQuality: { confidence: 0.2 },
        context: {
          frameworks: {
            iso14064: { enabled: true },
            iso14067: { enabled: true }
          }
        }
      }
    });

    expect(output.frameworks['ISO 14064']).toBeDefined();
    expect(output.frameworks['ISO 14067']).toBeDefined();
    expect(output.gapClosureChecklist).toBeDefined();
    expect(output.gapClosureChecklist.sections.boundaryDefinitions).toBeDefined();
    expect(output.gapClosureChecklist.sections.factorRegistry).toBeDefined();
    expect(output.gapClosureChecklist.sections.uncertaintyFields).toBeDefined();
    expect(output.gapClosureChecklist.sections.governanceVerificationControls).toBeDefined();
    expect(output.gapClosureChecklist.sections.productCfpModuleSkeleton).toBeDefined();
    expect(output.status).toBe('non_compliant');
    expect(output.readinessScore).toBeGreaterThanOrEqual(0);
  });

  test('flags ISO 14064 governance and verification gaps when controls are absent', () => {
    const result = helpers.evaluateIso14064({
      msmeData: {
        companyName: 'Acme Works'
      },
      carbonData: {
        totalEmissions: 90,
        categoryBreakdown: {
          energy: 90
        }
      },
      transactions: [{ category: 'energy', amount: 100 }],
      dataQuality: {
        confidence: 0.8
      },
      knownParameters: {
        msmeProfile: { businessDomain: 'manufacturing' }
      },
      unknownParameters: {
        weightedParameters: []
      },
      context: {
        frameworks: {
          iso14064: {
            enabled: true,
            baseYear: 2024
          }
        }
      }
    });

    const issueCodes = result.issues.map(issue => issue.code);
    expect(issueCodes).toContain('ISO14064_METHODOLOGY_MISSING');
    expect(issueCodes).toContain('ISO14064_ACCOUNTABILITY_OWNER_MISSING');
    expect(issueCodes).toContain('ISO14064_RECALCULATION_POLICY_MISSING');
    expect(issueCodes).toContain('ISO14064_VERIFICATION_READINESS_MISSING');
    expect(issueCodes).toContain('ISO14064_EVIDENCE_RETENTION_INSUFFICIENT');
    expect(result.controlSummary.methodologyDeclared).toBe(false);
    expect(result.controlSummary.inventoryManager).toBeNull();
  });
});
