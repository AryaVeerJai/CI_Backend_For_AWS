const {
  applyUsageQuoteAdjustment,
  USAGE_PRICING,
  USAGE_RATE_COEFFICIENTS,
  SECTOR_EMISSION_INTENSITY_FACTORS,
  computeDocumentOverage,
  roundTo
} = require('../config/pricingCatalog');

const toNonNegativeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
};

const resolveSectorFactor = (businessDomain = 'other') => (
  SECTOR_EMISSION_INTENSITY_FACTORS[businessDomain] || SECTOR_EMISSION_INTENSITY_FACTORS.other
);

const countWorkflowInputs = (msme = {}) => {
  const workflow = msme.business?.manufacturingWorkflow || {};
  const units = Array.isArray(workflow.units) ? workflow.units : [];
  const legacyProcesses = Array.isArray(workflow.processes) ? workflow.processes : [];
  const processContainers = units.length > 0
    ? units.flatMap((unit) => (Array.isArray(unit.processes) ? unit.processes : []))
    : legacyProcesses;

  const processCount = processContainers.length;
  const rawMaterialCount = processContainers.reduce(
    (sum, process) => sum + (Array.isArray(process.rawMaterials) ? process.rawMaterials.length : 0),
    0
  );
  const machineryCount = processContainers.reduce((sum, process) => (
    sum + (Array.isArray(process.machineries)
      ? process.machineries.reduce(
        (machinerySum, machinery) => machinerySum + toNonNegativeNumber(machinery.quantity, 1),
        0
      )
      : 0)
  ), 0);
  const siteCount = units.length > 0
    ? units.length
    : Math.max(toNonNegativeNumber(msme.business?.manufacturingUnits, 1), 1);

  return {
    processCount,
    rawMaterialCount,
    machineryCount,
    siteCount
  };
};

const calculateMsmePayment = ({
  msme = {},
  totalTransactions = 0,
  totalCO2Emissions = 0,
  documentsThisMonth = 0,
  billingStatus = 'none',
  selectedPlanId = null
} = {}) => {
  const transactionCount = toNonNegativeNumber(totalTransactions, 0);
  const emissions = toNonNegativeNumber(totalCO2Emissions, 0);
  const sector = msme.businessDomain || 'other';
  const sectorIntensityFactor = resolveSectorFactor(sector);
  const {
    processCount,
    rawMaterialCount,
    machineryCount,
    siteCount
  } = countWorkflowInputs(msme);

  const denominator = Math.max(transactionCount, processCount, 1);
  const emissionIntensity = (emissions / denominator) * sectorIntensityFactor;

  const rates = USAGE_RATE_COEFFICIENTS;
  const baseAmount = USAGE_PRICING.baseAmountInr;
  const emissionIntensityCharge = emissionIntensity * rates.emissionIntensity;
  const transactionVolumeCharge = transactionCount * rates.transaction;
  const processCharge = processCount * rates.process;
  const rawMaterialCharge = rawMaterialCount * rates.rawMaterial;
  const machineryCharge = machineryCount * rates.machinery;
  const siteCharge = siteCount * rates.site;

  const documentOverage = computeDocumentOverage({
    documentsThisMonth,
    billingStatus,
    selectedPlanId
  });
  const documentOverageCharge = documentOverage.overageChargeInr;

  const rawUsageAmount = roundTo(
    baseAmount +
      emissionIntensityCharge +
      transactionVolumeCharge +
      processCharge +
      rawMaterialCharge +
      machineryCharge +
      siteCharge +
      documentOverageCharge
  );

  const usageAdjustment = applyUsageQuoteAdjustment(rawUsageAmount);
  const paymentAmount = usageAdjustment.paymentAmount;

  return {
    currency: 'INR',
    paymentAmount,
    rawUsageAmount: usageAdjustment.rawAmountInr,
    usageAdjustment: usageAdjustment.adjustment,
    recommendedPlanId: usageAdjustment.recommendedPlanId,
    recommendedPlanName: usageAdjustment.recommendedPlanName,
    recommendedPlanAmountInr: usageAdjustment.recommendedPlanAmountInr,
    overagePerDocumentInr: USAGE_PRICING.overagePerDocumentInr,
    factors: {
      sector,
      sectorIntensityFactor: roundTo(sectorIntensityFactor, 3),
      emissionIntensity: roundTo(emissionIntensity, 3),
      totalCO2Emissions: roundTo(emissions, 3),
      transactionCount,
      processCount,
      rawMaterialCount,
      machineryCount,
      siteCount,
      documentsThisMonth: documentOverage.documentsThisMonth,
      documentLimit: documentOverage.docLimit,
      documentOverageCount: documentOverage.overageDocuments,
      effectiveTierForOverage: documentOverage.tier
    },
    breakdown: {
      baseAmount: roundTo(baseAmount),
      emissionIntensityCharge: roundTo(emissionIntensityCharge),
      transactionVolumeCharge: roundTo(transactionVolumeCharge),
      processCharge: roundTo(processCharge),
      rawMaterialCharge: roundTo(rawMaterialCharge),
      machineryCharge: roundTo(machineryCharge),
      siteCharge: roundTo(siteCharge),
      documentOverageCharge: roundTo(documentOverageCharge)
    },
    documentOverage,
    computedAt: new Date()
  };
};

module.exports = {
  calculateMsmePayment
};
