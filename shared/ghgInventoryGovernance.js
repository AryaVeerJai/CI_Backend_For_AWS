/**
 * GHG inventory governance — boundary enforcement, assurance gates, scope reconciliation.
 * Shared between backend services and tooling (GHG Protocol / ISO 14064 aligned).
 */

const getCarbonAnalytics = () => require('./carbonEmissionAnalytics');
const { DEFAULT_SCOPE3_CATEGORIES_INCLUDED } = require('./ghgBoundaryBrsr');

/** GHG Protocol Scope 3 category number (1–15) from analytics category key. */
const SCOPE3_CATEGORY_KEY_TO_NUMBER = Object.freeze({
  cat1_purchased_goods: 1,
  cat2_capital_goods: 2,
  cat3_fuel_energy_related: 3,
  cat4_upstream_transport: 4,
  cat5_waste: 5,
  cat6_business_travel: 6,
  cat7_employee_commuting: 7,
  cat8_upstream_leased_assets: 8,
  cat9_downstream_transport: 9,
  cat10_processing_sold_products: 10,
  cat11_use_sold_products: 11,
  cat12_end_of_life: 12,
  cat13_downstream_leased_assets: 13,
  cat14_franchises: 14,
  cat15_investments: 15,
  unclassified_indirect: null
});

const NON_INVENTORY_SCOPE_PATTERNS = Object.freeze({
  offset: /\b(offset|offsets|carbon\s*credit|credit\s*purchase|vcu|ver\b|cer\b|gold\s*standard|vcs|verra|removal|sequestration)\b/i,
  avoided: /\b(avoided|avoidance|saved\s*emissions|reduction\s*claim)\b/i,
  governance: /\b(esg\s*report|disclosure\s*only|assurance\s*fee|audit\s*fee|sbti\s*fee)\b/i
});

const ASSURANCE_GATE_DEFAULTS = Object.freeze({
  maxTier2ShareForLimitedAssurance: 0.65,
  maxTier3ShareForLimitedAssurance: 0.25,
  minTier1ShareForAssuranceReady: 0.35,
  requireExplicitScope3ForBrsr: true,
  requireBaseYearForAssuranceReady: true,
  requireDualScope2WhenMarketEnabled: true
});

const toFinite = (value, fallback = 0) => {
  if (value && typeof value === 'object') {
    const val = value.co2Emissions ?? value.total ?? value.value ?? 0;
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeScopeLabel = (scope) => {
  const s = String(scope || '').toLowerCase().replace(/\s+/g, '');
  if (s.includes('scope1') || s === '1') return 'scope1';
  if (s.includes('scope2') || s === '2') return 'scope2';
  if (s.includes('scope3') || s === '3') return 'scope3';
  if (s.includes('scope4') || s === '4') return 'scope4';
  if (s.includes('scope5') || s === '5') return 'scope5';
  if (s.includes('scope6') || s === '6') return 'scope6';
  if (s.includes('scope7') || s === '7') return 'scope7';
  return 'unknown';
};

const isSalesOrRevenueTransaction = (transaction = {}) => {
  const rawType = String(
    transaction.transactionType ||
    transaction.metadata?.transactionType ||
    transaction.type ||
    ''
  ).toLowerCase();
  if (['sale', 'sales', 'revenue', 'income', 'payment_received', 'customer_payment'].includes(rawType)) {
    return true;
  }

  const voucherType = String(
    transaction.voucherType ||
    transaction.metadata?.voucherType ||
    transaction.metadata?.voucher_type ||
    ''
  ).toLowerCase();
  if (voucherType === 'sales' || voucherType === 'sale') {
    return true;
  }

  const category = String(transaction.category || '').toLowerCase();
  return category === 'revenue' || category === 'sales';
};

const isNonInventoryTransaction = (transaction = {}) => {
  if (transaction.excludeFromCarbonFootprint === true) return true;
  if (transaction.inventoryTreatment === 'excluded_non_emitting') return true;
  if (transaction.inventoryTreatment === 'offsets_reported_separately') return true;
  if (transaction.inventoryTreatment === 'avoided_emissions_separate') return true;
  if (isSalesOrRevenueTransaction(transaction)) return true;

  const scope = normalizeScopeLabel(transaction.ghgScope || transaction.carbonFootprint?.inventoryScope);
  if (['scope4', 'scope5', 'scope6', 'scope7'].includes(scope)) return true;

  const desc = `${transaction.description || ''} ${transaction.memo || ''} ${transaction.narration || ''}`;
  if (NON_INVENTORY_SCOPE_PATTERNS.offset.test(desc)) return true;
  if (NON_INVENTORY_SCOPE_PATTERNS.avoided.test(desc) && !/\b(diesel|petrol|kwh|fuel)\b/i.test(desc)) {
    return true;
  }
  return false;
};

const resolveScope3CategoryNumber = (transaction = {}) => {
  const explicit = transaction.carbonFootprint?.ghgScope3CategoryNumber
    ?? transaction.ghgScope3CategoryNumber;
  if (Number.isFinite(Number(explicit))) {
    const n = parseInt(explicit, 10);
    if (n >= 1 && n <= 15) return n;
  }
  const key = transaction.carbonFootprint?.ghgScope3Category
    || resolveScope3GhgCategoryLocal(transaction);
  return SCOPE3_CATEGORY_KEY_TO_NUMBER[key] ?? null;
};

const isScope1Allowed = (transaction, boundary = {}) => {
  const sub = String(transaction.subcategory || '').toLowerCase();
  const desc = `${transaction.description || ''}`.toLowerCase();
  if (/\b(fugitive|refrigerant|hfc|leak)\b/.test(desc)) {
    return boundary.scope1FugitiveEmissions !== false;
  }
  if (/\b(process|furnace|kiln|boiler|reaction)\b/.test(desc) || sub === 'process') {
    return boundary.scope1ProcessEmissions !== false;
  }
  if (/\b(fleet|vehicle|truck|van|mobile)\b/.test(desc) || ['transportation'].includes(transaction.category)) {
    return boundary.scope1MobileCombustion !== false;
  }
  return boundary.scope1StationaryCombustion !== false;
};

const inferEstimatedScope = (transaction = {}) => {
  const existing = normalizeScopeLabel(
    transaction.carbonFootprint?.estimatedScope
    || transaction.estimatedGhgScope
    || transaction.ghgScope
  );
  if (['scope1', 'scope2', 'scope3'].includes(existing)) return existing;

  const category = String(transaction.category || '').toLowerCase();
  const sub = String(transaction.subcategory || '').toLowerCase();
  const desc = `${transaction.description || ''} ${transaction.memo || ''}`.toLowerCase();

  const ownership = String(transaction.ownership || transaction.metadata?.ownership || '').toLowerCase();
  const FUEL_SUBCATEGORIES = ['diesel', 'petrol', 'cng', 'lpg', 'coal', 'natural_gas', 'fuel'];

  if (category === 'energy') {
    // On-site fuel combustion (generators, boilers, furnaces) is Scope 1.
    if (FUEL_SUBCATEGORIES.includes(sub)) {
      return 'scope1';
    }
    // All purchased electricity/heating/cooling/steam is Scope 2 per the GHG Protocol,
    // regardless of whether the subcategory is explicitly tagged 'grid'. This is the
    // common case for OCR'd/imported energy rows where subcategory defaults to 'general'.
    return 'scope2';
  }

  // Purchased utility energy (electricity, power, heating, cooling, steam) — Scope 2.
  if (
    (category === 'utilities' || category === 'other') &&
    /(electric|kwh|power\s*bill|\bpower\b|heating|cooling|steam|district\s*(?:energy|heating|cooling))/.test(desc)
  ) {
    return 'scope2';
  }

  // Mobile combustion: owned/controlled fleet is Scope 1; third-party logistics is Scope 3.
  if (category === 'transportation') {
    if (
      ownership === 'owned' ||
      ownership === 'controlled' ||
      /\b(fleet|company|owned|in-house|company\s*van|company\s*vehicle|own\s*vehicle)\b/.test(desc)
    ) {
      return 'scope1';
    }
    if (
      ownership === 'outsourced' ||
      ownership === 'third_party' ||
      /\b(third[\s-]?party|outsourced|logistics\s*provider|courier|freight\s*forward)\b/.test(desc)
    ) {
      return 'scope3';
    }
    // GHG Protocol default: fuel spend without ownership evidence is Scope 3 upstream transport.
    return 'scope3';
  }

  // On-site fugitive emissions regardless of nominal category.
  if (/\b(fugitive|refrigerant\s+leak)\b/.test(desc)) {
    return 'scope1';
  }

  return 'scope3';
};

const evaluateTransactionBoundary = (transaction = {}, boundary = {}) => {
  if (isNonInventoryTransaction(transaction)) {
    return {
      includeInInventory: false,
      exclusionReason: 'non_inventory_scope_or_offset',
      inventoryTreatment: transaction.inventoryTreatment || 'offsets_reported_separately',
      scope3CategoryNumber: null
    };
  }

  const estimatedScope = inferEstimatedScope(transaction);
  const scope3Cat = resolveScope3CategoryNumber(transaction);
  const includedCats = Array.isArray(boundary.scope3CategoriesIncluded)
    ? boundary.scope3CategoriesIncluded
    : [...DEFAULT_SCOPE3_CATEGORIES_INCLUDED];

  if (estimatedScope === 'scope1' && !isScope1Allowed(transaction, boundary)) {
    return {
      includeInInventory: false,
      exclusionReason: 'scope1_out_of_operational_boundary',
      scope3CategoryNumber: scope3Cat
    };
  }

  if (estimatedScope === 'scope2') {
    if (boundary.scope2LocationBased === false && boundary.scope2MarketBased === false) {
      return {
        includeInInventory: false,
        exclusionReason: 'scope2_excluded_from_boundary',
        scope3CategoryNumber: scope3Cat
      };
    }
  }

  if (estimatedScope === 'scope3' || !['scope1', 'scope2'].includes(estimatedScope)) {
    if (scope3Cat && !includedCats.includes(scope3Cat)) {
      return {
        includeInInventory: false,
        exclusionReason: 'scope3_category_out_of_boundary',
        scope3CategoryNumber: scope3Cat,
        materialityNote: `Category ${scope3Cat} not in operational boundary`
      };
    }
    if (!scope3Cat && includedCats.length > 0) {
      return {
        includeInInventory: true,
        exclusionReason: null,
        scope3CategoryNumber: null,
        reviewRequired: true,
        materialityNote: 'Unclassified Scope 3 — assign GHG category'
      };
    }
  }

  return {
    includeInInventory: true,
    exclusionReason: null,
    scope3CategoryNumber: scope3Cat
  };
};

const applyBoundaryToTransactions = (transactions = [], boundary = {}) => {
  const included = [];
  const excluded = [];
  (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
    const evaluation = evaluateTransactionBoundary(txn, boundary);
    const row = { ...txn, boundaryEvaluation: evaluation };
    if (evaluation.includeInInventory) {
      included.push(row);
    } else {
      excluded.push(row);
    }
  });
  return { included, excluded, boundary };
};

const resolveScope3GhgCategoryLocal = (transaction) => getCarbonAnalytics().resolveScope3GhgCategory(transaction);

const resolveQuantificationMethodLocal = (transaction) => getCarbonAnalytics().resolveQuantificationMethod(transaction);

const resolveDataQualityTierLocal = (method) => getCarbonAnalytics().resolveDataQualityTier(method);

const buildScope2DualReportWithInstruments = (transaction = {}, locationBasedKg = 0, options = {}) => {
  const { buildScope2DualReport: legacyBuildScope2DualReport, DEFAULT_FACTOR_REGISTRY } = getCarbonAnalytics();
  const instruments = transaction.marketBasedInstruments
    || transaction.sustainability?.marketBasedInstruments
    || options.marketBasedInstruments
    || [];
  const hasRec = Array.isArray(instruments) && instruments.some((i) => {
    const t = String(i?.type || i || '').toLowerCase();
    return ['rec', 'irec', 'i-rec', 'ppa', 'green_tariff', 'renewable_contract'].includes(t);
  });

  const enrichedTxn = hasRec
    ? {
      ...transaction,
      subcategory: transaction.subcategory || 'renewable',
      sustainability: { ...(transaction.sustainability || {}), isGreen: true }
    }
    : transaction;

  const base = legacyBuildScope2DualReport(enrichedTxn, locationBasedKg);
  const contractualFactor = toFinite(
    options.contractualEmissionFactor ?? transaction.contractualEmissionFactor,
    null
  );

  if (contractualFactor !== null && contractualFactor >= 0 && locationBasedKg > 0) {
    const gridFactor = DEFAULT_FACTOR_REGISTRY.electricity_grid_india.factor;
    const marketKg = locationBasedKg * (contractualFactor / gridFactor);
    return {
      ...base,
      marketBasedKg: Math.round(marketKg * 10000) / 10000,
      reportingBasis: 'market_based_contractual_factor',
      instruments: instruments.length ? instruments : [{ type: 'contractual_factor', factor: contractualFactor }],
      note: 'Market-based emissions from documented contractual emission factor or instrument.'
    };
  }

  return {
    ...base,
    instruments: instruments.length ? instruments : [],
    dualReportRequired: options.requireDualScope2 !== false
  };
};

const evaluateAssuranceReadiness = ({
  inventoryMetadata = {},
  boundary = {},
  transactions = [],
  options = {}
} = {}) => {
  const gates = { ...ASSURANCE_GATE_DEFAULTS, ...options };
  const mix = inventoryMetadata.dataQualityMix || {};
  const total = Object.values(mix).reduce((s, v) => s + toFinite(v, 0), 0) || 1;
  const tier1Share = toFinite(mix.tier_1_activity, 0) / total;
  const tier2Share = toFinite(mix.tier_2_spend_proxy, 0) / total;
  const tier3Share = toFinite(mix.tier_3_estimate, 0) / total;

  const blockers = [];
  const warnings = [];

  if (tier2Share > gates.maxTier2ShareForLimitedAssurance) {
    blockers.push({
      code: 'DATA_QUALITY_SPEND_PROXY_DOMINANT',
      message: `Spend-proxy share ${(tier2Share * 100).toFixed(1)}% exceeds limit for assurance-ready inventory.`
    });
  }
  if (tier3Share > gates.maxTier3ShareForLimitedAssurance) {
    blockers.push({
      code: 'DATA_QUALITY_ESTIMATE_DOMINANT',
      message: `Estimate-tier share ${(tier3Share * 100).toFixed(1)}% exceeds assurance threshold.`
    });
  }
  if (tier1Share < gates.minTier1ShareForAssuranceReady) {
    warnings.push({
      code: 'DATA_QUALITY_LOW_ACTIVITY_COVERAGE',
      message: `Activity-based data is ${(tier1Share * 100).toFixed(1)}% of transactions; increase metered activity evidence.`
    });
  }

  if (gates.requireBaseYearForAssuranceReady && !boundary.baseYear) {
    blockers.push({
      code: 'BASE_YEAR_UNDEFINED',
      message: 'Operational boundary base year is required for assurance-ready status.'
    });
  }

  const unclassified = (transactions || []).filter((t) => {
    const cat = resolveScope3CategoryNumber(t);
    return !cat && toFinite(t?.carbonFootprint?.co2Emissions, 0) > 0
      && normalizeScopeLabel(t?.carbonFootprint?.estimatedScope) !== 'scope1'
      && normalizeScopeLabel(t?.carbonFootprint?.estimatedScope) !== 'scope2';
  });
  if (unclassified.length > 0) {
    warnings.push({
      code: 'SCOPE3_UNCLASSIFIED',
      message: `${unclassified.length} transaction(s) need Scope 3 category assignment.`
    });
  }

  const assuranceReady = blockers.length === 0;
  return {
    assuranceReady,
    readinessStatus: assuranceReady
      ? (warnings.length ? 'ready_for_review' : 'assurance_ready')
      : 'not_ready',
    tier1Share: Math.round(tier1Share * 1000) / 1000,
    tier2Share: Math.round(tier2Share * 1000) / 1000,
    tier3Share: Math.round(tier3Share * 1000) / 1000,
    blockers,
    warnings,
    evaluatedAt: new Date().toISOString()
  };
};

const reconcileBrsrScopeTotals = (assessment = {}, options = {}) => {
  const esg = assessment.esgScopes || {};
  const explicit1 = toFinite(esg.scope1?.total, 0);
  const explicit2 = toFinite(esg.scope2?.total, 0);
  const explicit3 = toFinite(esg.scope3?.total, 0);
  const hasExplicit = explicit1 > 0 || explicit2 > 0 || explicit3 > 0;
  const total = toFinite(assessment.totalCO2Emissions, 0);

  if (hasExplicit) {
    return {
      scope1: explicit1,
      scope2: explicit2,
      scope3: explicit3,
      scopeAllocationSource: 'explicit_esg_scopes',
      scopesExplicitlyMeasured: true,
      residualScope3Used: false,
      methodologicalWarning: null
    };
  }

  const allowResidual = options.allowResidualScope3 === true;
  const inferred1 = toFinite(assessment?.breakdown?.energy?.fuel?.co2Emissions
    ?? assessment?.breakdown?.energy?.fuel, 0);
  const inferred2 = toFinite(assessment?.breakdown?.energy?.electricity?.co2Emissions
    ?? assessment?.breakdown?.energy?.electricity, 0);
  const residual3 = Math.max(0, total - inferred1 - inferred2);

  return {
    scope1: inferred1,
    scope2: inferred2,
    scope3: allowResidual ? residual3 : 0,
    scopeAllocationSource: allowResidual ? 'residual_scope3_inferred' : 'incomplete_requires_explicit_scopes',
    scopesExplicitlyMeasured: false,
    residualScope3Used: allowResidual,
    methodologicalWarning: allowResidual
      ? 'Scope 3 derived as residual; not suitable for limited assurance without category reconciliation.'
      : 'Scope totals incomplete — run inventory governance orchestration before BRSR disclosure.'
  };
};

const enrichTransactionForInventory = (transaction = {}, boundary = {}) => {
  const quantificationMethod = resolveQuantificationMethodLocal(transaction);
  const dataQualityTier = resolveDataQualityTierLocal(quantificationMethod);
  const ghgScope3Category = resolveScope3GhgCategoryLocal(transaction);
  const ghgScope3CategoryNumber = SCOPE3_CATEGORY_KEY_TO_NUMBER[ghgScope3Category];
  const nonInventory = isNonInventoryTransaction(transaction);

  let inventoryTreatment = 'corporate_inventory';
  if (nonInventory) {
    if (NON_INVENTORY_SCOPE_PATTERNS.offset.test(`${transaction.description || ''}`)) {
      inventoryTreatment = 'offsets_reported_separately';
    } else {
      inventoryTreatment = 'avoided_emissions_separate';
    }
  }

  return {
    ...transaction,
    quantificationMethod,
    dataQualityTier,
    ghgScope3Category,
    ghgScope3CategoryNumber: ghgScope3CategoryNumber || undefined,
    inventoryTreatment,
    excludeFromCarbonFootprint: nonInventory ? true : transaction.excludeFromCarbonFootprint
  };
};

module.exports = {
  SCOPE3_CATEGORY_KEY_TO_NUMBER,
  ASSURANCE_GATE_DEFAULTS,
  NON_INVENTORY_SCOPE_PATTERNS,
  normalizeScopeLabel,
  inferEstimatedScope,
  isNonInventoryTransaction,
  resolveScope3CategoryNumber,
  evaluateTransactionBoundary,
  applyBoundaryToTransactions,
  buildScope2DualReportWithInstruments,
  evaluateAssuranceReadiness,
  reconcileBrsrScopeTotals,
  enrichTransactionForInventory
};
