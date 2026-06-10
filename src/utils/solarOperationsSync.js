const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

/**
 * Persist solar fields from the operations workflow into manufacturing profile and business.solarPower.
 * @returns {{ solarInstallationKw: number, solarGenerationKwhPerMonth: number, solarUsageKwhPerMonth: number }}
 */
const syncSolarPowerFromOperations = (msme, normalizedOperationsData = {}) => {
  const solarInstallationKw = toNonNegativeNumber(normalizedOperationsData.solarInstallationKw, 0);
  const solarGenerationKwhPerMonth = toNonNegativeNumber(normalizedOperationsData.solarGenerationKwhPerMonth, 0);
  const declaredSolarUsageKwhPerMonth = toNonNegativeNumber(normalizedOperationsData.solarUsageKwhPerMonth, 0);
  const solarUsageKwhPerMonth = declaredSolarUsageKwhPerMonth > 0
    ? Math.min(declaredSolarUsageKwhPerMonth, solarGenerationKwhPerMonth || declaredSolarUsageKwhPerMonth)
    : solarGenerationKwhPerMonth;

  msme.manufacturingProfile = msme.manufacturingProfile || {};
  msme.manufacturingProfile.solarInstallationKw = solarInstallationKw;
  msme.manufacturingProfile.solarGenerationKwhPerMonth = solarGenerationKwhPerMonth;

  if (solarInstallationKw > 0 || solarGenerationKwhPerMonth > 0) {
    const primaryEnergySource = String(msme.manufacturingProfile.primaryEnergySource || '').trim();
    if (primaryEnergySource && !primaryEnergySource.toLowerCase().includes('solar')) {
      msme.manufacturingProfile.primaryEnergySource = `${primaryEnergySource} + Solar`;
    } else if (!primaryEnergySource) {
      msme.manufacturingProfile.primaryEnergySource = 'Grid + Solar';
    }
  }

  msme.business = msme.business || {};
  msme.business.solarPower = {
    installedCapacityKw: solarInstallationKw,
    annualGenerationKwh: solarGenerationKwhPerMonth * 12,
    annualUsageKwh: solarUsageKwhPerMonth * 12,
    netMeteringEnabled: Boolean(normalizedOperationsData.solarNetMeteringEnabled),
    lastUpdatedAt: new Date()
  };

  return {
    solarInstallationKw,
    solarGenerationKwhPerMonth,
    solarUsageKwhPerMonth
  };
};

const roundTo = (value, decimals = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(numeric.toFixed(decimals));
};

const resolveSolarUsageKwhPerMonth = (normalizedOperationsData = {}) => {
  const generation = toNonNegativeNumber(normalizedOperationsData.solarGenerationKwhPerMonth, 0);
  const declaredUsage = toNonNegativeNumber(normalizedOperationsData.solarUsageKwhPerMonth, 0);
  if (declaredUsage > 0) {
    return Math.min(declaredUsage, generation || declaredUsage);
  }
  return generation;
};

/**
 * Apply facility-level grid draw (net of onsite solar) to workflow CO₂ totals.
 * Uses operations-feed power consumption as Scope 2 proxy when declared.
 */
const applyOperationsGridAndSolarToEstimate = (
  estimate = {},
  normalizedOperationsData = {},
  fallbackGridKgCo2PerKwh = 0.82,
  operationalBoundary = {}
) => {
  const scope2Allowed = operationalBoundary.scope2LocationBased !== false
    || operationalBoundary.scope2MarketBased !== false;
  const gridFactor = toNonNegativeNumber(
    estimate?.emissionFactorResolution?.electricityGridKgCo2PerKwh,
    toNonNegativeNumber(fallbackGridKgCo2PerKwh, 0.82)
  );
  const powerKwh = toNonNegativeNumber(normalizedOperationsData.powerConsumptionKwhPerMonth, 0);
  const solarGenerationKwh = toNonNegativeNumber(normalizedOperationsData.solarGenerationKwhPerMonth, 0);
  const solarUsageKwh = resolveSolarUsageKwhPerMonth(normalizedOperationsData);
  const netGridKwh = Math.max(0, powerKwh - solarUsageKwh);
  const facilityNetGridKgCo2 = roundTo(netGridKwh * gridFactor, 2);
  const solarAvoidedKgCo2 = roundTo(solarUsageKwh * gridFactor, 2);

  let totalCO2Emissions = toNonNegativeNumber(estimate.totalCO2Emissions, 0);
  let scope2FacilityEmissions = toNonNegativeNumber(estimate.scope2FacilityEmissions, 0);

  if (powerKwh > 0 && scope2Allowed) {
    totalCO2Emissions = roundTo(totalCO2Emissions + facilityNetGridKgCo2, 2);
    scope2FacilityEmissions = roundTo(scope2FacilityEmissions + facilityNetGridKgCo2, 2);
  }

  const scope2Method = operationalBoundary.scope2MarketBased && operationalBoundary.scope2LocationBased === false
    ? 'market_based'
    : 'location_based';

  return {
    ...estimate,
    totalCO2Emissions,
    scope2FacilityEmissions,
    scope2Method: scope2Allowed ? scope2Method : null,
    operationsEnergyAdjustment: {
      powerConsumptionKwhPerMonth: powerKwh,
      solarGenerationKwhPerMonth: solarGenerationKwh,
      solarUsageKwhPerMonth: solarUsageKwh,
      netGridKwhPerMonth: netGridKwh,
      gridEmissionFactorKgCo2PerKwh: gridFactor,
      facilityNetGridKgCo2,
      solarAvoidedKgCo2,
      methodology:
        'Facility grid proxy from operations feed: (power consumption − onsite solar usage) × grid intensity.',
      scope2IncludedInBoundary: scope2Allowed
    }
  };
};

/** Typical rooftop solar capex (INR/kW) for green-loan prefill suggestions. */
const SOLAR_CAPEX_INR_PER_KW = 55000;

const buildSolarGreenLoanPrefill = (normalizedOperationsData = {}) => {
  const solarInstallationKw = toNonNegativeNumber(normalizedOperationsData.solarInstallationKw, 0);
  const solarGenerationKwhPerMonth = toNonNegativeNumber(normalizedOperationsData.solarGenerationKwhPerMonth, 0);
  const solarUsageKwhPerMonth = resolveSolarUsageKwhPerMonth(normalizedOperationsData);
  const gridFactor = 0.82;
  const annualSolarAvoidedKg = roundTo(solarUsageKwhPerMonth * gridFactor * 12, 0);
  const loanAmount = Math.max(
    100000,
    Math.round(solarInstallationKw > 0 ? solarInstallationKw * SOLAR_CAPEX_INR_PER_KW : solarGenerationKwhPerMonth * 45)
  );

  return {
    purpose: 'solar_installation',
    loanAmount,
    expectedCarbonReduction: annualSolarAvoidedKg,
    expectedPaybackPeriod: 36,
    description: solarInstallationKw > 0
      ? `Rooftop solar expansion (~${solarInstallationKw} kW installed, ~${solarGenerationKwhPerMonth.toLocaleString('en-IN')} kWh/month generation).`
      : `Rooftop solar installation targeting ~${solarGenerationKwhPerMonth.toLocaleString('en-IN')} kWh/month generation.`
  };
};

module.exports = {
  syncSolarPowerFromOperations,
  applyOperationsGridAndSolarToEstimate,
  buildSolarGreenLoanPrefill,
  resolveSolarUsageKwhPerMonth,
  toNonNegativeNumber,
  SOLAR_CAPEX_INR_PER_KW
};
