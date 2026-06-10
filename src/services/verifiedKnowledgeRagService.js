const VERIFIED_SOURCE_REGISTRY = {
  bee: {
    id: 'bee',
    name: 'Bureau of Energy Efficiency (BEE), Government of India',
    url: 'https://beeindia.gov.in/'
  },
  cea: {
    id: 'cea',
    name: 'Central Electricity Authority (CEA), Government of India',
    url: 'https://cea.nic.in/'
  },
  pngrb: {
    id: 'pngrb',
    name: 'Petroleum and Natural Gas Regulatory Board (PNGRB), Government of India',
    url: 'https://pngrb.gov.in/'
  },
  ppac: {
    id: 'ppac',
    name: 'Petroleum Planning & Analysis Cell (PPAC), Ministry of Petroleum & Natural Gas',
    url: 'https://www.ppac.gov.in/'
  },
  cpcb: {
    id: 'cpcb',
    name: 'Central Pollution Control Board (CPCB), Government of India',
    url: 'https://cpcb.nic.in/'
  },
  moefcc: {
    id: 'moefcc',
    name: 'Ministry of Environment, Forest and Climate Change (MoEFCC), Government of India',
    url: 'https://moef.gov.in/'
  },
  isro_bhuvan: {
    id: 'isro_bhuvan',
    name: 'ISRO Bhuvan Geospatial Platform',
    url: 'https://bhuvan.nrsc.gov.in/'
  }
};

const LOCATION_REGION_MAP = {
  andhra: 'south-india',
  hyderabad: 'south-india',
  telangana: 'south-india',
  tamil: 'south-india',
  chennai: 'south-india',
  kerala: 'south-india',
  karnataka: 'south-india',
  bengaluru: 'south-india',
  delhi: 'north-india',
  punjab: 'north-india',
  haryana: 'north-india',
  uttar: 'north-india',
  lucknow: 'north-india',
  rajasthan: 'north-india',
  'west bengal': 'east-india',
  kolkata: 'east-india',
  odisha: 'east-india',
  bihar: 'east-india',
  assam: 'northeast-india',
  guwahati: 'northeast-india',
  gujarat: 'west-india',
  maharashtra: 'west-india',
  mumbai: 'west-india',
  pune: 'west-india',
  goa: 'west-india'
};

const KNOWLEDGE_BASE = [
  {
    key: 'grid-electricity-utility',
    parameterType: 'process',
    category: 'energy',
    subcategory: 'grid',
    normalizedLabel: 'grid_electricity',
    transactionTypeHint: 'utility',
    keywords: ['electricity bill', 'grid power', 'kwh', 'energy charge'],
    businessDomains: ['manufacturing', 'services', 'other'],
    emissionFactor: {
      value: 0.00082,
      unit: 'kg_co2_per_inr',
      factorType: 'amount_multiplier'
    },
    verifiedSource: 'cea',
    referenceNote: 'Indian grid emission intensity reference for power mix.'
  },
  {
    key: 'diesel-combustion',
    parameterType: 'machinery',
    category: 'energy',
    subcategory: 'diesel',
    normalizedLabel: 'diesel_combustion',
    transactionTypeHint: 'utility',
    keywords: ['diesel', 'dg set', 'generator fuel', 'genset'],
    businessDomains: ['manufacturing', 'logistics', 'construction', 'other'],
    emissionFactor: {
      value: 0.00268,
      unit: 'kg_co2_per_inr',
      factorType: 'amount_multiplier'
    },
    verifiedSource: 'ppac',
    referenceNote: 'Diesel fuel factors aligned to PPAC fuel data interpretation.'
  },
  {
    key: 'cng-transport',
    parameterType: 'process',
    category: 'transportation',
    subcategory: 'cng',
    normalizedLabel: 'cng_transport',
    transactionTypeHint: 'transport',
    keywords: ['cng', 'compressed natural gas', 'fleet gas', 'auto gas'],
    businessDomains: ['logistics', 'services', 'tourism', 'other'],
    emissionFactor: {
      value: 0.00151,
      unit: 'kg_co2_per_inr',
      factorType: 'amount_multiplier'
    },
    verifiedSource: 'pngrb',
    referenceNote: 'CNG operational context and fuel pathways from PNGRB resources.'
  },
  {
    key: 'steel-input',
    parameterType: 'raw_material',
    category: 'raw_materials',
    subcategory: 'steel',
    normalizedLabel: 'steel_input',
    transactionTypeHint: 'purchase',
    keywords: ['steel coil', 'steel sheet', 'ms plate', 'tmt bar'],
    businessDomains: ['manufacturing', 'construction', 'other'],
    emissionFactor: {
      value: 0.00185,
      unit: 'kg_co2_per_inr',
      factorType: 'amount_multiplier'
    },
    verifiedSource: 'bee',
    referenceNote: 'Industrial material efficiency references from BEE sector guidance.'
  },
  {
    key: 'cement-input',
    parameterType: 'raw_material',
    category: 'raw_materials',
    subcategory: 'concrete',
    normalizedLabel: 'cement_input',
    transactionTypeHint: 'purchase',
    keywords: ['cement', 'opc', 'ppc', 'concrete mix'],
    businessDomains: ['construction', 'manufacturing', 'other'],
    emissionFactor: {
      value: 0.0012,
      unit: 'kg_co2_per_inr',
      factorType: 'amount_multiplier'
    },
    verifiedSource: 'bee',
    referenceNote: 'Energy-intensive material references from BEE industry benchmarking.'
  },
  {
    key: 'waste-landfill',
    parameterType: 'process',
    category: 'waste_management',
    subcategory: 'solid',
    normalizedLabel: 'solid_waste_landfill',
    transactionTypeHint: 'expense',
    keywords: ['landfill', 'solid waste', 'waste disposal', 'municipal waste'],
    businessDomains: ['manufacturing', 'services', 'other'],
    emissionFactor: {
      value: 0.0005,
      unit: 'kg_co2_per_inr',
      factorType: 'amount_multiplier'
    },
    verifiedSource: 'cpcb',
    referenceNote: 'Waste-management handling context from CPCB operating manuals.'
  },
  {
    key: 'hazardous-waste',
    parameterType: 'process',
    category: 'waste_management',
    subcategory: 'hazardous',
    normalizedLabel: 'hazardous_waste_treatment',
    transactionTypeHint: 'expense',
    keywords: ['hazardous waste', 'incineration', 'solvent waste', 'chemical waste'],
    businessDomains: ['manufacturing', 'healthcare', 'other'],
    emissionFactor: {
      value: 0.0018,
      unit: 'kg_co2_per_inr',
      factorType: 'amount_multiplier'
    },
    verifiedSource: 'moefcc',
    referenceNote: 'Hazardous waste handling and compliance context from MoEFCC rules.'
  }
];

class VerifiedKnowledgeRagService {
  normalizeText(value = '') {
    return String(value || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  scoreKnowledgeEntry(normalizedText, entry, context = {}) {
    if (!normalizedText || !entry) return null;

    const keywordHits = entry.keywords.filter(keyword => normalizedText.includes(keyword));
    if (keywordHits.length === 0) {
      return null;
    }

    let score = keywordHits.length * 2;
    const businessDomain = String(context.businessDomain || '').toLowerCase();
    const transactionType = String(context.transactionType || '').toLowerCase();
    const requestedParameterType = String(context.parameterType || '').toLowerCase();

    if (businessDomain && entry.businessDomains.includes(businessDomain)) {
      score += 1.2;
    }
    if (transactionType && entry.transactionTypeHint === transactionType) {
      score += 1.1;
    }
    if (requestedParameterType && entry.parameterType === requestedParameterType) {
      score += 0.8;
    }

    return {
      entry,
      score,
      keywordHits
    };
  }

  inferRegionFromLocation(normalizedText = '', explicitLocation = '') {
    const locationBlob = `${normalizedText} ${String(explicitLocation || '').toLowerCase()}`.trim();
    if (!locationBlob) {
      return null;
    }

    const matchedToken = Object.keys(LOCATION_REGION_MAP).find(token => locationBlob.includes(token));
    if (!matchedToken) {
      return null;
    }
    return {
      token: matchedToken,
      region: LOCATION_REGION_MAP[matchedToken],
      source: VERIFIED_SOURCE_REGISTRY.isro_bhuvan
    };
  }

  classifyUnknownEntry({
    text = '',
    businessDomain = 'other',
    transactionType = 'other',
    parameterType = 'other',
    candidateLocation = ''
  } = {}) {
    const normalizedText = this.normalizeText(text);
    if (!normalizedText) {
      return null;
    }

    const scored = KNOWLEDGE_BASE
      .map(entry => this.scoreKnowledgeEntry(normalizedText, entry, {
        businessDomain,
        transactionType,
        parameterType
      }))
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);

    const top = scored[0];
    if (!top || top.score < 2.5) {
      return null;
    }

    const source = VERIFIED_SOURCE_REGISTRY[top.entry.verifiedSource] || null;
    const locationInference = this.inferRegionFromLocation(normalizedText, candidateLocation);
    const confidence = Math.min(0.96, Number((0.45 + (top.score / 10)).toFixed(3)));

    return {
      category: top.entry.category,
      subcategory: top.entry.subcategory,
      transactionType: top.entry.transactionTypeHint || transactionType || 'other',
      parameterType: top.entry.parameterType || parameterType || 'other',
      normalizedLabel: top.entry.normalizedLabel,
      confidence,
      verifiedSource: source,
      referenceNote: top.entry.referenceNote,
      matchedKeywords: top.keywordHits,
      emissionFactor: {
        ...top.entry.emissionFactor,
        source: source?.url || null
      },
      locationInference,
      retrievalMethod: 'verified_registry_rag'
    };
  }

  classifyUnknownTransaction(input = {}) {
    return this.classifyUnknownEntry({
      ...input,
      parameterType: input.parameterType || 'transaction'
    });
  }

  classifyBatch(items = [], context = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }
    return items
      .map(item => {
        const text = item?.text || item?.description || item?.name || '';
        const result = this.classifyUnknownEntry({
          text,
          businessDomain: item?.businessDomain || context.businessDomain,
          transactionType: item?.transactionType || context.transactionType,
          parameterType: item?.parameterType || context.parameterType,
          candidateLocation: item?.location || context.location
        });
        return result ? { item, result } : null;
      })
      .filter(Boolean);
  }

  getVerifiedSources() {
    const usedSources = new Set(KNOWLEDGE_BASE.map(entry => entry.verifiedSource));
    return Array.from(usedSources).map(sourceKey => VERIFIED_SOURCE_REGISTRY[sourceKey]).filter(Boolean);
  }

  getKnowledgeBaseSummary() {
    return KNOWLEDGE_BASE.map(entry => ({
      key: entry.key,
      category: entry.category,
      subcategory: entry.subcategory,
      parameterType: entry.parameterType,
      source: VERIFIED_SOURCE_REGISTRY[entry.verifiedSource] || null,
      referenceNote: entry.referenceNote
    }));
  }
}

module.exports = new VerifiedKnowledgeRagService();
