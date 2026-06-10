const operationsEmissionFactorAgentService = require('../services/operationsEmissionFactorAgentService');

describe('operationsEmissionFactorAgentService', () => {
  test('resolves regional grid for Karnataka', () => {
    const ctx = operationsEmissionFactorAgentService.createEmissionFactorAgentContext({
      contact: { address: { state: 'Karnataka' } },
      businessDomain: 'manufacturing'
    });
    expect(ctx.gridKgCo2PerKwh).toBeGreaterThan(0);
    expect(ctx.gridKgCo2PerKwh).toBeLessThan(1);
  });

  test('raw material agent uses library for steel', () => {
    const ctx = operationsEmissionFactorAgentService.createEmissionFactorAgentContext({});
    const r = ctx.resolveRawMaterial('Cold rolled steel sheet', 0);
    expect(r.emissionFactorKgCO2PerKg).toBeCloseTo(1.85, 2);
    expect(r.source).toMatch(/agent_|verified_/);
  });

  test('machinery agent uses diesel hint from genset name', () => {
    const ctx = operationsEmissionFactorAgentService.createEmissionFactorAgentContext({});
    const r = ctx.resolveMachinery('100 kVA diesel genset', 'electricity', 0);
    expect(r.effectiveFuelType).toBe('diesel');
    expect(r.emissionFactor).toBeCloseTo(2.68, 2);
  });

  test('user override wins for materials', () => {
    const ctx = operationsEmissionFactorAgentService.createEmissionFactorAgentContext({});
    const r = ctx.resolveRawMaterial('Steel', 3.3);
    expect(r.emissionFactorKgCO2PerKg).toBe(3.3);
    expect(r.source).toBe('user_override');
  });
});
