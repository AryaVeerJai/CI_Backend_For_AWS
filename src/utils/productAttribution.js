const DEFAULT_UNASSIGNED_PRODUCT = 'Unassigned product';

const toSlug = (value = '') => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'product';

const splitProductString = (value = '') => String(value || '')
  .split(/[,;|]/g)
  .map((entry) => String(entry || '').trim())
  .filter(Boolean);

const toUniqueProductNames = (values = []) => {
  const seen = new Set();
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      const normalized = value.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
};

const getWorkflowProducts = (msmeProfile = {}) => {
  const units = Array.isArray(msmeProfile?.business?.manufacturingWorkflow?.units)
    ? msmeProfile.business.manufacturingWorkflow.units
    : [];

  return units.flatMap((unit) => (
    Array.isArray(unit?.products)
      ? unit.products
      : splitProductString(unit?.products)
  ));
};

const getProfileProducts = (msmeProfile = {}) => {
  const primaryProducts = splitProductString(msmeProfile?.business?.primaryProducts);
  const keyProducts = Array.isArray(msmeProfile?.manufacturingProfile?.keyProducts)
    ? msmeProfile.manufacturingProfile.keyProducts
    : splitProductString(msmeProfile?.manufacturingProfile?.keyProducts);

  return [...primaryProducts, ...keyProducts];
};

const buildProductCatalog = (msmeProfile = {}) => {
  const productNames = toUniqueProductNames([
    ...getWorkflowProducts(msmeProfile),
    ...getProfileProducts(msmeProfile)
  ]);

  const slugCounts = new Map();
  return productNames.map((productName) => {
    const baseSlug = toSlug(productName);
    const count = (slugCounts.get(baseSlug) || 0) + 1;
    slugCounts.set(baseSlug, count);
    const productId = count === 1 ? baseSlug : `${baseSlug}_${count}`;
    return {
      productId,
      productName
    };
  });
};

const normalizeAllocationPercentages = (assignments = []) => {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return [];
  }

  const normalized = assignments.map((assignment) => ({
    ...assignment,
    allocationPercent: Number(assignment?.allocationPercent)
  }));

  const total = normalized.reduce((sum, assignment) => {
    const allocation = Number(assignment.allocationPercent);
    return sum + (Number.isFinite(allocation) && allocation > 0 ? allocation : 0);
  }, 0);

  if (total <= 0) {
    const equalShare = 100 / normalized.length;
    let cumulative = 0;
    return normalized.map((assignment, index) => {
      const share = index === normalized.length - 1
        ? Math.max(0, 100 - cumulative)
        : Number(equalShare.toFixed(4));
      cumulative += share;
      return {
        ...assignment,
        allocationPercent: share
      };
    });
  }

  let cumulative = 0;
  return normalized.map((assignment, index) => {
    const rawAllocation = Number(assignment.allocationPercent);
    const allocation = Number.isFinite(rawAllocation) && rawAllocation > 0 ? rawAllocation : 0;
    const normalizedAllocation = index === normalized.length - 1
      ? Math.max(0, 100 - cumulative)
      : Number(((allocation / total) * 100).toFixed(4));
    cumulative += normalizedAllocation;
    return {
      ...assignment,
      allocationPercent: normalizedAllocation
    };
  });
};

const toCatalogMap = (catalog = []) => {
  return new Map(catalog.map((entry) => [String(entry.productName || '').toLowerCase(), entry]));
};

const normalizeExplicitProducts = ({
  products = [],
  catalog = []
}) => {
  const catalogMap = toCatalogMap(catalog);
  const normalizedNames = toUniqueProductNames(products);
  if (normalizedNames.length === 0) return [];

  const mapped = normalizedNames.map((productName) => {
    const catalogProduct = catalogMap.get(productName.toLowerCase());
    return {
      productId: catalogProduct?.productId || toSlug(productName),
      productName: catalogProduct?.productName || productName
    };
  });
  return normalizeAllocationPercentages(mapped);
};

const getExplicitProductInputs = (transaction = {}) => {
  const extractedData = transaction?.metadata?.extractedData || {};
  const productAttribution = transaction?.productAttribution || {};
  const assignedProducts = Array.isArray(productAttribution?.assignedProducts)
    ? productAttribution.assignedProducts.map((entry) => entry?.productName || entry?.name)
    : [];

  return toUniqueProductNames([
    ...(Array.isArray(transaction?.productNames) ? transaction.productNames : []),
    transaction?.productName,
    ...(Array.isArray(transaction?.products) ? transaction.products : []),
    ...(Array.isArray(extractedData?.products) ? extractedData.products : []),
    ...splitProductString(extractedData?.products),
    extractedData?.product,
    ...(Array.isArray(transaction?.classificationContext?.matchedProducts)
      ? transaction.classificationContext.matchedProducts
      : []),
    ...assignedProducts
  ]);
};

const getUnitMappedProducts = (transaction = {}, msmeProfile = {}) => {
  const workflowUnits = Array.isArray(msmeProfile?.business?.manufacturingWorkflow?.units)
    ? msmeProfile.business.manufacturingWorkflow.units
    : [];
  if (workflowUnits.length === 0) return [];

  const extractedData = transaction?.metadata?.extractedData || {};
  const candidateUnitIds = [
    extractedData?.assignedUnitId,
    extractedData?.unitId,
    transaction?.classificationContext?.matchedUnitId
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (candidateUnitIds.length === 0) return [];

  const unitMap = new Map(workflowUnits.map((unit) => [String(unit?.unitId || '').trim(), unit]));
  const mappedProducts = candidateUnitIds.flatMap((unitId) => {
    const unit = unitMap.get(unitId);
    return unit && Array.isArray(unit.products) ? unit.products : [];
  });

  return toUniqueProductNames(mappedProducts);
};

const tokenize = (value = '') => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9\s]+/g, ' ')
  .split(/\s+/g)
  .map((token) => token.trim())
  .filter((token) => token.length >= 2);

const matchProductsFromText = (transaction = {}, catalog = []) => {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return [];
  }

  const extractedData = transaction?.metadata?.extractedData || {};
  const candidateText = [
    transaction?.description,
    transaction?.subcategory,
    transaction?.category,
    transaction?.vendor?.name,
    transaction?.metadata?.originalText,
    extractedData?.rawText,
    extractedData?.description,
    extractedData?.product,
    extractedData?.itemName
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!candidateText) return [];

  const candidateTokens = new Set(tokenize(candidateText));
  const scored = catalog
    .map((entry) => {
      const productName = String(entry?.productName || '').toLowerCase();
      const productTokens = tokenize(productName);
      if (!productName || productTokens.length === 0) {
        return { entry, score: 0 };
      }

      const fullNameMatchBoost = candidateText.includes(productName) ? 3 : 0;
      const tokenScore = productTokens.reduce((sum, token) => (
        candidateTokens.has(token) ? sum + 1 : sum
      ), 0);

      return {
        entry,
        score: fullNameMatchBoost + tokenScore
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  const highestScore = scored[0].score;
  const matched = scored
    .filter((item) => item.score === highestScore)
    .slice(0, 3)
    .map((item) => item.entry.productName);

  return toUniqueProductNames(matched);
};

const buildFallbackAssignments = (catalog = []) => {
  if (catalog.length === 1) {
    return {
      assignmentMethod: 'single_product_default',
      assignmentConfidence: 0.8,
      assignedProducts: normalizeAllocationPercentages([{
        productId: catalog[0].productId,
        productName: catalog[0].productName,
        allocationPercent: 100
      }])
    };
  }

  if (catalog.length > 1) {
    return {
      assignmentMethod: 'profile_primary_products',
      assignmentConfidence: 0.35,
      assignedProducts: normalizeAllocationPercentages(catalog.map((entry) => ({
        productId: entry.productId,
        productName: entry.productName
      })))
    };
  }

  return {
    assignmentMethod: 'unassigned_fallback',
    assignmentConfidence: 0.1,
    assignedProducts: [{
      productId: 'unassigned_product',
      productName: DEFAULT_UNASSIGNED_PRODUCT,
      allocationPercent: 100
    }]
  };
};

const assignProductsToTransaction = (
  transaction = {},
  msmeProfile = {},
  options = {}
) => {
  const {
    forceRecompute = false,
    assignmentSource = 'data_stage',
    assignedAt = new Date()
  } = options;

  const catalog = buildProductCatalog(msmeProfile);
  const existingAssignments = Array.isArray(transaction?.productAttribution?.assignedProducts)
    ? transaction.productAttribution.assignedProducts
    : [];

  if (!forceRecompute && existingAssignments.length > 0) {
    return {
      ...transaction,
      productAttribution: {
        ...transaction.productAttribution,
        assignedProducts: normalizeAllocationPercentages(existingAssignments),
        assignmentSource: transaction?.productAttribution?.assignmentSource || assignmentSource,
        assignedAt: transaction?.productAttribution?.assignedAt || assignedAt
      }
    };
  }

  const explicitProductInputs = getExplicitProductInputs(transaction);
  if (explicitProductInputs.length > 0) {
    return {
      ...transaction,
      productAttribution: {
        assignedProducts: normalizeExplicitProducts({
          products: explicitProductInputs,
          catalog
        }),
        assignmentMethod: 'explicit_input',
        assignmentConfidence: 0.95,
        assignmentSource,
        assignedAt
      }
    };
  }

  const unitMappedProducts = getUnitMappedProducts(transaction, msmeProfile);
  if (unitMappedProducts.length > 0) {
    return {
      ...transaction,
      productAttribution: {
        assignedProducts: normalizeExplicitProducts({
          products: unitMappedProducts,
          catalog
        }),
        assignmentMethod: 'workflow_unit_match',
        assignmentConfidence: 0.85,
        assignmentSource,
        assignedAt
      }
    };
  }

  const keywordMatchedProducts = matchProductsFromText(transaction, catalog);
  if (keywordMatchedProducts.length > 0) {
    return {
      ...transaction,
      productAttribution: {
        assignedProducts: normalizeExplicitProducts({
          products: keywordMatchedProducts,
          catalog
        }),
        assignmentMethod: 'keyword_match',
        assignmentConfidence: 0.7,
        assignmentSource,
        assignedAt
      }
    };
  }

  const fallbackAssignments = buildFallbackAssignments(catalog);
  return {
    ...transaction,
    productAttribution: {
      ...fallbackAssignments,
      assignmentSource,
      assignedAt
    }
  };
};

/**
 * Infer manufactured product names from the MSME catalog using document text
 * (keyword agent) plus profile / workflow product signals from the machinery profiler agent.
 */
const inferManufacturedProductsFromAgentContext = (transaction = {}, msmeProfile = {}, agentContext = {}) => {
  const catalog = buildProductCatalog(msmeProfile);
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return [];
  }

  const fromDocumentAgents = matchProductsFromText(transaction, catalog);

  const profileHints = Array.isArray(agentContext.productSignals)
    ? agentContext.productSignals
    : [];

  const fromProfileCatalog = [];
  const hintTokens = profileHints
    .flatMap((hint) => tokenize(String(hint || '')))
    .filter(Boolean);

  for (const entry of catalog) {
    const name = String(entry.productName || '').trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    const catalogTokens = tokenize(name);

    let matched = false;
    for (const hint of profileHints) {
      const h = String(hint || '').trim().toLowerCase();
      if (!h) continue;
      if (lower.includes(h) || h.includes(lower)) {
        matched = true;
        break;
      }
      if (catalogTokens.some((tok) => h.includes(tok) || tok.includes(h))) {
        matched = true;
        break;
      }
    }

    if (!matched && hintTokens.length > 0) {
      matched = catalogTokens.some((tok) => hintTokens.includes(tok));
    }

    if (matched) {
      fromProfileCatalog.push(name);
    }
  }

  return toUniqueProductNames([...fromDocumentAgents, ...fromProfileCatalog]);
};

module.exports = {
  DEFAULT_UNASSIGNED_PRODUCT,
  assignProductsToTransaction,
  buildProductCatalog,
  inferManufacturedProductsFromAgentContext
};
