/**
 * BRSR Principle 6 + GHG Protocol aligned inventory boundary structure.
 * Single source for defaults, labels, completeness checks, and disclosure payloads.
 */

const DEFAULT_SCOPE3_CATEGORIES_INCLUDED = Object.freeze([1, 2, 3, 4, 5, 6, 7, 12, 13]);

const GHG_SCOPE3_CATEGORY_OPTIONS = Object.freeze([
  { value: 1, label: '1 — Purchased goods and services' },
  { value: 2, label: '2 — Capital goods' },
  { value: 3, label: '3 — Fuel and energy-related activities (not in Scope 1 or 2)' },
  { value: 4, label: '4 — Upstream transportation and distribution' },
  { value: 5, label: '5 — Waste generated in operations' },
  { value: 6, label: '6 — Business travel' },
  { value: 7, label: '7 — Employee commuting' },
  { value: 8, label: '8 — Upstream leased assets' },
  { value: 9, label: '9 — Downstream transportation and distribution' },
  { value: 10, label: '10 — Processing of sold products' },
  { value: 11, label: '11 — Use of sold products' },
  { value: 12, label: '12 — End-of-life treatment of sold products' },
  { value: 13, label: '13 — Downstream leased assets' },
  { value: 14, label: '14 — Franchises' },
  { value: 15, label: '15 — Investments' }
]);

const CONSOLIDATION_APPROACH_LABELS = Object.freeze({
  operational_control: 'Operational control (BRSR / GHG Protocol default for MSMEs)',
  financial_control: 'Financial control',
  equity_share: 'Equity share'
});

const toStringSafe = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const hasScope1Source = (ob = {}) => Boolean(
  ob.scope1StationaryCombustion
  || ob.scope1MobileCombustion
  || ob.scope1ProcessEmissions
  || ob.scope1FugitiveEmissions
);

const hasScope2Method = (ob = {}) => Boolean(
  ob.scope2LocationBased || ob.scope2MarketBased
);

const assessOrganizationalBoundaryComplete = (organizational = {}) => {
  const description = toStringSafe(organizational.reportingEntityDescription);
  const hasApproach = Boolean(organizational.consolidationApproach);
  const hasEntityNarrative = description.length >= 20;
  const entities = Array.isArray(organizational.includedLegalEntities)
    ? organizational.includedLegalEntities
    : [];
  const hasEntityRow = entities.some((row) => toStringSafe(row?.name).length > 0);
  return hasApproach && (hasEntityNarrative || hasEntityRow);
};

const assessOperationalBoundaryComplete = (operational = {}) => {
  const baseYear = Number(operational.baseYear);
  const hasReportingPeriod = Boolean(operational.reportingPeriodType)
    && Number.isFinite(baseYear)
    && baseYear >= 1990;
  const scope3 = Array.isArray(operational.scope3CategoriesIncluded)
    ? operational.scope3CategoriesIncluded
    : [];
  return hasReportingPeriod && hasScope1Source(operational) && hasScope2Method(operational) && scope3.length > 0;
};

const listScope1SourcesInBoundary = (operational = {}) => {
  const sources = [];
  if (operational.scope1StationaryCombustion) sources.push('stationary_combustion');
  if (operational.scope1MobileCombustion) sources.push('mobile_combustion');
  if (operational.scope1ProcessEmissions) sources.push('process_emissions');
  if (operational.scope1FugitiveEmissions) sources.push('fugitive_emissions');
  return sources;
};

const listScope2MethodsInBoundary = (operational = {}) => {
  const methods = [];
  if (operational.scope2LocationBased) methods.push('location_based');
  if (operational.scope2MarketBased) methods.push('market_based');
  return methods;
};

const buildBrsrGhgInventoryBoundaries = (msme = {}) => {
  const organizational = msme?.manufacturingProfile?.ghgOrganizationalBoundary || {};
  const operational = msme?.operations?.ghgOperationalBoundary || {};
  const scope3Categories = Array.isArray(operational.scope3CategoriesIncluded)
    && operational.scope3CategoriesIncluded.length > 0
    ? [...operational.scope3CategoriesIncluded].sort((a, b) => a - b)
    : [...DEFAULT_SCOPE3_CATEGORIES_INCLUDED];

  return {
    framework: 'GHG Protocol Corporate Standard + SEBI BRSR Principle 6',
    organizationalBoundary: {
      consolidationApproach: organizational.consolidationApproach || null,
      consolidationApproachLabel:
        CONSOLIDATION_APPROACH_LABELS[organizational.consolidationApproach] || null,
      reportingEntityDescription: toStringSafe(organizational.reportingEntityDescription) || null,
      includedLegalEntities: Array.isArray(organizational.includedLegalEntities)
        ? organizational.includedLegalEntities
        : [],
      jointVentureEmissionAllocation: organizational.jointVentureEmissionAllocation || null,
      franchisesOrOutsourcedOperationsTreatment:
        toStringSafe(organizational.franchisesOrOutsourcedOperationsTreatment) || null,
      nonControlledOperationsExcluded: organizational.nonControlledOperationsExcluded !== false,
      organizationalBoundaryNotes: toStringSafe(organizational.organizationalBoundaryNotes) || null,
      lastReviewedAt: organizational.lastReviewedAt || null
    },
    operationalBoundary: {
      reportingPeriodType: operational.reportingPeriodType || null,
      reportingPeriodEndMonth: operational.reportingPeriodEndMonth ?? null,
      baseYear: operational.baseYear ?? null,
      materialityThresholdPercent: operational.materialityThresholdPercent ?? null,
      scope1SourcesIncluded: listScope1SourcesInBoundary(operational),
      scope2MethodsIncluded: listScope2MethodsInBoundary(operational),
      scope3CategoriesIncluded: scope3Categories,
      scope3OutOfBoundarySummary: toStringSafe(operational.scope3OutOfBoundarySummary) || null,
      biogenicCo2Approach: operational.biogenicCo2Approach || null,
      operationalBoundaryDefinitionSummary:
        toStringSafe(operational.operationalBoundaryDefinitionSummary) || null,
      operationalBoundaryNotes: toStringSafe(operational.operationalBoundaryNotes) || null,
      lastReviewedAt: operational.lastReviewedAt || null
    },
    completeness: {
      organizationalDocumented: assessOrganizationalBoundaryComplete(organizational),
      operationalDocumented: assessOperationalBoundaryComplete(operational),
      boundariesReadyForBrsrPrinciple6: false
    }
  };
};

const withCompletenessFlag = (payload = {}) => {
  const completeness = payload.completeness || {};
  return {
    ...payload,
    completeness: {
      ...completeness,
      boundariesReadyForBrsrPrinciple6: Boolean(
        completeness.organizationalDocumented && completeness.operationalDocumented
      )
    }
  };
};

module.exports = {
  DEFAULT_SCOPE3_CATEGORIES_INCLUDED,
  GHG_SCOPE3_CATEGORY_OPTIONS,
  CONSOLIDATION_APPROACH_LABELS,
  assessOrganizationalBoundaryComplete,
  assessOperationalBoundaryComplete,
  buildBrsrGhgInventoryBoundaries,
  withCompletenessFlag,
  listScope1SourcesInBoundary,
  listScope2MethodsInBoundary
};
