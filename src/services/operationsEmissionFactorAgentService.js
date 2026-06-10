/**
 * Resolves mass-based and energy-based emission factors for manufacturing workflow
 * estimates using a deterministic "agent" layer: expanded material library, regional
 * grid electricity intensity, machinery-name fuel hints, verified-knowledge RAG matches,
 * and small process-intensity adders for thermal / finishing steps.
 */

const verifiedKnowledgeRagService = require('./verifiedKnowledgeRagService');

const DEFAULT_GRID_KG_CO2_PER_KWH = 0.82;

/** Representative grid emission intensity (kg CO₂ / kWh) by Indian state token. */
const REGION_GRID_KG_CO2_PER_KWH = {
  maharashtra: 0.72,
  gujarat: 0.78,
  karnataka: 0.71,
  tamil: 0.75,
  'tamil nadu': 0.75,
  kerala: 0.66,
  telangana: 0.74,
  andhra: 0.71,
  delhi: 0.82,
  haryana: 0.85,
  punjab: 0.88,
  'uttar pradesh': 0.86,
  uttarakhand: 0.52,
  rajasthan: 0.91,
  'madhya pradesh': 0.93,
  'west bengal': 0.78,
  odisha: 0.79,
  bihar: 0.82,
  jharkhand: 0.88,
  chhattisgarh: 0.95,
  assam: 0.48,
  goa: 0.72,
  'himachal pradesh': 0.28,
  sikkim: 0.28
};

const MACHINERY_FUEL_FACTORS = {
  electricity: DEFAULT_GRID_KG_CO2_PER_KWH,
  diesel: 2.68,
  petrol: 2.31,
  cng: 1.51,
  lpg: 1.51,
  coal: 2.42
};

/** Extended cradle-to-gate style factors (kg CO₂ / kg material) for MSME-relevant inputs. */
const EXTENDED_MATERIAL_KG_CO2_PER_KG = [
  { keys: ['steel', 'ms ', 'crca', 'hr coil', 'tmt', 'gi sheet', 'ss304', 'stainless'], value: 1.85, label: 'steel_average', source: 'industry_default' },
  { keys: ['aluminum', 'aluminium', 'al coil', 'adc12'], value: 8.24, label: 'aluminum_primary_blend', source: 'industry_default' },
  { keys: ['copper', 'cu wire', 'brass'], value: 4.2, label: 'copper_brass_blend', source: 'industry_default' },
  { keys: ['zinc', 'galvaniz'], value: 3.5, label: 'zinc_galvanizing_context', source: 'industry_default' },
  { keys: ['hdpe', 'ldpe', 'polyethylene', 'pp ', 'polypropylene', 'abs ', 'polycarbonate', 'nylon', 'polymer'], value: 2.53, label: 'plastics_generic', source: 'industry_default' },
  { keys: ['pvc'], value: 2.4, label: 'pvc', source: 'industry_default' },
  { keys: ['rubber', 'elastomer', 'sbr'], value: 2.7, label: 'rubber', source: 'industry_default' },
  { keys: ['paper', 'kraft', 'corrugat', 'cardboard'], value: 0.93, label: 'paper_board', source: 'industry_default' },
  { keys: ['glass', 'borosilicate'], value: 0.85, label: 'glass', source: 'industry_default' },
  { keys: ['wood', 'plywood', 'mdf', 'timber'], value: 0.35, label: 'wood_products', source: 'industry_default' },
  { keys: ['cement', 'opc', 'ppc', 'clinker'], value: 0.92, label: 'cement', source: 'industry_default' },
  { keys: ['concrete', 'rcc', 'readymix'], value: 0.15, label: 'concrete', source: 'industry_default' },
  { keys: ['ceramic', 'tile', 'sanitary ware'], value: 0.55, label: 'ceramics', source: 'industry_default' },
  { keys: ['cotton', 'yarn', 'fabric', 'textile fiber'], value: 2.1, label: 'cotton_textile', source: 'industry_default' },
  { keys: ['polyester', 'pet fiber', 'synthetic yarn'], value: 3.2, label: 'polyester_textile', source: 'industry_default' },
  { keys: ['sugar', 'jaggery'], value: 0.9, label: 'sugar', source: 'industry_default' },
  { keys: ['wheat', 'rice', 'maize', 'flour', 'atta'], value: 0.6, label: 'cereal_bulk', source: 'industry_default' },
  { keys: ['oil', 'edible oil', 'ghee', 'palm oil'], value: 2.8, label: 'vegetable_oils', source: 'industry_default' },
  { keys: ['fertilizer', 'urea', 'dap', 'npk'], value: 1.9, label: 'fertilizers', source: 'industry_default' },
  { keys: ['paint', 'primer', 'coating resin'], value: 2.2, label: 'coatings', source: 'industry_default' },
  { keys: ['solvent', 'thinner', 'acetone', 'toluene', 'ipa ', 'isopropyl'], value: 2.5, label: 'solvents', source: 'industry_default' },
  { keys: ['battery', 'lithium', 'li-ion'], value: 8.0, label: 'batteries_order_of_magnitude', source: 'industry_default' },
  { keys: ['electronics', 'pcb', 'circuit'], value: 5.0, label: 'electronics_assembly_intensity', source: 'industry_default' }
];

const LEGACY_DEFAULT_MATERIAL_KEYS = {
  steel: 1.85,
  aluminum: 8.24,
  plastic: 2.53,
  paper: 0.93,
  cardboard: 0.94,
  glass: 0.85,
  wood: 0.3,
  concrete: 0.15,
  cotton: 2.1,
  rubber: 2.7
};

const MASS_FACTOR_FROM_RAG_SUBCATEGORY = {
  steel: 1.85,
  concrete: 0.15,
  diesel: 2.68,
  cng: 1.51
};

const PROCESS_AUXILIARY_RULES = [
  { keys: ['furnace', 'kiln', 'smelt', 'foundry melt'], kgPerCompositeHour: 10, capFracOfMachinery: 0.14, label: 'high_temperature_process' },
  { keys: ['boiler', 'steam', 'autoclave'], kgPerCompositeHour: 6, capFracOfMachinery: 0.12, label: 'steam_thermal' },
  { keys: ['oven', 'curing', 'baking', 'drying tunnel', 'stenter'], kgPerCompositeHour: 4, capFracOfMachinery: 0.1, label: 'thermal_finishing' },
  { keys: ['paint', 'coating', 'powder coat', 'spray booth'], kgPerCompositeHour: 2, capFracOfMachinery: 0.08, label: 'surface_coating' },
  { keys: ['welding', 'brazing', 'cutting oxy'], kgPerCompositeHour: 1, capFracOfMachinery: 0.05, label: 'metal_joining' },
  { keys: ['chemical bath', 'electroplat', 'anodiz', 'etching'], kgPerCompositeHour: 3, capFracOfMachinery: 0.09, label: 'wet_chemical_process' }
];

const roundTo = (value, decimals = 4) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const base = 10 ** decimals;
  return Math.round(numeric * base) / base;
};

const normalizeBlob = (parts) => String(parts.filter(Boolean).join(' ')).toLowerCase();

const extractStateToken = (msme = {}) => {
  const state = msme.contact?.address?.state || msme.contact?.address?.region || '';
  return String(state || '').toLowerCase().trim();
};

const resolveGridKgCo2PerKwh = (msme = {}) => {
  const blob = extractStateToken(msme);
  if (!blob) {
    return { kgCo2PerKwh: DEFAULT_GRID_KG_CO2_PER_KWH, matchedRegion: null, source: 'default_india_grid' };
  }
  const matched = Object.keys(REGION_GRID_KG_CO2_PER_KWH).find((token) => blob.includes(token));
  if (matched) {
    return {
      kgCo2PerKwh: REGION_GRID_KG_CO2_PER_KWH[matched],
      matchedRegion: matched,
      source: 'regional_grid_agent'
    };
  }
  return { kgCo2PerKwh: DEFAULT_GRID_KG_CO2_PER_KWH, matchedRegion: null, source: 'default_india_grid' };
};

const inferFuelTypeFromMachineryName = (machineryName = '', declaredFuel = 'electricity') => {
  const n = String(machineryName).toLowerCase();
  if (declaredFuel && declaredFuel !== 'electricity') {
    return { fuelType: declaredFuel, hintApplied: false };
  }
  if (/(dg\b|genset|diesel\s*gen|diesel\s*engine|diesel\s*motor)/i.test(n)) {
    return { fuelType: 'diesel', hintApplied: true };
  }
  if (/(boiler|furnace|burner|oil\s*fired)/i.test(n) && /diesel|hfo|furnace\s*oil/i.test(n)) {
    return { fuelType: 'diesel', hintApplied: true };
  }
  if (/\blpg\b|propane/i.test(n)) {
    return { fuelType: 'lpg', hintApplied: true };
  }
  if (/\bcng\b/i.test(n)) {
    return { fuelType: 'cng', hintApplied: true };
  }
  return { fuelType: 'electricity', hintApplied: false };
};

const scoreExtendedMaterial = (normalizedName) => {
  let best = null;
  EXTENDED_MATERIAL_KG_CO2_PER_KG.forEach((row) => {
    const hitCount = row.keys.filter((k) => normalizedName.includes(k)).length;
    if (hitCount > 0 && (!best || hitCount > best.hitCount)) {
      best = { ...row, hitCount };
    }
  });
  return best;
};

const resolveRawMaterialFactor = ({
  materialName = '',
  userFactor = 0,
  businessDomain = 'other',
  msme = {}
} = {}) => {
  const user = Number(userFactor);
  if (Number.isFinite(user) && user > 0) {
    return {
      emissionFactorKgCO2PerKg: user,
      source: 'user_override',
      confidence: 1,
      label: null,
      matchedKeywords: []
    };
  }

  const normalizedName = String(materialName).toLowerCase();
  const rag = verifiedKnowledgeRagService.classifyUnknownEntry({
    text: materialName,
    businessDomain,
    transactionType: 'purchase',
    parameterType: 'raw_material',
    candidateLocation: extractStateToken(msme)
  });

  if (rag?.subcategory && MASS_FACTOR_FROM_RAG_SUBCATEGORY[rag.subcategory]) {
    const v = MASS_FACTOR_FROM_RAG_SUBCATEGORY[rag.subcategory];
    return {
      emissionFactorKgCO2PerKg: v,
      source: 'verified_knowledge_rag',
      confidence: rag.confidence || 0.72,
      label: rag.normalizedLabel || rag.subcategory,
      matchedKeywords: rag.matchedKeywords || [],
      verifiedSource: rag.verifiedSource || null
    };
  }

  const extended = scoreExtendedMaterial(normalizedName);
  if (extended) {
    return {
      emissionFactorKgCO2PerKg: extended.value,
      source: 'agent_material_library',
      confidence: Math.min(0.9, 0.55 + extended.hitCount * 0.08),
      label: extended.label,
      matchedKeywords: extended.keys.filter((k) => normalizedName.includes(k)),
      verifiedSource: null
    };
  }

  const legacy = Object.entries(LEGACY_DEFAULT_MATERIAL_KEYS).find(([key]) => normalizedName.includes(key));
  if (legacy) {
    return {
      emissionFactorKgCO2PerKg: legacy[1],
      source: 'agent_keyword_default',
      confidence: 0.62,
      label: legacy[0],
      matchedKeywords: [legacy[0]],
      verifiedSource: null
    };
  }

  return {
    emissionFactorKgCO2PerKg: 1.8,
    source: 'agent_generic_default',
    confidence: 0.35,
    label: 'unknown_material',
    matchedKeywords: [],
    verifiedSource: null
  };
};

const resolveMachineryEmissionFactor = ({
  machineryName = '',
  declaredFuel = 'electricity',
  userCustomFactor = 0,
  gridKgCo2PerKwh = DEFAULT_GRID_KG_CO2_PER_KWH,
  businessDomain = 'other',
  msme = {}
} = {}) => {
  const custom = Number(userCustomFactor);
  if (Number.isFinite(custom) && custom > 0) {
    return {
      emissionFactor: custom,
      effectiveFuelType: String(declaredFuel || 'electricity').toLowerCase(),
      source: 'user_override',
      confidence: 1,
      fuelHintApplied: false,
      rag: null
    };
  }

  const { fuelType: inferredFuel, hintApplied } = inferFuelTypeFromMachineryName(machineryName, declaredFuel);
  let fuel = String(inferredFuel || 'electricity').toLowerCase();
  if (fuel === 'custom') {
    fuel = 'electricity';
  }

  const rag = verifiedKnowledgeRagService.classifyUnknownEntry({
    text: `${machineryName} ${fuel}`,
    businessDomain,
    transactionType: 'utility',
    parameterType: 'machinery',
    candidateLocation: extractStateToken(msme)
  });

  if (fuel === 'electricity') {
    const factor = roundTo(gridKgCo2PerKwh, 4);
    return {
      emissionFactor: factor,
      effectiveFuelType: fuel,
      source: hintApplied ? 'agent_name_fuel_hint_grid' : 'regional_grid_agent',
      confidence: hintApplied ? 0.72 : 0.68,
      fuelHintApplied: hintApplied,
      rag: rag || null
    };
  }

  const factor = MACHINERY_FUEL_FACTORS[fuel] ?? MACHINERY_FUEL_FACTORS.diesel;
  return {
    emissionFactor: factor,
    effectiveFuelType: fuel,
    source: rag ? 'agent_fuel_table_plus_rag' : 'agent_fuel_table',
    confidence: rag ? Math.min(0.88, (rag.confidence || 0.5) + 0.05) : 0.75,
    fuelHintApplied: hintApplied,
    rag: rag || null
  };
};

const estimateProcessAuxiliaryEmissionsKg = ({
  processName = '',
  processDescription = '',
  machineryEmissionsForProcess = 0,
  runHoursPerDay = 0
} = {}) => {
  const blob = normalizeBlob([processName, processDescription]);
  if (!blob || runHoursPerDay <= 0) {
    return { co2Kg: 0, matchedRules: [], source: 'none' };
  }

  let rawKg = 0;
  const matchedRules = [];
  PROCESS_AUXILIARY_RULES.forEach((rule) => {
    const hit = rule.keys.some((k) => blob.includes(k));
    if (hit) {
      const add = rule.kgPerCompositeHour * runHoursPerDay;
      rawKg += add;
      matchedRules.push(rule.label);
    }
  });

  const cap = Math.max(0, machineryEmissionsForProcess) * 0.18;
  const co2Kg = Math.min(rawKg, cap);
  return {
    co2Kg: roundTo(co2Kg, 3),
    matchedRules,
    source: matchedRules.length ? 'agent_process_intensity' : 'none'
  };
};

/**
 * Builds a reusable context for one workflow estimate call.
 */
const createEmissionFactorAgentContext = (msme = {}) => {
  const grid = resolveGridKgCo2PerKwh(msme);
  const businessDomain = String(msme.businessDomain || msme.business?.domain || 'other').toLowerCase();

  return {
    gridKgCo2PerKwh: grid.kgCo2PerKwh,
    gridMeta: grid,
    businessDomain,
    resolveRawMaterial: (materialName, userFactor) => resolveRawMaterialFactor({
      materialName,
      userFactor,
      businessDomain,
      msme
    }),
    resolveMachinery: (machineryName, declaredFuel, userCustom) => resolveMachineryEmissionFactor({
      machineryName,
      declaredFuel,
      userCustomFactor: userCustom,
      gridKgCo2PerKwh: grid.kgCo2PerKwh,
      businessDomain,
      msme
    }),
    estimateProcessAuxiliary: (processName, processDescription, machineryEmissionsForProcess, runHoursPerDay) => (
      estimateProcessAuxiliaryEmissionsKg({
        processName,
        processDescription,
        machineryEmissionsForProcess,
        runHoursPerDay
      })
    )
  };
};

module.exports = {
  createEmissionFactorAgentContext,
  resolveGridKgCo2PerKwh,
  resolveRawMaterialFactor,
  resolveMachineryEmissionFactor,
  estimateProcessAuxiliaryEmissionsKg,
  DEFAULT_GRID_KG_CO2_PER_KWH,
  MACHINERY_FUEL_FACTORS
};
