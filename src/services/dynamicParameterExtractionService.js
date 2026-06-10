const PARAMETER_PATTERNS = [
  {
    bucket: 'waterConsumption',
    types: {
      municipal: ['municipal', 'tap water', 'water bill'],
      groundwater: ['borewell', 'groundwater', 'well'],
      tanker: ['tanker'],
      wastewater: ['wastewater', 'effluent']
    }
  },
  {
    bucket: 'fuelConsumption',
    types: {
      diesel: ['diesel'],
      petrol: ['petrol', 'gasoline'],
      lpg: ['lpg'],
      cng: ['cng'],
      natural_gas: ['natural gas'],
      coal: ['coal'],
      biomass: ['biomass'],
      furnace_oil: ['furnace oil']
    }
  },
  {
    bucket: 'chemicalsConsumption',
    types: {
      acid: ['acid'],
      alkali: ['alkali', 'caustic'],
      solvent: ['solvent'],
      dye: ['dye'],
      paint: ['paint', 'coating'],
      cleaner: ['cleaner', 'detergent']
    }
  },
  {
    bucket: 'wasteGeneration',
    types: {
      hazardous: ['hazardous', 'chemical waste'],
      scrap: ['scrap', 'reject'],
      recycling: ['recycle', 'recycling'],
      organic: ['organic waste']
    }
  },
  {
    bucket: 'airPollution',
    types: {
      sox: ['sox', 'sulfur oxide'],
      nox: ['nox', 'nitrogen oxide'],
      particulate: ['pm2.5', 'pm10', 'particulate'],
      smoke: ['smoke', 'stack', 'flue']
    }
  },
  {
    bucket: 'materialsConsumption',
    types: {
      steel: ['steel'],
      plastic: ['plastic'],
      paper: ['paper'],
      cotton: ['cotton'],
      yarn: ['yarn'],
      cement: ['cement'],
      grain: ['grain', 'wheat', 'rice'],
      milk: ['milk']
    }
  }
];

const PROCESS_PATTERNS = {
  dyeing: ['dyeing'],
  weaving: ['weaving'],
  extrusion: ['extrusion'],
  smelting: ['smelting'],
  roasting: ['roasting'],
  sterilization: ['sterilization'],
  packaging: ['packaging', 'packing'],
  cold_storage: ['cold storage', 'chiller']
};

const MACHINERY_PATTERNS = {
  boiler: ['boiler'],
  generator: ['generator', 'genset'],
  kiln: ['kiln'],
  furnace: ['furnace'],
  compressor: ['compressor'],
  chiller: ['chiller'],
  cnc: ['cnc'],
  mixer: ['mixer']
};

const MEASUREMENT_REGEX = /(\d+(?:\.\d+)?)\s?(kwh|kg|g|ton|tons|t|kl|l|liters|m3)/g;
const KEY_VALUE_REGEX = /([a-z][a-z0-9_ -]{2,})\s*[:=]\s*([a-z0-9._-]+)/gi;
const KNOWN_PARAMETER_KEYS = new Set();

PARAMETER_PATTERNS.forEach(pattern => {
  KNOWN_PARAMETER_KEYS.add(pattern.bucket.toLowerCase());
  Object.keys(pattern.types).forEach(typeKey => KNOWN_PARAMETER_KEYS.add(typeKey));
});
Object.keys(PROCESS_PATTERNS).forEach(typeKey => KNOWN_PARAMETER_KEYS.add(typeKey));
Object.keys(MACHINERY_PATTERNS).forEach(typeKey => KNOWN_PARAMETER_KEYS.add(typeKey));

const normalizeText = (value) => String(value || '').toLowerCase();

const buildTextBlob = (transaction) => {
  const parts = [
    transaction.description,
    transaction.subcategory,
    transaction.category,
    transaction.vendor?.name,
    transaction.metadata?.originalText
  ].filter(Boolean);
  return parts.join(' ').trim();
};

const recordTypeMatch = (bucketMap, bucket, typeKey, amount) => {
  if (!bucketMap[bucket]) {
    bucketMap[bucket] = {
      types: {},
      mentions: 0,
      totalAmount: 0
    };
  }
  const bucketEntry = bucketMap[bucket];
  bucketEntry.mentions += 1;
  bucketEntry.totalAmount += amount;
  bucketEntry.types[typeKey] = (bucketEntry.types[typeKey] || 0) + 1;
};

const extractPatternMatches = (text, amount, bucketMap) => {
  PARAMETER_PATTERNS.forEach(pattern => {
    Object.entries(pattern.types).forEach(([typeKey, keywords]) => {
      const matched = keywords.some(keyword => text.includes(keyword));
      if (matched) {
        recordTypeMatch(bucketMap, pattern.bucket, typeKey, amount);
      }
    });
  });
};

const extractSignalMatches = (text, patterns) => {
  const matches = new Set();
  Object.entries(patterns).forEach(([key, keywords]) => {
    const matched = keywords.some(keyword => text.includes(keyword));
    if (matched) {
      matches.add(key);
    }
  });
  return Array.from(matches);
};

const computeUnknownWeights = (unknownMap, totalAmount, totalTransactions) => {
  return Array.from(unknownMap.values()).map(entry => {
    const amountShare = totalAmount > 0 ? entry.totalAmount / totalAmount : 0;
    const mentionRate = totalTransactions > 0 ? entry.count / totalTransactions : 0;
    const weight = Math.min(1, 0.6 * mentionRate + 0.4 * amountShare);
    return {
      name: entry.name,
      count: entry.count,
      totalAmount: entry.totalAmount,
      amountShare,
      weight,
      samples: entry.samples.slice(0, 3)
    };
  });
};

const extractDynamicParameters = (transactions = []) => {
  const bucketMap = {};
  const unknownMap = new Map();
  const measurements = [];
  const processSignals = {};
  const machinerySignals = {};
  const totalAmount = transactions.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

  transactions.forEach(transaction => {
    const text = normalizeText(buildTextBlob(transaction));
    if (!text) {
      return;
    }

    const amount = Number(transaction.amount) || 0;
    extractPatternMatches(text, amount, bucketMap);

    const processMatches = extractSignalMatches(text, PROCESS_PATTERNS);
    processMatches.forEach(match => {
      processSignals[match] = (processSignals[match] || 0) + 1;
    });

    const machineryMatches = extractSignalMatches(text, MACHINERY_PATTERNS);
    machineryMatches.forEach(match => {
      machinerySignals[match] = (machinerySignals[match] || 0) + 1;
    });

    const measurementsInText = [...text.matchAll(MEASUREMENT_REGEX)];
    measurementsInText.forEach(match => {
      measurements.push({
        value: Number(match[1]),
        unit: match[2],
        source: transaction.description || transaction.metadata?.originalText || 'unknown'
      });
    });

    const keyValues = [...text.matchAll(KEY_VALUE_REGEX)];
    keyValues.forEach(match => {
      const key = match[1].trim();
      const value = match[2].trim();
      if (!key || !value) {
        return;
      }
      const normalizedKey = key.replace(/\s+/g, '_');
      if (KNOWN_PARAMETER_KEYS.has(normalizedKey)) {
        return;
      }
      const existing = unknownMap.get(normalizedKey) || {
        name: normalizedKey,
        count: 0,
        totalAmount: 0,
        samples: []
      };
      existing.count += 1;
      existing.totalAmount += amount;
      if (existing.samples.length < 5) {
        existing.samples.push(`${key}:${value}`);
      }
      unknownMap.set(normalizedKey, existing);
    });
  });

  return {
    consumptionSignals: bucketMap,
    processSignals,
    machinerySignals,
    measurements,
    unknownParameters: computeUnknownWeights(unknownMap, totalAmount, transactions.length),
    totals: {
      totalTransactions: transactions.length,
      totalAmount
    }
  };
};

module.exports = {
  extractDynamicParameters
};
