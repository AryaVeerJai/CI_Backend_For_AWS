const { buildZedReadinessPack } = require('../services/zedAssessmentService');
const {
  calculateZedSubsidy,
  resolveZedCertificationLevel,
  ZED_PARAMETERS
} = require('../../../shared/zedCertification');

describe('ZED assessment service', () => {
  test('builds readiness pack with 20 parameters and pillar scores', () => {
    const pack = buildZedReadinessPack({
      msme: {
        companyName: 'Acme Manufacturing',
        udyamRegistrationNumber: 'UDYAM-MH-01-0001234',
        businessDomain: 'manufacturing',
        companyType: 'micro',
        numberOfEmployees: 25,
        manufacturingProfile: {
          keyProducts: ['Precision Gears'],
          powerConsumptionKwhPerMonth: 12000,
          waterSource: 'Municipal + recycled',
          wasteManagementPractice: 'Segregation and authorized recycler',
          certifications: ['ISO 9001'],
          digitalizationLevel: 'moderate'
        },
        environmentalCompliance: {
          hasPollutionControlBoard: true,
          hasWasteManagement: true
        },
        business: {
          manufacturingWorkflow: {
            units: [{ name: 'Machining', products: ['Precision Gears'] }]
          }
        }
      },
      documents: [{ _id: 'doc1' }],
      hubZed: {
        pledgeTaken: true,
        targetLevel: 'bronze'
      },
      totalEmissionsKg: 45000
    });

    expect(pack.parameters).toHaveLength(ZED_PARAMETERS.length);
    expect(pack.pillarScores).toHaveLength(4);
    expect(pack.overallReadinessScore).toBeGreaterThan(0);
    expect(pack.eligibility.eligible).toBe(true);
    expect(pack.journeyStatus).toBe('ready_for_assessment');
    expect(pack.zeroEffectAlignment.platformCarbonDataAvailable).toBe(true);
    expect(pack.zeroDefectAlignment.manufacturingWorkflowConfigured).toBe(true);
    expect(pack.priorityActions.length).toBeGreaterThan(0);
  });

  test('marks journey as certified when certified level is stored', () => {
    const pack = buildZedReadinessPack({
      msme: {
        udyamRegistrationNumber: 'UDYAM-KA-02-0009876',
        businessDomain: 'manufacturing',
        manufacturingProfile: {
          certifications: ['ZED Gold']
        }
      },
      hubZed: {
        certifiedLevel: 'gold',
        certifiedAt: new Date().toISOString()
      }
    });

    expect(pack.certifiedLevel).toBe('gold');
    expect(pack.journeyStatus).toBe('certified');
  });

  test('uses manual parameter scores over auto-detection', () => {
    const pack = buildZedReadinessPack({
      msme: {
        udyamRegistrationNumber: 'UDYAM-DL-03-0001111',
        businessDomain: 'manufacturing'
      },
      hubZed: {
        parameterScores: [
          { id: '6', maturityStage: 'reviewed', evidence: ['energy_audit_2025'] }
        ]
      }
    });

    const energyParam = pack.parameters.find((param) => param.id === '6');
    expect(energyParam.maturityStage).toBe('reviewed');
    expect(energyParam.autoDetected).toBe(false);
    expect(energyParam.maturityScore).toBe(100);
  });
});

describe('ZED certification shared helpers', () => {
  test('resolveZedCertificationLevel picks highest level from certifications', () => {
    expect(resolveZedCertificationLevel(['ZED Bronze'])).toBe('bronze');
    expect(resolveZedCertificationLevel(['MSME ZED Silver'])).toBe('silver');
    expect(resolveZedCertificationLevel(['ZED Gold', 'ZED Bronze'])).toBe('gold');
    expect(resolveZedCertificationLevel(['ISO 14001'])).toBeNull();
  });

  test('calculateZedSubsidy estimates bronze net payable for micro enterprise', () => {
    const subsidy = calculateZedSubsidy({
      companyType: 'micro',
      targetLevel: 'bronze',
      isWomenOrScStOwned: false,
      isInClusterProgramme: false
    });

    expect(subsidy.grossCostInr).toBe(10000);
    expect(subsidy.schemeSubsidyInr).toBe(8000);
    expect(subsidy.joiningRewardInr).toBe(10000);
    expect(subsidy.estimatedNetPayableInr).toBe(0);
  });
});
