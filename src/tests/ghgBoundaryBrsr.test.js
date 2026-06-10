const {
  assessOrganizationalBoundaryComplete,
  assessOperationalBoundaryComplete,
  buildBrsrGhgInventoryBoundaries,
  withCompletenessFlag,
  DEFAULT_SCOPE3_CATEGORIES_INCLUDED
} = require('../../../shared/ghgBoundaryBrsr');

describe('ghgBoundaryBrsr', () => {
  test('default Scope 3 categories align across services', () => {
    expect(DEFAULT_SCOPE3_CATEGORIES_INCLUDED).toEqual([1, 2, 3, 4, 5, 6, 7, 12, 13]);
  });

  test('assessOrganizationalBoundaryComplete requires consolidation and entity narrative', () => {
    expect(assessOrganizationalBoundaryComplete({})).toBe(false);
    expect(
      assessOrganizationalBoundaryComplete({
        consolidationApproach: 'operational_control',
        reportingEntityDescription: 'Acme India Pvt Ltd and two manufacturing plants in Gujarat.'
      })
    ).toBe(true);
    expect(
      assessOrganizationalBoundaryComplete({
        consolidationApproach: 'operational_control',
        includedLegalEntities: [{ name: 'Acme Plant 1', relationshipType: 'branch', consolidationBasis: 'operational_control' }]
      })
    ).toBe(true);
  });

  test('assessOperationalBoundaryComplete requires reporting period and scope toggles', () => {
    expect(assessOperationalBoundaryComplete({})).toBe(false);
    expect(
      assessOperationalBoundaryComplete({
        reportingPeriodType: 'financial_year',
        baseYear: 2024,
        scope1StationaryCombustion: true,
        scope2LocationBased: true,
        scope3CategoriesIncluded: [1, 2, 3]
      })
    ).toBe(true);
  });

  test('buildBrsrGhgInventoryBoundaries structures org and operational fields for disclosure', () => {
    const payload = withCompletenessFlag(buildBrsrGhgInventoryBoundaries({
      manufacturingProfile: {
        ghgOrganizationalBoundary: {
          consolidationApproach: 'operational_control',
          reportingEntityDescription: 'Single legal entity with one plant.'
        }
      },
      operations: {
        ghgOperationalBoundary: {
          reportingPeriodType: 'financial_year',
          baseYear: 2024,
          scope1StationaryCombustion: true,
          scope2LocationBased: true,
          scope3CategoriesIncluded: [1, 2, 3, 4]
        }
      }
    }));

    expect(payload.organizationalBoundary.consolidationApproach).toBe('operational_control');
    expect(payload.operationalBoundary.scope1SourcesIncluded).toContain('stationary_combustion');
    expect(payload.operationalBoundary.scope2MethodsIncluded).toContain('location_based');
    expect(payload.completeness.boundariesReadyForBrsrPrinciple6).toBe(true);
  });
});
