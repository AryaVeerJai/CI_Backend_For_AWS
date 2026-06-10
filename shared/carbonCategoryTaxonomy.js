/**
 * Canonical carbon transaction category taxonomy (backend, SMS, OCR, agents, mobile).
 * Data: shared/carbonCategoryTaxonomy.json
 */

const TAXONOMY = require('./carbonCategoryTaxonomy.json');

const TRANSACTION_CATEGORIES = Object.freeze([...TAXONOMY.transactionCategories]);
const DOCUMENT_CATEGORIES = Object.freeze([...TAXONOMY.documentCategories]);
const ASSESSMENT_BREAKDOWN_KEYS = Object.freeze([...TAXONOMY.assessmentBreakdownKeys]);

const TRANSACTION_CATEGORY_SET = new Set(TRANSACTION_CATEGORIES);
const DOCUMENT_CATEGORY_SET = new Set(DOCUMENT_CATEGORIES);

const normalizeKey = (value) => String(value || '').toLowerCase().trim();

const normalizeSubcategory = (subcategory) => {
  const raw = normalizeKey(subcategory);
  if (!raw) return 'general';
  const alias = TAXONOMY.subcategoryAliases?.[raw];
  if (alias) return alias;
  const dotBase = raw.split('.')[0];
  if (dotBase && dotBase !== raw) {
    const dotAlias = TAXONOMY.subcategoryAliases?.[dotBase];
    if (dotAlias) return dotAlias;
    return dotBase;
  }
  return raw;
};

const normalizeTransactionCategory = (category) => {
  const normalized = normalizeKey(category);
  if (TRANSACTION_CATEGORY_SET.has(normalized)) {
    return normalized;
  }
  const alias = TAXONOMY.mappings?.legacyCategoryAliases?.[normalized];
  if (alias && TRANSACTION_CATEGORY_SET.has(alias)) {
    return alias;
  }
  if (normalized.includes('telecom') || normalized.includes('broadband') || normalized.includes('recharge')) {
    return 'telecom';
  }
  if (normalized.includes('energy') || normalized.includes('electric') || normalized === 'fuel') {
    return 'energy';
  }
  if (normalized.includes('transport') || normalized.includes('fuel')) {
    return 'transportation';
  }
  if (normalized.includes('waste')) return 'waste_management';
  if (normalized.includes('water')) return 'water';
  if (normalized.includes('mainten')) return 'maintenance';
  if (normalized.includes('service')) return 'services';
  if (normalized.includes('equip') || normalized.includes('machin')) return 'equipment';
  if (normalized.includes('utilit')) return 'utilities';
  if (normalized.includes('material') || normalized.includes('raw')) return 'raw_materials';
  return 'other';
};

const matchesTelecomKeywords = (text = '') => {
  const body = normalizeKey(text);
  if (!body) return false;
  return (TAXONOMY.telecomKeywords || []).some((kw) => body.includes(kw));
};

const mapSmsExpenseCategory = (expenseCategory, subcategory = '', smsBody = '') => {
  const expenseKey = normalizeKey(expenseCategory);
  const subKey = normalizeKey(subcategory);

  const subMapping = TAXONOMY.mappings?.smsExpenseSubcategory?.[subKey];
  if (subMapping?.category) {
    return {
      category: normalizeTransactionCategory(subMapping.category),
      subcategory: normalizeSubcategory(subMapping.subcategory || 'general')
    };
  }

  let category = TAXONOMY.mappings?.smsExpenseCategory?.[expenseKey];
  if (!category) {
    category = normalizeTransactionCategory(expenseKey);
  } else {
    category = normalizeTransactionCategory(category);
  }

  let resolvedSubcategory = subKey || 'general';

  const billsEnergySubs = TAXONOMY.mappings?.smsBillsEnergySubcategories || [];
  if (expenseKey === 'bills' && billsEnergySubs.includes(subKey)) {
    category = 'energy';
    resolvedSubcategory = subKey === 'electricity' ? 'grid' : subKey;
  }

  if (expenseKey === 'bills' && subKey === 'water') {
    category = 'water';
    resolvedSubcategory = 'consumption';
  }

  if (
    matchesTelecomKeywords(smsBody) ||
    (['bills', 'other', 'energy'].includes(expenseKey) && matchesTelecomKeywords(smsBody))
  ) {
    category = 'telecom';
    resolvedSubcategory = subKey && subKey !== 'general' ? normalizeSubcategory(subKey) : 'mobile';
  }

  if (TRANSACTION_CATEGORY_SET.has(expenseKey)) {
    category = expenseKey;
  }

  return {
    category,
    subcategory: normalizeSubcategory(resolvedSubcategory)
  };
};

const mapPipelineCategory = (pipelineCategory, pipelineSubcategory = '') => {
  const key = normalizeKey(pipelineCategory);
  const mapped = TAXONOMY.mappings?.pipelineCategory?.[key] || normalizeTransactionCategory(key);
  return {
    category: normalizeTransactionCategory(mapped),
    subcategory: normalizeSubcategory(pipelineSubcategory || 'general')
  };
};

const resolveSmsToBackend = (payload = {}) => {
  const expenseCategory = payload.category || payload.expenseCategory || '';
  const subcategory = payload.subcategory || '';
  const body = payload.body || payload.message || payload.description || '';
  return mapSmsExpenseCategory(expenseCategory, subcategory, body);
};

const isEnergyRenewableSubcategory = (subcategory) => {
  const normalized = normalizeSubcategory(subcategory);
  return (TAXONOMY.energyRenewableSubcategories || ['renewable', 'solar']).includes(normalized);
};

const isEnergyElectricitySubcategory = (subcategory) => {
  const normalized = normalizeSubcategory(subcategory);
  if (isEnergyRenewableSubcategory(normalized)) return false;
  return (TAXONOMY.energyElectricitySubcategories || []).includes(normalized);
};

const isEnergyFuelSubcategory = (subcategory) => {
  const normalized = normalizeSubcategory(subcategory);
  return (TAXONOMY.energyFuelSubcategories || []).includes(normalized);
};

const getInvoiceSubcategoryOverride = (subcategoryId) => {
  const key = normalizeKey(subcategoryId);
  return TAXONOMY.invoiceSubcategoryOverrides?.[key] || null;
};

const getInvoiceCategoryBackendOverride = (categoryId) => {
  const key = normalizeKey(categoryId);
  return TAXONOMY.invoiceCategoryBackendOverrides?.[key] || null;
};

const applyInvoiceBackendMapping = (classification = {}) => {
  let category = normalizeTransactionCategory(classification.backend_category || classification.category);
  let subcategory = normalizeSubcategory(classification.backend_subcategory || classification.subcategory);

  const categoryOverride = getInvoiceCategoryBackendOverride(classification.category_id);
  if (categoryOverride) {
    category = normalizeTransactionCategory(categoryOverride);
  }

  const subOverride = getInvoiceSubcategoryOverride(classification.subcategory_id);
  if (subOverride) {
    category = normalizeTransactionCategory(subOverride.category);
    subcategory = normalizeSubcategory(subOverride.subcategory);
  }

  return { category, subcategory };
};

const getCategoryKeywords = () => ({ ...(TAXONOMY.categoryKeywords || {}) });

const getSubcategoryKeywordMap = () => ({ ...(TAXONOMY.subcategoryKeywordMap || {}) });

const classifySubcategoryFromText = (text, category) => {
  const normalizedCategory = normalizeTransactionCategory(category);
  const map = TAXONOMY.subcategoryKeywordMap?.[normalizedCategory];
  if (!map) return 'general';
  const haystack = normalizeKey(text);
  for (const [subcategory, keywords] of Object.entries(map)) {
    if (keywords.some((kw) => haystack.includes(kw))) {
      return subcategory;
    }
  }
  return 'general';
};

const getAllowedSubcategories = (category) => {
  const normalized = normalizeTransactionCategory(category);
  return [...(TAXONOMY.subcategories?.[normalized] || ['general'])];
};

const normalizeSubcategoryForCategory = (subcategory, category) => {
  const normalizedCategory = normalizeTransactionCategory(category);
  const normalized = normalizeSubcategory(subcategory);
  const allowed = new Set(getAllowedSubcategories(normalizedCategory).map(normalizeKey));
  if (allowed.has(normalized)) return normalized;
  return 'general';
};

const isValidTransactionCategory = (category) =>
  TRANSACTION_CATEGORY_SET.has(normalizeTransactionCategory(category));

const isValidDocumentCategory = (category) =>
  DOCUMENT_CATEGORY_SET.has(normalizeKey(category));

module.exports = {
  TAXONOMY,
  TRANSACTION_CATEGORIES,
  DOCUMENT_CATEGORIES,
  ASSESSMENT_BREAKDOWN_KEYS,
  TRANSACTION_CATEGORY_SET,
  DOCUMENT_CATEGORY_SET,
  normalizeKey,
  normalizeSubcategory,
  normalizeTransactionCategory,
  matchesTelecomKeywords,
  mapSmsExpenseCategory,
  mapPipelineCategory,
  resolveSmsToBackend,
  isEnergyRenewableSubcategory,
  isEnergyElectricitySubcategory,
  isEnergyFuelSubcategory,
  normalizeSubcategoryForCategory,
  getInvoiceSubcategoryOverride,
  getInvoiceCategoryBackendOverride,
  applyInvoiceBackendMapping,
  getCategoryKeywords,
  getSubcategoryKeywordMap,
  classifySubcategoryFromText,
  getAllowedSubcategories,
  isValidTransactionCategory,
  isValidDocumentCategory
};
