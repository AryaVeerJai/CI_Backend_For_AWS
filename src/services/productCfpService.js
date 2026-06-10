/**
 * ISO 14067 product carbon footprint computation.
 * Allocates transaction-level emissions to products using attribution shares.
 */
const { buildProductCatalog } = require('../utils/productAttribution');
const carbonEmissionAnalytics = require('../../../shared/carbonEmissionAnalytics');

const toFinite = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const round2 = (value) => Math.round(toFinite(value) * 100) / 100;
const round4 = (value) => Math.round(toFinite(value) * 10000) / 10000;

const LIFECYCLE_STAGES = ['upstream', 'operations', 'downstream', 'support'];

const mapCategoryToStage = (category = '', scope = '') => {
  const normalizedCategory = String(category || '').toLowerCase();
  const normalizedScope = String(scope || '').toLowerCase();

  if (normalizedScope === 'scope1' || normalizedScope === 'scope2') {
    return 'operations';
  }
  if (normalizedCategory === 'transportation') {
    return normalizedScope === 'scope3' ? 'upstream' : 'operations';
  }
  if (['raw_materials', 'utilities'].includes(normalizedCategory)) {
    return 'upstream';
  }
  if (normalizedCategory === 'waste_management') {
    return 'downstream';
  }
  if (['maintenance', 'equipment', 'services', 'other'].includes(normalizedCategory)) {
    return 'support';
  }
  return normalizedScope === 'scope3' ? 'upstream' : 'operations';
};

const resolveFunctionalUnit = (input = {}) => {
  const frameworkConfig = input.frameworks?.iso14067 || input.context?.frameworks?.iso14067 || {};
  return frameworkConfig.functionalUnit
    || input.msmeData?.business?.functionalUnit
    || '1 unit of product';
};

const resolveAllocationMethod = (input = {}) => {
  const frameworkConfig = input.frameworks?.iso14067 || input.context?.frameworks?.iso14067 || {};
  return frameworkConfig.allocationMethod || 'economic_allocation';
};

const normalizeAssignments = (assignments = []) => {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return [];
  }

  const withShares = assignments.map((entry) => ({
    productId: entry.productId || null,
    productName: String(entry.productName || '').trim(),
    allocationPercent: toFinite(entry.allocationPercent, 0)
  })).filter((entry) => entry.productName);

  const total = withShares.reduce((sum, entry) => sum + entry.allocationPercent, 0);
  if (total <= 0) {
    const equalShare = 100 / withShares.length;
    return withShares.map((entry) => ({ ...entry, allocationPercent: equalShare }));
  }

  return withShares.map((entry) => ({
    ...entry,
    allocationPercent: (entry.allocationPercent / total) * 100
  }));
};

const computeProductCarbonFootprint = (input = {}) => {
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  const msmeData = input.msmeData || {};
  const functionalUnit = resolveFunctionalUnit(input);
  const allocationMethod = resolveAllocationMethod(input);
  const catalog = buildProductCatalog(msmeData);

  const productMap = new Map();
  catalog.forEach((product) => {
    productMap.set(product.productName.toLowerCase(), {
      productId: product.productId,
      productName: product.productName,
      functionalUnit,
      totalKgCo2e: 0,
      stageBreakdown: Object.fromEntries(LIFECYCLE_STAGES.map((stage) => [stage, 0])),
      transactionCount: 0,
      allocationMethod
    });
  });

  let unassignedKg = 0;
  let assignedTransactionCount = 0;

  transactions.forEach((transaction) => {
    const co2 = toFinite(transaction.carbonFootprint?.co2Emissions, 0);
    if (co2 <= 0) {
      return;
    }

    const category = transaction.category || transaction.carbonFootprint?.category || 'other';
    const scope = transaction.carbonFootprint?.metrics?.estimatedScope
      || carbonEmissionAnalytics.resolveQuantificationMethod(transaction, category);
    const estimatedScope = transaction.carbonFootprint?.metrics?.estimatedScope || 'scope3';
    const stage = mapCategoryToStage(category, estimatedScope);

    const assignments = normalizeAssignments(transaction.productAttribution?.assignedProducts || []);
    if (assignments.length === 0) {
      unassignedKg += co2;
      return;
    }

    assignedTransactionCount += 1;
    assignments.forEach((assignment) => {
      const key = assignment.productName.toLowerCase();
      if (!productMap.has(key)) {
        productMap.set(key, {
          productId: assignment.productId || key.replace(/\s+/g, '_'),
          productName: assignment.productName,
          functionalUnit,
          totalKgCo2e: 0,
          stageBreakdown: Object.fromEntries(LIFECYCLE_STAGES.map((s) => [s, 0])),
          transactionCount: 0,
          allocationMethod
        });
      }
      const allocatedKg = co2 * (assignment.allocationPercent / 100);
      const product = productMap.get(key);
      product.totalKgCo2e += allocatedKg;
      product.stageBreakdown[stage] = (product.stageBreakdown[stage] || 0) + allocatedKg;
      product.transactionCount += 1;
    });
  });

  const products = [...productMap.values()]
    .filter((product) => product.totalKgCo2e > 0 || product.transactionCount > 0)
    .map((product) => ({
      ...product,
      totalKgCo2e: round2(product.totalKgCo2e),
      stageBreakdown: Object.fromEntries(
        Object.entries(product.stageBreakdown).map(([stage, kg]) => [stage, round2(kg)])
      ),
      kgCo2ePerFunctionalUnit: round4(product.totalKgCo2e)
    }));

  const totalAssignedKg = products.reduce((sum, product) => sum + product.totalKgCo2e, 0);
  const totalInventoryKg = transactions.reduce(
    (sum, tx) => sum + toFinite(tx.carbonFootprint?.co2Emissions, 0),
    0
  );
  const inventoryCoveragePercent = totalInventoryKg > 0
    ? round2((totalAssignedKg / totalInventoryKg) * 100)
    : 0;
  const unassignedShare = totalInventoryKg > 0 ? unassignedKg / totalInventoryKg : 1;
  const dataQualityConfidence = toFinite(
    input.dataQuality?.confidence ?? input.context?.dataQuality?.confidence,
    0.7
  );
  const relativeUncertainty = round4(
    Math.min(0.5, 0.08 + (unassignedShare * 0.25) + ((1 - dataQualityConfidence) * 0.15))
  );

  return {
    version: '1.0.0',
    moduleName: 'product_cfp',
    standard: 'ISO 14067',
    functionalUnit,
    allocationMethod,
    generatedAt: new Date().toISOString(),
    productCount: products.length,
    assignedTransactionCount,
    totalAssignedKgCo2e: round2(totalAssignedKg),
    unassignedKgCo2e: round2(unassignedKg),
    inventoryCoveragePercent,
    products,
    uncertainty: {
      relativeUncertainty,
      confidenceLevel: 0.95,
      methodology: 'activity_and_allocation_coverage_weighted',
      lowerBoundKgCo2e: round2(totalAssignedKg * (1 - relativeUncertainty)),
      upperBoundKgCo2e: round2(totalAssignedKg * (1 + relativeUncertainty)),
      drivers: {
        unassignedShare: round4(unassignedShare),
        dataQualityConfidence: round4(dataQualityConfidence)
      }
    }
  };
};

module.exports = {
  computeProductCarbonFootprint,
  mapCategoryToStage,
  LIFECYCLE_STAGES
};
