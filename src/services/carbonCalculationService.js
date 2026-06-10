const { getSectorModel } = require('./sectorModelRegistry');
const logger = require('../utils/logger');
const getFuelPriceService = () => require('./fuelPriceService');
const { normalizeManufacturingProfile } = require('../utils/manufacturingProfile');
const verifiedKnowledgeRagService = require('./verifiedKnowledgeRagService');
const CARBON_SHARED = require('../../../shared/carbonEmissionDefaults.json');
const carbonCategoryTaxonomy = require('../../../shared/carbonCategoryTaxonomy');
const carbonScoreCalculation = require('../../../shared/carbonScoreCalculation');
const carbonRating = require('../../../shared/carbonRating');
const carbonEmissionAnalytics = require('../../../shared/carbonEmissionAnalytics');
const {
  getActivityEmissionFactors,
  getIndustryFactors,
  getDomainFactors,
  getRegionalGridFactors
} = require('../../../shared/emissionFactorRegistry');

const MATERIAL_KEYWORD_MAP = [
  { type: 'plastic', keywords: ['plastic', 'polymer', 'granule', 'resin', 'pvc', 'moulding', 'colorant'] },
  { type: 'paper', keywords: ['paper', 'packaging', 'cardboard', 'label', 'bottle'] },
  { type: 'concrete', keywords: ['cement', 'concrete'] },
  { type: 'aluminum', keywords: ['aluminum', 'aluminium'] },
  { type: 'wood', keywords: ['wood', 'plywood', 'laminate', 'timber', 'furniture'] },
  { type: 'glass', keywords: ['glass'] },
  { type: 'steel', keywords: ['steel', 'iron', 'welding', 'bearing', 'shaft', 'gear', 'casting', 'metal', 'tooling'] }
];

const REVENUE_TRANSACTION_TYPES = new Set([
  'sale',
  'sales',
  'revenue',
  'income',
  'payment_received',
  'customer_payment'
]);
const ghgGovernance = require('../../../shared/ghgInventoryGovernance');
const governanceService = require('./ghgInventoryGovernanceService');
const { normalizeGhgOperationalBoundary, normalizeGhgOrganizationalBoundary } = require('../utils/ghgBoundaryFields');
const { buildInventoryOrganizationalBoundary } = require('../../../shared/ghgBoundaryCalculation');
const { STATE_REGION_MAP } = require('../constants/indianRegions');
const { resolveZedCertificationLevel } = require('../../../shared/zedCertification');
const { resolveTaxableAmountForCarbon } = require('../../../shared/taxableAmountPolicy');

class CarbonCalculationService {
  constructor() {
    this.emissionFactors = getActivityEmissionFactors();
    this.industryFactors = getIndustryFactors();
    this.domainFactors = getDomainFactors();
    this.regionalGridFactors = getRegionalGridFactors();
    this.reportingModes = CARBON_SHARED.reportingModes || {};
    this.defaultReportingMode = CARBON_SHARED.defaultReportingMode || 'compliance';
    this.feraModeling = CARBON_SHARED.feraModeling || {};
    this.gstStripping = CARBON_SHARED.gstStripping || {};

    // Enhanced ESG parameters
    this.esgParameters = {
      // Location-based emission factors (kg CO2 per unit)
      locationFactors: {
        'north-india': { electricity: 0.85, transport: 1.1 },
        'south-india': { electricity: 0.75, transport: 1.0 },
        'east-india': { electricity: 0.90, transport: 1.2 },
        'west-india': { electricity: 0.80, transport: 1.05 },
        'northeast-india': { electricity: 0.70, transport: 1.3 }
      },

      // Temporal factors (seasonal variations)
      temporalFactors: {
        summer: { cooling: 1.3, heating: 0.7 },
        winter: { cooling: 0.7, heating: 1.4 },
        monsoon: { transport: 1.2, energy: 1.1 },
        dry: { energy: 0.9, transport: 0.95 }
      },

      // Company size factors
      sizeFactors: {
        micro: { efficiency: 0.8, scale: 1.2 },
        small: { efficiency: 0.9, scale: 1.1 },
        medium: { efficiency: 1.0, scale: 1.0 },
        large: { efficiency: 1.1, scale: 0.9 },
        enterprise: { efficiency: 1.2, scale: 0.8 }
      },

      // Technology factors
      technologyFactors: {
        traditional: 1.2,
        modern: 1.0,
        advanced: 0.8,
        cutting_edge: 0.6
      },

      // Scope 4 avoided emissions factors
      avoidedEmissionFactors: {
        renewableEnergy: {
          solar: 0.8, // kg CO2 per kWh avoided
          wind: 0.7,
          hydro: 0.6,
          biomass: 0.9
        },
        energyEfficiency: {
          ledLighting: 0.1, // kg CO2 per kWh saved
          efficientMotors: 0.15,
          insulation: 0.2,
          smartControls: 0.12
        },
        wasteReduction: {
          recycling: 0.5, // kg CO2 per kg waste avoided
          composting: 0.3,
          wasteToEnergy: 0.4
        },
        sustainableTransport: {
          electricVehicles: 0.3, // kg CO2 per km avoided
          publicTransport: 0.6,
          cycling: 0.1,
          walking: 0.05
        }
      }
    };

    // Current Indian market prices (Rs per unit) for converting transaction amounts
    this.unitPrices = {
      fuel: {
        diesel: 90,      // Rs per liter
        petrol: 103,     // Rs per liter
        lpg: 75,         // Rs per kg (~900/12kg cylinder)
        cng: 76,         // Rs per kg
        coal: 15         // Rs per kg (bulk industrial estimate)
      },
      electricity: {
        grid: 8,         // Rs per kWh (commercial avg)
        renewable: 5,    // Rs per kWh
        mixed: 7         // Rs per kWh
      },
      water: 0.05,       // Rs per liter
      materials: {
        steel: 70,       // Rs per kg
        aluminum: 230,   // Rs per kg
        plastic: 120,    // Rs per kg
        paper: 40,       // Rs per kg
        glass: 25,       // Rs per kg
        wood: 30,        // Rs per kg
        concrete: 8      // Rs per kg
      },
      waste: {
        solid: 3,        // Rs per kg (disposal cost)
        hazardous: 25,   // Rs per kg
        recycling: 5     // Rs per kg
      },
      equipment: 500,    // Rs per kg (avg equipment cost proxy)
      maintenance: 200   // Rs per service unit (avg maintenance cost proxy)
    };

    this.defaultFuelPrices = { ...this.unitPrices.fuel };

    this.manufacturingSectorComplianceProfiles = {
      steel_and_metals: {
        sector: 'Steel & Metals',
        complianceLevel: 'high',
        complianceLabel: '🔴 High',
        sustainowPriority: 5,
        sustainowPriorityLabel: '⭐⭐⭐⭐⭐'
      },
      cement_and_materials: {
        sector: 'Cement & Materials',
        complianceLevel: 'high',
        complianceLabel: '🔴 High',
        sustainowPriority: 5,
        sustainowPriorityLabel: '⭐⭐⭐⭐⭐'
      },
      chemicals: {
        sector: 'Chemicals',
        complianceLevel: 'high',
        complianceLabel: '🔴 High',
        sustainowPriority: 4,
        sustainowPriorityLabel: '⭐⭐⭐⭐'
      },
      textiles_wet: {
        sector: 'Textiles (wet)',
        complianceLevel: 'high',
        complianceLabel: '🔴 High',
        sustainowPriority: 4,
        sustainowPriorityLabel: '⭐⭐⭐⭐'
      },
      engineering_msmes: {
        sector: 'Engineering MSMEs',
        complianceLevel: 'medium',
        complianceLabel: '🟠 Medium',
        sustainowPriority: 5,
        sustainowPriorityLabel: '⭐⭐⭐⭐⭐'
      },
      food_processing: {
        sector: 'Food processing',
        complianceLevel: 'medium',
        complianceLabel: '🟠 Medium',
        sustainowPriority: 3,
        sustainowPriorityLabel: '⭐⭐⭐'
      },
      plastics: {
        sector: 'Plastics',
        complianceLevel: 'medium',
        complianceLabel: '🟠 Medium',
        sustainowPriority: 3,
        sustainowPriorityLabel: '⭐⭐⭐'
      },
      electronics: {
        sector: 'Electronics',
        complianceLevel: 'low',
        complianceLabel: '🟢 Low',
        sustainowPriority: 2,
        sustainowPriorityLabel: '⭐⭐'
      }
    };

    // Location fallbacks for live fuel price lookups
    this.metroCityAliases = {
      delhi: 'Delhi',
      ncr: 'Delhi',
      new_delhi: 'Delhi',
      mumbai: 'Mumbai',
      maharashtra: 'Mumbai',
      chennai: 'Chennai',
      'tamil nadu': 'Chennai',
      kolkata: 'Kolkata',
      'west bengal': 'Kolkata',
      bengaluru: 'Bengaluru',
      bangalore: 'Bengaluru',
      karnataka: 'Bengaluru'
    };

    this.regionToMetroCity = {
      'north-india': 'Delhi',
      'west-india': 'Mumbai',
      'south-india': 'Chennai',
      'east-india': 'Kolkata',
      'northeast-india': 'Delhi'
    };

    this.carbonConfigVersion = CARBON_SHARED.configVersion;
    this.carbonReportingLabel = CARBON_SHARED.reportingLabel || 'CO2e_activity_and_spend_proxy';
    this.adjustmentMultiplierClamp = CARBON_SHARED.adjustmentMultiplierClamp || { min: 0.45, max: 2.75 };
    if (CARBON_SHARED.unitPrices && Number.isFinite(Number(CARBON_SHARED.unitPrices.water))) {
      this.unitPrices.water = Number(CARBON_SHARED.unitPrices.water);
    }
  }

  clamp(value, min, max) {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.min(Math.max(value, min), max);
  }

  extractManufacturingProfile(transaction = {}, runtimeContext = {}) {
    const runtimeProfile = runtimeContext?.profileContext ||
      runtimeContext?.msmeData?.manufacturingProfile ||
      runtimeContext?.context?.manufacturingProfile ||
      {};

    const transactionProfile = transaction?.manufacturingProfile || {};

    return normalizeManufacturingProfile(transactionProfile, runtimeProfile);
  }

  normalizeProfileText(value) {
    return String(value || '').toLowerCase().trim();
  }

  mapMSMEType(msmeType = '') {
    const normalized = this.normalizeProfileText(msmeType);
    if (!normalized) return null;
    if (normalized.includes('micro')) return 'micro';
    if (normalized.includes('small')) return 'small';
    if (normalized.includes('medium')) return 'medium';
    return null;
  }

  resolveZedCertificationLevel(certifications = []) {
    return resolveZedCertificationLevel(certifications);
  }

  getCapacityUnitMultiplier(unit = '') {
    const normalized = this.normalizeProfileText(unit);
    if (!normalized) return 1;
    if (['ton', 'tons', 'tonne', 'tonnes', 'mt'].includes(normalized)) return 1000;
    if (['kg', 'kilogram', 'kilograms'].includes(normalized)) return 1;
    if (['g', 'gram', 'grams'].includes(normalized)) return 0.001;
    if (['liter', 'litre', 'liters', 'litres', 'l', 'ltr'].includes(normalized)) return 1;
    if (['piece', 'pieces', 'unit', 'units', 'nos', 'number'].includes(normalized)) return 0.5;
    return 1;
  }

  getIndustrySectorAdjustment(category = '', industrySector = '') {
    const normalizedCategory = String(category || '').toLowerCase();
    const normalizedSector = this.normalizeProfileText(industrySector);
    if (!normalizedSector) {
      return { factor: 1, sectorKey: null };
    }

    const sectorProfiles = [
      {
        key: 'textiles',
        match: ['textile', 'apparel', 'garment'],
        factors: {
          energy: 1.08,
          water: 1.18,
          raw_materials: 1.06,
          waste_management: 1.04,
          transportation: 1.02
        }
      },
      {
        key: 'food_processing',
        match: ['food', 'beverage', 'dairy', 'processing'],
        factors: {
          energy: 1.06,
          water: 1.11,
          raw_materials: 1.04,
          waste_management: 1.08
        }
      },
      {
        key: 'electronics',
        match: ['electronic', 'electronics', 'semiconductor'],
        factors: {
          energy: 1.04,
          raw_materials: 1.1,
          waste_management: 1.08,
          transportation: 1.03
        }
      },
      {
        key: 'automotive',
        match: ['automotive', 'auto', 'vehicle', 'engineering'],
        factors: {
          energy: 1.09,
          raw_materials: 1.12,
          transportation: 1.05,
          waste_management: 1.05
        }
      },
      {
        key: 'services',
        match: ['service', 'consulting', 'it'],
        factors: {
          energy: 0.94,
          water: 0.95,
          raw_materials: 0.9,
          waste_management: 0.92,
          transportation: 0.96
        }
      }
    ];

    const profile = sectorProfiles.find(entry =>
      entry.match.some(keyword => normalizedSector.includes(keyword))
    );

    if (!profile) {
      return { factor: 1, sectorKey: null };
    }

    const mappedCategory = ['equipment', 'maintenance'].includes(normalizedCategory)
      ? 'energy'
      : normalizedCategory;

    return {
      factor: profile.factors[mappedCategory] || 1,
      sectorKey: profile.key
    };
  }

  calculateProfileCompleteness(profile = {}) {
    const fields = [
      'msmeType',
      'industrySector',
      'nicCode',
      'yearOfEstablishment',
      'locationCity',
      'locationState',
      'locationCountry',
      'numberOfEmployees',
      'plantAreaSqft',
      'operationalDaysPerYear',
      'primaryEnergySource',
      'backupEnergySource',
      'mainFuelsUsed',
      'waterSource',
      'wasteManagementPractice',
      'keyProducts',
      'productionCapacityPerMonth',
      'productionCapacityUnit',
      'supplyChainType',
      'logisticsMode',
      'certifications',
      'esgMaturityLevel',
      'digitalizationLevel',
      'carbonAccountingPractice',
      'regulatoryExposure',
      'exportActivity',
      'clusterAssociation'
    ];

    const providedFields = fields.reduce((count, field) => {
      const value = profile[field];
      if (Array.isArray(value)) {
        return count + (value.length > 0 ? 1 : 0);
      }
      if (typeof value === 'boolean') {
        return count + 1;
      }
      if (value === undefined || value === null) {
        return count;
      }
      if (typeof value === 'string') {
        return count + (value.trim().length > 0 ? 1 : 0);
      }
      if (Number.isFinite(value)) {
        return count + 1;
      }
      return count;
    }, 0);

    const ratio = fields.length > 0 ? providedFields / fields.length : 0;
    return {
      providedFields,
      totalFields: fields.length,
      ratio: this.roundTo(ratio, 4)
    };
  }

  getManufacturingProfileFactor({ category, profile = {} } = {}) {
    if (!profile || typeof profile !== 'object' || Object.keys(profile).length === 0) {
      return {
        factor: 1,
        signals: {}
      };
    }

    let factor = 1;
    const normalizedCategory = String(category || '').toLowerCase();
    const signals = {};
    const profileCompleteness = this.calculateProfileCompleteness(profile);
    const profileUncertaintyFactor = this.roundTo(
      this.clamp(1.08 - (profileCompleteness.ratio * 0.08), 1, 1.08),
      4
    );
    factor *= profileUncertaintyFactor;
    signals.profileCompleteness = profileCompleteness;
    signals.profileUncertaintyFactor = profileUncertaintyFactor;

    const normalizedMsmeType = this.mapMSMEType(profile.msmeType);
    if (normalizedMsmeType && this.esgParameters?.sizeFactors?.[normalizedMsmeType]) {
      const sizeFactors = this.esgParameters.sizeFactors[normalizedMsmeType];
      const msmeTypeFactor = this.clamp(
        (
          this.toFiniteNumber(sizeFactors.efficiency, 1) +
          this.toFiniteNumber(sizeFactors.scale, 1)
        ) / 2,
        0.85,
        1.2
      );
      factor *= msmeTypeFactor;
      signals.msmeType = normalizedMsmeType;
      signals.msmeTypeFactor = this.roundTo(msmeTypeFactor, 4);
    }

    const industrySector = this.normalizeProfileText(profile.industrySector);
    const industrySectorAdjustment = this.getIndustrySectorAdjustment(normalizedCategory, industrySector);
    factor *= industrySectorAdjustment.factor;
    signals.industrySector = industrySector || null;
    signals.industrySectorKey = industrySectorAdjustment.sectorKey;

    const yearOfEstablishment = this.toFiniteNumber(profile.yearOfEstablishment, 0);
    if (yearOfEstablishment >= 1900 && yearOfEstablishment <= new Date().getFullYear()) {
      const companyAgeYears = new Date().getFullYear() - yearOfEstablishment;
      if (companyAgeYears > 30) {
        factor *= 1.06;
      } else if (companyAgeYears > 15) {
        factor *= 1.03;
      } else if (companyAgeYears < 5) {
        factor *= 0.97;
      }
      signals.companyAgeYears = companyAgeYears;
    }

    const numberOfEmployees = this.toFiniteNumber(profile.numberOfEmployees, 0);
    if (numberOfEmployees > 0) {
      let employeeScaleFactor = 1;
      if (numberOfEmployees <= 10) employeeScaleFactor = 1.04;
      else if (numberOfEmployees <= 50) employeeScaleFactor = 1.02;
      else if (numberOfEmployees <= 250) employeeScaleFactor = 0.99;
      else employeeScaleFactor = 0.96;
      factor *= employeeScaleFactor;
      signals.numberOfEmployees = numberOfEmployees;
      signals.employeeScaleFactor = this.roundTo(employeeScaleFactor, 4);
    }

    const plantAreaSqft = this.toFiniteNumber(profile.plantAreaSqft, 0);
    if (plantAreaSqft > 0) {
      let plantScaleFactor = 1;
      if (plantAreaSqft < 5000) plantScaleFactor = 1.04;
      else if (plantAreaSqft > 50000) plantScaleFactor = 0.96;
      factor *= plantScaleFactor;
      signals.plantAreaSqft = plantAreaSqft;
      signals.plantScaleFactor = this.roundTo(plantScaleFactor, 4);
    }

    const productionCapacityPerMonth = this.toFiniteNumber(profile.productionCapacityPerMonth, 0);
    if (productionCapacityPerMonth > 0) {
      const capacityUnitMultiplier = this.getCapacityUnitMultiplier(profile.productionCapacityUnit);
      const normalizedCapacity = productionCapacityPerMonth * capacityUnitMultiplier;
      let capacityFactor = 1;

      if (numberOfEmployees > 0) {
        const capacityPerEmployee = normalizedCapacity / numberOfEmployees;
        if (capacityPerEmployee > 1200) capacityFactor *= 0.94;
        else if (capacityPerEmployee < 120) capacityFactor *= 1.05;
        signals.capacityPerEmployee = this.roundTo(capacityPerEmployee, 4);
      }

      if (plantAreaSqft > 0) {
        const capacityPerThousandSqft = normalizedCapacity / (plantAreaSqft / 1000);
        if (capacityPerThousandSqft > 2500) capacityFactor *= 0.95;
        else if (capacityPerThousandSqft < 250) capacityFactor *= 1.04;
        signals.capacityPerThousandSqft = this.roundTo(capacityPerThousandSqft, 4);
      }

      factor *= capacityFactor;
      signals.productionCapacityPerMonth = productionCapacityPerMonth;
      signals.productionCapacityUnit = profile.productionCapacityUnit || null;
      signals.capacityFactor = this.roundTo(capacityFactor, 4);
    }

    const primaryEnergy = String(profile.primaryEnergySource || '').toLowerCase();
    if (normalizedCategory === 'energy') {
      if (primaryEnergy.includes('renewable') || primaryEnergy.includes('solar') || primaryEnergy.includes('wind')) {
        factor *= 0.82;
        signals.primaryEnergy = 'renewable';
      } else if (primaryEnergy.includes('grid')) {
        factor *= 1.03;
        signals.primaryEnergy = 'grid';
      }

      const backupEnergy = String(profile.backupEnergySource || '').toLowerCase();
      if (backupEnergy.includes('diesel')) {
        factor *= 1.06;
        signals.backupEnergy = 'diesel';
      }

      const fuels = Array.isArray(profile.mainFuelsUsed) ? profile.mainFuelsUsed : [];
      const fuelSignals = fuels.map(fuel => String(fuel || '').toLowerCase());
      if (fuelSignals.some(fuel => fuel.includes('coal'))) {
        factor *= 1.1;
      }
      if (fuelSignals.some(fuel => fuel.includes('cng') || fuel.includes('lpg'))) {
        factor *= 0.97;
      }
      signals.mainFuelsUsed = fuels;
    }

    if (normalizedCategory === 'water') {
      const waterSource = this.normalizeProfileText(profile.waterSource);
      if (waterSource.includes('recycl') || waterSource.includes('treated') || waterSource.includes('rain')) {
        factor *= 0.85;
      } else if (waterSource.includes('tanker')) {
        factor *= 1.12;
      } else if (waterSource.includes('bore') || waterSource.includes('ground')) {
        factor *= 1.05;
      }
      signals.waterSource = waterSource || null;
    }

    if (normalizedCategory === 'transportation') {
      const logisticsMode = String(profile.logisticsMode || '').toLowerCase();
      if (logisticsMode.includes('road')) factor *= 1.08;
      if (logisticsMode.includes('rail')) factor *= 0.9;
      if (logisticsMode.includes('sea')) factor *= 0.88;
      if (logisticsMode.includes('air')) factor *= 1.22;
      signals.logisticsMode = logisticsMode || null;

      if (profile.exportActivity === true) {
        factor *= 1.08;
        signals.exportActivity = true;
      }
    }

    const supplyChainType = this.normalizeProfileText(profile.supplyChainType);
    if (['transportation', 'raw_materials'].includes(normalizedCategory)) {
      if (supplyChainType.includes('local') || supplyChainType.includes('cluster')) {
        factor *= 0.93;
      } else if (supplyChainType.includes('national')) {
        factor *= 1.06;
      } else if (supplyChainType.includes('global') || supplyChainType.includes('import') || supplyChainType.includes('export')) {
        factor *= 1.14;
      }
    }
    signals.supplyChainType = supplyChainType || null;

    if (normalizedCategory === 'waste_management') {
      const wastePractice = String(profile.wasteManagementPractice || '').toLowerCase();
      if (wastePractice.includes('recycl') || wastePractice.includes('recover')) {
        factor *= 0.82;
      } else if (wastePractice.includes('partial')) {
        factor *= 0.92;
      } else if (wastePractice.includes('none')) {
        factor *= 1.1;
      }
      signals.wasteManagementPractice = wastePractice || null;
    }

    if (normalizedCategory === 'raw_materials' && profile.exportActivity === true) {
      factor *= 1.04;
    }

    const keyProducts = Array.isArray(profile.keyProducts) ? profile.keyProducts : [];
    const normalizedProducts = keyProducts.map(product => this.normalizeProfileText(product));
    if (['raw_materials', 'waste_management'].includes(normalizedCategory)) {
      if (normalizedProducts.some(product => product.includes('recycl') || product.includes('eco'))) {
        factor *= 0.95;
      }
      if (normalizedProducts.some(product => product.includes('plastic') || product.includes('chemical') || product.includes('synthetic'))) {
        factor *= 1.07;
      }
    }
    signals.keyProducts = keyProducts;

    const operationalDays = this.toFiniteNumber(profile.operationalDaysPerYear, 0);
    if (operationalDays > 0) {
      const operationalFactor = this.clamp(operationalDays / 300, 0.75, 1.25);
      factor *= operationalFactor;
      signals.operationalDaysPerYear = operationalDays;
      signals.operationalDaysFactor = this.roundTo(operationalFactor, 4);
    }

    const esgMaturityLevel = String(profile.esgMaturityLevel || '').toLowerCase();
    if (esgMaturityLevel.includes('advanced') || esgMaturityLevel.includes('mature')) {
      factor *= 0.93;
    } else if (esgMaturityLevel.includes('basic')) {
      factor *= 1.02;
    }
    signals.esgMaturityLevel = esgMaturityLevel || null;

    const digitalizationLevel = String(profile.digitalizationLevel || '').toLowerCase();
    if (digitalizationLevel.includes('high') || digitalizationLevel.includes('advanced')) {
      factor *= 0.95;
    } else if (digitalizationLevel.includes('low')) {
      factor *= 1.03;
    }
    signals.digitalizationLevel = digitalizationLevel || null;

    const carbonAccounting = String(profile.carbonAccountingPractice || '').toLowerCase();
    if (carbonAccounting.includes('none')) {
      factor *= 1.04;
    } else if (carbonAccounting.includes('advanced') || carbonAccounting.includes('full')) {
      factor *= 0.97;
    }
    signals.carbonAccountingPractice = carbonAccounting || null;

    const certifications = Array.isArray(profile.certifications) ? profile.certifications : [];
    const normalizedCertifications = certifications.map(cert => String(cert || '').toLowerCase());
    if (normalizedCertifications.some(cert => cert.includes('iso 14001') || cert.includes('iso14001'))) {
      factor *= 0.94;
    }
    if (normalizedCategory === 'energy' &&
      normalizedCertifications.some(cert => cert.includes('iso 50001') || cert.includes('iso50001'))) {
      factor *= 0.9;
    }
    const zedLevel = this.resolveZedCertificationLevel(certifications);
    if (zedLevel === 'gold') {
      factor *= 0.88;
    } else if (zedLevel === 'silver') {
      factor *= 0.92;
    } else if (zedLevel === 'bronze') {
      factor *= 0.95;
    } else if (normalizedCertifications.some(cert => cert.includes('zed') || cert.includes('zero defect'))) {
      factor *= 0.97;
    }
    signals.zedCertificationLevel = zedLevel;
    signals.certifications = certifications;

    const regulatoryExposure = Array.isArray(profile.regulatoryExposure) ? profile.regulatoryExposure : [];
    const normalizedRegulatoryExposure = regulatoryExposure.map(entry => this.normalizeProfileText(entry));
    if (normalizedRegulatoryExposure.some(entry =>
      entry.includes('cbam') ||
      entry.includes('epr') ||
      entry.includes('pollution') ||
      entry.includes('spcb') ||
      entry.includes('compliance')
    )) {
      factor *= 0.97;
    } else if (
      ['waste_management', 'raw_materials'].includes(normalizedCategory) &&
      normalizedRegulatoryExposure.some(entry => entry.includes('none') || entry.includes('na'))
    ) {
      factor *= 1.03;
    }
    signals.regulatoryExposure = regulatoryExposure;

    const locationCountry = this.normalizeProfileText(profile.locationCountry);
    if (
      locationCountry &&
      !locationCountry.includes('india') &&
      ['transportation', 'raw_materials'].includes(normalizedCategory)
    ) {
      factor *= 1.05;
    }
    signals.locationCountry = locationCountry || null;

    const clusterAssociation = String(profile.clusterAssociation || '').trim();
    if (
      clusterAssociation &&
      ['transportation', 'raw_materials', 'waste_management'].includes(normalizedCategory)
    ) {
      factor *= 0.96;
    }
    signals.clusterAssociation = clusterAssociation || null;

    return {
      factor: this.roundTo(this.clamp(factor, 0.65, 1.45), 4),
      signals
    };
  }

  resolveReportingMode() {
    return 'compliance';
  }

  getReportingModeConfig() {
    return this.reportingModes.compliance || {};
  }

  shouldApplyCompositeMultipliers(transaction = {}, runtimeFactors = {}) {
    const mode = this.resolveReportingMode(transaction, runtimeFactors);
    return this.getReportingModeConfig(mode).applyCompositeMultipliers === true;
  }

  shouldUseRegionalGridFactors(transaction = {}, runtimeFactors = {}) {
    const mode = this.resolveReportingMode(transaction, runtimeFactors);
    return this.getReportingModeConfig(mode).useRegionalGridFactors === true;
  }

  isRevenueOrSalesTransaction(transaction = {}) {
    const rawType = String(
      transaction.transactionType ||
      transaction.metadata?.transactionType ||
      transaction.type ||
      ''
    ).toLowerCase();
    if (rawType && REVENUE_TRANSACTION_TYPES.has(rawType)) {
      return true;
    }

    const voucherType = String(
      transaction.voucherType ||
      transaction.metadata?.voucherType ||
      transaction.metadata?.voucher_type ||
      ''
    ).toLowerCase();
    if (voucherType === 'sales' || voucherType === 'sale') {
      return true;
    }

    const category = String(transaction.category || '').toLowerCase();
    if (category === 'revenue' || category === 'sales') {
      return true;
    }

    const text = `${transaction.description || ''} ${transaction.memo || ''} ${transaction.narration || ''}`
      .toLowerCase();
    if (/\b(sales\s+invoice|sales\s+receipt|customer\s+payment\s+received|payment\s+received\s+from\s+customer)\b/.test(text)) {
      return true;
    }

    return false;
  }

  isExcludedFromCarbonFootprint(transaction = {}) {
    if (transaction.excludeFromCarbonFootprint === true) {
      return { excluded: true, reason: 'explicit_flag' };
    }

    const reportingMode = this.resolveReportingMode(transaction, {});
    if (this.getReportingModeConfig(reportingMode).excludeSalesRevenue !== false
      && this.isRevenueOrSalesTransaction(transaction)) {
      return { excluded: true, reason: 'revenue_or_sales_non_emitting' };
    }

    const rawType = String(
      transaction.transactionType ||
      transaction.metadata?.transactionType ||
      ''
    ).toLowerCase();
    const excludedTypes = new Set([
      'transfer',
      'salary',
      'loan_repayment',
      'loan_emi',
      'investment',
      'dividend',
      'tax_payment',
      'pf',
      'provident_fund',
      'treasury',
      'internal_transfer',
      'sale',
      'sales',
      'revenue',
      'income',
      'payment_received',
      'customer_payment'
    ]);
    if (rawType && excludedTypes.has(rawType)) {
      return { excluded: true, reason: rawType };
    }
    const cat = String(transaction.category || '').toLowerCase();
    if (['transfer', 'salary', 'investment', 'tax', 'treasury'].includes(cat)) {
      return { excluded: true, reason: `category_${cat}` };
    }
    const text = `${transaction.description || ''} ${transaction.memo || ''} ${transaction.narration || ''}`
      .toLowerCase();
    if (text.trim()) {
      if (/\bsalary\s+(credited|credit|processed)\b/.test(text)) {
        return { excluded: true, reason: 'pattern_salary' };
      }
      if (/\b(provident\s+fund|epf|employer\s+pf)\b/.test(text)) {
        return { excluded: true, reason: 'pattern_pf' };
      }
      if (/\b(mutual\s+fund|sip\s+instalment|systematic\s+investment)\b/.test(text)) {
        return { excluded: true, reason: 'pattern_investment' };
      }
      if (/\b(loan\s+emi\s+deduction|home\s+loan\s+emi|auto\s+debit.*\bemi\b)\b/.test(text)) {
        return { excluded: true, reason: 'pattern_loan_emi' };
      }
      if (/\b(transferred\s+to\s+(own|self)\s+account)\b/.test(text)) {
        return { excluded: true, reason: 'pattern_self_transfer' };
      }
    }
    return { excluded: false };
  }

  calculateTransactionCarbonFootprint(transaction, runtimeFactors = {}) {
    const operationalBoundary = runtimeFactors.boundary || {};
    const exclusion = this.isExcludedFromCarbonFootprint(transaction);
    if (exclusion.excluded) {
      const amount = this.toFiniteNumber(transaction.amount, 0);
      const zeroFootprint = {
        co2Emissions: 0,
        emissionFactor: 0,
        calculationMethod: 'excluded_non_emitting_financial_flow',
        locationWeightage: 1,
        sustainabilityFactor: 1,
        industryFactor: 1,
        businessDomainFactor: 1,
        productBoundaryFactor: 1,
        manufacturingProfileFactor: 1,
        manufacturingProfileSignals: {},
        emissionBreakdown: { scope1: 0, scope2: 0, scope3: 0 },
        exclusionReason: exclusion.reason,
        adjustmentCompositeUncapped: 1,
        adjustmentCompositeCapped: 1
      };
      const zeroWithMeta = {
        ...zeroFootprint,
        carbonModelVersion: this.carbonConfigVersion,
        carbonReportingLabel: this.carbonReportingLabel
      };
      return {
        ...zeroWithMeta,
        metrics: this.buildTransactionEmissionMetrics(transaction, zeroWithMeta)
      };
    }

    const calculationTxn = this.resolveCalculationTransaction(transaction, runtimeFactors);
    const { category, sustainability } = calculationTxn;
    const amount = this.toFiniteNumber(calculationTxn.amount, 0);
    const quantificationMethod = carbonEmissionAnalytics.resolveQuantificationMethod(calculationTxn, category);

    const emissionResult = this.normalizeEmissionResult(
      this.calculateCategoryEmissions(calculationTxn, category, runtimeFactors)
    );
    const baseEmissions = emissionResult.co2Emissions;

    let sustainabilityFactor = 1;
    if (sustainability?.isGreen) {
      sustainabilityFactor = 1 - this.toFiniteNumber(sustainability.greenScore, 0) / 200;
    }

    const industryFactor = this.industryFactors[transaction.industry] || 1.0;

    let businessDomainFactor = 1;
    if (transaction.businessDomain) {
      const domainFactor = this.domainFactors[transaction.businessDomain];
      if (domainFactor) {
        switch (category) {
          case 'transportation':
            businessDomainFactor = domainFactor.transportation;
            break;
          case 'energy':
          case 'utilities':
            businessDomainFactor = domainFactor.energy;
            break;
          case 'raw_materials':
            businessDomainFactor = domainFactor.materials;
            break;
          case 'waste_management':
            businessDomainFactor = domainFactor.waste;
            break;
          default:
            businessDomainFactor = 1;
            break;
        }
      }
    }

    const locationWeightage = this.getLocationWeightage(transaction, category);
    const locationMultiplier = locationWeightage !== 1 ? locationWeightage : 1;

    const manufacturingProfile = this.extractManufacturingProfile(transaction, runtimeFactors);
    const profileAdjustment = this.getManufacturingProfileFactor({
      category,
      profile: manufacturingProfile
    });

    const emissionBoundary = String(transaction?.emissionBoundary || '').toLowerCase();
    const hasProductAssignments = Array.isArray(transaction?.productAttribution?.assignedProducts)
      && transaction.productAttribution.assignedProducts.length > 0;
    const productBoundaryFactor = emissionBoundary === 'product' && hasProductAssignments ? 1.05 : 1;

    const applyCompositeMultipliers = this.shouldApplyCompositeMultipliers(transaction, runtimeFactors);
    const compositeMultiplier = applyCompositeMultipliers
      ? sustainabilityFactor *
        industryFactor *
        businessDomainFactor *
        locationMultiplier *
        profileAdjustment.factor *
        productBoundaryFactor
      : 1;

    const clampMin = this.adjustmentMultiplierClamp?.min ?? 0.45;
    const clampMax = this.adjustmentMultiplierClamp?.max ?? 2.75;
    const appliedCompositeMultiplier = applyCompositeMultipliers
      ? this.clamp(compositeMultiplier, clampMin, clampMax)
      : 1;

    const directEmissions = baseEmissions * appliedCompositeMultiplier;
    const reportingMode = this.resolveReportingMode(transaction, runtimeFactors);
    const feraSupplement = this.computeFeraSupplement(
      calculationTxn,
      directEmissions,
      reportingMode,
      runtimeFactors
    );
    const co2Emissions = directEmissions + feraSupplement.feraKg;
    const emissionBreakdown = feraSupplement.emissionBreakdown;

    const emissionFactor = amount > 0 ? co2Emissions / amount : 0;
    const carbonFootprint = {
      co2Emissions: Math.round(co2Emissions * 100) / 100,
      emissionFactor: Math.round(emissionFactor * 10000) / 10000,
      calculationMethod: quantificationMethod,
      quantificationMethod,
      locationWeightage: this.roundTo(locationWeightage, 4),
      fuelContext: emissionResult.fuelContext || undefined,
      sustainabilityFactor: this.roundTo(sustainabilityFactor, 4),
      industryFactor: this.roundTo(industryFactor, 4),
      businessDomainFactor: this.roundTo(businessDomainFactor, 4),
      productBoundaryFactor: this.roundTo(productBoundaryFactor, 4),
      manufacturingProfileFactor: this.roundTo(profileAdjustment.factor, 4),
      manufacturingProfileSignals: profileAdjustment.signals,
      emissionBreakdown,
      scope2Reporting: emissionBreakdown.scope2 > 0
        && (operationalBoundary.scope2LocationBased !== false || operationalBoundary.scope2MarketBased !== false)
        ? ghgGovernance.buildScope2DualReportWithInstruments(
          transaction,
          emissionBreakdown.scope2,
          { boundary: operationalBoundary }
        )
        : undefined,
      adjustmentCompositeUncapped: this.roundTo(compositeMultiplier, 6),
      adjustmentCompositeCapped: this.roundTo(appliedCompositeMultiplier, 6),
      reportingMode,
      complianceFlags: this.buildComplianceFlags(
        transaction,
        quantificationMethod,
        reportingMode,
        calculationTxn._taxableAmountMeta
      ),
      taxableAmountMeta: calculationTxn._taxableAmountMeta || null,
      feraSupplement: feraSupplement.feraKg > 0 ? {
        feraKg: this.roundTo(feraSupplement.feraKg, 4),
        upstreamShare: feraSupplement.upstreamShare,
        energyType: feraSupplement.energyType,
        ghgScope3Category: 'cat3_fuel_energy_related'
      } : null,
      carbonModelVersion: this.carbonConfigVersion,
      carbonReportingLabel: this.carbonReportingLabel
    };

    if (feraSupplement.feraKg > 0) {
      carbonFootprint.ghgScope3Category = 'cat3_fuel_energy_related';
    }

    const inventoryFields = carbonEmissionAnalytics.buildTransactionInventoryFields(calculationTxn, carbonFootprint);
    const enrichedFootprint = {
      ...carbonFootprint,
      ...inventoryFields,
      dataSource: inventoryFields.dataQualityTier === carbonEmissionAnalytics.DATA_QUALITY_TIERS.TIER_1
        ? 'measured'
        : inventoryFields.dataQualityTier === carbonEmissionAnalytics.DATA_QUALITY_TIERS.TIER_2
          ? 'ai_calculated'
          : 'default_factor'
    };

    return {
      ...enrichedFootprint,
      metrics: this.buildTransactionEmissionMetrics(transaction, enrichedFootprint)
    };
  }

  async calculateTransactionCarbonFootprintForAgent(transaction = {}, runtimeContext = {}) {
    const runtimeFactors = await this.resolveRuntimeFactors(transaction, runtimeContext);
    runtimeFactors.profileContext = this.extractManufacturingProfile(transaction, runtimeContext);
    runtimeFactors.boundary = runtimeContext.boundary || runtimeFactors.boundary;
    return this.calculateTransactionCarbonFootprint(transaction, runtimeFactors);
  }

  ensureCarbonFootprintMetrics(transaction = {}, carbonFootprint = {}) {
    const rawFootprint = carbonFootprint || {};
    const co2 = this.roundTo(rawFootprint.co2Emissions, 2);
    const normalizedFootprint = {
      co2Emissions: co2,
      emissionFactor: this.roundTo(rawFootprint.emissionFactor, 4),
      calculationMethod: rawFootprint.calculationMethod || 'transaction_analysis',
      locationWeightage: this.roundTo(
        rawFootprint.locationWeightage === undefined ? 1 : rawFootprint.locationWeightage,
        4
      ),
      emissionBreakdown: rawFootprint.emissionBreakdown && typeof rawFootprint.emissionBreakdown === 'object'
        ? {
          scope1: this.roundTo(rawFootprint.emissionBreakdown.scope1, 4),
          scope2: this.roundTo(rawFootprint.emissionBreakdown.scope2, 4),
          scope3: this.roundTo(rawFootprint.emissionBreakdown.scope3, 4)
        }
        : this.buildTransactionEmissionBreakdown(transaction, co2)
    };

    const derivedMetrics = this.buildTransactionEmissionMetrics(transaction, {
      ...normalizedFootprint,
      sustainabilityFactor: rawFootprint.sustainabilityFactor ?? rawFootprint.metrics?.appliedFactors?.sustainability,
      industryFactor: rawFootprint.industryFactor ?? rawFootprint.metrics?.appliedFactors?.industry,
      businessDomainFactor: rawFootprint.businessDomainFactor ?? rawFootprint.metrics?.appliedFactors?.businessDomain,
      manufacturingProfileFactor: rawFootprint.manufacturingProfileFactor ?? rawFootprint.metrics?.appliedFactors?.manufacturingProfile
    });

    return {
      ...rawFootprint,
      ...normalizedFootprint,
      emissionBreakdown: normalizedFootprint.emissionBreakdown,
      metrics: {
        ...(rawFootprint.metrics || {}),
        ...derivedMetrics,
        appliedFactors: {
          ...(rawFootprint.metrics?.appliedFactors || {}),
          ...derivedMetrics.appliedFactors
        },
        calculatedAt: rawFootprint.metrics?.calculatedAt
          ? new Date(rawFootprint.metrics.calculatedAt)
          : derivedMetrics.calculatedAt
      }
    };
  }

  buildTransactionEmissionMetrics(transaction = {}, footprint = {}) {
    const amount = this.toFiniteNumber(transaction.amount, 0);
    const co2Emissions = this.toFiniteNumber(footprint.co2Emissions, 0);
    const emissionFactor = this.toFiniteNumber(footprint.emissionFactor, 0);
    const emissionsPerThousandCurrency = amount > 0 ? (co2Emissions / amount) * 1000 : 0;

    const sustainabilityFactor = this.toFiniteNumber(footprint.sustainabilityFactor, 1);
    const industryFactor = this.toFiniteNumber(footprint.industryFactor, 1);
    const businessDomainFactor = this.toFiniteNumber(footprint.businessDomainFactor, 1);
    const manufacturingProfileFactor = this.toFiniteNumber(footprint.manufacturingProfileFactor, 1);
    const locationFactor = this.toFiniteNumber(footprint.locationWeightage, 1);
    const fuelContext = footprint.fuelContext && typeof footprint.fuelContext === 'object'
      ? {
        ...footprint.fuelContext,
        fuelPricePerLiter: Number.isFinite(footprint.fuelContext.fuelPricePerLiter)
          ? this.roundTo(footprint.fuelContext.fuelPricePerLiter, 4)
          : null,
        fuelEmissionFactor: Number.isFinite(footprint.fuelContext.fuelEmissionFactor)
          ? this.roundTo(footprint.fuelContext.fuelEmissionFactor, 4)
          : null,
        estimatedConsumption: Number.isFinite(footprint.fuelContext.estimatedConsumption)
          ? this.roundTo(footprint.fuelContext.estimatedConsumption, 4)
          : null
      }
      : null;

    const normalizedCategory = String(transaction.category || '').toLowerCase();
    const normalizedSubcategory = String(transaction.subcategory || '').toLowerCase();
    const ragClassification = transaction?.metadata?.ragClassification || transaction?.classificationContext?.ragClassification;
    let carbonIntensity = emissionFactor;
    if (Number.isFinite(fuelContext?.fuelEmissionFactor)) {
      carbonIntensity = this.toFiniteNumber(fuelContext.fuelEmissionFactor, emissionFactor);
    } else if (normalizedCategory === 'energy') {
      carbonIntensity = this.toFiniteNumber(
        this.emissionFactors.electricity[normalizedSubcategory] ?? this.emissionFactors.electricity.grid,
        emissionFactor
      );
    }

    return {
      carbonIntensity: this.roundTo(carbonIntensity, 6),
      emissionsPerThousandCurrency: this.roundTo(emissionsPerThousandCurrency, 4),
      estimatedScope: this.estimateTransactionScope(transaction),
      emissionBreakdown: footprint.emissionBreakdown || null,
      quantificationMethod: footprint.quantificationMethod || footprint.calculationMethod || null,
      dataQualityTier: footprint.dataQualityTier || null,
      ghgScope3Category: footprint.ghgScope3Category || null,
      factorLineage: footprint.factorLineage || null,
      scope2Reporting: footprint.scope2Reporting || null,
      category: transaction.category || 'other',
      subcategory: transaction.subcategory || 'general',
      amount: this.roundTo(amount, 2),
      currency: transaction.currency || 'INR',
      carbonModelVersion: footprint.carbonModelVersion || this.carbonConfigVersion,
      carbonReportingLabel: footprint.carbonReportingLabel || this.carbonReportingLabel,
      appliedFactors: {
        sustainability: this.roundTo(sustainabilityFactor, 4),
        industry: this.roundTo(industryFactor, 4),
        businessDomain: this.roundTo(businessDomainFactor, 4),
        manufacturingProfile: this.roundTo(manufacturingProfileFactor, 4),
        location: this.roundTo(locationFactor, 4),
        fuelEmissionFactor: this.roundTo(fuelContext?.fuelEmissionFactor, 4),
        fuelPricePerLiter: this.roundTo(fuelContext?.fuelPricePerLiter, 4),
        ragEmissionFactor: this.roundTo(ragClassification?.emissionFactor?.value, 6),
        adjustmentCompositeUncapped: this.roundTo(footprint.adjustmentCompositeUncapped, 6),
        adjustmentCompositeCapped: this.roundTo(footprint.adjustmentCompositeCapped, 6)
      },
      fuelContext,
      ragClassification: ragClassification || null,
      calculatedAt: new Date()
    };
  }

  calculateCategoryEmissions(transaction = {}, category, runtimeFactors = {}) {
    switch (category) {
      case 'energy':
        return this.calculateEnergyEmissions(transaction, runtimeFactors);
      case 'water':
        return { co2Emissions: this.calculateWaterEmissions(transaction) };
      case 'waste_management':
        return { co2Emissions: this.calculateWasteEmissions(transaction) };
      case 'transportation':
        return this.calculateTransportEmissions(transaction, runtimeFactors);
      case 'raw_materials':
        return { co2Emissions: this.calculateMaterialEmissions(transaction, runtimeFactors) };
      case 'equipment':
        return { co2Emissions: this.calculateEquipmentEmissions(transaction) };
      case 'maintenance':
        return { co2Emissions: this.calculateMaintenanceEmissions(transaction) };
      case 'utilities':
        return { co2Emissions: this.calculateUtilitiesEmissions(transaction, runtimeFactors) };
      case 'telecom':
        return { co2Emissions: this.calculateTelecomEmissions(transaction, runtimeFactors) };
      default:
        return { co2Emissions: this.calculateGenericEmissions(transaction, runtimeFactors) };
    }
  }

  normalizeEmissionResult(result) {
    if (Number.isFinite(result)) {
      return { co2Emissions: this.toFiniteNumber(result, 0), fuelContext: null };
    }

    if (result && typeof result === 'object') {
      return {
        co2Emissions: this.toFiniteNumber(result.co2Emissions, 0),
        fuelContext: result.fuelContext || null
      };
    }

    return { co2Emissions: 0, fuelContext: null };
  }

  isFuelSubcategory(subcategory) {
    const key = String(subcategory || '').toLowerCase();
    return ['diesel', 'petrol', 'cng', 'lpg', 'coal', 'natural_gas'].includes(key);
  }

  resolveFuelType(transaction = {}, defaultFuel = 'diesel') {
    const subcategory = String(transaction.subcategory || '').toLowerCase();
    const description = String(transaction.description || '').toLowerCase();
    if (subcategory === 'petrol' || description.includes('petrol') || description.includes('gasoline')) return 'petrol';
    if (subcategory === 'cng' || description.includes('cng')) return 'cng';
    if (subcategory === 'lpg' || description.includes('lpg')) return 'lpg';
    if (subcategory === 'coal' || description.includes('coal')) return 'coal';
    if (subcategory === 'natural_gas' || description.includes('natural gas')) return 'natural_gas';
    return defaultFuel;
  }

  getFuelEmissionFactor(fuelType = 'diesel') {
    const normalizedFuelType = String(fuelType || '').toLowerCase();
    return this.emissionFactors.fuel[normalizedFuelType] ||
      this.emissionFactors.transport[normalizedFuelType] ||
      this.emissionFactors.fuel.diesel;
  }

  normalizeUnit(unit) {
    const normalized = String(unit || '').toLowerCase().trim();
    if (!normalized) return null;
    if (['kwh', 'kw-h', 'kw·h', 'kilowatt-hour', 'kilowatt hour', 'kilowatthour', 'units_consumed_kwh']
      .includes(normalized)) return 'kwh';
    if (['kl', 'kiloliter', 'kilolitre', 'kiloliters', 'kilolitres', 'kld'].includes(normalized)) {
      return 'kiloliter';
    }
    if (['l', 'lt', 'ltr', 'litre', 'litres', 'liter', 'liters'].includes(normalized)) return 'liter';
    if (['kg', 'kilogram', 'kilograms'].includes(normalized)) return 'kg';
    return normalized;
  }

  extractElectricityKwh(transaction = {}) {
    const unit = this.normalizeUnit(transaction.unit || transaction.metadata?.unit);
    const quantity = this.toFiniteNumber(
      transaction.quantity ??
      transaction.metadata?.quantity ??
      transaction.metadata?.kwh ??
      transaction.kwh,
      0
    );
    if (quantity > 0 && unit === 'kwh') {
      return quantity;
    }
    return 0;
  }

  extractWaterLiters(transaction = {}) {
    const unit = this.normalizeUnit(transaction.unit || transaction.metadata?.unit);
    const quantity = this.toFiniteNumber(
      transaction.quantity ??
      transaction.metadata?.quantity ??
      transaction.metadata?.liters ??
      transaction.liters,
      0
    );
    if (quantity <= 0) {
      return 0;
    }
    if (unit === 'liter') {
      return quantity;
    }
    if (unit === 'kiloliter') {
      return quantity * 1000;
    }
    return 0;
  }

  extractMaterialKg(transaction = {}) {
    const unit = this.normalizeUnit(transaction.unit || transaction.metadata?.unit);
    const quantity = this.toFiniteNumber(
      transaction.quantity ??
      transaction.metadata?.quantity ??
      transaction.weightKg,
      0
    );
    if (quantity > 0 && unit === 'kg') {
      return quantity;
    }
    return 0;
  }

  extractFuelQuantityFromTransaction(transaction = {}) {
    const quantity = this.toFiniteNumber(
      transaction.quantity ??
      transaction.metadata?.quantity ??
      transaction.metadata?.liters ??
      transaction.liters,
      0
    );
    if (quantity > 0) {
      return quantity;
    }

    const description = String(transaction.description || '').toLowerCase();
    const quantityMatch = description.match(/(\d+(?:\.\d+)?)\s?(l|ltr|litre|litres|liter|liters|ltrs)\b/);
    if (quantityMatch) {
      return this.toFiniteNumber(quantityMatch[1], 0);
    }

    return 0;
  }

  shouldTreatFuelAmountAsCurrency(transaction = {}, amount = 0) {
    const unit = this.normalizeUnit(transaction.unit || transaction.metadata?.unit);
    if (unit === 'liter') {
      return false;
    }

    const description = String(transaction.description || '').toLowerCase();
    const currencyHints = ['rs', 'inr', '₹', 'cost', 'price', 'amount', 'debited', 'payment'];
    const hasCurrencyHint = currencyHints.some(hint => description.includes(hint));
    if (hasCurrencyHint) {
      return true;
    }

    if (transaction.currency && String(transaction.currency).toUpperCase() === 'INR') {
      return true;
    }

    // Default to currency interpretation. A bare numeric `amount` is a spend figure (₹),
    // not a fuel volume; only an explicit `liter` unit (handled above) or an explicit
    // parsed quantity should be treated as litres. Previously small amounts (<=250) were
    // misread as litres, causing ~90x over-counting of CO2 for currency-less fuel rows.
    return true;
  }

  extractLocationContext(transaction = {}, runtimeContext = {}) {
    const msmeData = runtimeContext.msmeData || {};
    const orchestrationContext = runtimeContext.context || {};

    const city = transaction.location?.city ||
      transaction.city ||
      orchestrationContext.location?.city ||
      msmeData?.manufacturingProfile?.locationCity ||
      msmeData?.contact?.address?.city ||
      null;

    const state = transaction.location?.state ||
      transaction.state ||
      orchestrationContext.location?.state ||
      msmeData?.manufacturingProfile?.locationState ||
      msmeData?.contact?.address?.state ||
      null;

    const region = transaction.region ||
      transaction.location?.region ||
      orchestrationContext.region ||
      this.resolveRegion(state) ||
      null;

    return { city, state, region };
  }

  resolveMetroCityForFuelPrice(locationContext = {}) {
    const normalizedCity = String(locationContext.city || '').toLowerCase().trim();
    if (this.metroCityAliases[normalizedCity]) {
      return this.metroCityAliases[normalizedCity];
    }

    const normalizedState = String(locationContext.state || '').toLowerCase().trim();
    if (this.metroCityAliases[normalizedState]) {
      return this.metroCityAliases[normalizedState];
    }

    const region = locationContext.region || this.resolveRegion(normalizedState);
    return this.regionToMetroCity[region] || 'Delhi';
  }

  async resolveRuntimeFactors(transaction = {}, runtimeContext = {}) {
    const category = String(transaction.category || '').toLowerCase();
    const fuelRelevantCategory = category === 'transportation' ||
      (category === 'energy' && this.isFuelSubcategory(transaction.subcategory));
    if (!fuelRelevantCategory) {
      return {};
    }

    const fuelType = this.resolveFuelType(transaction);
    const locationContext = this.extractLocationContext(transaction, runtimeContext);
    const metroCity = this.resolveMetroCityForFuelPrice(locationContext);

    if (runtimeContext.__fuelPriceCache && runtimeContext.__fuelPriceCache[metroCity]) {
      return {
        fuelContext: {
          ...runtimeContext.__fuelPriceCache[metroCity],
          fuelType
        }
      };
    }

    const defaults = {
      source: 'default_fallback',
      location: metroCity,
      diesel: this.defaultFuelPrices.diesel,
      petrol: this.defaultFuelPrices.petrol
    };

    try {
      const fuelPriceService = getFuelPriceService();
      const livePricePayload = await Promise.race([
        fuelPriceService.getFuelPrices({ location: metroCity, days: 2 }),
        new Promise(resolve => setTimeout(() => resolve(null), 4000))
      ]);

      const livePrices = livePricePayload?.location
        ? {
          source: 'ppac_live',
          location: livePricePayload.location.name || metroCity,
          diesel: this.toFiniteNumber(livePricePayload.location.diesel, this.defaultFuelPrices.diesel),
          petrol: this.toFiniteNumber(livePricePayload.location.petrol, this.defaultFuelPrices.petrol),
          lastUpdated: livePricePayload.lastUpdated || null,
          authority: livePricePayload?.source?.authority || null
        }
        : defaults;

      runtimeContext.__fuelPriceCache = runtimeContext.__fuelPriceCache || {};
      runtimeContext.__fuelPriceCache[metroCity] = livePrices;

      return {
        fuelContext: {
          ...livePrices,
          fuelType
        }
      };
    } catch (error) {
      logger.warn('Falling back to default fuel prices during carbon agent calculation', {
        message: error.message,
        metroCity
      });

      runtimeContext.__fuelPriceCache = runtimeContext.__fuelPriceCache || {};
      runtimeContext.__fuelPriceCache[metroCity] = defaults;

      return {
        fuelContext: {
          ...defaults,
          fuelType
        }
      };
    }
  }

  resolveFuelPricePerLiter(fuelType = 'diesel', runtimeFactors = {}) {
    const normalizedFuelType = String(fuelType || '').toLowerCase();
    const fuelContext = runtimeFactors?.fuelContext || {};

    if (normalizedFuelType === 'petrol' && Number.isFinite(fuelContext.petrol)) {
      return fuelContext.petrol;
    }
    if (normalizedFuelType === 'diesel' && Number.isFinite(fuelContext.diesel)) {
      return fuelContext.diesel;
    }

    return this.defaultFuelPrices[normalizedFuelType] || this.defaultFuelPrices.diesel;
  }

  calculateFuelCombustionEmissions(transaction = {}, fuelType = 'diesel', runtimeFactors = {}) {
    const amount = this.toFiniteNumber(transaction.amount, 0);
    const explicitQuantity = this.extractFuelQuantityFromTransaction(transaction);
    const fuelPricePerLiter = this.resolveFuelPricePerLiter(fuelType, runtimeFactors);
    const fuelEmissionFactor = this.getFuelEmissionFactor(fuelType);

    let estimatedConsumption = explicitQuantity;
    let consumptionMethod = 'explicit_quantity';

    if (estimatedConsumption <= 0) {
      if (this.shouldTreatFuelAmountAsCurrency(transaction, amount)) {
        estimatedConsumption = fuelPricePerLiter > 0 ? amount / fuelPricePerLiter : amount;
        consumptionMethod = fuelPricePerLiter > 0 ? 'amount_divided_by_live_price' : 'amount_fallback';
      } else {
        estimatedConsumption = amount;
        consumptionMethod = 'amount_as_volume';
      }
    }

    return {
      co2Emissions: estimatedConsumption * fuelEmissionFactor,
      fuelContext: {
        source: runtimeFactors?.fuelContext?.source || 'static',
        authority: runtimeFactors?.fuelContext?.authority || null,
        location: runtimeFactors?.fuelContext?.location || null,
        fuelType,
        fuelPricePerLiter: this.roundTo(fuelPricePerLiter, 4),
        fuelEmissionFactor: this.roundTo(fuelEmissionFactor, 4),
        estimatedConsumption: this.roundTo(estimatedConsumption, 4),
        consumptionMethod,
        lastUpdated: runtimeFactors?.fuelContext?.lastUpdated || null
      }
    };
  }

  /**
   * Maps a transaction's total modelled CO₂ (after category + adjustment factors) into
   * GHG Protocol scope buckets for feeds, reporting, and product aggregation.
   */
  buildTransactionEmissionBreakdown(transaction = {}, co2Emissions = 0) {
    const total = this.toFiniteNumber(co2Emissions, 0);
    if (total <= 0) {
      return { scope1: 0, scope2: 0, scope3: 0 };
    }
    if (this.isScope1Emission(transaction)) {
      return { scope1: this.roundTo(total, 4), scope2: 0, scope3: 0 };
    }
    if (this.isScope2Emission(transaction)) {
      return { scope1: 0, scope2: this.roundTo(total, 4), scope3: 0 };
    }
    return { scope1: 0, scope2: 0, scope3: this.roundTo(total, 4) };
  }

  estimateTransactionScope(transaction = {}) {
    if (this.isScope4Emission(transaction)) {
      return 'scope4';
    }
    if (this.isScope1Emission(transaction)) {
      return 'scope1';
    }
    if (this.isScope2Emission(transaction)) {
      return 'scope2';
    }
    return 'scope3';
  }

  normalizeStateToken(stateOrRegion) {
    if (!stateOrRegion) return null;
    return String(stateOrRegion).toLowerCase().trim().replace(/\s+/g, ' ');
  }

  resolveRegionalGridFactor(transaction = {}, runtimeFactors = {}) {
    const regional = this.regionalGridFactors || {};
    const state = transaction.state
      || transaction.location?.state
      || transaction.manufacturingProfile?.locationState;
    const normalized = this.normalizeStateToken(state);
    if (normalized && Number.isFinite(regional[normalized])) {
      return regional[normalized];
    }
    if (normalized) {
      const match = Object.entries(regional).find(([key]) => key !== 'default' && normalized.includes(key));
      if (match) return match[1];
    }
    return regional.default ?? this.emissionFactors.electricity.grid;
  }

  resolveGridEmissionFactor(transaction = {}, energyType = 'grid', runtimeFactors = {}) {
    if (energyType !== 'grid' || !this.shouldUseRegionalGridFactors(transaction, runtimeFactors)) {
      return this.emissionFactors.electricity[energyType] || this.emissionFactors.electricity.grid;
    }
    return this.resolveRegionalGridFactor(transaction, runtimeFactors);
  }

  resolveCalculationTransaction(transaction = {}, runtimeFactors = {}) {
    const reportingMode = this.resolveReportingMode(transaction, runtimeFactors);
    const gstEnabled = this.gstStripping?.enabledInComplianceMode !== false;
    if (reportingMode !== 'compliance' || !gstEnabled) {
      return transaction;
    }

    const taxableMeta = resolveTaxableAmountForCarbon(transaction);
    if (!taxableMeta.gstStripped || taxableMeta.amount === this.toFiniteNumber(transaction.amount, 0)) {
      return {
        ...transaction,
        _taxableAmountMeta: taxableMeta
      };
    }

    return {
      ...transaction,
      amount: taxableMeta.amount,
      _taxableAmountMeta: taxableMeta
    };
  }

  isFeraEligibleTransaction(transaction = {}) {
    const category = String(transaction.category || '').toLowerCase();
    const subcategory = String(transaction.subcategory || '').toLowerCase();

    if (category === 'energy' || category === 'utilities') {
      if (subcategory === 'renewable') {
        return { eligible: true, energyType: 'renewable' };
      }
      if (this.isFuelSubcategory(subcategory)) {
        return { eligible: true, energyType: 'fuel' };
      }
      return { eligible: true, energyType: 'electricity' };
    }

    if (category === 'transportation' && this.isScope1Emission(transaction)) {
      return { eligible: true, energyType: 'fuel' };
    }

    return { eligible: false, energyType: null };
  }

  resolveFeraUpstreamShare(energyType = 'electricity') {
    const config = this.feraModeling || {};
    if (energyType === 'renewable') {
      return config.renewableElectricityUpstreamShare ?? 0.02;
    }
    if (energyType === 'fuel') {
      return config.fuelUpstreamShare ?? 0.18;
    }
    return config.electricityUpstreamShare ?? 0.08;
  }

  computeFeraSupplement(transaction = {}, directEmissions = 0, reportingMode = 'compliance', runtimeFactors = {}) {
    const direct = this.toFiniteNumber(directEmissions, 0);
    const baseBreakdown = this.buildTransactionEmissionBreakdown(transaction, direct);

    if (reportingMode !== 'compliance' || this.feraModeling?.enabledInComplianceMode === false || direct <= 0) {
      return {
        feraKg: 0,
        upstreamShare: 0,
        energyType: null,
        emissionBreakdown: baseBreakdown
      };
    }

    const eligibility = this.isFeraEligibleTransaction(transaction);
    if (!eligibility.eligible) {
      return {
        feraKg: 0,
        upstreamShare: 0,
        energyType: null,
        emissionBreakdown: baseBreakdown
      };
    }

    const upstreamShare = this.resolveFeraUpstreamShare(eligibility.energyType);
    const feraKg = direct * upstreamShare;
    const emissionBreakdown = {
      scope1: baseBreakdown.scope1,
      scope2: baseBreakdown.scope2,
      scope3: this.roundTo((baseBreakdown.scope3 || 0) + feraKg, 4)
    };

    return {
      feraKg,
      upstreamShare,
      energyType: eligibility.energyType,
      emissionBreakdown
    };
  }

  buildComplianceFlags(transaction = {}, quantificationMethod = '', reportingMode = 'compliance', taxableMeta = null) {
    const flags = [];
    if (reportingMode === 'compliance') {
      if (quantificationMethod === 'spend_proxy') {
        flags.push('tier2_spend_proxy_requires_activity_units');
      }
      if (!transaction.unit && !transaction.metadata?.unit) {
        flags.push('missing_activity_unit');
      }
      const meta = taxableMeta || resolveTaxableAmountForCarbon(transaction);
      if (meta.gstStripped) {
        flags.push('gst_stripped_for_spend_proxy');
      } else if (transaction.amount && transaction.gstAmount && transaction.amount !== transaction.netAmountInr) {
        flags.push('gst_may_be_included_in_amount');
      }
    }
    return flags;
  }

  resolveMaterialType(transaction = {}) {
    const { subcategory, description, item } = transaction;
    const searchText = `${item || ''} ${description || ''}`.toLowerCase();

    if (subcategory && this.emissionFactors.materials[subcategory]) {
      return subcategory;
    }

    for (const entry of MATERIAL_KEYWORD_MAP) {
      if (entry.keywords.some((keyword) => searchText.includes(keyword))) {
        return entry.type;
      }
    }

    if (subcategory === 'chemical_inputs' || subcategory === 'textiles_inputs' || subcategory === 'general') {
      return subcategory;
    }

    return 'steel';
  }

  calculateEnergyEmissions(transaction, runtimeFactors = {}) {
    const { amount, subcategory, description } = transaction;

    // Determine energy type
    let energyType = 'grid';
    if (subcategory === 'renewable') {
      energyType = 'renewable';
    } else if (subcategory === 'mixed') {
      energyType = 'mixed';
    } else if (description && (description.toLowerCase().includes('solar') || description.toLowerCase().includes('wind'))) {
      energyType = 'renewable';
    }

    // Check if subcategory indicates fuel (diesel/petrol generators etc.)
    if (subcategory && this.emissionFactors.fuel[subcategory]) {
      return this.calculateFuelCombustionEmissions(transaction, subcategory, runtimeFactors);
    }

    const gridFactor = this.resolveGridEmissionFactor(transaction, energyType, runtimeFactors);
    const meteredKwh = this.extractElectricityKwh(transaction);
    if (meteredKwh > 0) {
      return meteredKwh * gridFactor;
    }

    // Amount is in Rs — convert to kWh (spend proxy when metered kWh not supplied)
    const pricePerKwh = this.unitPrices.electricity[energyType] || this.unitPrices.electricity.grid;
    const kWh = amount / pricePerKwh;
    return kWh * gridFactor;
  }

  calculateWaterEmissions(transaction) {
    const { amount } = transaction;
    const explicitLiters = this.extractWaterLiters(transaction);
    const liters = explicitLiters > 0 ? explicitLiters : amount / this.unitPrices.water;
    return liters * this.emissionFactors.water;
  }

  calculateWasteEmissions(transaction) {
    const { amount, subcategory, description } = transaction;

    if (subcategory === 'recycling') {
      // Amount is in Rs — convert to kg
      const kg = amount / this.unitPrices.waste.recycling;
      // Recycling reduces emissions by 70%
      return kg * this.emissionFactors.solidWaste * 0.3;
    } else if (description && description.toLowerCase().includes('hazardous')) {
      const kg = amount / this.unitPrices.waste.hazardous;
      return kg * this.emissionFactors.hazardousWaste;
    } else {
      const kg = amount / this.unitPrices.waste.solid;
      return kg * this.emissionFactors.solidWaste;
    }
  }

  calculateTransportEmissions(transaction, runtimeFactors = {}) {
    const { amount, subcategory } = transaction;

    let fuelType = 'diesel'; // Default
    if (subcategory === 'petrol') fuelType = 'petrol';
    if (subcategory === 'cng') fuelType = 'cng';
    if (subcategory === 'coal') fuelType = 'coal';

    return this.calculateFuelCombustionEmissions(transaction, fuelType, runtimeFactors);
  }

  resolveRagEmissionFactor(transaction = {}) {
    const factorValue = Number(
      transaction?.metadata?.ragClassification?.emissionFactor?.value ??
      transaction?.classificationContext?.ragClassification?.emissionFactor?.value
    );
    if (!Number.isFinite(factorValue) || factorValue <= 0) {
      return null;
    }
    return factorValue;
  }

  calculateMaterialEmissions(transaction, runtimeFactors = {}) {
    const { amount, subcategory, description } = transaction;
    const normalizedDescription = String(description || '').toLowerCase();
    const reportingMode = this.resolveReportingMode(transaction, runtimeFactors);
    const materialType = this.resolveMaterialType(transaction);
    const useGenericSpend = reportingMode === 'compliance'
      && !this.emissionFactors.materials[materialType]
      && !this.extractMaterialKg(transaction);

    const massKg = this.extractMaterialKg(transaction);
    if (massKg > 0) {
      const baseEmissions = massKg * this.emissionFactors.materials[materialType];
      if (normalizedDescription) {
        const distanceMatch = normalizedDescription.match(/(\d+)\s*km/i);
        if (distanceMatch) {
          const distance = parseInt(distanceMatch[1], 10);
          const transportFactor = distance * 0.0001; // 0.1 kg CO2 per km per kg
          return baseEmissions + (massKg * transportFactor);
        }
      }
      return baseEmissions;
    }

    if (useGenericSpend) {
      return this.calculateGenericEmissions(transaction, runtimeFactors);
    }

    const ragEmissionFactor = this.resolveRagEmissionFactor(transaction);
    if (ragEmissionFactor && (
      runtimeFactors?.useRagEmissionFactor ||
      String(transaction?.metadata?.ragClassification?.retrievalMethod || '').toLowerCase() === 'verified_registry_rag'
    )) {
      return (Number(amount) || 0) * ragEmissionFactor;
    }

    // Amount is in Rs — convert to kg using material price
    const pricePerKg = this.unitPrices.materials[materialType] || 50;
    const weightKg = amount / pricePerKg;
    const baseEmissions = weightKg * this.emissionFactors.materials[materialType];

    // Add transportation factor if supplier distance is mentioned
    if (normalizedDescription) {
      const distanceMatch = normalizedDescription.match(/(\d+)\s*km/i);
      if (distanceMatch) {
        const distance = parseInt(distanceMatch[1], 10);
        const transportFactor = distance * 0.0001; // 0.1 kg CO2 per km per kg
        return baseEmissions + (weightKg * transportFactor);
      }
    }

    return baseEmissions;
  }

  getLocationWeightage(transaction, category) {
    const region = this.resolveRegion(
      transaction.region ||
      transaction.location?.region ||
      transaction.location?.state ||
      transaction.state
    );
    if (!region) {
      return 1;
    }
    const sectorModel = getSectorModel(transaction.businessDomain);
    const weightages = sectorModel?.locationWeightages || {};
    const regionWeights = weightages[region] || weightages.default;
    if (!regionWeights) {
      return 1;
    }
    const categoryKey = this.mapCategoryToLocationKey(category);
    return regionWeights[categoryKey] || 1;
  }

  mapCategoryToLocationKey(category) {
    switch (category) {
      case 'energy':
      case 'equipment':
      case 'maintenance':
      case 'utilities':
        return 'energy';
      case 'transportation':
        return 'transport';
      case 'raw_materials':
      case 'materials':
        return 'materials';
      case 'waste_management':
        return 'waste';
      case 'water':
        return 'water';
      default:
        return 'energy';
    }
  }

  resolveRegion(stateOrRegion) {
    if (!stateOrRegion) return null;
    const normalized = String(stateOrRegion).toLowerCase();
    // northeast must be checked before east/north to avoid false matches
    if (normalized.includes('india') && normalized.includes('northeast')) return 'northeast-india';
    if (normalized.includes('india') && normalized.includes('north')) return 'north-india';
    if (normalized.includes('india') && normalized.includes('south')) return 'south-india';
    if (normalized.includes('india') && normalized.includes('east')) return 'east-india';
    if (normalized.includes('india') && normalized.includes('west')) return 'west-india';
    return STATE_REGION_MAP[normalized] || (normalized.includes('india') ? normalized : null);
  }

  calculateEquipmentEmissions(transaction) {
    const { amount, description } = transaction;

    // Equipment emissions are typically embedded in manufacturing
    // Estimate based on equipment type and age
    let factor = 0.5; // Base factor (kg CO2 per kg of equipment)

    if (description && description.toLowerCase().includes('old') || description && description.toLowerCase().includes('used')) {
      factor *= 1.5; // Old equipment is less efficient
    }
    if (description && description.toLowerCase().includes('energy efficient') || description && description.toLowerCase().includes('modern')) {
      factor *= 0.7; // Modern equipment is more efficient
    }

    // Amount is in Rs — convert to estimated weight
    const estimatedKg = amount / this.unitPrices.equipment;
    return estimatedKg * factor;
  }

  calculateMaintenanceEmissions(transaction) {
    const { amount, description } = transaction;

    // Maintenance emissions are typically low
    let factor = 0.1; // kg CO2 per service unit

    if (description && description.toLowerCase().includes('major') || description && description.toLowerCase().includes('overhaul')) {
      factor = 0.3;
    }

    // Amount is in Rs — convert to estimated service units
    const serviceUnits = amount / this.unitPrices.maintenance;
    return serviceUnits * factor;
  }

  calculateTelecomEmissions(transaction = {}, runtimeFactors = {}) {
    const amount = this.toFiniteNumber(transaction.amount, 0);
    const sub = carbonCategoryTaxonomy.normalizeSubcategory(transaction.subcategory);
    const desc = String(transaction.description || '').toLowerCase();

    const telecomKgPerInr = {
      telecom: 0.00045,
      broadband: 0.0004,
      internet: 0.0004,
      mobile: 0.00042,
      recharge: 0.00042,
      dth: 0.00038,
      data: 0.0004,
      sim: 0.00035,
      voip: 0.00035,
      general: 0.0005
    };

    if (telecomKgPerInr[sub]) {
      return amount * telecomKgPerInr[sub];
    }

    if (carbonCategoryTaxonomy.matchesTelecomKeywords(desc)) {
      return amount * telecomKgPerInr.mobile;
    }

    return amount * telecomKgPerInr.general;
  }

  /**
   * Utility bills and digital subscriptions: split grid-style power from low-intensity digital spend.
   */
  calculateUtilitiesEmissions(transaction = {}, runtimeFactors = {}) {
    const amount = this.toFiniteNumber(transaction.amount, 0);
    const sub = String(transaction.subcategory || '').toLowerCase();
    const desc = String(transaction.description || '').toLowerCase();

    const looksLikeElectricityBill = sub === 'electricity'
      || sub === 'grid'
      || desc.includes('electricity')
      || desc.includes('power bill')
      || desc.includes('energy charges')
      || desc.includes('billed units')
      || desc.includes('kwh')
      || desc.includes('units consumed');

    if (looksLikeElectricityBill) {
      const energyResult = this.calculateEnergyEmissions(
        { ...transaction, category: 'energy', subcategory: 'grid' },
        runtimeFactors
      );
      if (energyResult && typeof energyResult === 'object' && Number.isFinite(energyResult.co2Emissions)) {
        return energyResult.co2Emissions;
      }
      return this.toFiniteNumber(energyResult, 0);
    }

    const digitalKgPerInr = {
      telecom: 0.00045,
      broadband: 0.0004,
      internet: 0.0004,
      mobile: 0.00042,
      software: 0.00035,
      subscription: 0.00055,
      hosting: 0.0005,
      cloud: 0.00055,
      streaming: 0.00048
    };

    if (sub && digitalKgPerInr[sub]) {
      return amount * digitalKgPerInr[sub];
    }

    if (/(recharge|prepaid|postpaid|data pack|datapack|4g|5g|pack)\b/.test(desc)
      || /\b(jio|airtel|vodafone|idea|bsnl|vi\b)\b/.test(desc)) {
      return amount * 0.00042;
    }

    if (/\b(upi|rtgs|neft|imps)\b/.test(desc)
      && (desc.includes('paid') || desc.includes('debited') || desc.includes('sent') || desc.includes('paid to'))) {
      return amount * 0.00028;
    }

    return this.calculateGenericEmissions(transaction, runtimeFactors);
  }

  calculateGenericEmissions(transaction, runtimeFactors = {}) {
    const { amount, category } = transaction;
    const ragEmissionFactor = this.resolveRagEmissionFactor(transaction);
    if (ragEmissionFactor && (
      runtimeFactors?.useRagEmissionFactor ||
      String(transaction?.metadata?.ragClassification?.retrievalMethod || '').toLowerCase() === 'verified_registry_rag'
    )) {
      return (Number(amount) || 0) * ragEmissionFactor;
    }

    const sub = String(transaction.subcategory || '').toLowerCase();
    const desc = String(transaction.description || '').toLowerCase();

    const subcategorySpendFactors = {
      telecom: 0.00045,
      broadband: 0.0004,
      internet: 0.0004,
      mobile: 0.00042,
      mobile_recharge: 0.00042,
      software: 0.00035,
      subscription: 0.00055,
      banking: 0.00028,
      fees: 0.0003,
      finance: 0.0003,
      insurance: 0.0003,
      transfer: 0.00022,
      cloud: 0.00055,
      hosting: 0.0005
    };

    if (sub && subcategorySpendFactors[sub]) {
      return amount * subcategorySpendFactors[sub];
    }

    if (/(recharge|prepaid|postpaid|data pack|datapack)\b/.test(desc)
      || /\b(jio|airtel|vodafone|idea|bsnl|vi\b)\b/.test(desc)) {
      return amount * 0.00042;
    }

    if (/\b(upi|rtgs|neft|imps)\b/.test(desc)
      && (desc.includes('paid') || desc.includes('debited') || desc.includes('sent') || desc.includes('paid to'))) {
      return amount * 0.00028;
    }

    // Generic emission factor based on category (kg CO2 per Rs)
    // Calibrated spend-based factors — synced with mobile app
    const genericFactors = {
      other: 0.001,
      utilities: 0.005,
      services: 0.001,
      telecom: 0.0005,
      finance: 0.0003,
      transfer: 0.0002,
      insurance: 0.0003
    };

    const normalizedCategory = String(category || 'other').toLowerCase();
    const factor = genericFactors[normalizedCategory] || 0.001;
    return amount * factor;
  }

  sumIncludedTransactionAmounts(transactions = []) {
    return transactions.reduce(
      (sum, transaction) => sum + this.toFiniteNumber(transaction?.amount, 0),
      0
    );
  }

  attachAssessmentSpendAndCounts(assessment, includedTransactions = []) {
    const totalAmount = this.sumIncludedTransactionAmounts(includedTransactions);
    assessment.transactionCount = includedTransactions.length;
    assessment.totalAmount = this.roundTo(totalAmount, 2);
    assessment.totalSpend = assessment.totalAmount;
    return assessment;
  }

  resolveBreakdownEmissionTotals(breakdown = {}) {
    let materials = breakdown.materials || {};
    if (typeof materials === 'string') {
      try {
        materials = JSON.parse(materials);
      } catch (_error) {
        materials = {};
      }
    }

    const energy = breakdown.energy || {};
    const waste = breakdown.waste || {};
    const transportation = breakdown.transportation || {};
    const water = breakdown.water || {};

    const energyElectricity = this.toFiniteNumber(
      energy.electricity?.co2Emissions ?? energy.electricity,
      0
    );
    const energyFuel = this.toFiniteNumber(energy.fuel?.co2Emissions ?? energy.fuel, 0);
    const energyRenewable = this.toFiniteNumber(energy.renewable, 0);
    const energyTotal = this.toFiniteNumber(energy.total, 0)
      || (energyElectricity + energyFuel + energyRenewable);

    const wasteSolid = this.toFiniteNumber(waste.solid?.co2Emissions ?? waste.solid, 0);
    const wasteHazardous = this.toFiniteNumber(waste.hazardous?.co2Emissions ?? waste.hazardous, 0);
    const wasteRecycled = this.toFiniteNumber(waste.recycled, 0);
    const wasteTotal = this.toFiniteNumber(waste.total, 0)
      || (wasteSolid + wasteHazardous + wasteRecycled);

    return {
      energyTotal,
      wasteTotal,
      transportationCo2: this.toFiniteNumber(
        transportation.co2Emissions ?? transportation.total,
        0
      ),
      materialsCo2: this.toFiniteNumber(
        materials.co2Emissions ?? materials.total,
        0
      ),
      waterCo2: this.toFiniteNumber(water.co2Emissions, 0)
    };
  }

  createEmptyMSMECarbonAssessment(msmeData = {}) {
    return {
      totalCO2Emissions: 0,
      breakdown: {
        energy: { electricity: 0, fuel: 0, renewable: 0, total: 0 },
        water: { consumption: 0, co2Emissions: 0 },
        waste: { solid: 0, hazardous: 0, recycled: 0, total: 0 },
        transportation: { distance: 0, co2Emissions: 0, vehicleCount: 0, fuelEfficiency: 0 },
        materials: { consumption: 0, co2Emissions: 0, type: 'mixed', supplierDistance: 0 },
        manufacturing: { productionVolume: 0, co2Emissions: 0, efficiency: 0, equipmentAge: 0 }
      },
      businessDomain: msmeData.businessDomain || 'other',
      domainFactors: msmeData.businessDomain ? this.domainFactors[msmeData.businessDomain] : null,
      esgScopes: {
        scope1: {
          total: 0,
          percentage: 0,
          breakdown: {
            directFuel: 0,
            directTransport: 0,
            directManufacturing: 0,
            fugitiveEmissions: 0,
            processEmissions: 0,
            stationaryCombustion: 0,
            mobileCombustion: 0
          },
          description: 'Direct emissions from owned or controlled sources',
          parameters: {
            fuelTypes: {},
            vehicleTypes: {},
            processTypes: {},
            emissionFactors: {}
          }
        },
        scope2: {
          total: 0,
          percentage: 0,
          breakdown: {
            electricity: 0,
            heating: 0,
            cooling: 0,
            steam: 0,
            districtHeating: 0,
            districtCooling: 0
          },
          description: 'Indirect emissions from purchased energy',
          parameters: {
            energySources: {},
            gridFactors: {},
            renewablePercentage: 0,
            locationFactors: {}
          }
        },
        scope3: {
          total: 0,
          percentage: 0,
          breakdown: {
            purchasedGoods: 0,
            transportation: 0,
            wasteDisposal: 0,
            businessTravel: 0,
            employeeCommuting: 0,
            leasedAssets: 0,
            investments: 0,
            franchises: 0,
            processingSoldProducts: 0,
            useSoldProducts: 0,
            endLifeDisposal: 0,
            other: 0
          },
          description: 'All other indirect emissions in the value chain',
          parameters: {
            supplyChainFactors: {},
            transportationModes: {},
            wasteTypes: {},
            productLifecycle: {}
          }
        },
        scope4: {
          total: 0,
          percentage: 0,
          breakdown: {
            avoidedEmissions: 0,
            carbonOffsets: 0,
            renewableEnergyCredits: 0,
            energyEfficiency: 0,
            wasteReduction: 0,
            sustainableProducts: 0,
            greenTransportation: 0,
            carbonCapture: 0
          },
          description: 'Avoided emissions and positive climate impact',
          parameters: {
            offsetTypes: {},
            renewableEnergyTypes: {},
            efficiencyMeasures: {},
            carbonCaptureMethods: {}
          }
        }
      },
      carbonScore: 0,
      recommendations: []
    };
  }

  calculateMSMECarbonFootprint(msmeData, transactions) {
    const assessment = this.createEmptyMSMECarbonAssessment(msmeData);
    const boundary = normalizeGhgOperationalBoundary(
      msmeData.operations?.ghgOperationalBoundary || {},
      {}
    );
    const organizationalBoundary = normalizeGhgOrganizationalBoundary(
      msmeData.manufacturingProfile?.ghgOrganizationalBoundary || {},
      {}
    );
    const { included, excluded, organizationalBoundary: orgBoundary } = governanceService.prepareTransactionsForInventory(
      transactions,
      msmeData
    );
    const resolvedOrgBoundary = orgBoundary || organizationalBoundary;
    assessment.boundaryGovernance = {
      operationalBoundary: boundary,
      organizationalBoundary: resolvedOrgBoundary,
      includedTransactionCount: included.length,
      excludedTransactionCount: excluded.length,
      excludedSummary: excluded.slice(0, 20).map((t) => ({
        id: t._id,
        reason: t.boundaryEvaluation?.exclusionReason
      }))
    };

    // Process transactions by category (operational boundary enforced)
    included.forEach(transaction => {
      const enrichedTransaction = {
        ...transaction,
        industry: transaction.industry || msmeData.industry,
        businessDomain: transaction.businessDomain || msmeData.businessDomain,
        manufacturingProfile: transaction.manufacturingProfile || msmeData.manufacturingProfile || {}
      };

      const carbonData = this.calculateTransactionCarbonFootprint(enrichedTransaction, {
        boundary,
        reportingMode: 'compliance'
      });
      enrichedTransaction.carbonFootprint = carbonData;
      transaction.carbonFootprint = carbonData;

      assessment.totalCO2Emissions += carbonData.co2Emissions;

      // Update breakdown
      this.updateBreakdown(assessment.breakdown, enrichedTransaction, carbonData.co2Emissions);

      // Update ESG scope breakdown
      this.updateESGScopes(assessment.esgScopes, enrichedTransaction, carbonData.co2Emissions, boundary);
    });

    // Normalize scope values and compute contribution percentages for reporting
    this.finalizeESGScopeMetrics(assessment.esgScopes, assessment.totalCO2Emissions);

    this.attachAssessmentSpendAndCounts(assessment, included);

    // Calculate carbon score
    assessment.carbonScore = this.calculateCarbonScore(assessment, msmeData);

    // Generate recommendations
    assessment.recommendations = this.generateRecommendations(assessment, msmeData);

    assessment.inventoryMetadata = carbonEmissionAnalytics.aggregateInventoryMetadata(included, {
      organizationalBoundary: buildInventoryOrganizationalBoundary(msmeData, resolvedOrgBoundary),
      operationalBoundary: boundary
    });

    return governanceService.applyGovernanceToAssessment(assessment, {
      boundary,
      organizationalBoundary: resolvedOrgBoundary,
      includedTransactions: included,
      excludedCount: excluded.length,
      msmeData
    });
  }

  /**
   * Async footprint path: uses the same aggregation as calculateMSMECarbonFootprint but runs
   * calculateTransactionCarbonFootprintForAgent per transaction so fuel-price and RAG runtime
   * factors apply consistently (multi-agent–aligned transaction analysis).
   */
  async calculateMSMECarbonFootprintAsync(msmeData, transactions = []) {
    const assessment = this.createEmptyMSMECarbonAssessment(msmeData);
    const boundary = normalizeGhgOperationalBoundary(
      msmeData.operations?.ghgOperationalBoundary || {},
      {}
    );
    const organizationalBoundary = normalizeGhgOrganizationalBoundary(
      msmeData.manufacturingProfile?.ghgOrganizationalBoundary || {},
      {}
    );
    const { included, excluded, organizationalBoundary: orgBoundary } = governanceService.prepareTransactionsForInventory(
      transactions,
      msmeData
    );
    const resolvedOrgBoundary = orgBoundary || organizationalBoundary;
    assessment.boundaryGovernance = {
      operationalBoundary: boundary,
      organizationalBoundary: resolvedOrgBoundary,
      includedTransactionCount: included.length,
      excludedTransactionCount: excluded.length
    };

    const runtimeContext = {
      msmeData: {
        ...msmeData,
        manufacturingProfile: msmeData.manufacturingProfile || {}
      },
      __fuelPriceCache: {}
    };

    for (const transaction of included) {
      const enrichedTransaction = {
        ...transaction,
        industry: transaction.industry || msmeData.industry,
        businessDomain: transaction.businessDomain || msmeData.businessDomain,
        manufacturingProfile: transaction.manufacturingProfile || msmeData.manufacturingProfile || {}
      };

      const carbonData = await this.calculateTransactionCarbonFootprintForAgent(
        enrichedTransaction,
        { ...runtimeContext, boundary, reportingMode: 'compliance' }
      );
      transaction.carbonFootprint = carbonData;

      assessment.totalCO2Emissions += carbonData.co2Emissions;

      this.updateBreakdown(assessment.breakdown, enrichedTransaction, carbonData.co2Emissions);
      this.updateESGScopes(assessment.esgScopes, enrichedTransaction, carbonData.co2Emissions, boundary);
    }

    this.finalizeESGScopeMetrics(assessment.esgScopes, assessment.totalCO2Emissions);

    this.attachAssessmentSpendAndCounts(assessment, included);

    assessment.carbonScore = this.calculateCarbonScore(assessment, msmeData);
    assessment.recommendations = this.generateRecommendations(assessment, msmeData);

    assessment.inventoryMetadata = carbonEmissionAnalytics.aggregateInventoryMetadata(included, {
      organizationalBoundary: buildInventoryOrganizationalBoundary(msmeData, resolvedOrgBoundary),
      operationalBoundary: boundary
    });

    return governanceService.applyGovernanceToAssessment(assessment, {
      boundary,
      organizationalBoundary: resolvedOrgBoundary,
      includedTransactions: included,
      excludedCount: excluded.length,
      msmeData
    });
  }

  updateBreakdown(breakdown, transaction, co2Emissions) {
    const { category, amount, subcategory } = transaction;

    switch (category) {
      case 'energy':
        if (carbonCategoryTaxonomy.isEnergyRenewableSubcategory(subcategory)) {
          breakdown.energy.renewable += co2Emissions;
        } else if (carbonCategoryTaxonomy.isEnergyElectricitySubcategory(subcategory)) {
          breakdown.energy.electricity += co2Emissions;
        } else if (carbonCategoryTaxonomy.isEnergyFuelSubcategory(subcategory)) {
          breakdown.energy.fuel += co2Emissions;
        } else {
          breakdown.energy.electricity += co2Emissions;
        }
        breakdown.energy.total += co2Emissions;
        break;

      case 'utilities':
      case 'telecom':
        breakdown.energy.electricity += co2Emissions;
        breakdown.energy.total += co2Emissions;
        break;

      case 'water':
        breakdown.water.consumption += amount / (this.unitPrices?.water || 0.5);
        breakdown.water.co2Emissions += co2Emissions;
        break;

      case 'waste_management':
        if (subcategory === 'hazardous') {
          breakdown.waste.hazardous += co2Emissions;
        } else if (subcategory === 'recycling') {
          breakdown.waste.recycled += co2Emissions;
        } else {
          breakdown.waste.solid += co2Emissions;
        }
        breakdown.waste.total += co2Emissions;
        break;

      case 'transportation':
        breakdown.transportation.co2Emissions += co2Emissions;
        breakdown.transportation.vehicleCount += 1;
        break;

      case 'raw_materials':
        breakdown.materials.consumption += amount;
        breakdown.materials.co2Emissions += co2Emissions;
        if (subcategory) {
          breakdown.materials.type = subcategory;
        }
        break;

      case 'equipment':
      case 'maintenance':
        breakdown.manufacturing.co2Emissions += co2Emissions;
        break;
    }
  }

  applyScope3InventoryEmissions(esgScopes, transaction, scope3Kg, operationalBoundary = {}) {
    const scope3Cat = ghgGovernance.resolveScope3CategoryNumber(transaction);
    const includedCats = Array.isArray(operationalBoundary.scope3CategoriesIncluded)
      ? operationalBoundary.scope3CategoriesIncluded
      : null;
    if (scope3Cat && includedCats && !includedCats.includes(scope3Cat)) {
      return;
    }

    esgScopes.scope3.total += scope3Kg;
    const ghgCategory = transaction.carbonFootprint?.ghgScope3Category
      || carbonEmissionAnalytics.resolveScope3GhgCategory(transaction);
    const breakdownKey = carbonEmissionAnalytics.mapScope3CategoryToEsgBreakdownKey(ghgCategory);
    if (esgScopes.scope3.breakdown[breakdownKey] !== undefined) {
      esgScopes.scope3.breakdown[breakdownKey] += scope3Kg;
      this.updateScope3Parameters(esgScopes.scope3.parameters, transaction, scope3Kg, breakdownKey);
    } else {
      esgScopes.scope3.breakdown.other += scope3Kg;
    }
    if (!esgScopes.scope3.ghgCategories) {
      esgScopes.scope3.ghgCategories = {};
    }
    esgScopes.scope3.ghgCategories[ghgCategory] =
      (esgScopes.scope3.ghgCategories[ghgCategory] || 0) + scope3Kg;
  }

  updateESGScopes(esgScopes, transaction, co2Emissions, operationalBoundary = {}) {
    if (ghgGovernance.isNonInventoryTransaction(transaction) || this.isOffsetOrRemovalTransaction(transaction)) {
      return;
    }
    if (transaction.boundaryEvaluation?.includeInInventory === false) {
      return;
    }

    const footprintBreakdown = transaction.carbonFootprint?.emissionBreakdown;
    const hasFeraSplit = footprintBreakdown
      && footprintBreakdown.scope3 > 0
      && (this.isScope1Emission(transaction) || this.isScope2Emission(transaction));

    if (hasFeraSplit) {
      const directScope1 = footprintBreakdown.scope1 || 0;
      const directScope2 = footprintBreakdown.scope2 || 0;
      const feraScope3 = footprintBreakdown.scope3 || 0;
      const directOnlyTransaction = {
        ...transaction,
        carbonFootprint: {
          ...transaction.carbonFootprint,
          emissionBreakdown: {
            scope1: directScope1,
            scope2: directScope2,
            scope3: 0
          },
          feraSupplement: null
        }
      };

      if (directScope1 > 0) {
        this.updateESGScopes(
          esgScopes,
          directOnlyTransaction,
          directScope1,
          operationalBoundary
        );
      } else if (directScope2 > 0) {
        this.updateESGScopes(
          esgScopes,
          directOnlyTransaction,
          directScope2,
          operationalBoundary
        );
      }

      if (feraScope3 > 0) {
        this.applyScope3InventoryEmissions(
          esgScopes,
          {
            ...transaction,
            carbonFootprint: {
              ...transaction.carbonFootprint,
              ghgScope3Category: 'cat3_fuel_energy_related'
            }
          },
          feraScope3,
          operationalBoundary
        );
      }
      return;
    }

    const estimatedScope = ghgGovernance.inferEstimatedScope(transaction);
    if (estimatedScope === 'scope3') {
      const scope3Cat = ghgGovernance.resolveScope3CategoryNumber(transaction);
      const includedCats = Array.isArray(operationalBoundary.scope3CategoriesIncluded)
        ? operationalBoundary.scope3CategoriesIncluded
        : null;
      if (scope3Cat && includedCats && !includedCats.includes(scope3Cat)) {
        return;
      }
    }

    const { category, subcategory, description } = transaction;

    // Scope 1: Direct emissions from owned or controlled sources
    if (this.isScope1Emission(transaction)) {
      esgScopes.scope1.total += co2Emissions;

      if (category === 'energy' && subcategory !== 'renewable' && subcategory !== 'grid') {
        esgScopes.scope1.breakdown.directFuel += co2Emissions;
        this.updateScope1Parameters(esgScopes.scope1.parameters, transaction, co2Emissions, 'fuel');
      } else if (category === 'transportation') {
        esgScopes.scope1.breakdown.directTransport += co2Emissions;
        this.updateScope1Parameters(esgScopes.scope1.parameters, transaction, co2Emissions, 'transport');
      } else if (category === 'equipment' || category === 'maintenance') {
        esgScopes.scope1.breakdown.directManufacturing += co2Emissions;
        this.updateScope1Parameters(esgScopes.scope1.parameters, transaction, co2Emissions, 'manufacturing');
      } else if (description && description.toLowerCase().includes('fugitive')) {
        esgScopes.scope1.breakdown.fugitiveEmissions += co2Emissions;
      } else if (description && description.toLowerCase().includes('process')) {
        esgScopes.scope1.breakdown.processEmissions += co2Emissions;
      } else if (description && description.toLowerCase().includes('stationary')) {
        esgScopes.scope1.breakdown.stationaryCombustion += co2Emissions;
      } else if (description && description.toLowerCase().includes('mobile')) {
        esgScopes.scope1.breakdown.mobileCombustion += co2Emissions;
      }
    }

    // Scope 2: Indirect emissions from purchased energy
    else if (this.isScope2Emission(transaction)) {
      esgScopes.scope2.total += co2Emissions;

      if (category === 'energy') {
        // Any purchased-energy (electricity) row that reaches Scope 2 belongs in the
        // electricity bucket; on-site fuel combustion was already routed to Scope 1.
        esgScopes.scope2.breakdown.electricity += co2Emissions;
        this.updateScope2Parameters(esgScopes.scope2.parameters, transaction, co2Emissions, 'electricity');
      } else if (description && description.toLowerCase().includes('heating')) {
        esgScopes.scope2.breakdown.heating += co2Emissions;
        this.updateScope2Parameters(esgScopes.scope2.parameters, transaction, co2Emissions, 'heating');
      } else if (description && description.toLowerCase().includes('cooling')) {
        esgScopes.scope2.breakdown.cooling += co2Emissions;
        this.updateScope2Parameters(esgScopes.scope2.parameters, transaction, co2Emissions, 'cooling');
      } else if (description && description.toLowerCase().includes('steam')) {
        esgScopes.scope2.breakdown.steam += co2Emissions;
        this.updateScope2Parameters(esgScopes.scope2.parameters, transaction, co2Emissions, 'steam');
      } else if (description && description.toLowerCase().includes('district heating')) {
        esgScopes.scope2.breakdown.districtHeating += co2Emissions;
      } else if (description && description.toLowerCase().includes('district cooling')) {
        esgScopes.scope2.breakdown.districtCooling += co2Emissions;
      }
    }

    // Scope 3: All other indirect emissions (GHG Protocol category mapping)
    else if (!this.isScope4Emission(transaction)) {
      esgScopes.scope3.total += co2Emissions;

      const ghgCategory = transaction.carbonFootprint?.ghgScope3Category
        || carbonEmissionAnalytics.resolveScope3GhgCategory(transaction);
      const breakdownKey = carbonEmissionAnalytics.mapScope3CategoryToEsgBreakdownKey(ghgCategory);
      if (esgScopes.scope3.breakdown[breakdownKey] !== undefined) {
        esgScopes.scope3.breakdown[breakdownKey] += co2Emissions;
        this.updateScope3Parameters(esgScopes.scope3.parameters, transaction, co2Emissions, breakdownKey);
      } else {
        esgScopes.scope3.breakdown.other += co2Emissions;
      }
      if (!esgScopes.scope3.ghgCategories) {
        esgScopes.scope3.ghgCategories = {};
      }
      esgScopes.scope3.ghgCategories[ghgCategory] =
        (esgScopes.scope3.ghgCategories[ghgCategory] || 0) + co2Emissions;
    }

    // Scope 4: Avoided emissions and positive climate impact
    else if (this.isScope4Emission(transaction)) {
      const avoidedEmissions = this.calculateAvoidedEmissions(transaction);
      esgScopes.scope4.total += avoidedEmissions;

      if (description && description.toLowerCase().includes('renewable')) {
        esgScopes.scope4.breakdown.renewableEnergyCredits += avoidedEmissions;
        this.updateScope4Parameters(esgScopes.scope4.parameters, transaction, avoidedEmissions, 'renewableEnergy');
      } else if (description && description.toLowerCase().includes('efficiency')) {
        esgScopes.scope4.breakdown.energyEfficiency += avoidedEmissions;
        this.updateScope4Parameters(esgScopes.scope4.parameters, transaction, avoidedEmissions, 'energyEfficiency');
      } else if (description && description.toLowerCase().includes('waste reduction')) {
        esgScopes.scope4.breakdown.wasteReduction += avoidedEmissions;
        this.updateScope4Parameters(esgScopes.scope4.parameters, transaction, avoidedEmissions, 'wasteReduction');
      } else if (description && description.toLowerCase().includes('sustainable transport')) {
        esgScopes.scope4.breakdown.greenTransportation += avoidedEmissions;
        this.updateScope4Parameters(esgScopes.scope4.parameters, transaction, avoidedEmissions, 'sustainableTransport');
      } else if (description && description.toLowerCase().includes('carbon capture')) {
        esgScopes.scope4.breakdown.carbonCapture += avoidedEmissions;
        this.updateScope4Parameters(esgScopes.scope4.parameters, transaction, avoidedEmissions, 'carbonCapture');
      } else if (description && description.toLowerCase().includes('offset')) {
        esgScopes.scope4.breakdown.carbonOffsets += avoidedEmissions;
      } else {
        esgScopes.scope4.breakdown.avoidedEmissions += avoidedEmissions;
      }
    }
  }

  // Scope classification delegates to the single canonical GHG classifier
  // (shared/ghgInventoryGovernance.inferEstimatedScope) so the direct path and the
  // AI-agent path can never drift apart. Per the GHG Protocol: on-site fuel
  // combustion and owned-fleet transport are Scope 1; purchased electricity is
  // Scope 2; purchased goods/services and capital goods (equipment/maintenance)
  // are Scope 3.
  isScope1Emission(transaction = {}) {
    return ghgGovernance.inferEstimatedScope(transaction) === 'scope1';
  }

  isScope2Emission(transaction = {}) {
    return ghgGovernance.inferEstimatedScope(transaction) === 'scope2';
  }

  finalizeESGScopeMetrics(esgScopes, totalCO2Emissions = 0) {
    if (!esgScopes || typeof esgScopes !== 'object') {
      return;
    }

    const contributingScopes = ['scope1', 'scope2', 'scope3'];
    const contributingTotal = contributingScopes.reduce((sum, scopeKey) => {
      return sum + (Number(esgScopes?.[scopeKey]?.total) || 0);
    }, 0);

    const denominator = contributingTotal > 0
      ? contributingTotal
      : (Number(totalCO2Emissions) || 0);

    Object.entries(esgScopes).forEach(([scopeKey, scopeData]) => {
      if (!scopeData || typeof scopeData !== 'object') {
        return;
      }

      scopeData.total = this.roundTo(scopeData.total, 2);

      if (scopeKey === 'scope4') {
        const baseTotal = Number(totalCO2Emissions) || 0;
        scopeData.percentage = baseTotal > 0
          ? this.roundTo((scopeData.total / baseTotal) * 100, 2)
          : 0;
      } else {
        scopeData.percentage = denominator > 0
          ? this.roundTo((scopeData.total / denominator) * 100, 2)
          : 0;
      }

      if (scopeData.breakdown && typeof scopeData.breakdown === 'object') {
        Object.keys(scopeData.breakdown).forEach(key => {
          scopeData.breakdown[key] = this.roundTo(scopeData.breakdown[key], 2);
        });
      }

      if (scopeData.parameters && typeof scopeData.parameters === 'object') {
        this.roundScopeParameterMetrics(scopeData.parameters);
      }
    });
  }

  roundScopeParameterMetrics(parameters = {}) {
    const metricKeys = ['totalEmissions', 'totalAvoidedEmissions', 'averageAmount', 'totalAmount'];
    Object.values(parameters).forEach(entry => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      metricKeys.forEach(metricKey => {
        if (entry[metricKey] !== undefined) {
          entry[metricKey] = this.roundTo(entry[metricKey], 2);
        }
      });
    });
  }

  roundTo(value, decimals = 2) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0;
    }
    const factor = Math.pow(10, decimals);
    return Math.round(numeric * factor) / factor;
  }

  toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  mapExtractedCalculationToAssessment(calculation = {}, msmeProfile = {}) {
    const energyDetails = calculation.breakdown?.energy?.details || {};
    const energyCo2 = this.toFiniteNumber(calculation.breakdown?.energy?.co2, 0);
    const wasteDetails = calculation.breakdown?.waste?.details || {};
    const wasteCo2 = this.toFiniteNumber(calculation.breakdown?.waste?.co2, 0);
    const renewablePct = this.toFiniteNumber(energyDetails.renewable, 0);
    const renewableCo2 = energyCo2 * (renewablePct / 100);
    const gridCo2 = Math.max(0, energyCo2 - renewableCo2);
    const totalSpend = this.toFiniteNumber(
      calculation.totalSpend
        ?? calculation.totalAmount
        ?? msmeProfile.annualTurnover
        ?? msmeProfile.financials?.annualTurnoverInr,
      100000
    );

    return {
      totalCO2Emissions: this.toFiniteNumber(calculation.totalCO2Emissions, 0),
      totalSpend,
      totalAmount: totalSpend,
      breakdown: {
        energy: {
          total: energyCo2,
          electricity: gridCo2,
          fuel: this.toFiniteNumber(energyDetails.fuelCO2 ?? energyDetails.fuel, 0),
          renewable: renewableCo2
        },
        waste: {
          total: wasteCo2,
          solid: this.toFiniteNumber(wasteDetails.solid, 0),
          hazardous: this.toFiniteNumber(wasteDetails.hazardous, 0),
          recycled: this.toFiniteNumber(wasteDetails.recycled, 0)
        }
      }
    };
  }

  applyCanonicalCarbonScore(calculation = {}, msmeProfile = {}) {
    const assessment = this.mapExtractedCalculationToAssessment(calculation, msmeProfile);
    const carbonScore = this.calculateCarbonScore(assessment, msmeProfile);
    return {
      carbonScore,
      sustainabilityRating: carbonRating.getRating(carbonScore),
      assessment
    };
  }

  calculateCarbonScore(assessment, msmeData) {
    return carbonScoreCalculation.calculateCarbonScore(assessment, msmeData);
  }

  resolveCurrentCarbonScore({
    enrichedLatestAssessment = null,
    latestAssessment = null,
    msmeData = null,
    totalCO2Emissions = 0,
    periodTransactions = []
  } = {}) {
    const profileScore = Number(msmeData?.carbonScore);
    let currentScore = Number(enrichedLatestAssessment?.carbonScore) || 0;

    if (currentScore <= 0 && enrichedLatestAssessment && msmeData) {
      currentScore = this.calculateCarbonScore(enrichedLatestAssessment, msmeData);
    } else if (currentScore <= 0 && Number.isFinite(profileScore) && profileScore > 0) {
      currentScore = profileScore;
    } else if (currentScore <= 0 && totalCO2Emissions > 0 && msmeData) {
      const totalAmount = this.sumIncludedTransactionAmounts(periodTransactions);
      currentScore = this.calculateCarbonScore({
        totalCO2Emissions,
        totalAmount,
        totalSpend: totalAmount,
        transactionCount: periodTransactions.length,
        breakdown: enrichedLatestAssessment?.breakdown
          || latestAssessment?.breakdown
          || {}
      }, msmeData);
    }

    return currentScore;
  }

  enrichAssessmentForAnalytics(assessment = {}, msmeData = {}, transactions = []) {
    if (!assessment || typeof assessment !== 'object') {
      return assessment;
    }
    const enriched = typeof assessment.toObject === 'function'
      ? assessment.toObject()
      : { ...assessment };

    const hasSpend = this.toFiniteNumber(enriched.totalSpend ?? enriched.totalAmount, 0) > 0;
    if (!hasSpend && Array.isArray(transactions) && transactions.length > 0) {
      const totalAmount = this.sumIncludedTransactionAmounts(transactions);
      if (totalAmount > 0) {
        enriched.totalAmount = this.roundTo(totalAmount, 2);
        enriched.totalSpend = enriched.totalAmount;
      }
    }

    const storedScore = this.toFiniteNumber(enriched.carbonScore, 0);
    const shouldRecalculateScore = storedScore <= 0
      || (!hasSpend && this.toFiniteNumber(enriched.totalSpend ?? enriched.totalAmount, 0) > 0);
    if (shouldRecalculateScore) {
      enriched.carbonScore = this.calculateCarbonScore(enriched, msmeData);
    }

    return enriched;
  }

  getDomainScoreAdjustments(businessDomain, _assessment) {
    return carbonScoreCalculation.getDomainScoreAdjustments(businessDomain);
  }

  generateRecommendations(assessment, msmeData) {
    const recommendations = [];
    const breakdown = assessment?.breakdown && typeof assessment.breakdown === 'object'
      ? assessment.breakdown
      : {};

    // Domain-specific recommendations
    const domainRecommendations = this.getDomainSpecificRecommendations(msmeData?.businessDomain, assessment);
    recommendations.push(...domainRecommendations);

    const {
      energyTotal,
      wasteTotal,
      transportationCo2,
      materialsCo2,
      waterCo2
    } = this.resolveBreakdownEmissionTotals(breakdown);

    // Energy recommendations
    if (energyTotal > 500) {
      recommendations.push({
        category: 'energy',
        title: 'Switch to Renewable Energy',
        description: 'Consider installing solar panels or purchasing renewable energy credits',
        priority: 'high',
        potentialCO2Reduction: energyTotal * 0.3,
        implementationCost: 50000,
        paybackPeriod: 24
      });
    }

    // Waste management recommendations
    if (wasteTotal > 100) {
      recommendations.push({
        category: 'waste',
        title: 'Improve Waste Recycling',
        description: 'Implement comprehensive waste segregation and recycling program',
        priority: 'medium',
        potentialCO2Reduction: wasteTotal * 0.4,
        implementationCost: 10000,
        paybackPeriod: 12
      });
    }

    // Transportation recommendations
    if (transportationCo2 > 50) {
      recommendations.push({
        category: 'transportation',
        title: 'Optimize Transportation',
        description: 'Use fuel-efficient vehicles and optimize delivery routes',
        priority: 'medium',
        potentialCO2Reduction: transportationCo2 * 0.2,
        implementationCost: 20000,
        paybackPeriod: 18
      });
    }

    // Material sourcing recommendations
    if (materialsCo2 > 200) {
      recommendations.push({
        category: 'materials',
        title: 'Source Local Materials',
        description: 'Reduce transportation emissions by sourcing materials locally',
        priority: 'low',
        potentialCO2Reduction: materialsCo2 * 0.15,
        implementationCost: 5000,
        paybackPeriod: 6
      });
    }

    if (waterCo2 > 20) {
      recommendations.push({
        category: 'water',
        title: 'Reduce Water-Related Emissions',
        description: 'Improve water efficiency and treatment to lower utility-linked CO₂ impacts',
        priority: 'low',
        potentialCO2Reduction: waterCo2 * 0.25,
        implementationCost: 15000,
        paybackPeriod: 18
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        category: 'general',
        title: 'Complete your baseline assessment',
        description: 'Upload operational documents and transactions to unlock targeted reduction actions.',
        priority: 'medium',
        potentialCO2Reduction: Number(assessment?.totalCO2Emissions || 0) * 0.05,
        implementationCost: 0,
        paybackPeriod: 0
      });
    }

    return recommendations;
  }

  getDomainSpecificRecommendations(businessDomain, assessment) {
    const recommendations = [];
    const breakdown = assessment?.breakdown && typeof assessment.breakdown === 'object'
      ? assessment.breakdown
      : {};
    const {
      energyTotal,
      wasteTotal,
      transportationCo2,
      materialsCo2
    } = this.resolveBreakdownEmissionTotals(breakdown);

    switch (businessDomain) {
      case 'manufacturing':
        if (energyTotal > 500) {
          recommendations.push({
            category: 'energy',
            title: 'Manufacturing Energy Efficiency',
            description: 'Implement energy-efficient manufacturing processes and equipment upgrades',
            priority: 'high',
            potentialCO2Reduction: energyTotal * 0.3,
            implementationCost: 75000,
            paybackPeriod: 24
          });
        }
        if (materialsCo2 > 200) {
          recommendations.push({
            category: 'materials',
            title: 'Sustainable Material Sourcing',
            description: 'Source eco-friendly raw materials and implement circular economy practices',
            priority: 'high',
            potentialCO2Reduction: materialsCo2 * 0.25,
            implementationCost: 50000,
            paybackPeriod: 18
          });
        }
        break;

      case 'trading':
        if (transportationCo2 > 100) {
          recommendations.push({
            category: 'transportation',
            title: 'Trading Logistics Optimization',
            description: 'Optimize supply chain routes and implement consolidated shipping',
            priority: 'high',
            potentialCO2Reduction: transportationCo2 * 0.3,
            implementationCost: 25000,
            paybackPeriod: 12
          });
        }
        break;

      case 'services':
        if (energyTotal > 200) {
          recommendations.push({
            category: 'energy',
            title: 'Service Industry Energy Efficiency',
            description: 'Implement smart office solutions and remote work policies',
            priority: 'medium',
            potentialCO2Reduction: energyTotal * 0.4,
            implementationCost: 20000,
            paybackPeriod: 15
          });
        }
        break;

      case 'export_import':
        recommendations.push({
          category: 'transportation',
          title: 'Green Export/Import Operations',
          description: 'Use carbon-neutral shipping options and optimize international logistics',
          priority: 'high',
          potentialCO2Reduction: transportationCo2 * 0.35,
          implementationCost: 40000,
          paybackPeriod: 18
        });
        break;

      case 'retail':
        if (materialsCo2 > 150) {
          recommendations.push({
            category: 'materials',
            title: 'Sustainable Retail Packaging',
            description: 'Switch to biodegradable packaging and reduce single-use plastics',
            priority: 'high',
            potentialCO2Reduction: materialsCo2 * 0.4,
            implementationCost: 30000,
            paybackPeriod: 12
          });
        }
        break;

      case 'wholesale':
        if (transportationCo2 > 150) {
          recommendations.push({
            category: 'transportation',
            title: 'Wholesale Distribution Optimization',
            description: 'Implement bulk shipping and route optimization for wholesale operations',
            priority: 'high',
            potentialCO2Reduction: transportationCo2 * 0.25,
            implementationCost: 35000,
            paybackPeriod: 15
          });
        }
        break;

      case 'e_commerce':
        if (transportationCo2 > 120) {
          recommendations.push({
            category: 'transportation',
            title: 'E-commerce Last-Mile Optimization',
            description: 'Implement electric delivery vehicles and carbon-neutral shipping options',
            priority: 'high',
            potentialCO2Reduction: transportationCo2 * 0.3,
            implementationCost: 45000,
            paybackPeriod: 20
          });
        }
        break;

      case 'consulting':
        recommendations.push({
          category: 'energy',
          title: 'Digital-First Consulting',
          description: 'Maximize virtual meetings and digital document management',
          priority: 'medium',
          potentialCO2Reduction: energyTotal * 0.5,
          implementationCost: 10000,
          paybackPeriod: 6
        });
        break;

      case 'logistics':
        recommendations.push({
          category: 'transportation',
          title: 'Green Logistics Fleet',
          description: 'Transition to electric or hybrid vehicles and optimize delivery routes',
          priority: 'high',
          potentialCO2Reduction: transportationCo2 * 0.4,
          implementationCost: 100000,
          paybackPeriod: 30
        });
        break;

      case 'agriculture':
        recommendations.push({
          category: 'energy',
          title: 'Sustainable Agriculture Practices',
          description: 'Implement solar irrigation and organic farming techniques',
          priority: 'high',
          potentialCO2Reduction: energyTotal * 0.3,
          implementationCost: 60000,
          paybackPeriod: 24
        });
        break;

      case 'handicrafts':
        recommendations.push({
          category: 'materials',
          title: 'Traditional Craft Sustainability',
          description: 'Use locally sourced, sustainable materials and traditional techniques',
          priority: 'medium',
          potentialCO2Reduction: materialsCo2 * 0.2,
          implementationCost: 15000,
          paybackPeriod: 12
        });
        break;

      case 'food_processing':
        if (energyTotal > 300) {
          recommendations.push({
            category: 'energy',
            title: 'Food Processing Energy Efficiency',
            description: 'Implement energy-efficient processing equipment and waste-to-energy systems',
            priority: 'high',
            potentialCO2Reduction: energyTotal * 0.35,
            implementationCost: 80000,
            paybackPeriod: 20
          });
        }
        break;

      case 'textiles':
        recommendations.push({
          category: 'materials',
          title: 'Sustainable Textile Production',
          description: 'Use organic cotton and implement water recycling systems',
          priority: 'high',
          potentialCO2Reduction: materialsCo2 * 0.3,
          implementationCost: 70000,
          paybackPeriod: 24
        });
        break;

      case 'electronics':
        recommendations.push({
          category: 'materials',
          title: 'Electronics Circular Economy',
          description: 'Implement e-waste recycling and sustainable component sourcing',
          priority: 'high',
          potentialCO2Reduction: materialsCo2 * 0.25,
          implementationCost: 50000,
          paybackPeriod: 18
        });
        break;

      case 'automotive':
        recommendations.push({
          category: 'materials',
          title: 'Green Automotive Manufacturing',
          description: 'Use lightweight materials and implement electric vehicle components',
          priority: 'high',
          potentialCO2Reduction: materialsCo2 * 0.4,
          implementationCost: 150000,
          paybackPeriod: 36
        });
        break;

      case 'construction':
        recommendations.push({
          category: 'materials',
          title: 'Sustainable Construction Materials',
          description: 'Use green building materials and implement waste reduction practices',
          priority: 'high',
          potentialCO2Reduction: materialsCo2 * 0.35,
          implementationCost: 100000,
          paybackPeriod: 30
        });
        break;

      case 'healthcare':
        recommendations.push({
          category: 'energy',
          title: 'Healthcare Energy Efficiency',
          description: 'Implement energy-efficient medical equipment and smart building systems',
          priority: 'medium',
          potentialCO2Reduction: energyTotal * 0.25,
          implementationCost: 60000,
          paybackPeriod: 24
        });
        break;

      case 'education':
        recommendations.push({
          category: 'energy',
          title: 'Green Campus Initiative',
          description: 'Implement solar power and digital learning platforms',
          priority: 'medium',
          potentialCO2Reduction: energyTotal * 0.4,
          implementationCost: 40000,
          paybackPeriod: 18
        });
        break;

      case 'tourism':
        recommendations.push({
          category: 'transportation',
          title: 'Sustainable Tourism Practices',
          description: 'Promote eco-tourism and carbon-neutral travel options',
          priority: 'medium',
          potentialCO2Reduction: transportationCo2 * 0.2,
          implementationCost: 25000,
          paybackPeriod: 15
        });
        break;
    }

    return recommendations;
  }

  // Calculate carbon savings for MSMEs
  calculateCarbonSavings(msmeData, currentAssessment, previousAssessment = null) {
    const savings = {
      totalSavings: 0,
      periodSavings: 0,
      categorySavings: {
        energy: 0,
        water: 0,
        waste: 0,
        transportation: 0,
        materials: 0,
        manufacturing: 0
      },
      implementedRecommendations: 0,
      potentialSavings: 0,
      savingsPercentage: 0,
      benchmarkComparison: {
        industryAverage: 0,
        bestInClass: 0,
        performance: 'average'
      },
      trends: {
        monthly: [],
        quarterly: [],
        yearly: []
      },
      achievements: [],
      nextMilestones: []
    };

    // Calculate period savings if previous assessment exists
    if (previousAssessment) {
      savings.periodSavings = previousAssessment.totalCO2Emissions - currentAssessment.totalCO2Emissions;
      savings.savingsPercentage = previousAssessment.totalCO2Emissions > 0 ?
        (savings.periodSavings / previousAssessment.totalCO2Emissions) * 100 : 0;
    }

    // Calculate category-wise savings
    if (previousAssessment) {
      Object.keys(savings.categorySavings).forEach(category => {
        const current = currentAssessment.breakdown[category]?.total || 0;
        const previous = previousAssessment.breakdown[category]?.total || 0;
        savings.categorySavings[category] = previous - current;
      });
    }

    // Calculate total savings (sum of all category savings)
    savings.totalSavings = Object.values(savings.categorySavings).reduce((sum, val) => sum + val, 0);

    // Count implemented recommendations
    savings.implementedRecommendations = currentAssessment.recommendations.filter(rec => rec.isImplemented).length;

    // Calculate potential savings from unimplemented recommendations
    savings.potentialSavings = currentAssessment.recommendations
      .filter(rec => !rec.isImplemented)
      .reduce((sum, rec) => sum + (rec.potentialCO2Reduction || 0), 0);

    // Set industry benchmarks based on company type and industry
    const industryBenchmarks = this.getIndustryBenchmarks(msmeData.industry, msmeData.companyType);
    savings.benchmarkComparison = {
      industryAverage: industryBenchmarks.average,
      bestInClass: industryBenchmarks.bestInClass,
      performance: this.calculatePerformanceLevel(currentAssessment.totalCO2Emissions, industryBenchmarks)
    };

    // Generate achievements based on savings
    savings.achievements = this.generateAchievements(savings, currentAssessment, msmeData);

    // Generate next milestones
    savings.nextMilestones = this.generateNextMilestones(savings, currentAssessment, msmeData);

    return savings;
  }

  normalizeManufacturingSectorName(sector = '') {
    const normalized = String(sector || '').toLowerCase().trim();
    if (!normalized) return null;

    if (normalized.includes('steel') || normalized.includes('metal')) return 'steel_and_metals';
    if (normalized.includes('cement') || normalized.includes('material')) return 'cement_and_materials';
    if (normalized.includes('chemical')) return 'chemicals';
    if (normalized.includes('textile')) return 'textiles_wet';
    if (normalized.includes('engineering')) return 'engineering_msmes';
    if (normalized.includes('food')) return 'food_processing';
    if (normalized.includes('plastic')) return 'plastics';
    if (normalized.includes('electronic')) return 'electronics';

    return null;
  }

  getManufacturingSectorComplianceProfile(sector, businessDomain = 'manufacturing') {
    if (String(businessDomain || '').toLowerCase() !== 'manufacturing') {
      return null;
    }

    const sectorKey = this.normalizeManufacturingSectorName(sector);
    if (!sectorKey) {
      return null;
    }

    const profile = this.manufacturingSectorComplianceProfiles[sectorKey];
    if (!profile) {
      return null;
    }

    return {
      sectorKey,
      ...profile
    };
  }

  getIndustryBenchmarks(industry, companyType) {
    // Industry-specific CO2 emissions per unit of production (kg CO2 per ₹1000 turnover)
    const industryFactors = {
      manufacturing: { average: 2.5, bestInClass: 1.2 },
      textiles: { average: 3.2, bestInClass: 1.8 },
      food: { average: 1.8, bestInClass: 1.0 },
      chemicals: { average: 4.5, bestInClass: 2.8 },
      electronics: { average: 2.8, bestInClass: 1.5 },
      automotive: { average: 3.8, bestInClass: 2.2 },
      pharmaceuticals: { average: 3.5, bestInClass: 2.0 }
    };

    // Company size multipliers
    const sizeMultipliers = {
      micro: 1.2,
      small: 1.0,
      medium: 0.8
    };

    const baseBenchmark = industryFactors[industry] || industryFactors.manufacturing;
    const sizeMultiplier = sizeMultipliers[companyType] || 1.0;

    return {
      average: baseBenchmark.average * sizeMultiplier,
      bestInClass: baseBenchmark.bestInClass * sizeMultiplier
    };
  }

  calculatePerformanceLevel(currentEmissions, benchmarks) {
    const efficiency = currentEmissions / benchmarks.average;

    if (efficiency <= 0.6) return 'excellent';
    if (efficiency <= 0.8) return 'good';
    if (efficiency <= 1.0) return 'average';
    if (efficiency <= 1.2) return 'below_average';
    return 'poor';
  }

  generateAchievements(savings, assessment, _msmeData) {
    const achievements = [];

    // Carbon reduction achievements
    if (savings.savingsPercentage >= 20) {
      achievements.push({
        type: 'carbon_reduction',
        title: 'Carbon Reduction Champion',
        description: `Achieved ${savings.savingsPercentage.toFixed(1)}% reduction in carbon emissions`,
        level: 'gold',
        co2Saved: savings.periodSavings
      });
    } else if (savings.savingsPercentage >= 10) {
      achievements.push({
        type: 'carbon_reduction',
        title: 'Green Progress',
        description: `Achieved ${savings.savingsPercentage.toFixed(1)}% reduction in carbon emissions`,
        level: 'silver',
        co2Saved: savings.periodSavings
      });
    }

    // Recommendation implementation achievements
    if (savings.implementedRecommendations >= 5) {
      achievements.push({
        type: 'implementation',
        title: 'Sustainability Leader',
        description: `Implemented ${savings.implementedRecommendations} sustainability recommendations`,
        level: 'gold'
      });
    } else if (savings.implementedRecommendations >= 3) {
      achievements.push({
        type: 'implementation',
        title: 'Action Taker',
        description: `Implemented ${savings.implementedRecommendations} sustainability recommendations`,
        level: 'silver'
      });
    }

    // Carbon score achievements
    if (assessment.carbonScore >= 90) {
      achievements.push({
        type: 'score',
        title: 'Carbon Excellence',
        description: `Achieved carbon score of ${assessment.carbonScore}`,
        level: 'gold'
      });
    } else if (assessment.carbonScore >= 80) {
      achievements.push({
        type: 'score',
        title: 'Green Achiever',
        description: `Achieved carbon score of ${assessment.carbonScore}`,
        level: 'silver'
      });
    }

    return achievements;
  }

  generateNextMilestones(savings, assessment, _msmeData) {
    const milestones = [];

    // Carbon reduction milestones
    const nextReductionTarget = Math.max(5, Math.ceil(savings.savingsPercentage / 5) * 5 + 5);
    milestones.push({
      type: 'carbon_reduction',
      title: `${nextReductionTarget}% Carbon Reduction`,
      description: `Aim for ${nextReductionTarget}% reduction in next assessment`,
      targetValue: nextReductionTarget,
      currentValue: savings.savingsPercentage,
      priority: 'high'
    });

    // Recommendation implementation milestones
    const nextRecTarget = savings.implementedRecommendations + 2;
    milestones.push({
      type: 'recommendations',
      title: `Implement ${nextRecTarget} Recommendations`,
      description: `Implement ${nextRecTarget} sustainability recommendations`,
      targetValue: nextRecTarget,
      currentValue: savings.implementedRecommendations,
      priority: 'medium'
    });

    // Carbon score milestones
    const nextScoreTarget = Math.min(100, assessment.carbonScore + 10);
    if (nextScoreTarget > assessment.carbonScore) {
      milestones.push({
        type: 'score',
        title: `Carbon Score ${nextScoreTarget}`,
        description: `Achieve carbon score of ${nextScoreTarget}`,
        targetValue: nextScoreTarget,
        currentValue: assessment.carbonScore,
        priority: 'medium'
      });
    }

    return milestones;
  }

  updateScope1Parameters(parameters, transaction, co2Emissions, type) {
    if (!parameters[type]) {
      parameters[type] = {
        totalEmissions: 0,
        transactionCount: 0,
        averageAmount: 0,
        totalAmount: 0
      };
    }

    parameters[type].totalEmissions += co2Emissions;
    parameters[type].transactionCount += 1;
    parameters[type].totalAmount += transaction.amount;
    parameters[type].averageAmount = parameters[type].totalAmount / parameters[type].transactionCount;
  }

  updateScope2Parameters(parameters, transaction, co2Emissions, type) {
    if (!parameters[type]) {
      parameters[type] = {
        totalEmissions: 0,
        transactionCount: 0,
        averageAmount: 0,
        totalAmount: 0
      };
    }

    parameters[type].totalEmissions += co2Emissions;
    parameters[type].transactionCount += 1;
    parameters[type].totalAmount += transaction.amount;
    parameters[type].averageAmount = parameters[type].totalAmount / parameters[type].transactionCount;
  }

  isScope4Emission(transaction = {}) {
    return ghgGovernance.isNonInventoryTransaction(transaction)
      && !ghgGovernance.NON_INVENTORY_SCOPE_PATTERNS.offset.test(
        `${transaction.description || ''} ${transaction.memo || ''}`
      );
  }

  isOffsetOrRemovalTransaction(transaction = {}) {
    const desc = `${transaction.description || ''} ${transaction.memo || ''}`;
    return ghgGovernance.NON_INVENTORY_SCOPE_PATTERNS.offset.test(desc)
      || transaction.inventoryTreatment === 'offsets_reported_separately';
  }

  updateScope3Parameters(parameters, transaction, co2Emissions, type) {
    if (!parameters[type]) {
      parameters[type] = {
        totalEmissions: 0,
        transactionCount: 0,
        averageAmount: 0,
        totalAmount: 0
      };
    }

    parameters[type].totalEmissions += co2Emissions;
    parameters[type].transactionCount += 1;
    parameters[type].totalAmount += transaction.amount;
    parameters[type].averageAmount = parameters[type].totalAmount / parameters[type].transactionCount;
  }

  updateScope4Parameters(parameters, transaction, avoidedEmissions, type) {
    if (!parameters[type]) {
      parameters[type] = {
        totalAvoidedEmissions: 0,
        transactionCount: 0,
        averageAmount: 0,
        totalAmount: 0
      };
    }

    parameters[type].totalAvoidedEmissions += avoidedEmissions;
    parameters[type].transactionCount += 1;
    parameters[type].totalAmount += transaction.amount;
    parameters[type].averageAmount = parameters[type].totalAmount / parameters[type].transactionCount;
  }

  getAdvancedCalculationService() {
    if (!this._advancedCalculationService) {
      const AdvancedCarbonCalculationService = require('./advancedCarbonCalculationService');
      this._advancedCalculationService = new AdvancedCarbonCalculationService();
    }
    return this._advancedCalculationService;
  }

  /**
   * Document/bill carbon analysis entry point (delegates to advanced extraction calculator).
   */
  async calculateDocumentCarbonFootprint(extractedData, msmeProfile) {
    return this.getAdvancedCalculationService().calculateAdvancedCarbonFootprint(
      extractedData,
      msmeProfile
    );
  }
}

module.exports = new CarbonCalculationService();