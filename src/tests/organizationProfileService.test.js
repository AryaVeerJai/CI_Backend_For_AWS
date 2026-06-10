const { mapEnterpriseToOperationalProfile } = require('../services/organizationProfileService');

describe('mapEnterpriseToOperationalProfile', () => {
  it('maps facilities and scope3 into operational profile', () => {
    const enterprise = {
      _id: 'ent1',
      companyName: 'Acme Corp',
      industry: 'Manufacturing',
      sector: 'Steel',
      gstNumber: '29ABCDE1234F1Z5',
      consolidationApproach: 'operational_control',
      reportingEntityType: 'consolidated',
      contact: { address: { state: 'Maharashtra', country: 'India' } },
      facilities: [{ name: 'Plant A', state: 'MH', scope1Sources: ['boiler'], scope2Sources: ['grid'] }],
      scope3Materiality: {
        categories: [{ category: 'Business travel', material: true, coveragePercent: 40 }]
      }
    };

    const mapped = mapEnterpriseToOperationalProfile(enterprise);
    expect(mapped.enterpriseProfile).toEqual(enterprise);
    expect(mapped.operations.facilities).toHaveLength(1);
    expect(mapped.operations.scope3Materiality.categories[0].category).toBe('Business travel');
    expect(mapped.gstNumber).toBe(enterprise.gstNumber);
  });
});
