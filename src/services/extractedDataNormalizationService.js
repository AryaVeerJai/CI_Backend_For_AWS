/**
 * Pre-save normalization for document extractedData (vendor + category).
 * Categories: schema enum + shared taxonomy intelligence (no hardcoded lists).
 */

const carbonCategoryTaxonomy = require('../../../shared/carbonCategoryTaxonomy');
const fieldContract = require('../../../shared/fieldContract');
const fieldProvenance = require('../../../shared/fieldProvenance');
const Document = require('../models/Document');
const categoryIntelligenceService = require('./categoryIntelligenceService');
const TAXONOMY = require('../../../shared/invoiceCategoryTaxonomy.json');

const OCR_VENDOR_CORRECTIONS = [
  [/\b0ffice\b/gi, 'office'],
  [/\b(?:pvt|p\.v\.t)\s*ltd\b/gi, 'Pvt Ltd'],
  [/\bltd\.\b/gi, 'Ltd'],
  [/\bgstin\b/gi, ''],
  [/\binvoice\b/gi, ''],
  [/\btax\s*invoice\b/gi, '']
];

let _allowedCategoriesCache = null;

function getAllowedDocumentCategories() {
  if (_allowedCategoriesCache) {
    return _allowedCategoriesCache;
  }
  const extractedPath = Document.schema.path('extractedData');
  const nestedSchema = extractedPath?.schema;
  const categoryPath = nestedSchema?.path('category');
  const fromEnum = categoryPath?.enumValues || categoryPath?.options?.enum;
  if (Array.isArray(fromEnum) && fromEnum.length) {
    _allowedCategoriesCache = fromEnum.map((v) => String(v).toLowerCase());
    return _allowedCategoriesCache;
  }
  const fallback = Document.schema?.obj?.extractedData?.category?.enum;
  _allowedCategoriesCache = Array.isArray(fallback)
    ? fallback.map((v) => String(v).toLowerCase())
    : categoryIntelligenceService.getAllowedBackendCategories().map((v) => String(v).toLowerCase());
  return _allowedCategoriesCache;
}

function tokenize(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function similarityScore(a = '', b = '') {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) {
    return 0;
  }
  const setB = new Set(tb);
  let overlap = 0;
  for (const t of ta) {
    if (setB.has(t)) {
      overlap += 1;
    }
  }
  const union = new Set([...ta, ...tb]).size;
  return overlap / union;
}

function buildTaxonomyBackendIndex() {
  const index = [];
  for (const cat of TAXONOMY.categories || []) {
    const backend = String(cat.backend_category || '').toLowerCase();
    const terms = new Set([
      cat.id,
      cat.label,
      backend,
      ...(cat.keywords || []),
      ...(cat.vendor_patterns || [])
    ].map((t) => String(t).toLowerCase()));
    for (const sub of cat.subcategories || []) {
      terms.add(sub.id);
      terms.add(sub.label);
      terms.add(sub.backend_subcategory);
      for (const kw of sub.keywords || []) {
        terms.add(String(kw).toLowerCase());
      }
    }
    index.push({ backend, terms: [...terms] });
  }
  return index;
}

const TAXONOMY_BACKEND_INDEX = buildTaxonomyBackendIndex();

function resolveNearestAllowedCategory(candidate, originalLabel = '') {
  const allowed = getAllowedDocumentCategories();
  const normalizedCandidate = String(candidate || '').toLowerCase().trim();
  if (normalizedCandidate && allowed.includes(normalizedCandidate)) {
    return {
      category: normalizedCandidate,
      reason: 'schema_enum_match',
      confidence: 0.98
    };
  }

  const label = String(originalLabel || candidate || '').toLowerCase().trim();
  let best = { category: 'other', score: 0, reason: 'safe_fallback' };

  for (const allowedCat of allowed) {
    const score = similarityScore(label, allowedCat);
    if (score > best.score) {
      best = { category: allowedCat, score, reason: `string_similarity:${allowedCat}` };
    }
  }

  for (const entry of TAXONOMY_BACKEND_INDEX) {
    if (!allowed.includes(entry.backend)) {
      continue;
    }
    let score = similarityScore(label, entry.backend);
    for (const term of entry.terms) {
      score = Math.max(score, similarityScore(label, term));
      if (label && (label.includes(term) || term.includes(label))) {
        score = Math.max(score, 0.85);
      }
    }
    if (score > best.score) {
      best = { category: entry.backend, score, reason: `taxonomy_similarity:${entry.backend}` };
    }
  }

  if (best.score < 0.12) {
    return { category: 'other', reason: 'unmapped_safe_fallback', confidence: 0.35 };
  }

  return {
    category: best.category,
    reason: best.reason,
    confidence: Math.min(0.95, 0.4 + best.score)
  };
}

function cleanVendorRaw(value = '') {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  for (const [pattern, replacement] of OCR_VENDOR_CORRECTIONS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/[^\w\s.&,\-'()/]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function mergeOcrWordFragments(text = '') {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return text;
  }

  const merged = [];
  let fragmentBuffer = '';

  const flushFragment = () => {
    if (fragmentBuffer) {
      merged.push(fragmentBuffer);
      fragmentBuffer = '';
    }
  };

  for (const token of tokens) {
    if (/^[&\-./,]+$/.test(token)) {
      flushFragment();
      merged.push(token);
      continue;
    }

    const alnum = token.replace(/[^a-zA-Z0-9]/g, '');
    const isShortFragment = alnum.length > 0 && alnum.length <= 3;

    if (isShortFragment) {
      fragmentBuffer += token;
    } else {
      flushFragment();
      merged.push(token);
    }
  }
  flushFragment();

  return merged.join(' ').replace(/\s+/g, ' ').trim();
}

function titleCaseVendorName(name = '') {
  return String(name)
    .split(/\s+/)
    .map((word) => {
      if (/^[&\-./,]+$/.test(word)) {
        return word;
      }
      if (word.length <= 3 && /^[A-Z0-9&]+$/.test(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ')
    .trim();
}

function extractVendorRaw(extractedData = {}) {
  if (typeof extractedData.vendor === 'string') {
    return extractedData.vendor;
  }
  if (extractedData.vendor?.rawName) {
    return extractedData.vendor.rawName;
  }
  if (extractedData.vendor?.name) {
    return extractedData.vendor.name;
  }
  return extractedData.vendorRaw || '';
}

function normalizeVendor(extractedData = {}) {
  const original = extractVendorRaw(extractedData);
  if (!original) {
    return {
      vendor: extractedData.vendor || null,
      vendorRaw: null,
      meta: null
    };
  }

  const cleaned = cleanVendorRaw(original);
  const merged = mergeOcrWordFragments(cleaned);
  const display = titleCaseVendorName(merged);
  const source = merged !== cleaned
    ? 'ocr_fragment_merge'
    : cleaned !== original
      ? 'ocr_noise_cleanup'
      : typeof extractedData.vendor === 'string'
        ? 'string_to_object'
        : 'unchanged';

  const existingVendor =
    extractedData.vendor && typeof extractedData.vendor === 'object'
      ? { ...extractedData.vendor }
      : {};

  const vendor = {
    ...existingVendor,
    name: display || cleaned || original,
    rawName: original
  };

  return {
    vendor,
    vendorRaw: original,
    meta: {
      original,
      normalized: vendor.name,
      source,
      confidence: display && display.length >= 3 ? 0.72 : 0.4
    }
  };
}

function normalizeCategory(extractedData = {}) {
  const original = extractedData.category != null ? String(extractedData.category).trim() : '';
  const contextText = [
    extractedData.description,
    extractedData.rawText,
    extractedData.invoiceCategory,
    original
  ]
    .filter(Boolean)
    .join(' ');

  const vendorName =
    typeof extractedData.vendor === 'string'
      ? extractedData.vendor
      : extractedData.vendor?.name || '';

  const classification = categoryIntelligenceService.classify({
    text: contextText,
    vendor: vendorName,
    items: extractedData.items || [],
    mlLabel: original || null,
    mlConf: original ? 0.88 : 0,
    historicalCategory: original || null,
    sector: extractedData.sector || extractedData?.classificationContext?.sector
  });

  const backendFields = categoryIntelligenceService.toBackendFields(classification);
  const candidate = backendFields.category || classification.backend_category || 'other';
  const resolved = resolveNearestAllowedCategory(candidate, original || candidate);

  const reason =
    resolved.reason === 'schema_enum_match'
      ? `taxonomy:${classification.classification_method}`
      : `${resolved.reason};taxonomy:${classification.explainability?.[0] || classification.category_id}`;

  return {
    category: resolved.category,
    subcategory: carbonCategoryTaxonomy.normalizeSubcategory(
      backendFields.subcategory || extractedData.subcategory || 'general'
    ),
    classification,
    backendFields,
    meta: {
      original: original || null,
      normalized: resolved.category,
      confidence: resolved.confidence ?? classification.confidence,
      source: 'category_intelligence_service',
      reason
    }
  };
}

function normalizeExtractedDataForSave(extractedData = {}) {
  if (!extractedData || typeof extractedData !== 'object') {
    return extractedData;
  }

  const vendorResult = normalizeVendor(extractedData);
  if (vendorResult.vendor) {
    extractedData.vendor = vendorResult.vendor;
  }
  if (vendorResult.vendorRaw) {
    extractedData.vendorRaw = vendorResult.vendorRaw;
  }
  fieldProvenance.recordVendorNormalization(extractedData, vendorResult);

  const categoryResult = normalizeCategory(extractedData);
  extractedData.category = categoryResult.category;
  if (categoryResult.subcategory) {
    extractedData.subcategory = categoryResult.subcategory;
  }

  extractedData.classificationContext = {
    ...(extractedData.classificationContext || {}),
    ...(categoryResult.backendFields?.classificationContext || {}),
    normalization: {
      ...(extractedData.classificationContext?.normalization || {}),
      category: categoryResult.meta,
      vendor: vendorResult.meta
    }
  };

  if (categoryResult.classification) {
    extractedData.classificationIntelligence = {
      ...(extractedData.classificationIntelligence || {}),
      ...categoryResult.classification
    };
    extractedData.invoiceCategory = categoryResult.classification.category;
    extractedData.invoiceSubcategory = categoryResult.classification.subcategory;
  }

  const catMeta = categoryResult.meta || {};
  const vendorMeta = vendorResult.meta || {};
  console.log('[NORMALIZE] category:', {
    original: catMeta.original,
    normalized: catMeta.normalized,
    reason: catMeta.reason,
    confidence: catMeta.confidence,
    source: catMeta.source
  });
  console.log('[NORMALIZE] vendor:', {
    original: vendorMeta.original,
    normalized: vendorMeta.normalized,
    source: vendorMeta.source,
    confidence: vendorMeta.confidence
  });

  return fieldContract.applyFieldContractWrite(extractedData);
}

module.exports = {
  normalizeExtractedDataForSave,
  getAllowedDocumentCategories,
  normalizeVendor,
  normalizeCategory,
  resolveNearestAllowedCategory
};
