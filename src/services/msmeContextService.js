const { getSectorModel } = require('./sectorModelRegistry');

const PRODUCT_PROCESS_HINTS = [
  { match: ['steel', 'metal', 'fabrication'], processes: ['cutting', 'welding'], machinery: ['presses', 'welding_units'] },
  { match: ['cement', 'concrete'], processes: ['mixing', 'curing'], machinery: ['mixers', 'kilns'] },
  { match: ['textile', 'garment', 'cotton'], processes: ['dyeing', 'weaving'], machinery: ['looms', 'dyeing_units'] },
  { match: ['food', 'dairy', 'bakery'], processes: ['processing', 'cold_storage'], machinery: ['refrigeration_units', 'boilers'] },
  { match: ['pharma', 'medical'], processes: ['sterilization', 'packaging'], machinery: ['autoclaves', 'clean_rooms'] },
  { match: ['electronics', 'circuit'], processes: ['soldering', 'testing'], machinery: ['smt_lines', 'testing_rigs'] },
  { match: ['automotive', 'vehicle'], processes: ['assembly', 'painting'], machinery: ['paint_booths', 'conveyors'] },
  { match: ['agro', 'rice', 'grain'], processes: ['processing', 'storage'], machinery: ['dryers', 'cold_storage'] }
];

const normalizeList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim().toLowerCase()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;/]/)
      .map(item => item.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
};

const resolveBusinessDomain = (input) => {
  return (
    input?.businessDomain ||
    input?.processContext?.businessDomain ||
    input?.msmeProfile?.businessDomain ||
    'other'
  );
};

const resolveIndustry = (input) => {
  return (
    input?.industry ||
    input?.processContext?.industry ||
    input?.msmeProfile?.industry ||
    null
  );
};

const resolveCompanyType = (input) => {
  return (
    input?.companyType ||
    input?.processContext?.companyType ||
    input?.msmeProfile?.companyType ||
    null
  );
};

const resolvePrimaryProducts = (input) => normalizeList(
  input?.business?.primaryProducts ||
  input?.processContext?.primaryProducts ||
  input?.primaryProducts ||
  input?.msmeProfile?.business?.primaryProducts
);

const resolveManufacturingUnits = (input) => {
  const value = (
    input?.business?.manufacturingUnits ??
    input?.processContext?.manufacturingUnits ??
    input?.manufacturingUnits ??
    input?.msmeProfile?.business?.manufacturingUnits
  );
  return Number.isFinite(value) ? value : null;
};

const enrichWithProductHints = (products, baseProcesses = [], baseMachinery = []) => {
  const processes = new Set(baseProcesses || []);
  const machinery = new Set(baseMachinery || []);
  const productSignals = new Set();

  products.forEach(product => {
    PRODUCT_PROCESS_HINTS.forEach(hint => {
      if (hint.match.some(token => product.includes(token))) {
        hint.processes.forEach(process => processes.add(process));
        hint.machinery.forEach(machine => machinery.add(machine));
        productSignals.add(product);
      }
    });
  });

  return {
    processes: Array.from(processes),
    machinery: Array.from(machinery),
    productSignals: Array.from(productSignals)
  };
};

const buildMsmeClassificationContext = (input = {}) => {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const businessDomain = resolveBusinessDomain(input);
  const sectorModel = getSectorModel(businessDomain);
  const primaryProducts = resolvePrimaryProducts(input);
  const manufacturingUnits = resolveManufacturingUnits(input);
  const baseProcesses = Array.isArray(input?.processContext?.processes) && input.processContext.processes.length > 0
    ? input.processContext.processes
    : (sectorModel.processes || []);
  const baseMachinery = Array.isArray(input?.processContext?.machinery) && input.processContext.machinery.length > 0
    ? input.processContext.machinery
    : (sectorModel.machinery || []);
  const enriched = enrichWithProductHints(primaryProducts, baseProcesses, baseMachinery);

  return {
    sector: businessDomain || 'other',
    sectorLabel: sectorModel.label,
    industry: resolveIndustry(input),
    companyType: resolveCompanyType(input),
    primaryProducts,
    manufacturingUnits,
    processes: enriched.processes,
    machinery: enriched.machinery,
    productSignals: enriched.productSignals,
    source: 'msme_registration'
  };
};

const normalizeMatchToken = (token) => String(token || '').toLowerCase().replace(/_/g, ' ');

const findMatches = (text, terms = []) => {
  if (!text || !Array.isArray(terms) || terms.length === 0) {
    return [];
  }

  const normalized = String(text || '').toLowerCase();
  const matches = [];
  terms.forEach(term => {
    const token = String(term || '').toLowerCase();
    if (!token) return;
    const spaced = normalizeMatchToken(token);
    if (normalized.includes(token) || normalized.includes(spaced)) {
      matches.push(term);
    }
  });

  return matches;
};

const findContextMatches = (text, context) => {
  if (!context || !text) {
    return {
      processMatches: [],
      machineryMatches: [],
      productMatches: []
    };
  }

  const processMatches = findMatches(text, context.processes);
  const machineryMatches = findMatches(text, context.machinery);
  const productMatches = findMatches(text, context.primaryProducts);

  return {
    processMatches,
    machineryMatches,
    productMatches,
    processMatch: processMatches[0] || null,
    machineryMatch: machineryMatches[0] || null
  };
};

module.exports = {
  buildMsmeClassificationContext,
  findContextMatches
};
