const {
  syncSolarPowerFromOperations,
  applyOperationsGridAndSolarToEstimate,
  buildSolarGreenLoanPrefill
} = require('../utils/solarOperationsSync');

describe('syncSolarPowerFromOperations', () => {
  it('writes manufacturing profile and annual business.solarPower from monthly operations data', () => {
    const msme = {
      manufacturingProfile: { primaryEnergySource: 'Grid Electricity' },
      business: {}
    };

    const metrics = syncSolarPowerFromOperations(msme, {
      solarInstallationKw: 50,
      solarGenerationKwhPerMonth: 6000,
      solarUsageKwhPerMonth: 4500,
      solarNetMeteringEnabled: true
    });

    expect(metrics).toEqual({
      solarInstallationKw: 50,
      solarGenerationKwhPerMonth: 6000,
      solarUsageKwhPerMonth: 4500
    });
    expect(msme.manufacturingProfile.solarInstallationKw).toBe(50);
    expect(msme.manufacturingProfile.solarGenerationKwhPerMonth).toBe(6000);
    expect(msme.manufacturingProfile.primaryEnergySource).toBe('Grid Electricity + Solar');
    expect(msme.business.solarPower).toMatchObject({
      installedCapacityKw: 50,
      annualGenerationKwh: 72000,
      annualUsageKwh: 54000,
      netMeteringEnabled: true
    });
  });

  it('defaults onsite usage to full generation when usage is not declared', () => {
    const msme = { manufacturingProfile: {}, business: {} };

    syncSolarPowerFromOperations(msme, {
      solarInstallationKw: 10,
      solarGenerationKwhPerMonth: 1200,
      solarUsageKwhPerMonth: 0
    });

    expect(msme.business.solarPower.annualUsageKwh).toBe(14400);
  });

  it('adds net grid facility emissions and reports solar avoidance metadata', () => {
    const estimate = applyOperationsGridAndSolarToEstimate(
      {
        totalCO2Emissions: 1000,
        processEmissions: 800,
        emissionFactorResolution: { electricityGridKgCo2PerKwh: 0.8 }
      },
      {
        powerConsumptionKwhPerMonth: 10000,
        solarGenerationKwhPerMonth: 2000,
        solarUsageKwhPerMonth: 2000
      }
    );

    expect(estimate.totalCO2Emissions).toBe(7400);
    expect(estimate.scope2FacilityEmissions).toBe(6400);
    expect(estimate.operationsEnergyAdjustment).toMatchObject({
      netGridKwhPerMonth: 8000,
      facilityNetGridKgCo2: 6400,
      solarAvoidedKgCo2: 1600,
      scope2IncludedInBoundary: true
    });
  });

  it('does not add grid emissions when Scope 2 is excluded from operational boundary', () => {
    const estimate = applyOperationsGridAndSolarToEstimate(
      {
        totalCO2Emissions: 500,
        scope2FacilityEmissions: 0
      },
      {
        powerConsumptionKwhPerMonth: 10000,
        solarGenerationKwhPerMonth: 0,
        solarUsageKwhPerMonth: 0
      },
      0.8,
      { scope2LocationBased: false, scope2MarketBased: false }
    );

    expect(estimate.totalCO2Emissions).toBe(500);
    expect(estimate.scope2FacilityEmissions).toBe(0);
    expect(estimate.operationsEnergyAdjustment.scope2IncludedInBoundary).toBe(false);
  });

  it('builds green-loan prefill from solar operations data', () => {
    const prefill = buildSolarGreenLoanPrefill({
      solarInstallationKw: 40,
      solarGenerationKwhPerMonth: 4800,
      solarUsageKwhPerMonth: 4200
    });

    expect(prefill.purpose).toBe('solar_installation');
    expect(prefill.loanAmount).toBe(2200000);
    expect(prefill.expectedCarbonReduction).toBeGreaterThan(0);
    expect(prefill.description).toContain('40 kW');
  });
});
