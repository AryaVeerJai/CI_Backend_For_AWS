const isoGapClosureService = require('../services/isoGapClosureService');

describe('ISO gap-closure checklist service', () => {
  test('builds checklist sections and factor registry defaults', () => {
    const checklist = isoGapClosureService.buildIsoGapClosureChecklist({
      msmeData: {
        companyName: 'Acme Works',
        business: {
          primaryProducts: 'Precision Gears',
          manufacturingWorkflow: {
            units: [{ products: ['Precision Gears'] }]
          }
        }
      },
      transactions: [
        { category: 'energy', amount: 1200, transactionType: 'expense' }
      ],
      dataQuality: {
        confidence: 0.8
      }
    });

    expect(checklist.sections.boundaryDefinitions).toBeDefined();
    expect(checklist.sections.factorRegistry).toBeDefined();
    expect(checklist.sections.uncertaintyFields).toBeDefined();
    expect(checklist.sections.productCfpModuleSkeleton).toBeDefined();
    expect(checklist.sections.productCfpModuleSkeleton.section).toBe('product_cfp_module');
    expect(checklist.sections.productCfpModuleSkeleton.lifecycleStages).toBeDefined();
    expect(Array.isArray(checklist.factorRegistry)).toBe(true);
    expect(checklist.factorRegistry.length).toBeGreaterThan(0);
    expect(checklist.overallReadinessScore).toBeGreaterThanOrEqual(0);
  });

  test('marks boundary and CFP fields complete when framework details are provided', () => {
    const checklist = isoGapClosureService.buildIsoGapClosureChecklist({
      msmeData: {
        companyName: 'Acme Works',
        business: {
          primaryProducts: 'Precision Gears',
          manufacturingWorkflow: {
            units: [{ products: ['Precision Gears'] }]
          }
        }
      },
      dataQuality: {
        confidence: 0.9
      },
      frameworks: {
        iso14064: {
          boundaryDefinitions: {
            organizationalBoundary: 'Acme legal entities in India',
            operationalBoundary: 'Scopes 1, 2, and selected Scope 3 categories',
            consolidationApproach: 'operational_control',
            includedFacilities: ['Plant A']
          },
          uncertainty: {
            combinationMethod: 'root_sum_square',
            combinedRelativeUncertainty: 0.12
          }
        },
        iso14067: {
          functionalUnit: '1 kg finished product',
          allocationMethod: 'mass',
          lifecycleStages: {
            upstream: 'raw material extraction',
            operations: 'manufacturing',
            downstream: 'distribution and use'
          }
        }
      }
    });

    const boundaryItems = checklist.sections.boundaryDefinitions.items;
    const cfpItems = checklist.sections.productCfpModuleSkeleton.items;
    expect(boundaryItems.every(item => item.status === 'complete')).toBe(true);
    expect(cfpItems.find(item => item.id === 'cfp_functional_unit').status).toBe('complete');
    expect(cfpItems.find(item => item.id === 'cfp_allocation_method').status).toBe('complete');
  });

  test('marks ISO 14064 governance and verification controls complete when configured', () => {
    const checklist = isoGapClosureService.buildIsoGapClosureChecklist({
      msmeData: {
        companyName: 'Acme Works'
      },
      frameworks: {
        iso14064: {
          methodology: {
            protocolReference: 'ISO 14064-1:2018',
            quantificationApproach: 'activity_data_x_emission_factor'
          },
          governance: {
            inventoryManager: 'Sustainability Lead',
            evidenceRetentionYears: 8
          },
          recalculationPolicy: {
            policyStatement: 'Recalculate baseline for major structural changes',
            triggers: ['acquisition', 'divestment', 'methodology_update']
          },
          verification: {
            assuranceLevel: 'limited',
            boundaryCoverage: 'Scopes 1 and 2 + material Scope 3',
            evidencePackVersion: 'v2026.04'
          }
        }
      }
    });

    const governanceItems = checklist.sections.governanceVerificationControls.items;
    expect(governanceItems.every(item => item.status === 'complete')).toBe(true);
    expect(checklist.sections.governanceVerificationControls.readinessScore).toBe(100);
  });
});
