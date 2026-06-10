const {
  evaluateEligibility,
  calculateSubvention,
  inferBeeSector
} = require('../services/adeetieEligibilityService');

const baseMsme = () => ({
  companyType: 'small',
  companyName: 'Test Unit',
  industry: 'Textile weaving',
  businessDomain: 'textiles',
  udyamRegistrationNumber: 'UDYAM-TN-01-1234567',
  gstNumber: '33AABCT1332L1Z1',
  manufacturingProfile: {
    beeSector: 'textiles',
    adeetieClusterId: 'textiles-tiruppur-tn',
    powerConsumptionKwhPerMonth: 12000
  }
});

describe('adeetieEligibilityService', () => {
  test('inferBeeSector from business domain', () => {
    expect(inferBeeSector(baseMsme())).toBe('textiles');
  });

  test('evaluateEligibility passes for complete profile', () => {
    const result = evaluateEligibility(baseMsme());
    expect(result.isEligible).toBe(true);
    expect(result.subventionRatePercent).toBe(5);
  });

  test('evaluateEligibility fails without cluster', () => {
    const msme = baseMsme();
    delete msme.manufacturingProfile.adeetieClusterId;
    delete msme.manufacturingProfile.beeSector;
    msme.businessDomain = 'other';
    msme.industry = 'General trading';
    msme.manufacturingProfile.clusterAssociation = 'Unknown cluster';
    const result = evaluateEligibility(msme);
    expect(result.isEligible).toBe(false);
    expect(result.missingFields).toContain('phase1_cluster');
  });

  test('calculateSubvention for small enterprise', () => {
    const result = calculateSubvention({
      loanAmount: 5000000,
      companyType: 'small',
      nominalInterestRatePercent: 12,
      tenureYears: 3
    });
    expect(result.eligible).toBe(true);
    expect(result.subventionRatePercent).toBe(5);
    expect(result.effectiveInterestRatePercent).toBe(7);
    expect(result.totalSubventionInr).toBe(750000);
  });

  test('medium enterprise gets 3% subvention', () => {
    const result = calculateSubvention({
      loanAmount: 10000000,
      companyType: 'medium',
      nominalInterestRatePercent: 11,
      tenureYears: 3
    });
    expect(result.subventionRatePercent).toBe(3);
    expect(result.effectiveInterestRatePercent).toBe(8);
  });
});
