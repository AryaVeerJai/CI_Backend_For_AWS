const {
  DEFAULT_FACTOR_REGISTRY,
  listRegistryFactorIds,
  getActivityEmissionFactors,
  getIndustryFactors,
  getDomainFactors
} = require('../../../shared/emissionFactorRegistry');

describe('shared emission factor registry', () => {
  test('includes core activity and spend factors', () => {
    const ids = listRegistryFactorIds();
    expect(ids).toEqual(expect.arrayContaining([
      'electricity_grid_india',
      'fuel_diesel',
      'water_consumption',
      'spend_generic',
      'material_steel',
      'waste_solid'
    ]));
    expect(ids.length).toBeGreaterThan(10);
  });

  test('activity tree matches registry canonical values', () => {
    const activity = getActivityEmissionFactors();
    expect(activity.electricity.grid).toBe(DEFAULT_FACTOR_REGISTRY.electricity_grid_india.factor);
    expect(activity.fuel.diesel).toBe(DEFAULT_FACTOR_REGISTRY.fuel_diesel.factor);
    expect(activity.materials.steel).toBe(DEFAULT_FACTOR_REGISTRY.material_steel.factor);
  });

  test('industry factors are exposed for calculation service', () => {
    const industries = getIndustryFactors();
    expect(industries.manufacturing).toBe(1);
    expect(industries.chemicals).toBeGreaterThan(1);
  });

  test('domain factors expose per-category multipliers for MSME business domains', () => {
    const domains = getDomainFactors();
    expect(domains.manufacturing).toEqual({
      transportation: 1.2,
      energy: 1.4,
      materials: 1.5,
      waste: 1.3
    });
    expect(domains.logistics.transportation).toBe(1.8);
    expect(domains.other).toEqual({
      transportation: 1,
      energy: 1,
      materials: 1,
      waste: 1
    });
    expect(Object.keys(domains)).toHaveLength(20);
  });
});
