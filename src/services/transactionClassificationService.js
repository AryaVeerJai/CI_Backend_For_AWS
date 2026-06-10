const MSME = require('../models/MSME');
const carbonCalculationService = require('./carbonCalculationService');
const {
  buildProductCatalog,
  assignProductsToTransaction
} = require('../utils/productAttribution');

const VALID_BOUNDARIES = new Set(['company', 'product']);

const normalizeBoundary = (value) => {
  const normalized = String(value || 'company').trim().toLowerCase();
  return VALID_BOUNDARIES.has(normalized) ? normalized : 'company';
};

const resolveMsmeProfile = async (scope = {}) => {
  if (scope.msmeId) {
    const profile = await MSME.findById(scope.msmeId).lean();
    if (profile) return profile;
  }

  if (scope.userId) {
    return MSME.findOne({ userId: scope.userId }).lean();
  }

  return null;
};

const buildProductAttributionFromNames = (productNames = [], msmeProfile = {}) => {
  const catalog = buildProductCatalog(msmeProfile);
  const catalogMap = new Map(
    catalog.map((entry) => [String(entry.productName || '').toLowerCase(), entry])
  );

  const uniqueNames = [...new Set(
    (Array.isArray(productNames) ? productNames : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean)
  )];

  if (uniqueNames.length === 0) {
    return null;
  }

  const assignedProducts = uniqueNames.map((productName) => {
    const catalogEntry = catalogMap.get(productName.toLowerCase());
    return {
      productId: catalogEntry?.productId || productName.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      productName: catalogEntry?.productName || productName,
      allocationPercent: 100 / uniqueNames.length
    };
  });

  return {
    assignedProducts,
    assignmentMethod: 'manual_classification',
    assignmentConfidence: 1,
    assignmentSource: 'data_workspace',
    assignedAt: new Date()
  };
};

const applyClassificationToTransaction = (transaction, {
  emissionBoundary,
  productNames = [],
  reason = '',
  msmeProfile = null
}) => {
  const boundary = normalizeBoundary(emissionBoundary);
  transaction.emissionBoundary = boundary;
  transaction.emissionClassification = {
    level: boundary,
    reason: String(reason || '').trim() || (
      boundary === 'product'
        ? 'Classified to manufactured product for product-level carbon accounting'
        : 'Classified to company-level operational boundary'
    )
  };

  if (boundary === 'product') {
    const manualAttribution = buildProductAttributionFromNames(productNames, msmeProfile);
    if (manualAttribution) {
      transaction.productAttribution = manualAttribution;
    } else if (msmeProfile) {
      const attributed = assignProductsToTransaction(
        transaction.toObject ? transaction.toObject({ depopulate: true }) : transaction,
        msmeProfile,
        { forceRecompute: true, assignmentSource: 'data_workspace' }
      );
      transaction.productAttribution = attributed.productAttribution;
    }
  } else {
    transaction.productAttribution = {
      assignedProducts: [],
      assignmentMethod: 'company_boundary',
      assignmentConfidence: 1,
      assignmentSource: 'data_workspace',
      assignedAt: new Date()
    };
  }

  if (transaction.metadata?.extractedData) {
    transaction.metadata.extractedData.transactionMapping = boundary;
    transaction.metadata.extractedData.emissionBoundary = boundary;
  }

  const carbonData = carbonCalculationService.calculateTransactionCarbonFootprint(
    transaction.toObject ? transaction.toObject({ depopulate: true }) : transaction
  );
  transaction.carbonFootprint = carbonData;

  return transaction;
};

module.exports = {
  VALID_BOUNDARIES,
  normalizeBoundary,
  resolveMsmeProfile,
  buildProductAttributionFromNames,
  applyClassificationToTransaction
};
