const {
  DEFAULT_SCOPE3_CATEGORIES_INCLUDED
} = require('../../../shared/ghgBoundaryBrsr');

const CONSOLIDATION_APPROACHES = new Set(['operational_control', 'financial_control', 'equity_share']);
const JV_ALLOCATION = new Set(['proportional_equity', 'operational_share', 'not_applicable']);
const REPORTING_PERIOD = new Set(['calendar_year', 'financial_year']);
const BIOGENIC = new Set(['reported_separately', 'included_with_fossil', 'not_applicable']);

const toBool = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (['yes', 'true', 'y'].includes(t)) return true;
    if (['no', 'false', 'n'].includes(t)) return false;
  }
  return fallback;
};

const toInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const toStringSafe = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const toCategoryList = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  value.forEach((entry) => {
    const n = parseInt(entry, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 15) out.push(n);
  });
  return [...new Set(out)].sort((a, b) => a - b);
};

const defaultOperationalBoundary = () => ({
  reportingPeriodType: 'financial_year',
  reportingPeriodEndMonth: 3,
  baseYear: undefined,
  materialityThresholdPercent: 5,
  scope1StationaryCombustion: true,
  scope1MobileCombustion: true,
  scope1ProcessEmissions: true,
  scope1FugitiveEmissions: true,
  scope2LocationBased: true,
  scope2MarketBased: false,
  scope3CategoriesIncluded: [...DEFAULT_SCOPE3_CATEGORIES_INCLUDED],
  scope3OutOfBoundarySummary: '',
  biogenicCo2Approach: 'reported_separately',
  operationalBoundaryDefinitionSummary: '',
  operationalBoundaryNotes: '',
  lastReviewedAt: undefined,
  boundaryAgentRunAt: undefined
});

const normalizeGhgOperationalBoundary = (incoming = {}, existing = {}) => {
  const base = { ...defaultOperationalBoundary(), ...(existing && typeof existing === 'object' ? existing : {}) };
  const raw = incoming && typeof incoming === 'object' ? incoming : {};
  const periodType = toStringSafe(raw.reportingPeriodType);
  const reportingPeriodType = REPORTING_PERIOD.has(periodType) ? periodType : base.reportingPeriodType;
  const reportingPeriodEndMonth = clamp(
    toInt(raw.reportingPeriodEndMonth, base.reportingPeriodEndMonth),
    1,
    12
  );
  const baseYearRaw = raw.baseYear;
  let baseYear = base.baseYear;
  if (baseYearRaw !== undefined && baseYearRaw !== null && baseYearRaw !== '') {
    const y = toInt(baseYearRaw, NaN);
    if (Number.isFinite(y)) {
      baseYear = clamp(y, 1990, 2100);
    }
  }

  const materialityThresholdPercent = clamp(
    toInt(raw.materialityThresholdPercent, base.materialityThresholdPercent),
    0,
    25
  );

  const biogenic = toStringSafe(raw.biogenicCo2Approach);
  const biogenicCo2Approach = BIOGENIC.has(biogenic) ? biogenic : base.biogenicCo2Approach;

  const scope3CategoriesIncluded = toCategoryList(raw.scope3CategoriesIncluded).length
    ? toCategoryList(raw.scope3CategoriesIncluded)
    : toCategoryList(base.scope3CategoriesIncluded);

  return {
    reportingPeriodType,
    reportingPeriodEndMonth,
    baseYear,
    materialityThresholdPercent,
    scope1StationaryCombustion: toBool(raw.scope1StationaryCombustion, base.scope1StationaryCombustion),
    scope1MobileCombustion: toBool(raw.scope1MobileCombustion, base.scope1MobileCombustion),
    scope1ProcessEmissions: toBool(raw.scope1ProcessEmissions, base.scope1ProcessEmissions),
    scope1FugitiveEmissions: toBool(raw.scope1FugitiveEmissions, base.scope1FugitiveEmissions),
    scope2LocationBased: toBool(raw.scope2LocationBased, base.scope2LocationBased),
    scope2MarketBased: toBool(raw.scope2MarketBased, base.scope2MarketBased),
    scope3CategoriesIncluded,
    scope3OutOfBoundarySummary: toStringSafe(raw.scope3OutOfBoundarySummary) || base.scope3OutOfBoundarySummary,
    biogenicCo2Approach,
    operationalBoundaryDefinitionSummary:
      toStringSafe(raw.operationalBoundaryDefinitionSummary) || base.operationalBoundaryDefinitionSummary,
    operationalBoundaryNotes: toStringSafe(raw.operationalBoundaryNotes) || base.operationalBoundaryNotes,
    lastReviewedAt: raw.lastReviewedAt ? new Date(raw.lastReviewedAt) : base.lastReviewedAt,
    boundaryAgentRunAt: raw.boundaryAgentRunAt ? new Date(raw.boundaryAgentRunAt) : base.boundaryAgentRunAt
  };
};

const normalizeGhgOrganizationalBoundary = (incoming = {}, existing = {}) => {
  const base = {
    consolidationApproach: 'operational_control',
    reportingEntityDescription: '',
    includedLegalEntities: [],
    jointVentureEmissionAllocation: 'not_applicable',
    franchisesOrOutsourcedOperationsTreatment: '',
    nonControlledOperationsExcluded: true,
    organizationalBoundaryNotes: '',
    lastReviewedAt: undefined,
    ...(existing && typeof existing === 'object' ? existing : {})
  };
  const raw = incoming && typeof incoming === 'object' ? incoming : {};
  const ca = toStringSafe(raw.consolidationApproach);
  const consolidationApproach = CONSOLIDATION_APPROACHES.has(ca) ? ca : base.consolidationApproach;

  const jv = toStringSafe(raw.jointVentureEmissionAllocation);
  const jointVentureEmissionAllocation = JV_ALLOCATION.has(jv) ? jv : base.jointVentureEmissionAllocation;

  let includedLegalEntities = base.includedLegalEntities;
  if (Array.isArray(raw.includedLegalEntities)) {
    includedLegalEntities = raw.includedLegalEntities
      .filter(Boolean)
      .map((row) => ({
        name: toStringSafe(row.name),
        relationshipType: toStringSafe(row.relationshipType),
        consolidationBasis: toStringSafe(row.consolidationBasis)
      }))
      .filter((row) => row.name);
  }

  return {
    consolidationApproach,
    reportingEntityDescription:
      toStringSafe(raw.reportingEntityDescription) || base.reportingEntityDescription,
    includedLegalEntities,
    jointVentureEmissionAllocation,
    franchisesOrOutsourcedOperationsTreatment:
      toStringSafe(raw.franchisesOrOutsourcedOperationsTreatment)
      || base.franchisesOrOutsourcedOperationsTreatment,
    nonControlledOperationsExcluded: toBool(
      raw.nonControlledOperationsExcluded,
      base.nonControlledOperationsExcluded !== false
    ),
    organizationalBoundaryNotes:
      toStringSafe(raw.organizationalBoundaryNotes) || base.organizationalBoundaryNotes,
    lastReviewedAt: raw.lastReviewedAt ? new Date(raw.lastReviewedAt) : base.lastReviewedAt
  };
};

module.exports = {
  normalizeGhgOperationalBoundary,
  normalizeGhgOrganizationalBoundary,
  defaultOperationalBoundary
};
