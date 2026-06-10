const {
  DEFAULT_UNASSIGNED_PRODUCT,
  assignProductsToTransaction,
  buildProductCatalog
} = require('./productAttribution');

const safeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const safeRound = (value, decimals = 4) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(numeric * factor) / factor;
};

const normalizeProductAssignments = (assignments = []) => {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return [{
      productId: 'unassigned_product',
      productName: DEFAULT_UNASSIGNED_PRODUCT,
      allocationPercent: 100
    }];
  }

  const normalized = assignments.map((entry) => ({
    productId: String(entry?.productId || '').trim() || null,
    productName: String(entry?.productName || '').trim() || DEFAULT_UNASSIGNED_PRODUCT,
    allocationPercent: safeNumber(entry?.allocationPercent)
  }));

  const positiveTotal = normalized.reduce((sum, entry) => (
    sum + (entry.allocationPercent > 0 ? entry.allocationPercent : 0)
  ), 0);

  if (positiveTotal <= 0) {
    const equalShare = 100 / normalized.length;
    let cumulative = 0;
    return normalized.map((entry, index) => {
      const allocationPercent = index === normalized.length - 1
        ? Math.max(0, 100 - cumulative)
        : safeRound(equalShare, 4);
      cumulative += allocationPercent;
      return {
        ...entry,
        productId: entry.productId || `product_${index + 1}`,
        allocationPercent
      };
    });
  }

  let cumulative = 0;
  return normalized.map((entry, index) => {
    const allocationPercent = index === normalized.length - 1
      ? Math.max(0, 100 - cumulative)
      : safeRound((Math.max(0, entry.allocationPercent) / positiveTotal) * 100, 4);
    cumulative += allocationPercent;
    return {
      ...entry,
      productId: entry.productId || `product_${index + 1}`,
      allocationPercent
    };
  });
};

const aggregateTransactionEmissionsByProduct = ({
  transactions = [],
  msme = {}
}) => {
  const productCatalog = buildProductCatalog(msme);
  const productState = new Map(productCatalog.map((product) => [
    product.productId,
    {
      productId: product.productId,
      productName: product.productName,
      totalEmissions: 0,
      transactionCount: 0,
      totalAmount: 0,
      scopes: {
        scope1: 0,
        scope2: 0,
        scope3: 0
      }
    }
  ]));

  if (productState.size === 0) {
    productState.set('unassigned_product', {
      productId: 'unassigned_product',
      productName: DEFAULT_UNASSIGNED_PRODUCT,
      totalEmissions: 0,
      transactionCount: 0,
      totalAmount: 0,
      scopes: {
        scope1: 0,
        scope2: 0,
        scope3: 0
      }
    });
  }

  let transactionAssignedCount = 0;
  let unassignedTransactionCount = 0;
  let inferredAssignmentCount = 0;
  let persistedAssignmentCount = 0;

  transactions.forEach((transaction) => {
    const emission = safeNumber(transaction?.carbonFootprint?.co2Emissions);
    const amount = safeNumber(transaction?.amount);
    const scopeBreakdown = transaction?.carbonFootprint?.emissionBreakdown || {};
    const persistedAssignments = Array.isArray(transaction?.productAttribution?.assignedProducts)
      ? transaction.productAttribution.assignedProducts
      : [];
    const hasPersistedAssignments = persistedAssignments.length > 0;
    const attribution = hasPersistedAssignments
      ? transaction.productAttribution
      : assignProductsToTransaction(transaction, msme, {
        forceRecompute: true,
        assignmentSource: 'reporting_stage'
      }).productAttribution;
    const assignments = normalizeProductAssignments(attribution?.assignedProducts || []);

    if (hasPersistedAssignments) {
      persistedAssignmentCount += 1;
    } else {
      inferredAssignmentCount += 1;
    }

    if (assignments.length > 0 && assignments[0].productName !== DEFAULT_UNASSIGNED_PRODUCT) {
      transactionAssignedCount += 1;
    } else {
      unassignedTransactionCount += 1;
    }

    assignments.forEach((assignment) => {
      const allocationRatio = safeNumber(assignment.allocationPercent) / 100;
      const productId = assignment.productId || 'unassigned_product';
      if (!productState.has(productId)) {
        productState.set(productId, {
          productId,
          productName: assignment.productName || DEFAULT_UNASSIGNED_PRODUCT,
          totalEmissions: 0,
          transactionCount: 0,
          totalAmount: 0,
          scopes: {
            scope1: 0,
            scope2: 0,
            scope3: 0
          }
        });
      }
      const state = productState.get(productId);
      state.totalEmissions += emission * allocationRatio;
      state.totalAmount += amount * allocationRatio;
      state.transactionCount += allocationRatio;
      state.scopes.scope1 += safeNumber(scopeBreakdown.scope1) * allocationRatio;
      state.scopes.scope2 += safeNumber(scopeBreakdown.scope2) * allocationRatio;
      state.scopes.scope3 += safeNumber(scopeBreakdown.scope3) * allocationRatio;
    });
  });

  const products = [...productState.values()]
    .map((entry) => ({
      productId: entry.productId,
      productName: entry.productName,
      totalEmissions: safeRound(entry.totalEmissions, 4),
      totalAmount: safeRound(entry.totalAmount, 2),
      transactionCount: safeRound(entry.transactionCount, 2),
      scopes: {
        scope1: safeRound(entry.scopes.scope1, 4),
        scope2: safeRound(entry.scopes.scope2, 4),
        scope3: safeRound(entry.scopes.scope3, 4)
      }
    }))
    .sort((a, b) => b.totalEmissions - a.totalEmissions);

  const totalEmissions = safeRound(
    products.reduce((sum, entry) => sum + safeNumber(entry.totalEmissions), 0),
    4
  );
  const totalAmount = safeRound(
    products.reduce((sum, entry) => sum + safeNumber(entry.totalAmount), 0),
    2
  );
  const totalTransactions = safeRound(
    products.reduce((sum, entry) => sum + safeNumber(entry.transactionCount), 0),
    2
  );

  return {
    organization: {
      totalEmissions,
      totalAmount,
      totalTransactions,
      scopeBreakdown: {
        scope1: safeRound(products.reduce((sum, entry) => sum + safeNumber(entry.scopes.scope1), 0), 4),
        scope2: safeRound(products.reduce((sum, entry) => sum + safeNumber(entry.scopes.scope2), 0), 4),
        scope3: safeRound(products.reduce((sum, entry) => sum + safeNumber(entry.scopes.scope3), 0), 4)
      }
    },
    products,
    attributionStats: {
      assignedTransactions: transactionAssignedCount,
      unassignedTransactions: unassignedTransactionCount,
      inferredAssignmentTransactions: inferredAssignmentCount,
      persistedAssignmentTransactions: persistedAssignmentCount,
      assignedTransactionRatio: transactions.length > 0
        ? safeRound(transactionAssignedCount / transactions.length, 4)
        : 0
    }
  };
};

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return undefined;
};

const parseCsv = (value = '') => String(value || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const buildReportingConfiguration = (input = {}) => {
  const includeOrganizationSummary = parseBoolean(input.includeOrganizationSummary);
  const includeProductBreakdown = parseBoolean(input.includeProductBreakdown);
  const includeProductScopeBreakdown = parseBoolean(input.includeProductScopeBreakdown);
  const includeAttributionStats = parseBoolean(input.includeAttributionStats);
  const includeUnassignedProducts = parseBoolean(input.includeUnassignedProducts);

  return {
    includeOrganizationSummary: includeOrganizationSummary !== false,
    includeProductBreakdown: includeProductBreakdown !== false,
    includeProductScopeBreakdown: includeProductScopeBreakdown !== false,
    includeAttributionStats: includeAttributionStats !== false,
    includeUnassignedProducts: includeUnassignedProducts !== false,
    productLimit: Math.max(1, safeNumber(input.productLimit, 20)),
    productIds: parseCsv(input.productIds),
    productNames: parseCsv(input.productNames)
  };
};

const applyReportingConfigurationToBreakdown = ({
  breakdown = {},
  config = {}
}) => {
  const resolvedConfig = buildReportingConfiguration(config);
  const scopedProducts = Array.isArray(breakdown.products)
    ? breakdown.products
    : [];

  const filterIdSet = new Set(resolvedConfig.productIds.map((entry) => entry.toLowerCase()));
  const filterNameSet = new Set(resolvedConfig.productNames.map((entry) => entry.toLowerCase()));

  const filteredProducts = scopedProducts.filter((entry) => {
    if (!resolvedConfig.includeUnassignedProducts && entry.productId === 'unassigned_product') {
      return false;
    }
    if (filterIdSet.size > 0 || filterNameSet.size > 0) {
      return filterIdSet.has(String(entry.productId || '').toLowerCase())
        || filterNameSet.has(String(entry.productName || '').toLowerCase());
    }
    return true;
  }).slice(0, resolvedConfig.productLimit);

  const productBreakdown = filteredProducts.map((entry) => {
    if (resolvedConfig.includeProductScopeBreakdown) {
      return entry;
    }
    return {
      productId: entry.productId,
      productName: entry.productName,
      totalEmissions: entry.totalEmissions,
      totalAmount: entry.totalAmount,
      transactionCount: entry.transactionCount
    };
  });

  return {
    reportingConfiguration: resolvedConfig,
    organizationSummary: resolvedConfig.includeOrganizationSummary
      ? breakdown.organization
      : undefined,
    productBreakdown: resolvedConfig.includeProductBreakdown
      ? productBreakdown
      : undefined,
    attributionStats: resolvedConfig.includeAttributionStats
      ? breakdown.attributionStats
      : undefined
  };
};

module.exports = {
  aggregateTransactionEmissionsByProduct,
  buildReportingConfiguration,
  applyReportingConfigurationToBreakdown
};
