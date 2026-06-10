/**
 * Shared carbon inventory analytics helpers (backend + tooling).
 * GHG Protocol–aligned scope 3 categories, data-quality tiers, and factor lineage.
 */

const CARBON_SHARED = require('./carbonEmissionDefaults.json');
const {
  DEFAULT_FACTOR_REGISTRY: SHARED_FACTOR_REGISTRY
} = require('./emissionFactorRegistry');

const QUANTIFICATION_METHODS = Object.freeze({
  ACTIVITY: 'activity_based',
  SPEND_PROXY: 'spend_proxy',
  ESTIMATE: 'estimate',
  EXCLUDED: 'excluded_non_emitting_financial_flow'
});

const DATA_QUALITY_TIERS = Object.freeze({
  TIER_1: 'tier_1_activity',
  TIER_2: 'tier_2_spend_proxy',
  TIER_3: 'tier_3_estimate',
  EXCLUDED: 'excluded'
});

/** GHG Protocol Scope 3 category keys (Corporate Standard). */
const GHG_SCOPE3_CATEGORY_KEYS = Object.freeze([
  'cat1_purchased_goods',
  'cat2_capital_goods',
  'cat3_fuel_energy_related',
  'cat4_upstream_transport',
  'cat5_waste',
  'cat6_business_travel',
  'cat7_employee_commuting',
  'cat8_upstream_leased_assets',
  'cat9_downstream_transport',
  'cat10_processing_sold_products',
  'cat11_use_sold_products',
  'cat12_end_of_life',
  'cat13_downstream_leased_assets',
  'cat14_franchises',
  'cat15_investments',
  'unclassified_indirect'
]);

const GHG_SCOPE3_LABELS = Object.freeze({
  cat1_purchased_goods: 'Cat. 1 — Purchased goods & services',
  cat2_capital_goods: 'Cat. 2 — Capital goods',
  cat3_fuel_energy_related: 'Cat. 3 — Fuel- and energy-related activities',
  cat4_upstream_transport: 'Cat. 4 — Upstream transportation & distribution',
  cat5_waste: 'Cat. 5 — Waste generated in operations',
  cat6_business_travel: 'Cat. 6 — Business travel',
  cat7_employee_commuting: 'Cat. 7 — Employee commuting',
  cat8_upstream_leased_assets: 'Cat. 8 — Upstream leased assets',
  cat9_downstream_transport: 'Cat. 9 — Downstream transportation & distribution',
  cat10_processing_sold_products: 'Cat. 10 — Processing of sold products',
  cat11_use_sold_products: 'Cat. 11 — Use of sold products',
  cat12_end_of_life: 'Cat. 12 — End-of-life treatment of sold products',
  cat13_downstream_leased_assets: 'Cat. 13 — Downstream leased assets',
  cat14_franchises: 'Cat. 14 — Franchises',
  cat15_investments: 'Cat. 15 — Investments',
  unclassified_indirect: 'Unclassified indirect (review allocation)'
});

const DEFAULT_FACTOR_REGISTRY = SHARED_FACTOR_REGISTRY;

const ORGANIZATIONAL_BOUNDARY_DEFAULT = Object.freeze({
  approach: 'operational_control',
  consolidation: 'operational_control',
  description: 'Emissions from operations under the reporting entity’s operational control.'
});

const toFinite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeUnit = (unit) => {
  const normalized = String(unit || '').toLowerCase().trim();
  if (!normalized) return null;
  if (['kwh', 'kw-h', 'kw·h', 'kilowatt-hour', 'kilowatt hour', 'kilowatthour'].includes(normalized)) {
    return 'kwh';
  }
  if (['kl', 'kiloliter', 'kilolitre', 'kiloliters', 'kilolitres', 'kld'].includes(normalized)) {
    return 'kiloliter';
  }
  if (['l', 'lt', 'ltr', 'litre', 'litres', 'liter', 'liters'].includes(normalized)) {
    return 'liter';
  }
  if (['kg', 'kilogram', 'kilograms'].includes(normalized)) {
    return 'kg';
  }
  return normalized;
};

const extractActivityQuantity = (transaction = {}) => {
  const unit = normalizeUnit(transaction.unit || transaction.metadata?.unit);
  const quantity = toFinite(
    transaction.quantity ??
    transaction.metadata?.quantity ??
    transaction.metadata?.kwh ??
    transaction.metadata?.liters ??
    transaction.kwh ??
    transaction.liters,
    0
  );
  if (quantity <= 0) {
    return { quantity: 0, unit: null, activityType: null };
  }
  if (unit === 'kwh') {
    return { quantity, unit: 'kwh', activityType: 'electricity' };
  }
  if (unit === 'liter') {
    return { quantity, unit: 'liter', activityType: 'fuel_or_water' };
  }
  if (unit === 'kiloliter') {
    return { quantity: quantity * 1000, unit: 'liter', activityType: 'water' };
  }
  if (unit === 'kg') {
    return { quantity, unit: 'kg', activityType: 'material' };
  }
  return { quantity, unit: unit || 'unit', activityType: 'generic' };
};

const resolveQuantificationMethod = (transaction = {}, category = '') => {
  if (transaction.excludeFromCarbonFootprint === true) {
    return QUANTIFICATION_METHODS.EXCLUDED;
  }
  const activity = extractActivityQuantity(transaction);
  if (activity.quantity > 0 && ['kwh', 'liter', 'kg'].includes(activity.unit)) {
    return QUANTIFICATION_METHODS.ACTIVITY;
  }
  const desc = `${transaction.description || ''} ${transaction.memo || ''}`.toLowerCase();
  if (/\b(estimate|approx|assumed)\b/.test(desc)) {
    return QUANTIFICATION_METHODS.ESTIMATE;
  }
  if (toFinite(transaction.amount, 0) > 0) {
    return QUANTIFICATION_METHODS.SPEND_PROXY;
  }
  return QUANTIFICATION_METHODS.ESTIMATE;
};

const resolveDataQualityTier = (quantificationMethod) => {
  switch (quantificationMethod) {
    case QUANTIFICATION_METHODS.ACTIVITY:
      return DATA_QUALITY_TIERS.TIER_1;
    case QUANTIFICATION_METHODS.SPEND_PROXY:
      return DATA_QUALITY_TIERS.TIER_2;
    case QUANTIFICATION_METHODS.EXCLUDED:
      return DATA_QUALITY_TIERS.EXCLUDED;
    default:
      return DATA_QUALITY_TIERS.TIER_3;
  }
};

const resolveScope3GhgCategory = (transaction = {}) => {
  const category = String(transaction.category || '').toLowerCase();
  const subcategory = String(transaction.subcategory || '').toLowerCase();
  const desc = `${transaction.description || ''} ${transaction.memo || ''} ${transaction.narration || ''}`
    .toLowerCase();

  if (category === 'raw_materials' || subcategory.includes('capital')) {
    return subcategory.includes('capital') ? 'cat2_capital_goods' : 'cat1_purchased_goods';
  }
  if (category === 'waste_management') {
    return 'cat5_waste';
  }
  if (category === 'transportation') {
    if (desc.includes('deliver') || desc.includes('dispatch') || desc.includes('outbound')) {
      return 'cat9_downstream_transport';
    }
    return 'cat4_upstream_transport';
  }
  if (desc.includes('commut')) {
    return 'cat7_employee_commuting';
  }
  if (desc.includes('travel') || desc.includes('flight') || desc.includes('hotel')) {
    return 'cat6_business_travel';
  }
  if (desc.includes('lease') && (desc.includes('upstream') || desc.includes('rented'))) {
    return 'cat8_upstream_leased_assets';
  }
  if (desc.includes('lease')) {
    return 'cat13_downstream_leased_assets';
  }
  if (desc.includes('franchise')) {
    return 'cat14_franchises';
  }
  if (desc.includes('investment') || desc.includes('portfolio')) {
    return 'cat15_investments';
  }
  if (desc.includes('processing') || desc.includes('contract manufactur')) {
    return 'cat10_processing_sold_products';
  }
  if (desc.includes('use of sold') || desc.includes('product use')) {
    return 'cat11_use_sold_products';
  }
  if (desc.includes('end of life') || desc.includes('end-of-life') || desc.includes('disposal of sold')) {
    return 'cat12_end_of_life';
  }
  if (category === 'energy' && (desc.includes('td loss') || desc.includes('transmission'))) {
    return 'cat3_fuel_energy_related';
  }
  if (['utilities', 'services', 'other', 'maintenance', 'equipment'].includes(category)) {
    return 'cat1_purchased_goods';
  }
  return 'unclassified_indirect';
};

const resolveFactorLineage = (transaction = {}, category = '', subcategory = '') => {
  const normalizedCategory = String(category || transaction.category || '').toLowerCase();
  const normalizedSub = String(subcategory || transaction.subcategory || '').toLowerCase();
  const quantificationMethod = resolveQuantificationMethod(transaction, normalizedCategory);

  if (quantificationMethod === QUANTIFICATION_METHODS.SPEND_PROXY
    || quantificationMethod === QUANTIFICATION_METHODS.ESTIMATE) {
    return { ...DEFAULT_FACTOR_REGISTRY.spend_generic, quantificationMethod };
  }

  if (normalizedCategory === 'energy') {
    if (['diesel', 'petrol', 'cng', 'lpg', 'coal', 'natural_gas', 'fuel'].includes(normalizedSub)) {
      return { ...DEFAULT_FACTOR_REGISTRY.fuel_diesel, quantificationMethod };
    }
    return { ...DEFAULT_FACTOR_REGISTRY.electricity_grid_india, quantificationMethod };
  }
  if (normalizedCategory === 'water') {
    return { ...DEFAULT_FACTOR_REGISTRY.water_consumption, quantificationMethod };
  }
  if (normalizedCategory === 'transportation') {
    return { ...DEFAULT_FACTOR_REGISTRY.fuel_diesel, quantificationMethod };
  }
  return { ...DEFAULT_FACTOR_REGISTRY.spend_generic, quantificationMethod };
};

const buildScope2DualReport = (transaction = {}, locationBasedKg = 0) => {
  const co2 = Math.max(0, toFinite(locationBasedKg, 0));
  const subcategory = String(transaction.subcategory || '').toLowerCase();
  const desc = `${transaction.description || ''} ${transaction.memo || ''}`.toLowerCase();
  const isRenewable = subcategory === 'renewable'
    || transaction.sustainability?.isGreen === true
    || desc.includes('renewable')
    || desc.includes('green tariff')
    || desc.includes('solar ppa');

  const gridFactor = DEFAULT_FACTOR_REGISTRY.electricity_grid_india.factor;
  const renewableFactor = 0.1;
  const marketFactor = isRenewable ? renewableFactor : gridFactor;
  const ratio = gridFactor > 0 ? marketFactor / gridFactor : 1;

  return {
    locationBasedKg: co2,
    marketBasedKg: Math.round(co2 * ratio * 10000) / 10000,
    reportingBasis: isRenewable ? 'market_based_renewable_contract' : 'location_based_grid_average',
    dualReportRequired: true,
    note: isRenewable
      ? 'Market-based factor applied for contracted renewable / green tariff signals.'
      : 'Location-based grid average used when market-based supplier factor is unavailable.'
  };
};

const mapScope3CategoryToEsgBreakdownKey = (ghgCategory) => {
  const map = {
    cat1_purchased_goods: 'purchasedGoods',
    cat2_capital_goods: 'purchasedGoods',
    cat3_fuel_energy_related: 'other',
    cat4_upstream_transport: 'transportation',
    cat5_waste: 'wasteDisposal',
    cat6_business_travel: 'businessTravel',
    cat7_employee_commuting: 'employeeCommuting',
    cat8_upstream_leased_assets: 'leasedAssets',
    cat9_downstream_transport: 'transportation',
    cat10_processing_sold_products: 'processingSoldProducts',
    cat11_use_sold_products: 'useSoldProducts',
    cat12_end_of_life: 'endLifeDisposal',
    cat13_downstream_leased_assets: 'leasedAssets',
    cat14_franchises: 'franchises',
    cat15_investments: 'investments',
    unclassified_indirect: 'other'
  };
  return map[ghgCategory] || 'other';
};

const aggregateInventoryMetadata = (transactions = [], options = {}) => {
  const rows = Array.isArray(transactions) ? transactions : [];
  const dataQualityMix = {
    tier_1_activity: 0,
    tier_2_spend_proxy: 0,
    tier_3_estimate: 0,
    excluded: 0
  };
  const quantificationMix = {
    activity_based: 0,
    spend_proxy: 0,
    estimate: 0,
    excluded_non_emitting_financial_flow: 0
  };
  const scope3ByCategory = {};
  GHG_SCOPE3_CATEGORY_KEYS.forEach((key) => {
    scope3ByCategory[key] = 0;
  });

  let scope1 = 0;
  let scope2Location = 0;
  let scope2Market = 0;
  let scope3 = 0;
  let grossTotal = 0;
  let unclassifiedScope3 = 0;
  let activityCount = 0;

  rows.forEach((transaction) => {
    const footprint = transaction.carbonFootprint || {};
    const co2 = toFinite(footprint.co2Emissions, 0);
    if (co2 <= 0 && !footprint.exclusionReason) {
      return;
    }

    const tier = footprint.dataQualityTier
      || resolveDataQualityTier(footprint.quantificationMethod || resolveQuantificationMethod(transaction));
    dataQualityMix[tier] = (dataQualityMix[tier] || 0) + (co2 > 0 ? co2 : 1);

    const method = footprint.quantificationMethod || resolveQuantificationMethod(transaction);
    quantificationMix[method] = (quantificationMix[method] || 0) + (co2 > 0 ? co2 : 1);
    if (method === QUANTIFICATION_METHODS.ACTIVITY) {
      activityCount += 1;
    }

    const breakdown = footprint.emissionBreakdown || {};
    scope1 += toFinite(breakdown.scope1, 0);
    scope2Location += toFinite(breakdown.scope2, 0);
    scope2Market += toFinite(footprint.scope2Reporting?.marketBasedKg, breakdown.scope2);
    scope3 += toFinite(breakdown.scope3, 0);
    grossTotal += co2;

    const ghgCat = footprint.ghgScope3Category
      || resolveScope3GhgCategory(transaction);
    if (toFinite(breakdown.scope3, 0) > 0) {
      scope3ByCategory[ghgCat] = (scope3ByCategory[ghgCat] || 0) + toFinite(breakdown.scope3, 0);
      if (ghgCat === 'unclassified_indirect') {
        unclassifiedScope3 += toFinite(breakdown.scope3, 0);
      }
    }
  });

  const txnCount = rows.length;
  const emittingCount = rows.filter((t) => toFinite(t?.carbonFootprint?.co2Emissions, 0) > 0).length;
  const activitySharePct = txnCount > 0 ? Math.round((activityCount / txnCount) * 1000) / 10 : 0;
  const tier1Kg = dataQualityMix.tier_1_activity || 0;
  const tier2Kg = dataQualityMix.tier_2_spend_proxy || 0;
  const tier3Kg = dataQualityMix.tier_3_estimate || 0;
  const qualityDenom = tier1Kg + tier2Kg + tier3Kg;
  const completenessScore = Math.min(100, Math.round(
    (emittingCount > 0 ? 35 : 0)
    + Math.min(35, activitySharePct * 0.35)
    + Math.min(20, (options.documentCount || 0) > 0 ? 20 : 0)
    + Math.min(10, emittingCount >= 5 ? 10 : emittingCount * 2)
  ));

  const scope3CategoryRows = Object.entries(scope3ByCategory)
    .filter(([, kg]) => kg > 0)
    .map(([key, kg]) => ({
      key,
      label: GHG_SCOPE3_LABELS[key] || key,
      kgCO2e: Math.round(kg * 100) / 100,
      sharePercent: scope3 > 0 ? Math.round((kg / scope3) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.kgCO2e - a.kgCO2e);

  return {
    methodology: CARBON_SHARED.reportingLabel || 'CO2e_activity_and_spend_proxy',
    methodologyNote: CARBON_SHARED.methodologyNote,
    organizationalBoundary: {
      ...ORGANIZATIONAL_BOUNDARY_DEFAULT,
      ...(options.organizationalBoundary || {})
    },
    dataQualityMix,
    quantificationMix,
    dataQualitySummary: {
      activitySharePct,
      tier1SharePct: qualityDenom > 0 ? Math.round((tier1Kg / qualityDenom) * 1000) / 10 : 0,
      tier2SharePct: qualityDenom > 0 ? Math.round((tier2Kg / qualityDenom) * 1000) / 10 : 0,
      tier3SharePct: qualityDenom > 0 ? Math.round((tier3Kg / qualityDenom) * 1000) / 10 : 0
    },
    scopeTotals: {
      scope1: Math.round(scope1 * 100) / 100,
      scope2LocationBased: Math.round(scope2Location * 100) / 100,
      scope2MarketBased: Math.round(scope2Market * 100) / 100,
      scope3: Math.round(scope3 * 100) / 100,
      grossTotal: Math.round(grossTotal * 100) / 100
    },
    scope2DualReporting: {
      locationBasedKg: Math.round(scope2Location * 100) / 100,
      marketBasedKg: Math.round(scope2Market * 100) / 100,
      deltaKg: Math.round((scope2Location - scope2Market) * 100) / 100
    },
    scope3ByCategory: scope3CategoryRows,
    unclassifiedScope3Kg: Math.round(unclassifiedScope3 * 100) / 100,
    completenessScore,
    transactionCount: txnCount,
    emittingTransactionCount: emittingCount,
    configVersion: CARBON_SHARED.configVersion
  };
};

const buildTransactionInventoryFields = (transaction = {}, footprint = {}) => {
  const category = transaction.category || 'other';
  const quantificationMethod = footprint.quantificationMethod
    || resolveQuantificationMethod(transaction, category);
  const ghgScope3Category = footprint.ghgScope3Category || resolveScope3GhgCategory(transaction);
  const factorLineage = footprint.factorLineage || resolveFactorLineage(transaction, category, transaction.subcategory);
  const activity = extractActivityQuantity(transaction);
  const relativeUncertainty = toFinite(factorLineage.relativeUncertainty, 0.25);
  const co2 = toFinite(footprint.co2Emissions, 0);

  return {
    quantificationMethod,
    dataQualityTier: resolveDataQualityTier(quantificationMethod),
    ghgScope3Category,
    ghgScope3Label: GHG_SCOPE3_LABELS[ghgScope3Category],
    esgScope3BreakdownKey: mapScope3CategoryToEsgBreakdownKey(ghgScope3Category),
    factorLineage: {
      ...factorLineage,
      lowerBoundKg: Math.round(co2 * (1 - relativeUncertainty) * 10000) / 10000,
      upperBoundKg: Math.round(co2 * (1 + relativeUncertainty) * 10000) / 10000,
      confidenceLevel: 0.95
    },
    activityQuantity: activity.quantity > 0 ? activity.quantity : null,
    activityUnit: activity.unit,
    scope2Reporting: footprint.scope2Reporting
      || (toFinite(footprint.emissionBreakdown?.scope2, 0) > 0
        ? (() => {
          const { buildScope2DualReportWithInstruments } = require('./ghgInventoryGovernance');
          return buildScope2DualReportWithInstruments(
            transaction,
            footprint.emissionBreakdown.scope2
          );
        })()
        : null)
  };
};

module.exports = {
  QUANTIFICATION_METHODS,
  DATA_QUALITY_TIERS,
  GHG_SCOPE3_CATEGORY_KEYS,
  GHG_SCOPE3_LABELS,
  DEFAULT_FACTOR_REGISTRY,
  ORGANIZATIONAL_BOUNDARY_DEFAULT,
  resolveQuantificationMethod,
  resolveDataQualityTier,
  resolveScope3GhgCategory,
  resolveFactorLineage,
  buildScope2DualReport,
  mapScope3CategoryToEsgBreakdownKey,
  aggregateInventoryMetadata,
  buildTransactionInventoryFields,
  extractActivityQuantity
};
