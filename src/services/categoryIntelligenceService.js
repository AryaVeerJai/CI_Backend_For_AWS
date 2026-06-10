/**
 * Enterprise MSME Category + Subcategory Intelligence Service (Node).
 * Mirrors ai-model/pipeline/category_intelligence.py using shared taxonomy.
 */

const carbonCategoryTaxonomy = require('../../../shared/carbonCategoryTaxonomy');
const TAXONOMY = require('../../../shared/invoiceCategoryTaxonomy.json');

const OCR_CORRECTIONS = [
  [/\be1ectric\b/gi, 'electric'],
  [/\bdiese1\b/gi, 'diesel'],
  [/\bpetro1\b/gi, 'petrol'],
  [/\bsteek\b/gi, 'steel'],
  [/\b0ffice\b/gi, 'office']
];

class CategoryIntelligenceService {
  constructor() {
    this.taxonomyVersion = TAXONOMY.taxonomyVersion;
    this.categories = TAXONOMY.categories;
    this.legacyMap = TAXONOMY.legacyCategoryMap || {};
    this.mlLabelMap = TAXONOMY.mlLabelMap || {};
    this._buildIndexes();
  }

  _buildIndexes() {
    this.catById = {};
    this.subById = {};
    this.keywordIndex = [];
    this.vendorIndex = [];

    for (const cat of this.categories) {
      this.catById[cat.id] = cat;
      for (const kw of cat.keywords || []) {
        this.keywordIndex.push({ kw: kw.toLowerCase(), catId: cat.id, subId: '', weight: 1.0 });
      }
      for (const vp of cat.vendor_patterns || []) {
        this.vendorIndex.push({ pattern: vp.toLowerCase(), catId: cat.id, label: vp });
      }
      for (const sub of cat.subcategories || []) {
        this.subById[sub.id] = { cat, sub };
        for (const kw of sub.keywords || []) {
          this.keywordIndex.push({ kw: kw.toLowerCase(), catId: cat.id, subId: sub.id, weight: 1.4 });
        }
      }
    }
    this.keywordIndex.sort((a, b) => b.kw.length - a.kw.length);
  }

  cleanText(text = '') {
    if (!text) return '';
    let t = String(text).toLowerCase();
    t = t.replace(/[^\w\s.\-/&,@#]/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    for (const [pattern, replacement] of OCR_CORRECTIONS) {
      t = t.replace(pattern, replacement);
    }
    return t;
  }

  scoreKeywords(text) {
    const signals = [];
    for (const entry of this.keywordIndex) {
      if (text.includes(entry.kw)) {
        signals.push({
          source: 'keyword',
          categoryId: entry.catId,
          subcategoryId: entry.subId,
          weight: entry.weight,
          reason: `Keyword match: ${entry.kw}`
        });
      }
    }
    return signals;
  }

  detectVendorSignals(vendor, text) {
    const haystack = `${vendor || ''} ${text}`.toLowerCase();
    const signals = [];
    for (const entry of this.vendorIndex) {
      if (haystack.includes(entry.pattern)) {
        signals.push({
          source: 'vendor',
          categoryId: entry.catId,
          subcategoryId: '',
          weight: 2.2,
          reason: `Vendor pattern matched: ${entry.label}`
        });
      }
    }
    return signals;
  }

  analyzeLineItems(items = []) {
    const signals = [];
    for (const item of items) {
      const name = String(item?.name || item?.description || '').toLowerCase();
      if (name.length < 3) continue;
      for (const entry of this.keywordIndex) {
        if (name.includes(entry.kw)) {
          signals.push({
            source: 'line_item',
            categoryId: entry.catId,
            subcategoryId: entry.subId,
            weight: entry.weight * 1.3,
            reason: `Line item keyword: ${entry.kw}`
          });
        }
      }
    }
    return signals;
  }

  applyMlHint(mlLabel, mlConf = 0) {
    if (!mlLabel || mlConf < 0.45) return [];
    const mapped = this.mlLabelMap[mlLabel.toLowerCase()] || this.legacyMap[mlLabel.toLowerCase()];
    if (!mapped) return [];
    return [{
      source: 'ml',
      categoryId: mapped,
      subcategoryId: '',
      weight: mlConf * 1.8,
      reason: `ML label '${mlLabel}' → ${mapped}`
    }];
  }

  aggregateSignals(signals) {
    const catScores = {};
    const subScores = {};
    for (const sig of signals) {
      catScores[sig.categoryId] = (catScores[sig.categoryId] || 0) + sig.weight;
      if (sig.subcategoryId) {
        const key = `${sig.categoryId}::${sig.subcategoryId}`;
        subScores[key] = (subScores[key] || 0) + sig.weight;
      }
    }
    return { catScores, subScores };
  }

  pickBest(catScores, subScores, fallbackCategory = 'general_msme') {
    let catId;
    let catConf;
    if (!Object.keys(catScores).length) {
      catId = fallbackCategory;
      catConf = 0.35;
    } else {
      catId = Object.entries(catScores).sort((a, b) => b[1] - a[1])[0][0];
      const total = Object.values(catScores).reduce((s, v) => s + v, 0) || 1;
      catConf = Math.min(catScores[catId] / total, 0.98);
    }

    const catSubs = Object.entries(subScores)
      .filter(([key]) => key.startsWith(`${catId}::`))
      .map(([key, score]) => ({ subId: key.split('::')[1], score }));

    let subId = '';
    let subConf = 0;
    if (catSubs.length) {
      const best = catSubs.sort((a, b) => b.score - a.score)[0];
      subId = best.subId;
      const totalSub = catSubs.reduce((s, e) => s + e.score, 0) || 1;
      subConf = Math.min(best.score / totalSub, 0.98);
    } else {
      const subs = this.catById[catId]?.subcategories || [];
      if (subs.length) {
        subId = subs[0].id;
        subConf = catConf * 0.6;
      }
    }

    return { catId, subId, catConf, subConf };
  }

  inferVendorType(vendor, catId) {
    if (!vendor) return null;
    const v = vendor.toLowerCase();
    const patterns = this.catById[catId]?.vendor_patterns || [];
    for (const pattern of patterns) {
      if (v.includes(pattern)) return pattern.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    if (/petrol|diesel|fuel|iocl|bpcl/.test(v)) return 'Fuel Station';
    if (/electric|power|bescom|mseb/.test(v)) return 'Utility Provider';
    if (/pharma|medical|hospital/.test(v)) return 'Healthcare Vendor';
    return 'MSME Vendor';
  }

  /**
   * Classify invoice text into hierarchical category intelligence output.
   */
  classify({
    text = '',
    vendor = null,
    items = [],
    gstDescription = null,
    mlLabel = null,
    mlConf = 0,
    sector = null,
    sectorConf = 0,
    historicalCategory = null
  } = {}) {
    const raw = [text, gstDescription].filter(Boolean).join(' ');
    const cleaned = this.cleanText(raw);
    const vendorName = typeof vendor === 'string' ? vendor : vendor?.name || '';

    const signals = [
      ...this.scoreKeywords(cleaned),
      ...this.detectVendorSignals(vendorName, cleaned),
      ...this.analyzeLineItems(items),
      ...this.applyMlHint(mlLabel, mlConf)
    ];

    if (historicalCategory) {
      const histId = this.legacyMap[historicalCategory.toLowerCase()] || historicalCategory;
      if (this.catById[histId]) {
        signals.push({
          source: 'historical',
          categoryId: histId,
          subcategoryId: '',
          weight: 1.5,
          reason: `Historical category: ${historicalCategory}`
        });
      }
    }

    const { catScores, subScores } = this.aggregateSignals(signals);
    let { catId, subId, catConf, subConf } = this.pickBest(catScores, subScores);

    let method = 'Rule Engine + Keyword Intelligence';
    const sources = new Set(signals.map((s) => s.source));
    if (sources.has('ml') && (sources.has('keyword') || sources.has('vendor'))) {
      method = 'Hybrid ML + Rule Engine';
    } else if (sources.has('ml')) {
      method = 'ML Prediction';
    }

    let overallConf = subConf ? Math.min(0.98, catConf * 0.45 + subConf * 0.55) : catConf;
    if (overallConf < 0.5) {
      method = 'Confidence Fallback';
      catId = 'general_msme';
      const cat = this.catById[catId];
      subId = cat.subcategories[0].id;
      overallConf = 0.42;
      catConf = 0.42;
      subConf = 0.4;
    }

    const cat = this.catById[catId];
    const subEntry = this.subById[subId];
    const sub = subEntry?.sub || cat.subcategories?.[0];

    return {
      category: cat.label,
      subcategory: sub.label,
      category_id: catId,
      subcategory_id: sub.id,
      sector: sub.sector,
      emission_scope: sub.emission_scope,
      confidence: Math.round(overallConf * 10000) / 10000,
      category_confidence: Math.round(catConf * 10000) / 10000,
      subcategory_confidence: Math.round(subConf * 10000) / 10000,
      vendor_type: this.inferVendorType(vendorName, catId),
      carbon_factor: sub.carbon_factor,
      classification_method: method,
      backend_category: cat.backend_category,
      backend_subcategory: sub.backend_subcategory,
      explainability: signals.slice(0, 8).map((s) => s.reason),
      classificationContext: {
        taxonomyVersion: this.taxonomyVersion,
        signals: signals.slice(0, 12)
      }
    };
  }

  /**
   * Map hierarchical result to legacy backend transaction category fields.
   */
  toBackendFields(classification) {
    const mapped = carbonCategoryTaxonomy.applyInvoiceBackendMapping(classification);
    return {
      category: mapped.category,
      subcategory: mapped.subcategory,
      classificationContext: {
        invoiceCategory: classification.category,
        invoiceSubcategory: classification.subcategory,
        invoiceCategoryId: classification.category_id,
        invoiceSubcategoryId: classification.subcategory_id,
        sector: classification.sector,
        emissionScope: classification.emission_scope,
        carbonFactor: classification.carbon_factor,
        vendorType: classification.vendor_type,
        confidence: classification.confidence,
        classificationMethod: classification.classification_method,
        explainability: classification.explainability
      }
    };
  }

  getAllowedBackendCategories() {
    return carbonCategoryTaxonomy.DOCUMENT_CATEGORIES.filter((cat) => cat !== 'general');
  }

  resolveItemCategory(item, extractedData = {}) {
    const result = this.classify({
      text: `${item?.name || ''} ${extractedData.description || ''}`,
      vendor: extractedData.vendor?.name,
      mlLabel: extractedData.category,
      historicalCategory: extractedData.category
    });
    return result.backend_category;
  }

  resolveItemSubcategory(item, category, extractedData = {}) {
    const result = this.classify({
      text: `${item?.name || ''} ${extractedData.description || ''}`,
      vendor: extractedData.vendor?.name
    });
    if (result.backend_category === category) {
      return result.backend_subcategory;
    }
    return extractedData.subcategory || 'general';
  }
}

module.exports = new CategoryIntelligenceService();
