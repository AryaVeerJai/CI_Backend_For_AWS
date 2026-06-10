const carbonCalculationService = require('./carbonCalculationService');
const carbonCategoryTaxonomy = require('../../../shared/carbonCategoryTaxonomy');
const orchestrationManagerEventService = require('./orchestrationManagerEventService');
const { normalizeManufacturingProfile } = require('../utils/manufacturingProfile');

const MANUFACTURING_DETAILED_CATEGORIES = [
  {
    value: 'food_products_industry',
    label: 'A. Primary & Process Industries - Food Products Industry',
    examples: ['packaged food', 'dairy', 'spices', 'bakery', 'edible oils'],
    keywords: ['food products', 'packaged food', 'dairy', 'spices', 'bakery', 'edible oils']
  },
  {
    value: 'beverages_tobacco_products',
    label: 'A. Primary & Process Industries - Beverages & Tobacco Products',
    examples: ['soft drinks', 'alcohol', 'tobacco processing'],
    keywords: ['beverages', 'tobacco', 'soft drinks', 'alcohol']
  },
  {
    value: 'cotton_textiles',
    label: 'B. Textile & Apparel Industries - Cotton Textiles',
    examples: ['cotton yarn', 'cotton fabric'],
    keywords: ['cotton textiles', 'cotton yarn', 'cotton fabric']
  },
  {
    value: 'wool_silk_synthetic_fibre_textiles',
    label: 'B. Textile & Apparel Industries - Wool, Silk & Synthetic Fibre Textiles',
    examples: ['wool fabric', 'silk fabric', 'synthetic textiles'],
    keywords: ['wool', 'silk', 'synthetic fibre', 'synthetic textiles']
  },
  {
    value: 'jute_hemp_mesta_textiles',
    label: 'B. Textile & Apparel Industries - Jute, Hemp & Mesta Textiles',
    examples: ['jute bags', 'hemp textiles', 'mesta fibre'],
    keywords: ['jute', 'hemp', 'mesta']
  },
  {
    value: 'hosiery_garments',
    label: 'B. Textile & Apparel Industries - Hosiery & Garments',
    examples: ['readymade garments', 'knitwear'],
    keywords: ['hosiery', 'garments', 'readymade', 'knitwear']
  },
  {
    value: 'leather_leather_products',
    label: 'C. Leather & Consumer Goods - Leather & Leather Products',
    examples: ['footwear', 'bags', 'accessories'],
    keywords: ['leather', 'footwear', 'bags', 'accessories']
  },
  {
    value: 'chemical_chemical_products',
    label: 'D. Chemical & Allied Industries - Chemical & Chemical Products',
    examples: ['paints', 'dyes', 'fertilizers', 'specialty chemicals'],
    keywords: ['chemical', 'paint', 'dyes', 'fertilizers', 'specialty chemicals']
  },
  {
    value: 'basic_metal_industries',
    label: 'E. Engineering & Metal Industries - Basic Metal Industries',
    examples: ['steel processing', 'foundries'],
    keywords: ['basic metal', 'steel processing', 'foundries']
  },
  {
    value: 'metal_products',
    label: 'E. Engineering & Metal Industries - Metal Products',
    examples: ['fabrication', 'tools', 'structures'],
    keywords: ['metal products', 'fabrication', 'tools', 'structures']
  },
  {
    value: 'machinery_parts_non_electrical',
    label: 'F. Machinery & Equipment - Machinery & Parts (Non-Electrical)',
    examples: ['industrial machinery', 'mechanical parts'],
    keywords: ['machinery', 'non electrical', 'mechanical parts']
  },
  {
    value: 'electrical_machinery_parts',
    label: 'F. Machinery & Equipment - Electrical Machinery & Parts',
    examples: ['motors', 'transformers', 'wiring equipment'],
    keywords: ['electrical machinery', 'motors', 'transformers', 'wiring equipment']
  },
  {
    value: 'rubber_plastic_products',
    label: 'G. Plastics, Rubber & Polymers - Rubber & Plastic Products',
    examples: ['packaging', 'molded goods'],
    keywords: ['rubber', 'plastic products', 'polymers', 'molded goods']
  },
  {
    value: 'non_metallic_mineral_products',
    label: 'H. Non-Metallic Mineral Industries - Non-Metallic Mineral Products',
    examples: ['cement items', 'ceramics', 'glass'],
    keywords: ['non metallic mineral', 'cement', 'ceramics', 'glass']
  },
  {
    value: 'paper_products_printing',
    label: 'I. Paper & Printing - Paper Products & Printing',
    examples: ['packaging paper', 'notebooks', 'printing presses'],
    keywords: ['paper products', 'printing', 'notebooks', 'packaging paper']
  },
  {
    value: 'transport_equipment_parts',
    label: 'J. Transport Equipment - Transport Equipment & Parts',
    examples: ['auto components', 'bicycle parts'],
    keywords: ['transport equipment', 'auto components', 'bicycle parts']
  },
  {
    value: 'wood_products_furniture',
    label: 'K. Miscellaneous Manufacturing - Wood Products & Furniture',
    examples: ['wood furniture', 'plywood products'],
    keywords: ['wood products', 'furniture', 'plywood']
  },
  {
    value: 'handicrafts_artisanal_products',
    label: 'K. Miscellaneous Manufacturing - Handicrafts & Artisanal Products',
    examples: ['artisanal crafts', 'handmade products'],
    keywords: ['handicrafts', 'artisanal', 'handmade']
  },
  {
    value: 'coir_ceramic_glass_products',
    label: 'K. Miscellaneous Manufacturing - Coir, Ceramic & Glass Products',
    examples: ['coir products', 'ceramic products', 'glass products'],
    keywords: ['coir', 'ceramic', 'glass products']
  },
  {
    value: 'miscellaneous_manufacturing_industries',
    label: 'K. Miscellaneous Manufacturing - Miscellaneous Manufacturing Industries',
    examples: ['toys', 'sports goods', 'jewellery'],
    keywords: ['miscellaneous manufacturing', 'toys', 'sports goods', 'jewellery']
  }
];

const SERVICES_DETAILED_CATEGORIES = [
  {
    value: 'wholesale_trade_services',
    label: 'A. Trade & Commerce - Wholesale Trade Services',
    examples: ['distribution', 'stockists', 'B2B trade'],
    keywords: ['wholesale', 'distribution', 'stockists', 'b2b']
  },
  {
    value: 'retail_trade_services',
    label: 'A. Trade & Commerce - Retail Trade Services',
    examples: ['shops', 'e-commerce sellers'],
    keywords: ['retail', 'shops', 'e-commerce', 'ecommerce']
  },
  {
    value: 'transport_services',
    label: 'B. Transport & Logistics - Transport Services',
    examples: ['goods transport', 'passenger transport'],
    keywords: ['transport services', 'goods transport', 'passenger transport']
  },
  {
    value: 'storage_warehousing',
    label: 'B. Transport & Logistics - Storage & Warehousing',
    examples: ['cold storage', 'logistics parks'],
    keywords: ['storage', 'warehousing', 'cold storage', 'logistics parks']
  },
  {
    value: 'hotels_restaurants',
    label: 'C. Hospitality & Tourism - Hotels & Restaurants',
    examples: ['hotels', 'restaurants'],
    keywords: ['hotels', 'restaurants', 'hospitality']
  },
  {
    value: 'tourism_travel_services',
    label: 'C. Hospitality & Tourism - Tourism & Travel Services',
    examples: ['travel agencies', 'tour operators'],
    keywords: ['tourism', 'travel services', 'travel agencies', 'tour operators']
  },
  {
    value: 'it_services',
    label: 'D. IT & Communication - IT Services',
    examples: ['software development', 'saas', 'cloud services'],
    keywords: ['it services', 'software', 'saas', 'cloud']
  },
  {
    value: 'telecommunication_services',
    label: 'D. IT & Communication - Telecommunication Services',
    examples: ['internet providers', 'telecom support'],
    keywords: ['telecommunication', 'internet providers', 'telecom support']
  },
  {
    value: 'financial_services_non_banking',
    label: 'E. Financial & Business Services - Financial Services (Non-banking)',
    examples: ['fintech', 'insurance intermediaries'],
    keywords: ['financial services', 'non-banking', 'fintech', 'insurance intermediaries']
  },
  {
    value: 'professional_business_services',
    label: 'E. Financial & Business Services - Professional & Business Services',
    examples: ['consulting', 'legal', 'accounting'],
    keywords: ['professional services', 'consulting', 'legal', 'accounting']
  },
  {
    value: 'education_services',
    label: 'F. Education & Skill Development - Education Services',
    examples: ['schools', 'coaching institutes'],
    keywords: ['education services', 'schools', 'coaching institutes']
  },
  {
    value: 'training_skill_development',
    label: 'F. Education & Skill Development - Training & Skill Development',
    examples: ['vocational training', 'upskilling'],
    keywords: ['training', 'skill development', 'vocational', 'upskilling']
  },
  {
    value: 'healthcare_services',
    label: 'G. Healthcare & Social Services - Healthcare Services',
    examples: ['clinics', 'diagnostics', 'telemedicine'],
    keywords: ['healthcare services', 'clinics', 'diagnostics', 'telemedicine']
  },
  {
    value: 'social_community_services',
    label: 'G. Healthcare & Social Services - Social & Community Services',
    examples: ['ngos', 'welfare organizations'],
    keywords: ['social services', 'community services', 'ngo', 'welfare']
  },
  {
    value: 'real_estate_services',
    label: 'H. Real Estate & Infrastructure Support - Real Estate Services',
    examples: ['property management', 'brokerage'],
    keywords: ['real estate', 'property management', 'brokerage']
  },
  {
    value: 'infrastructure_support_services',
    label: 'H. Real Estate & Infrastructure Support - Infrastructure Support Services',
    examples: ['facility management', 'maintenance'],
    keywords: ['infrastructure support', 'facility management', 'maintenance']
  },
  {
    value: 'personal_services',
    label: 'I. Personal & Other Services - Personal Services',
    examples: ['salons', 'repair services'],
    keywords: ['personal services', 'salons', 'repair services']
  },
  {
    value: 'entertainment_recreation',
    label: 'I. Personal & Other Services - Entertainment & Recreation',
    examples: ['media', 'gaming', 'event management'],
    keywords: ['entertainment', 'recreation', 'media', 'gaming', 'event management']
  }
];

const MANUFACTURING_TRANSACTION_TEMPLATES = [
  { category: 'energy', subcategory: 'grid', amount: 12500 },
  { category: 'raw_materials', subcategory: 'steel', amount: 18500 },
  { category: 'transportation', subcategory: 'diesel', amount: 7200 },
  { category: 'waste_management', subcategory: 'solid', amount: 3800 },
  { category: 'maintenance', subcategory: 'general', amount: 4200 }
];

const SERVICES_TRANSACTION_TEMPLATES = [
  { category: 'energy', subcategory: 'grid', amount: 7800 },
  { category: 'transportation', subcategory: 'diesel', amount: 4200 },
  { category: 'utilities', subcategory: 'general', amount: 3600 },
  { category: 'waste_management', subcategory: 'solid', amount: 1600 },
  { category: 'other', subcategory: 'general', amount: 3000 }
];

const ALLOWED_TRANSACTION_CATEGORIES = carbonCategoryTaxonomy.TRANSACTION_CATEGORY_SET;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ACCURACY_AGENT_WEIGHTS = {
  textClassifierAgent: 0.28,
  subcategoryResolverAgent: 0.22,
  emissionFactorVerifierAgent: 0.3,
  anomalyReconciliationAgent: 0.2
};

const roundTo = (value, decimals = 2) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const factor = 10 ** decimals;
  return Math.round(parsed * factor) / factor;
};

const normalizeText = (value) => String(value || '').toLowerCase();

class GranularCategoryEmissionsService {
  getDetailedCategoryCatalog() {
    return {
      manufacturing: MANUFACTURING_DETAILED_CATEGORIES,
      services: SERVICES_DETAILED_CATEGORIES
    };
  }

  normalizeTransactionCategory(value) {
    const category = String(value || '').toLowerCase();
    if (ALLOWED_TRANSACTION_CATEGORIES.has(category)) {
      return category;
    }
    return 'other';
  }

  inferTransactionSubcategory(category, transaction = {}) {
    const explicitSubcategory = String(transaction.subcategory || '').trim().toLowerCase();
    if (explicitSubcategory) return explicitSubcategory;

    const text = normalizeText(transaction.description);
    const subcategoryRules = {
      utilities: [
        { subcategory: 'electricity_grid', keywords: ['electricity', 'power bill', 'kwh'] },
        { subcategory: 'water_supply', keywords: ['water', 'stp', 'etp'] },
        { subcategory: 'telecom_internet', keywords: ['internet', 'broadband', 'telecom'] }
      ],
      transportation: [
        { subcategory: 'freight_logistics', keywords: ['freight', 'logistics', 'shipment', 'courier'] },
        { subcategory: 'fuel_diesel', keywords: ['diesel', 'hsd'] },
        { subcategory: 'fuel_petrol', keywords: ['petrol', 'gasoline'] }
      ],
      raw_materials: [
        { subcategory: 'metals', keywords: ['steel', 'iron', 'aluminium', 'copper'] },
        { subcategory: 'textiles_inputs', keywords: ['fabric', 'yarn', 'thread', 'cotton'] },
        { subcategory: 'chemical_inputs', keywords: ['chemical', 'resin', 'solvent', 'polymer'] }
      ],
      energy: [
        { subcategory: 'fossil_fuel', keywords: ['coal', 'lpg', 'cng', 'furnace oil', 'gas'] }
      ],
      waste_management: [
        { subcategory: 'recycling_disposal', keywords: ['waste', 'recycling', 'disposal', 'scrap'] }
      ],
      maintenance: [
        { subcategory: 'amc_service', keywords: ['maintenance', 'amc', 'repair', 'service'] }
      ],
      equipment: [
        { subcategory: 'machinery_capex', keywords: ['machine', 'equipment', 'compressor', 'boiler'] }
      ]
    };

    const rules = subcategoryRules[category] || [];
    const matched = rules.find((rule) => rule.keywords.some((keyword) => text.includes(keyword)));
    return matched ? matched.subcategory : 'general';
  }

  buildAccuracyAgentAssessment(transaction = {}, footprint = {}) {
    const description = normalizeText(transaction.description);
    const category = this.normalizeTransactionCategory(transaction.category);
    const inferredSubcategory = this.inferTransactionSubcategory(category, transaction);
    const resolvedSubcategory = transaction.subcategory || inferredSubcategory;
    const emission = toNumber(footprint.co2Emissions, 0);
    const locationWeightage = toNumber(footprint.locationWeightage, 1);
    const profileFactor = toNumber(footprint.manufacturingProfileFactor, 1);

    const agentScores = {
      textClassifierAgent: roundTo(description.length > 8 ? 0.92 : 0.68, 4),
      subcategoryResolverAgent: roundTo(
        resolvedSubcategory !== 'general' ? 0.91 : (description ? 0.72 : 0.61),
        4
      ),
      emissionFactorVerifierAgent: roundTo(emission > 0 ? 0.93 : 0.66, 4),
      anomalyReconciliationAgent: roundTo(
        locationWeightage > 0 && profileFactor > 0 ? 0.89 : 0.63,
        4
      )
    };

    const weightedConfidence = roundTo(
      Object.entries(ACCURACY_AGENT_WEIGHTS).reduce(
        (sum, [agentName, weight]) => sum + (toNumber(agentScores[agentName], 0) * weight),
        0
      ),
      4
    );

    return {
      resolvedCategory: category,
      resolvedSubcategory,
      agentScores,
      weightedConfidence
    };
  }

  buildFineDetailSignals(msmeData = {}, normalizedProfile = {}) {
    const profileCompleteness = carbonCalculationService.calculateProfileCompleteness(normalizedProfile);
    const employeeCount = toNumber(
      normalizedProfile.numberOfEmployees,
      toNumber(msmeData?.business?.numberOfEmployees, 0)
    );
    const turnover = toNumber(msmeData?.business?.annualTurnover, 0);
    const operationalDays = toNumber(normalizedProfile.operationalDaysPerYear, 300);
    const plantAreaSqft = toNumber(normalizedProfile.plantAreaSqft, 0);

    return {
      profileCompleteness,
      employeeCount,
      annualTurnover: turnover,
      operationalDaysPerYear: operationalDays,
      plantAreaSqft,
      energySource: normalizedProfile.primaryEnergySource || null,
      fuelMix: normalizedProfile.mainFuelsUsed || [],
      logisticsMode: normalizedProfile.logisticsMode || null,
      supplyChainType: normalizedProfile.supplyChainType || null,
      certifications: normalizedProfile.certifications || [],
      esgMaturityLevel: normalizedProfile.esgMaturityLevel || null,
      digitalizationLevel: normalizedProfile.digitalizationLevel || null
    };
  }

  buildProfileScale(msmeData = {}, normalizedProfile = {}) {
    const employeeCount = toNumber(
      normalizedProfile.numberOfEmployees,
      toNumber(msmeData?.business?.numberOfEmployees, 0)
    );
    const turnover = toNumber(msmeData?.business?.annualTurnover, 0);
    const operationalDays = toNumber(normalizedProfile.operationalDaysPerYear, 300);
    const plantAreaSqft = toNumber(normalizedProfile.plantAreaSqft, 0);

    const employeeFactor = employeeCount > 0 ? Math.min(2.5, Math.max(0.7, employeeCount / 80)) : 1;
    const turnoverFactor = turnover > 0 ? Math.min(3, Math.max(0.7, turnover / 10000000)) : 1;
    const operationalFactor = Math.min(1.3, Math.max(0.75, operationalDays / 300));
    const plantFactor = plantAreaSqft > 0 ? Math.min(1.8, Math.max(0.8, plantAreaSqft / 25000)) : 1;

    return roundTo(
      (employeeFactor * 0.35) +
      (turnoverFactor * 0.3) +
      (operationalFactor * 0.2) +
      (plantFactor * 0.15),
      4
    );
  }

  enrichTransaction(tx = {}, msmeData = {}, normalizedProfile = {}, detail = {}) {
    const locationState = tx?.location?.state || msmeData?.contact?.address?.state || normalizedProfile.locationState;
    const locationCity = tx?.location?.city || msmeData?.contact?.address?.city || normalizedProfile.locationCity;
    const category = this.normalizeTransactionCategory(tx.category);
    const amount = Math.max(0, toNumber(tx.amount, 0));

    const subcategory = this.inferTransactionSubcategory(category, tx);

    return {
      ...tx,
      category,
      amount,
      subcategory,
      description: tx.description || `Granular emissions assessment for ${detail.label}`,
      source: tx.source || 'api',
      sourceId: tx.sourceId || `granular_${detail.value}_${Date.now()}`,
      transactionType: tx.transactionType || 'expense',
      industry: tx.industry || msmeData.industry,
      businessDomain: tx.businessDomain || msmeData.businessDomain,
      sustainability: tx.sustainability || { isGreen: false, greenScore: 0 },
      location: {
        ...(tx.location || {}),
        city: locationCity || null,
        state: locationState || null,
        country: tx?.location?.country || msmeData?.contact?.address?.country || normalizedProfile.locationCountry || 'India'
      },
      manufacturingProfile: {
        ...normalizedProfile,
        ...(tx.manufacturingProfile || {}),
        industrySector: detail.value
      },
      metadata: {
        ...(tx.metadata || {}),
        granularCategory: detail.value,
        granularCategoryLabel: detail.label
      }
    };
  }

  buildSyntheticTransactionsForDetail({
    detail,
    msmeData = {},
    normalizedProfile = {},
    profileScale = 1,
    lookbackStartDate
  }) {
    const templates = detail.type === 'services'
      ? SERVICES_TRANSACTION_TEMPLATES
      : MANUFACTURING_TRANSACTION_TEMPLATES;

    const operationalDays = Math.max(1, toNumber(normalizedProfile.operationalDaysPerYear, 300));
    const operationalScale = Math.min(1.3, Math.max(0.75, operationalDays / 300));

    return templates.map((template, index) => {
      const sequenceFactor = 1 + (index * 0.06);
      const amount = roundTo(template.amount * profileScale * operationalScale * sequenceFactor, 2);
      const syntheticDate = new Date(
        lookbackStartDate.getTime() + (index * 24 * 60 * 60 * 1000)
      );

      return this.enrichTransaction({
        category: template.category,
        subcategory: template.subcategory,
        amount,
        date: syntheticDate,
        transactionType: template.category === 'raw_materials' ? 'purchase' : 'expense',
        description: `${detail.label} - synthetic baseline (${detail.examples.join(', ')})`,
        metadata: {
          synthetic: true,
          syntheticReason: 'granular_category_backfill'
        }
      }, msmeData, normalizedProfile, detail);
    });
  }

  selectHistoricalTransactionsForDetail(detail = {}, transactions = []) {
    const keywords = detail.keywords || [];
    return transactions.filter((tx) => {
      const industrySector = String(
        tx?.manufacturingProfile?.industrySector ||
        tx?.industrySector ||
        tx?.metadata?.granularCategory ||
        ''
      ).toLowerCase();

      if (industrySector && industrySector === detail.value) {
        return true;
      }

      const description = String(tx?.description || '').toLowerCase();
      return keywords.some((keyword) => description.includes(keyword));
    });
  }

  async calculateDetailEmissionSummary(transactions = [], runtimeContext = {}) {
    const breakdownByCategory = {};
    let totalCO2Emissions = 0;
    let profileFactorTotal = 0;
    let locationFactorTotal = 0;
    let categoryConfidenceTotal = 0;
    let subcategoryConfidenceTotal = 0;
    let weightedAgentConfidenceTotal = 0;
    let dataPoints = 0;

    for (const tx of transactions) {
      const footprint = await carbonCalculationService.calculateTransactionCarbonFootprintForAgent(
        tx,
        runtimeContext
      );

      const category = this.normalizeTransactionCategory(tx.category);
      const assessment = this.buildAccuracyAgentAssessment(tx, footprint);
      const emissions = toNumber(footprint.co2Emissions, 0);
      totalCO2Emissions += emissions;
      profileFactorTotal += toNumber(footprint.manufacturingProfileFactor, 1);
      locationFactorTotal += toNumber(footprint.locationWeightage, 1);
      categoryConfidenceTotal += toNumber(assessment.agentScores.textClassifierAgent, 0);
      subcategoryConfidenceTotal += toNumber(assessment.agentScores.subcategoryResolverAgent, 0);
      weightedAgentConfidenceTotal += toNumber(assessment.weightedConfidence, 0);
      dataPoints += 1;

      if (!breakdownByCategory[category]) {
        breakdownByCategory[category] = {
          emissions: 0,
          transactionCount: 0,
          breakdownBySubcategory: {}
        };
      }
      breakdownByCategory[category].emissions += emissions;
      breakdownByCategory[category].transactionCount += 1;

      const resolvedSubcategory = assessment.resolvedSubcategory || 'general';
      if (!breakdownByCategory[category].breakdownBySubcategory[resolvedSubcategory]) {
        breakdownByCategory[category].breakdownBySubcategory[resolvedSubcategory] = {
          emissions: 0,
          transactionCount: 0
        };
      }
      breakdownByCategory[category].breakdownBySubcategory[resolvedSubcategory].emissions += emissions;
      breakdownByCategory[category].breakdownBySubcategory[resolvedSubcategory].transactionCount += 1;
    }

    Object.keys(breakdownByCategory).forEach((key) => {
      breakdownByCategory[key].emissions = roundTo(breakdownByCategory[key].emissions, 2);
      Object.keys(breakdownByCategory[key].breakdownBySubcategory).forEach((subcategoryKey) => {
        breakdownByCategory[key].breakdownBySubcategory[subcategoryKey].emissions = roundTo(
          breakdownByCategory[key].breakdownBySubcategory[subcategoryKey].emissions,
          2
        );
      });
    });

    return {
      totalCO2Emissions: roundTo(totalCO2Emissions, 2),
      breakdownByCategory,
      precisionSignals: {
        averageManufacturingProfileFactor: dataPoints > 0
          ? roundTo(profileFactorTotal / dataPoints, 4)
          : 1,
        averageLocationFactor: dataPoints > 0
          ? roundTo(locationFactorTotal / dataPoints, 4)
          : 1,
        categoryClassificationConfidence: dataPoints > 0
          ? roundTo(categoryConfidenceTotal / dataPoints, 4)
          : 0,
        subcategoryClassificationConfidence: dataPoints > 0
          ? roundTo(subcategoryConfidenceTotal / dataPoints, 4)
          : 0,
        weightedAgentAccuracyScore: dataPoints > 0
          ? roundTo(weightedAgentConfidenceTotal / dataPoints, 4)
          : 0,
        contributingAgents: Object.keys(ACCURACY_AGENT_WEIGHTS)
      }
    };
  }

  async calculateGranularCategoryEmissions({
    msmeId,
    msmeData,
    transactions = [],
    options = {}
  }) {
    const includeOrchestration = options.includeOrchestration !== false;
    const includeHistorical = options.includeHistorical !== false;
    const enableSyntheticBackfill = options.enableSyntheticBackfill !== false;
    const includeSyntheticTransactions = options.includeSyntheticTransactions === true;
    const lookbackDays = Math.max(30, toNumber(options.lookbackDays, 90));
    const lookbackStartDate = options.startDate
      ? new Date(options.startDate)
      : new Date(Date.now() - (lookbackDays * 24 * 60 * 60 * 1000));

    const normalizedProfile = normalizeManufacturingProfile(
      msmeData?.manufacturingProfile || {}
    );
    const profileScale = this.buildProfileScale(msmeData, normalizedProfile);
    const fineDetailSignals = this.buildFineDetailSignals(msmeData, normalizedProfile);
    const runtimeContext = { msmeData: { ...msmeData, manufacturingProfile: normalizedProfile } };

    const computeForDetail = async (detail) => {
      const historicalCandidates = includeHistorical
        ? this.selectHistoricalTransactionsForDetail(detail, transactions)
        : [];
      const historicalTransactions = historicalCandidates
        .map((tx) => this.enrichTransaction(tx, msmeData, normalizedProfile, detail));

      let workingTransactions = [...historicalTransactions];
      let syntheticTransactions = [];
      if (enableSyntheticBackfill && workingTransactions.length === 0) {
        syntheticTransactions = this.buildSyntheticTransactionsForDetail({
          detail,
          msmeData,
          normalizedProfile,
          profileScale,
          lookbackStartDate
        });
        workingTransactions = syntheticTransactions;
      }

      const emissions = await this.calculateDetailEmissionSummary(workingTransactions, runtimeContext);

      return {
        ...detail,
        totalCO2Emissions: emissions.totalCO2Emissions,
        breakdownByCategory: emissions.breakdownByCategory,
        precisionSignals: emissions.precisionSignals,
        transactionCount: workingTransactions.length,
        historicalTransactionCount: historicalTransactions.length,
        syntheticTransactionCount: syntheticTransactions.length,
        dataCoverage: workingTransactions.length > 0
          ? (historicalTransactions.length > 0 ? 'historical' : 'synthetic')
          : 'missing',
        _transactions: workingTransactions
      };
    };

    const manufacturingResults = await Promise.all(
      MANUFACTURING_DETAILED_CATEGORIES.map((detail) =>
        computeForDetail({ ...detail, type: 'manufacturing' })
      )
    );

    const servicesResults = await Promise.all(
      SERVICES_DETAILED_CATEGORIES.map((detail) =>
        computeForDetail({ ...detail, type: 'services' })
      )
    );

    const orchestrationTransactions = [...manufacturingResults, ...servicesResults]
      .flatMap((item) => item._transactions)
      .map((tx, index) => ({
        ...tx,
        sourceId: tx.sourceId || `granular_orch_${index + 1}`
      }));

    let orchestrationResult = null;
    let orchestrationWarning = null;
    if (includeOrchestration) {
      try {
        orchestrationResult = await orchestrationManagerEventService.triggerOrchestration({
          msmeId,
          msmeData,
          transactions: orchestrationTransactions,
          behaviorOverrides: {},
          contextOverrides: {
            manufacturingProfile: normalizedProfile,
            detailedCategoryComputation: {
              includeHistorical,
              enableSyntheticBackfill,
              lookbackDays
            },
            orchestrationOptions: {
              tuning: {
                anomalySensitivity: 'high',
                optimizationDepth: 'deep',
                complianceStrictness: 'strict'
              }
            }
          },
          triggerSource: 'granular_category_assessment'
        });
      } catch (error) {
        orchestrationWarning = error.message;
      }
    }

    const cleanResults = (items) => items.map(({ _transactions, ...rest }) => rest);
    const manufacturing = cleanResults(manufacturingResults);
    const services = cleanResults(servicesResults);

    const manufacturingTotal = roundTo(
      manufacturing.reduce((sum, item) => sum + toNumber(item.totalCO2Emissions, 0), 0),
      2
    );
    const servicesTotal = roundTo(
      services.reduce((sum, item) => sum + toNumber(item.totalCO2Emissions, 0), 0),
      2
    );

    const simulationTransactions = includeSyntheticTransactions
      ? [...manufacturingResults, ...servicesResults]
        .flatMap((item) => item._transactions.map((tx) => ({
          categoryDetail: item.value,
          categoryDetailLabel: item.label,
          categoryType: item.type,
          dataCoverage: item.dataCoverage,
          transaction: tx
        })))
      : undefined;

    return {
      generatedAt: new Date().toISOString(),
      msme: {
        id: msmeId?.toString?.() || msmeId,
        companyName: msmeData?.companyName || null,
        industry: msmeData?.industry || null,
        businessDomain: msmeData?.businessDomain || null
      },
      fineDetailSignals,
      settings: {
        includeHistorical,
        enableSyntheticBackfill,
        lookbackDays
      },
      categoryCatalog: this.getDetailedCategoryCatalog(),
      totals: {
        manufacturingCO2Emissions: manufacturingTotal,
        servicesCO2Emissions: servicesTotal,
        overallCO2Emissions: roundTo(manufacturingTotal + servicesTotal, 2),
        categoryCount: manufacturing.length + services.length
      },
      detailedResults: {
        manufacturing,
        services
      },
      simulationTransactions,
      orchestration: {
        orchestrationId: orchestrationResult?.orchestrationId || null,
        warnings: [
          ...((orchestrationResult?.warnings || []).map((warning) => warning.message || warning)),
          ...(orchestrationWarning ? [orchestrationWarning] : [])
        ],
        plan: orchestrationResult?.orchestrationPlan || null,
        emissionsSummary: orchestrationResult?.emissionsSummary || null,
        valueChainReport: orchestrationResult?.valueChainReport || null,
        agentOutputs: orchestrationResult?.agentOutputs || null
      }
    };
  }
}

module.exports = new GranularCategoryEmissionsService();
