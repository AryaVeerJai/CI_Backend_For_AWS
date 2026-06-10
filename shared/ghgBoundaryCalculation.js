/**
 * Apply GHG organizational / operational boundary settings to carbon totals.
 */

const { DEFAULT_SCOPE3_CATEGORIES_INCLUDED } = require('./ghgBoundaryBrsr');

const roundTo = (value, decimals = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
};

const toNonNegative = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const scope3CategoryIncluded = (boundary = {}, categoryNumber) => {
  const included = Array.isArray(boundary.scope3CategoriesIncluded)
    ? boundary.scope3CategoriesIncluded
    : [...DEFAULT_SCOPE3_CATEGORIES_INCLUDED];
  return included.includes(categoryNumber);
};

const buildInventoryOrganizationalBoundary = (msme = {}, organizational = {}) => ({
  consolidationApproach: organizational.consolidationApproach || null,
  reportingEntityDescription: organizational.reportingEntityDescription || null,
  includedLegalEntities: Array.isArray(organizational.includedLegalEntities)
    ? organizational.includedLegalEntities
    : [],
  jointVentureEmissionAllocation: organizational.jointVentureEmissionAllocation || null,
  franchisesOrOutsourcedOperationsTreatment:
    organizational.franchisesOrOutsourcedOperationsTreatment || null,
  nonControlledOperationsExcluded: organizational.nonControlledOperationsExcluded !== false,
  entityName: msme.companyName || msme.businessName || null,
  sites: Array.isArray(msme.operations?.sites) ? msme.operations.sites : []
});

/**
 * Filter workflow planner estimate components by operational boundary toggles.
 */
const applyOperationalBoundaryToWorkflowEstimate = (estimate = {}, boundary = {}) => {
  const stationaryAllowed = boundary.scope1StationaryCombustion !== false;
  const processAllowed = boundary.scope1ProcessEmissions !== false;
  const commuteAllowed = scope3CategoryIncluded(boundary, 7);
  const supplyChainAllowed = [1, 2, 4, 9].some((cat) => scope3CategoryIncluded(boundary, cat));

  const machineryEmissions = stationaryAllowed ? toNonNegative(estimate.machineryEmissions) : 0;
  const rawMaterialEmissions = stationaryAllowed ? toNonNegative(estimate.rawMaterialEmissions) : 0;
  const packagingMaterialEmissions = stationaryAllowed ? toNonNegative(estimate.packagingMaterialEmissions) : 0;
  const processAuxiliaryEmissions = processAllowed ? toNonNegative(estimate.processAuxiliaryEmissions) : 0;
  const commuteEmissions = commuteAllowed ? toNonNegative(estimate.commuteEmissions) : 0;
  const supplyChainEmissions = supplyChainAllowed ? toNonNegative(estimate.supplyChainEmissions) : 0;

  const processEmissions = roundTo(
    machineryEmissions + rawMaterialEmissions + packagingMaterialEmissions + processAuxiliaryEmissions
  );
  const scope3Emissions = roundTo(commuteEmissions + supplyChainEmissions);
  const scope1Emissions = roundTo(processEmissions);
  const scope2FacilityEmissions = toNonNegative(estimate.scope2FacilityEmissions);
  const totalCO2Emissions = roundTo(scope1Emissions + scope2FacilityEmissions + scope3Emissions);

  return {
    ...estimate,
    totalCO2Emissions,
    processEmissions: scope1Emissions,
    scope1Emissions,
    scope2FacilityEmissions,
    scope3Emissions,
    commuteEmissions: roundTo(commuteEmissions),
    supplyChainEmissions: roundTo(supplyChainEmissions),
    machineryEmissions: roundTo(machineryEmissions),
    rawMaterialEmissions: roundTo(rawMaterialEmissions),
    packagingMaterialEmissions: roundTo(packagingMaterialEmissions),
    processAuxiliaryEmissions: roundTo(processAuxiliaryEmissions, 3),
    boundaryApplied: {
      scope1StationaryCombustion: stationaryAllowed,
      scope1ProcessEmissions: processAllowed,
      scope3Category7EmployeeCommute: commuteAllowed,
      scope3SupplyChainCategories: supplyChainAllowed
    }
  };
};

module.exports = {
  applyOperationalBoundaryToWorkflowEstimate,
  buildInventoryOrganizationalBoundary,
  scope3CategoryIncluded
};
