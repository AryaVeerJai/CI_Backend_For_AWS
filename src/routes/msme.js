const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireMsmePlanFeature } = require('../middleware/enforceMsmePlanLimits');
const MSME = require('../models/MSME');
const Transaction = require('../models/Transaction');
const CarbonAssessment = require('../models/CarbonAssessment');
const carbonCreditsService = require('../services/carbonCreditsService');
const { getMsmePaymentQuote } = require('../services/msmePaymentQuoteService');
const workflowMultiAgentAdvisorService = require('../services/workflowMultiAgentAdvisorService');
const logger = require('../utils/logger');
const orchestrationManagerEventService = require('../services/orchestrationManagerEventService');
const { buildRegistrationAgentGuidance } = require('../services/msmeRegistrationAgentGuidance');
const { normalizeMSMEPayload } = require('../utils/manufacturingProfile');
const { generateOperationsTemplate, ensureSafeWebsiteUrl } = require('../services/operationsTemplateAgentService');
const operationsEmissionFactorAgentService = require('../services/operationsEmissionFactorAgentService');
const { normalizeGhgOperationalBoundary } = require('../utils/ghgBoundaryFields');
const { applyOperationalBoundaryToWorkflowEstimate } = require('../../../shared/ghgBoundaryCalculation');
const { runGhgBoundaryAgentOrchestration } = require('../services/ghgBoundaryAgentOrchestrator');
const { createOrganizationForMsme } = require('../services/organizationService');
const {
  syncSolarPowerFromOperations,
  applyOperationsGridAndSolarToEstimate
} = require('../utils/solarOperationsSync');

const VALID_COMPANY_TYPES = new Set(['micro', 'small', 'medium']);
const VALID_BUSINESS_DOMAINS = new Set([
  'manufacturing',
  'trading',
  'services',
  'export_import',
  'retail',
  'wholesale',
  'e_commerce',
  'consulting',
  'logistics',
  'agriculture',
  'handicrafts',
  'food_processing',
  'textiles',
  'electronics',
  'automotive',
  'construction',
  'healthcare',
  'education',
  'tourism',
  'other'
]);
const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;

const MSME_THRESHOLDS = {
  micro: { maxTurnover: 5, maxInvestment: 1 },
  small: { maxTurnover: 50, maxInvestment: 10 },
  medium: { maxTurnover: 250, maxInvestment: 50 }
};

const hasOwnField = (source, field) => Object.prototype.hasOwnProperty.call(source || {}, field);

const validateMSMEClassification = ({ companyType, annualTurnover, investment }) => {
  if (!companyType || !MSME_THRESHOLDS[companyType]) {
    return [];
  }

  const errors = [];
  const { maxTurnover, maxInvestment } = MSME_THRESHOLDS[companyType];
  const turnoverValue = Number(annualTurnover);
  const investmentValue = Number(investment);

  if (Number.isFinite(turnoverValue) && turnoverValue > maxTurnover) {
    errors.push(
      `${companyType} MSME annual turnover must be <= ₹${maxTurnover} crore`
    );
  }

  if (Number.isFinite(investmentValue) && investmentValue > maxInvestment) {
    errors.push(
      `${companyType} MSME investment must be <= ₹${maxInvestment} crore`
    );
  }

  return errors;
};

const COMMUTE_EMISSION_FACTORS = {
  car_petrol: 0.192,
  car_diesel: 0.171,
  two_wheeler: 0.075,
  bus: 0.082,
  train: 0.041,
  bike: 0.012,
  walk_cycle: 0,
  custom: 0
};

const SUPPLY_CHAIN_TRANSPORT_FACTORS = {
  road_diesel: 0.12,      // kg CO2 per ton-km
  road_petrol: 0.14,      // kg CO2 per ton-km
  road_cng: 0.09,         // kg CO2 per ton-km
  rail: 0.03,             // kg CO2 per ton-km
  sea: 0.015,             // kg CO2 per ton-km
  air: 0.6,               // kg CO2 per ton-km
  electric_vehicle: 0.04, // kg CO2 per ton-km
  custom: 0
};
const DEFAULT_VEHICLE_OWNERSHIP = 'owned';

const CHEMICAL_OPTIONS_BY_DOMAIN = {
  textiles: ['Dyes', 'Bleaching agents', 'Fixing agents', 'Softeners', 'Detergents', 'Hydrogen peroxide'],
  food_processing: ['Cleaning agents (CIP)', 'Sanitizers', 'Boiler treatment chemicals', 'Food-grade preservatives'],
  electronics: ['Flux', 'Solvents', 'Etching solutions', 'Isopropyl alcohol', 'Cleaning chemicals'],
  automotive: ['Coolants', 'Lubricants', 'Degreasers', 'Paints', 'Adhesives'],
  pharmaceuticals: ['Process solvents', 'pH modifiers', 'Disinfectants', 'Buffer solutions'],
  default: ['Acids', 'Alkalis', 'Solvents', 'Detergents', 'Disinfectants', 'Process additives']
};

const WATER_TREATMENT_OPTIONS_BY_DOMAIN = {
  textiles: ['Primary treatment', 'Biological treatment', 'Color removal', 'Zero Liquid Discharge', 'RO + MEE'],
  food_processing: ['Screening', 'Oil-water separation', 'Biological treatment', 'Disinfection', 'Reuse in utilities'],
  electronics: ['Neutralization', 'Heavy-metal precipitation', 'RO treatment', 'Ion exchange', 'Reuse in process'],
  automotive: ['Oil-water separator', 'Chemical coagulation', 'Biological treatment', 'Sludge dewatering'],
  pharmaceuticals: ['Advanced oxidation', 'Membrane bioreactor', 'Activated carbon', 'RO + evaporation'],
  default: ['Sedimentation', 'Filtration', 'Biological treatment', 'RO treatment', 'Disinfection']
};

const UPSTREAM_SUPPLY_CHAIN_TYPES = new Set(['supplier', 'inbound_logistics', 'warehouse']);
const DOWNSTREAM_SUPPLY_CHAIN_TYPES = new Set(['distributor', 'customer_delivery']);
const SUPPORT_SUPPLY_CHAIN_TYPES = new Set(['third_party_logistics', 'custom']);

const toNonNegativeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
};

const roundTo = (value, decimals = 3) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const base = 10 ** decimals;
  return Math.round(numeric * base) / base;
};

const toTextList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  if (value === undefined || value === null) {
    return [];
  }
  return String(value)
    .split(/[,;|]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const toStrictPositiveNumber = (value, fallback = null) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const normalizeTransportationVehicles = (vehicles = []) => (
  Array.isArray(vehicles)
    ? vehicles.filter(Boolean).map((vehicle) => ({
      vehicleType: String(vehicle.vehicleType || vehicle.type || 'goods_vehicle').trim(),
      fuelType: String(vehicle.fuelType || 'diesel').trim().toLowerCase(),
      ownership: String(vehicle.ownership || DEFAULT_VEHICLE_OWNERSHIP).trim().toLowerCase(),
      count: toNonNegativeNumber(vehicle.count, 1),
      monthlyDistanceKm: toNonNegativeNumber(vehicle.monthlyDistanceKm, 0)
    }))
    : []
);

const normalizeOperationsData = (operationsData = {}) => ({
  powerConsumptionKwhPerMonth: toNonNegativeNumber(operationsData.powerConsumptionKwhPerMonth, 0),
  waterUsageKlPerMonth: toNonNegativeNumber(operationsData.waterUsageKlPerMonth, 0),
  chemicalsUsageKgPerMonth: toNonNegativeNumber(operationsData.chemicalsUsageKgPerMonth, 0),
  fuelUsageLitersPerMonth: toNonNegativeNumber(operationsData.fuelUsageLitersPerMonth, 0),
  solarInstallationKw: toNonNegativeNumber(operationsData.solarInstallationKw, 0),
  solarGenerationKwhPerMonth: toNonNegativeNumber(operationsData.solarGenerationKwhPerMonth, 0),
  solarUsageKwhPerMonth: toNonNegativeNumber(operationsData.solarUsageKwhPerMonth, 0),
  solarNetMeteringEnabled: Boolean(operationsData.solarNetMeteringEnabled),
  selectedChemicalOptions: toTextList(operationsData.selectedChemicalOptions),
  selectedWaterTreatmentOptions: toTextList(operationsData.selectedWaterTreatmentOptions),
  transportationVehicles: normalizeTransportationVehicles(operationsData.transportationVehicles)
});


const normalizeWorkflowProcesses = (processes = []) => {
  return processes
    .filter(Boolean)
    .map((process, processIndex) => ({
      name: String(process.name || `Process ${processIndex + 1}`).trim() || `Process ${processIndex + 1}`,
      description: String(process.description || '').trim(),
      durationHours: toNonNegativeNumber(process.durationHours, 1),
      cycleCountPerDay: toNonNegativeNumber(process.cycleCountPerDay, 1),
      machineries: Array.isArray(process.machineries)
        ? process.machineries.filter(Boolean).map((machinery, machineryIndex) => ({
          name: String(machinery.name || `Machinery ${machineryIndex + 1}`).trim() || `Machinery ${machineryIndex + 1}`,
          quantity: toNonNegativeNumber(machinery.quantity, 1),
          powerRatingKw: toNonNegativeNumber(machinery.powerRatingKw, 0),
          fuelType: String(machinery.fuelType || 'electricity').toLowerCase(),
          fuelUsagePerHour: toNonNegativeNumber(machinery.fuelUsagePerHour, 0),
          customEmissionFactor: toNonNegativeNumber(machinery.customEmissionFactor, 0)
        }))
        : [],
      rawMaterials: Array.isArray(process.rawMaterials)
        ? process.rawMaterials.filter(Boolean).map((rawMaterial, materialIndex) => ({
          name: String(rawMaterial.name || `Material ${materialIndex + 1}`).trim() || `Material ${materialIndex + 1}`,
          quantityKg: toNonNegativeNumber(rawMaterial.quantityKg, 0),
          emissionFactorKgCO2PerKg: toNonNegativeNumber(rawMaterial.emissionFactorKgCO2PerKg, 0),
          isPackagingMaterial: Boolean(rawMaterial.isPackagingMaterial)
        }))
        : []
    }));
};

const normalizeWorkflowUnits = (units = [], legacyProcesses = []) => {
  if (Array.isArray(units) && units.length > 0) {
    return units
      .filter(Boolean)
      .map((unit, unitIndex) => ({
        unitId: String(unit.unitId || `unit-${unitIndex + 1}`).trim() || `unit-${unitIndex + 1}`,
        name: String(unit.name || `Unit ${unitIndex + 1}`).trim() || `Unit ${unitIndex + 1}`,
        location: String(unit.location || '').trim(),
        products: Array.isArray(unit.products)
          ? unit.products.map((product) => String(product || '').trim()).filter(Boolean)
          : String(unit.products || '')
            .split(',')
            .map((product) => product.trim())
            .filter(Boolean),
        processes: normalizeWorkflowProcesses(unit.processes || [])
      }));
  }

  // Backward compatibility with the previous single-workflow payload.
  return [{
    unitId: 'unit-1',
    name: 'Unit 1',
    location: '',
    products: [],
    processes: normalizeWorkflowProcesses(legacyProcesses)
  }];
};

const normalizeEmployees = (employees = [], units = []) => {
  const fallbackUnitId = units[0]?.unitId || 'unit-1';
  return Array.isArray(employees)
    ? employees
      .filter(Boolean)
      .map((employee, employeeIndex) => ({
        name: String(employee.name || `Employee ${employeeIndex + 1}`).trim() || `Employee ${employeeIndex + 1}`,
        phone: String(employee.phone || '').trim(),
        assignedUnitId: String(employee.assignedUnitId || fallbackUnitId).trim() || fallbackUnitId,
        commuteMode: String(employee.commuteMode || 'two_wheeler').toLowerCase(),
        commuteDistanceKmPerDay: toNonNegativeNumber(employee.commuteDistanceKmPerDay, 0),
        workingDaysPerMonth: toNonNegativeNumber(employee.workingDaysPerMonth, 22),
        customEmissionFactorKgPerKm: toNonNegativeNumber(employee.customEmissionFactorKgPerKm, 0)
      }))
    : [];
};

const normalizeSupplyChain = (supplyChain = [], units = []) => {
  const fallbackUnitId = units[0]?.unitId || 'unit-1';
  return Array.isArray(supplyChain)
    ? supplyChain
      .filter(Boolean)
      .map((entry, entryIndex) => ({
        partnerName: String(entry.partnerName || `Partner ${entryIndex + 1}`).trim() || `Partner ${entryIndex + 1}`,
        partnerType: String(entry.partnerType || 'supplier').toLowerCase(),
        assignedUnitId: String(entry.assignedUnitId || fallbackUnitId).trim() || fallbackUnitId,
        transportMode: String(entry.transportMode || 'road_diesel').toLowerCase(),
        distanceKm: toNonNegativeNumber(entry.distanceKm, 0),
        shipmentWeightKgPerMonth: toNonNegativeNumber(entry.shipmentWeightKgPerMonth, 0),
        tripsPerMonth: toNonNegativeNumber(entry.tripsPerMonth, 1),
        customEmissionFactorKgPerTonKm: toNonNegativeNumber(entry.customEmissionFactorKgPerTonKm, 0),
        notes: String(entry.notes || '').trim()
      }))
    : [];
};

const MAX_EMISSION_FACTOR_RESOLUTION_LINES = 260;

const calculateWorkflowEstimate = (processes = [], emissionFactorAgentContext = null) => {
  const agentCtx = emissionFactorAgentContext
    || operationsEmissionFactorAgentService.createEmissionFactorAgentContext({});
  const resolutionLines = [];

  const pushResolution = (line) => {
    if (resolutionLines.length < MAX_EMISSION_FACTOR_RESOLUTION_LINES) {
      resolutionLines.push(line);
    }
  };

  const processBreakdown = [];
  let machineryEmissions = 0;
  let rawMaterialEmissions = 0;
  let packagingMaterialEmissions = 0;
  let processAuxiliaryEmissions = 0;

  processes.forEach((process) => {
    const processName = process.name || 'Unnamed process';
    const runHoursPerDay = toNonNegativeNumber(process.durationHours, 1) * toNonNegativeNumber(process.cycleCountPerDay, 1);

    let processMachineryEmissions = 0;
    let processRawMaterialEmissions = 0;
    let processPackagingEmissions = 0;

    const machineryBreakdown = (process.machineries || []).map((machinery) => {
      const quantity = toNonNegativeNumber(machinery.quantity, 1);
      const powerRatingKw = toNonNegativeNumber(machinery.powerRatingKw, 0);
      const fuelUsagePerHour = toNonNegativeNumber(machinery.fuelUsagePerHour, 0);
      const declaredFuel = String(machinery.fuelType || 'electricity').toLowerCase();
      const customFactor = toNonNegativeNumber(machinery.customEmissionFactor, 0);
      const machResolved = agentCtx.resolveMachinery(machinery.name, declaredFuel, customFactor);
      const emissionFactor = machResolved.emissionFactor;
      const consumptionFuel = machResolved.effectiveFuelType || declaredFuel;

      let estimatedConsumption = 0;
      if (consumptionFuel === 'electricity') {
        estimatedConsumption = powerRatingKw * runHoursPerDay * quantity;
      } else {
        const baselineFuelUse = fuelUsagePerHour > 0 ? fuelUsagePerHour : powerRatingKw;
        estimatedConsumption = baselineFuelUse * runHoursPerDay * quantity;
      }

      const co2Emissions = estimatedConsumption * emissionFactor;
      processMachineryEmissions += co2Emissions;

      pushResolution({
        kind: 'machinery',
        processName,
        itemName: machinery.name,
        declaredFuelType: declaredFuel,
        effectiveFuelType: machResolved.effectiveFuelType,
        fuelHintApplied: Boolean(machResolved.fuelHintApplied),
        emissionFactor: roundTo(emissionFactor, 4),
        factorUnit: consumptionFuel === 'electricity' ? 'kgCO2_per_kWh' : 'kgCO2_per_consumption_unit',
        factorSource: machResolved.source,
        agentConfidence: roundTo(machResolved.confidence, 3)
      });

      return {
        name: machinery.name,
        fuelType: declaredFuel,
        effectiveFuelType: machResolved.effectiveFuelType,
        quantity,
        estimatedConsumption: roundTo(estimatedConsumption),
        emissionFactor: roundTo(emissionFactor, 4),
        emissionFactorSource: machResolved.source,
        agentConfidence: roundTo(machResolved.confidence, 3),
        co2Emissions: roundTo(co2Emissions)
      };
    });

    const rawMaterialBreakdown = (process.rawMaterials || []).map((rawMaterial) => {
      const quantityKg = toNonNegativeNumber(rawMaterial.quantityKg, 0);
      const matResolved = agentCtx.resolveRawMaterial(rawMaterial.name, rawMaterial.emissionFactorKgCO2PerKg);
      const emissionFactor = matResolved.emissionFactorKgCO2PerKg;
      const co2Emissions = quantityKg * emissionFactor;
      const isPackagingMaterial = Boolean(rawMaterial.isPackagingMaterial)
        || processName.toLowerCase().includes('pack');

      processRawMaterialEmissions += co2Emissions;
      if (isPackagingMaterial) {
        processPackagingEmissions += co2Emissions;
      }

      pushResolution({
        kind: 'raw_material',
        processName,
        itemName: rawMaterial.name,
        emissionFactor: roundTo(emissionFactor, 4),
        factorUnit: 'kgCO2_per_kg',
        factorSource: matResolved.source,
        agentConfidence: roundTo(matResolved.confidence, 3),
        materialLabel: matResolved.label || null
      });

      return {
        name: rawMaterial.name,
        quantityKg: roundTo(quantityKg),
        emissionFactor: roundTo(emissionFactor, 4),
        emissionFactorSource: matResolved.source,
        agentConfidence: roundTo(matResolved.confidence, 3),
        isPackagingMaterial,
        co2Emissions: roundTo(co2Emissions)
      };
    });

    const auxiliary = agentCtx.estimateProcessAuxiliary(
      processName,
      process.description,
      processMachineryEmissions,
      runHoursPerDay
    );
    const processAuxiliaryCo2 = toNonNegativeNumber(auxiliary.co2Kg, 0);
    processAuxiliaryEmissions += processAuxiliaryCo2;

    pushResolution({
      kind: 'process',
      processName,
      itemName: processName,
      emissionFactorSource: auxiliary.source,
      processAuxiliaryCo2Kg: roundTo(processAuxiliaryCo2, 3),
      matchedIntensityRules: auxiliary.matchedRules || []
    });

    const totalProcessEmissions = processMachineryEmissions + processRawMaterialEmissions + processAuxiliaryCo2;
    machineryEmissions += processMachineryEmissions;
    rawMaterialEmissions += processRawMaterialEmissions;
    packagingMaterialEmissions += processPackagingEmissions;

    processBreakdown.push({
      processName,
      durationHours: roundTo(process.durationHours, 2),
      cycleCountPerDay: roundTo(process.cycleCountPerDay, 2),
      machineryEmissions: roundTo(processMachineryEmissions),
      rawMaterialEmissions: roundTo(processRawMaterialEmissions),
      packagingMaterialEmissions: roundTo(processPackagingEmissions),
      processAuxiliaryEmissions: roundTo(processAuxiliaryCo2, 3),
      processAuxiliarySource: auxiliary.source,
      processIntensityRules: auxiliary.matchedRules || [],
      totalCO2Emissions: roundTo(totalProcessEmissions),
      machineryBreakdown,
      rawMaterialBreakdown
    });
  });

  const totalCO2Emissions = machineryEmissions + rawMaterialEmissions + processAuxiliaryEmissions;

  return {
    totalCO2Emissions: roundTo(totalCO2Emissions),
    machineryEmissions: roundTo(machineryEmissions),
    rawMaterialEmissions: roundTo(rawMaterialEmissions),
    packagingMaterialEmissions: roundTo(packagingMaterialEmissions),
    processAuxiliaryEmissions: roundTo(processAuxiliaryEmissions, 3),
    processBreakdown,
    emissionFactorResolution: {
      methodologyVersion: 'operations-emission-factor-agent-v1',
      electricityGridKgCo2PerKwh: roundTo(agentCtx.gridKgCo2PerKwh, 4),
      gridResolution: agentCtx.gridMeta || null,
      lines: resolutionLines
    }
  };
};

const calculateEmployeeCommuteScope3 = (employees = []) => {
  const employeeCommuteBreakdown = [];
  const commuteByUnit = {};
  let totalCommuteEmissions = 0;

  employees.forEach((employee) => {
    const mode = String(employee.commuteMode || 'two_wheeler').toLowerCase();
    const distanceKmPerDay = toNonNegativeNumber(employee.commuteDistanceKmPerDay, 0);
    const workingDaysPerMonth = toNonNegativeNumber(employee.workingDaysPerMonth, 22);
    const customFactor = toNonNegativeNumber(employee.customEmissionFactorKgPerKm, 0);
    const emissionFactorKgPerKm = customFactor > 0
      ? customFactor
      : (COMMUTE_EMISSION_FACTORS[mode] ?? COMMUTE_EMISSION_FACTORS.two_wheeler);

    // Round-trip commute to site.
    const monthlyDistanceKm = distanceKmPerDay * 2 * workingDaysPerMonth;
    const scope3Emissions = monthlyDistanceKm * emissionFactorKgPerKm;

    totalCommuteEmissions += scope3Emissions;
    commuteByUnit[employee.assignedUnitId] = (commuteByUnit[employee.assignedUnitId] || 0) + scope3Emissions;

    employeeCommuteBreakdown.push({
      name: employee.name,
      phone: employee.phone,
      assignedUnitId: employee.assignedUnitId,
      commuteMode: mode,
      commuteDistanceKmPerDay: roundTo(distanceKmPerDay, 2),
      workingDaysPerMonth: roundTo(workingDaysPerMonth, 0),
      emissionFactorKgPerKm: roundTo(emissionFactorKgPerKm, 4),
      monthlyDistanceKm: roundTo(monthlyDistanceKm, 2),
      scope3Emissions: roundTo(scope3Emissions)
    });
  });

  return {
    totalCommuteEmissions: roundTo(totalCommuteEmissions),
    commuteByUnit,
    employeeCommuteBreakdown
  };
};

const calculateSupplyChainScope3 = (supplyChain = []) => {
  const supplyChainBreakdown = [];
  const supplyChainByUnit = {};
  let totalSupplyChainEmissions = 0;

  supplyChain.forEach((entry) => {
    const transportMode = String(entry.transportMode || 'road_diesel').toLowerCase();
    const distanceKm = toNonNegativeNumber(entry.distanceKm, 0);
    const tripsPerMonth = toNonNegativeNumber(entry.tripsPerMonth, 1);
    const shipmentWeightKgPerMonth = toNonNegativeNumber(entry.shipmentWeightKgPerMonth, 0);
    const customFactor = toNonNegativeNumber(entry.customEmissionFactorKgPerTonKm, 0);
    const emissionFactorKgPerTonKm = customFactor > 0
      ? customFactor
      : (SUPPLY_CHAIN_TRANSPORT_FACTORS[transportMode] ?? SUPPLY_CHAIN_TRANSPORT_FACTORS.road_diesel);

    const shipmentWeightTons = shipmentWeightKgPerMonth / 1000;
    const estimatedTonKm = shipmentWeightTons * distanceKm * tripsPerMonth;
    const scope3Emissions = estimatedTonKm * emissionFactorKgPerTonKm;

    totalSupplyChainEmissions += scope3Emissions;
    supplyChainByUnit[entry.assignedUnitId] = (supplyChainByUnit[entry.assignedUnitId] || 0) + scope3Emissions;

    supplyChainBreakdown.push({
      partnerName: entry.partnerName,
      partnerType: entry.partnerType,
      assignedUnitId: entry.assignedUnitId,
      transportMode,
      distanceKm: roundTo(distanceKm, 2),
      shipmentWeightKgPerMonth: roundTo(shipmentWeightKgPerMonth, 2),
      tripsPerMonth: roundTo(tripsPerMonth, 2),
      shipmentWeightTons: roundTo(shipmentWeightTons, 4),
      emissionFactorKgPerTonKm: roundTo(emissionFactorKgPerTonKm, 4),
      estimatedTonKm: roundTo(estimatedTonKm, 4),
      scope3Emissions: roundTo(scope3Emissions)
    });
  });

  return {
    totalSupplyChainEmissions: roundTo(totalSupplyChainEmissions),
    supplyChainByUnit,
    supplyChainBreakdown
  };
};

const calculateValueChainEmissions = ({
  machineryEmissions = 0,
  rawMaterialEmissions = 0,
  commuteEmissions = 0,
  supplyChainBreakdown = [],
  processAuxiliaryEmissions = 0
} = {}) => {
  let upstreamSupplyChain = 0;
  let downstreamSupplyChain = 0;
  let supportSupplyChain = 0;

  (supplyChainBreakdown || []).forEach((entry) => {
    const partnerType = String(entry.partnerType || '').toLowerCase();
    const emissions = toNonNegativeNumber(entry.scope3Emissions, 0);

    if (UPSTREAM_SUPPLY_CHAIN_TYPES.has(partnerType)) {
      upstreamSupplyChain += emissions;
      return;
    }
    if (DOWNSTREAM_SUPPLY_CHAIN_TYPES.has(partnerType)) {
      downstreamSupplyChain += emissions;
      return;
    }
    if (SUPPORT_SUPPLY_CHAIN_TYPES.has(partnerType)) {
      supportSupplyChain += emissions;
      return;
    }

    // Default unknown partner types to support bucket.
    supportSupplyChain += emissions;
  });

  const upstream = toNonNegativeNumber(rawMaterialEmissions, 0) + upstreamSupplyChain;
  const operations = toNonNegativeNumber(machineryEmissions, 0) + toNonNegativeNumber(processAuxiliaryEmissions, 0);
  const downstream = downstreamSupplyChain;
  const support = toNonNegativeNumber(commuteEmissions, 0) + supportSupplyChain;
  const total = upstream + operations + downstream + support;

  const toShare = (value) => (total > 0 ? roundTo((value / total) * 100, 1) : 0);
  const contributionPercent = {
    upstream: toShare(upstream),
    operations: toShare(operations),
    downstream: toShare(downstream),
    support: toShare(support)
  };

  return {
    upstream: roundTo(upstream),
    operations: roundTo(operations),
    downstream: roundTo(downstream),
    support: roundTo(support),
    total: roundTo(total),
    contributionPercent,
    stageBreakdown: [
      { stage: 'upstream', label: 'Upstream', co2Emissions: roundTo(upstream), contributionPercent: contributionPercent.upstream },
      { stage: 'operations', label: 'Operations', co2Emissions: roundTo(operations), contributionPercent: contributionPercent.operations },
      { stage: 'downstream', label: 'Downstream', co2Emissions: roundTo(downstream), contributionPercent: contributionPercent.downstream },
      { stage: 'support', label: 'Support', co2Emissions: roundTo(support), contributionPercent: contributionPercent.support }
    ]
  };
};

const calculateMultiUnitWorkflowEstimate = (units = [], employees = [], supplyChain = [], emissionFactorAgentContext = null) => {
  const unitBreakdown = [];
  const flatProcessBreakdown = [];
  const mergedResolutionLines = [];

  let machineryEmissions = 0;
  let rawMaterialEmissions = 0;
  let packagingMaterialEmissions = 0;
  let processAuxiliaryEmissions = 0;
  let processEmissions = 0;

  const agentCtx = emissionFactorAgentContext
    || operationsEmissionFactorAgentService.createEmissionFactorAgentContext({});

  const commuteResult = calculateEmployeeCommuteScope3(employees);
  const supplyChainResult = calculateSupplyChainScope3(supplyChain);

  units.forEach((unit) => {
    const processEstimate = calculateWorkflowEstimate(unit.processes || [], agentCtx);
    const unitCommuteEmissions = toNonNegativeNumber(commuteResult.commuteByUnit[unit.unitId], 0);
    const unitSupplyChainEmissions = toNonNegativeNumber(supplyChainResult.supplyChainByUnit[unit.unitId], 0);
    const unitScope3Emissions = unitCommuteEmissions + unitSupplyChainEmissions;
    const unitProcessEmissions = toNonNegativeNumber(processEstimate.totalCO2Emissions, 0);
    const unitTotalEmissions = unitProcessEmissions + unitScope3Emissions;

    machineryEmissions += toNonNegativeNumber(processEstimate.machineryEmissions, 0);
    rawMaterialEmissions += toNonNegativeNumber(processEstimate.rawMaterialEmissions, 0);
    packagingMaterialEmissions += toNonNegativeNumber(processEstimate.packagingMaterialEmissions, 0);
    processAuxiliaryEmissions += toNonNegativeNumber(processEstimate.processAuxiliaryEmissions, 0);
    processEmissions += unitProcessEmissions;

    const unitLines = processEstimate.emissionFactorResolution?.lines || [];
    unitLines.forEach((line) => {
      if (mergedResolutionLines.length < MAX_EMISSION_FACTOR_RESOLUTION_LINES) {
        mergedResolutionLines.push({ unitId: unit.unitId, unitName: unit.name, ...line });
      }
    });

    const renamedProcessBreakdown = (processEstimate.processBreakdown || []).map((process) => ({
      ...process,
      processName: `${unit.name} - ${process.processName}`
    }));

    flatProcessBreakdown.push(...renamedProcessBreakdown);

    unitBreakdown.push({
      unitId: unit.unitId,
      unitName: unit.name,
      location: unit.location,
      products: unit.products || [],
      totalCO2Emissions: roundTo(unitTotalEmissions),
      processEmissions: roundTo(unitProcessEmissions),
      scope3Emissions: roundTo(unitScope3Emissions),
      commuteEmissions: roundTo(unitCommuteEmissions),
      supplyChainEmissions: roundTo(unitSupplyChainEmissions),
      machineryEmissions: roundTo(processEstimate.machineryEmissions),
      rawMaterialEmissions: roundTo(processEstimate.rawMaterialEmissions),
      packagingMaterialEmissions: roundTo(processEstimate.packagingMaterialEmissions),
      processAuxiliaryEmissions: roundTo(processEstimate.processAuxiliaryEmissions, 3),
      processBreakdown: processEstimate.processBreakdown || []
    });
  });

  const commuteEmissions = commuteResult.totalCommuteEmissions;
  const supplyChainEmissions = supplyChainResult.totalSupplyChainEmissions;
  const scope3Emissions = commuteEmissions + supplyChainEmissions;
  const totalCO2Emissions = processEmissions + scope3Emissions;
  const valueChainEmissions = calculateValueChainEmissions({
    machineryEmissions,
    rawMaterialEmissions,
    commuteEmissions,
    supplyChainBreakdown: supplyChainResult.supplyChainBreakdown,
    processAuxiliaryEmissions
  });

  return {
    totalCO2Emissions: roundTo(totalCO2Emissions),
    processEmissions: roundTo(processEmissions),
    scope1Emissions: roundTo(processEmissions),
    scope2FacilityEmissions: 0,
    scope3Emissions: roundTo(scope3Emissions),
    commuteEmissions: roundTo(commuteEmissions),
    supplyChainEmissions: roundTo(supplyChainEmissions),
    machineryEmissions: roundTo(machineryEmissions),
    rawMaterialEmissions: roundTo(rawMaterialEmissions),
    packagingMaterialEmissions: roundTo(packagingMaterialEmissions),
    processAuxiliaryEmissions: roundTo(processAuxiliaryEmissions, 3),
    processBreakdown: flatProcessBreakdown,
    unitBreakdown,
    employeeCommuteBreakdown: commuteResult.employeeCommuteBreakdown,
    supplyChainBreakdown: supplyChainResult.supplyChainBreakdown,
    valueChainEmissions,
    emissionFactorResolution: {
      methodologyVersion: 'operations-emission-factor-agent-v1',
      electricityGridKgCo2PerKwh: roundTo(agentCtx.gridKgCo2PerKwh, 4),
      gridResolution: agentCtx.gridMeta || null,
      lines: mergedResolutionLines
    }
  };
};

const applyProfileDataToEstimate = (msme = {}, estimate = {}, units = []) => {
  const manufacturingProfile = msme.manufacturingProfile || {};
  const business = msme.business || {};
  const operationalDaysPerYear = toNonNegativeNumber(manufacturingProfile.operationalDaysPerYear, 0);
  // If operational days are available, normalize process-heavy emissions by yearly run cadence.
  // Default baseline assumes 300 operational days/year for MSME plants.
  const operationalDaysFactor = operationalDaysPerYear > 0 ? operationalDaysPerYear / 300 : 1;
  const declaredUnitCount = Math.max(1, toNonNegativeNumber(business.manufacturingUnits, 0));
  const configuredUnitCount = Math.max(1, Array.isArray(units) ? units.length : 1);
  const unitCoverageFactor = configuredUnitCount / declaredUnitCount;

  const adjustedMachinery = toNonNegativeNumber(estimate.machineryEmissions, 0) * operationalDaysFactor;
  const adjustedRaw = toNonNegativeNumber(estimate.rawMaterialEmissions, 0) * operationalDaysFactor;
  const adjustedPackaging = toNonNegativeNumber(estimate.packagingMaterialEmissions, 0) * operationalDaysFactor;
  const adjustedAuxiliary = toNonNegativeNumber(estimate.processAuxiliaryEmissions, 0) * operationalDaysFactor;
  const adjustedProcess = (adjustedMachinery + adjustedRaw + adjustedAuxiliary) * unitCoverageFactor;
  const adjustedCommute = toNonNegativeNumber(estimate.commuteEmissions, 0) * unitCoverageFactor;
  const adjustedSupplyChain = toNonNegativeNumber(estimate.supplyChainEmissions, 0) * unitCoverageFactor;
  const adjustedScope3 = adjustedCommute + adjustedSupplyChain;
  const adjustedTotal = adjustedProcess + adjustedScope3;

  return {
    ...estimate,
    totalCO2Emissions: roundTo(adjustedTotal),
    processEmissions: roundTo(adjustedProcess),
    scope3Emissions: roundTo(adjustedScope3),
    machineryEmissions: roundTo(adjustedMachinery * unitCoverageFactor),
    rawMaterialEmissions: roundTo(adjustedRaw * unitCoverageFactor),
    packagingMaterialEmissions: roundTo(adjustedPackaging * unitCoverageFactor),
    processAuxiliaryEmissions: roundTo(adjustedAuxiliary * unitCoverageFactor),
    commuteEmissions: roundTo(adjustedCommute),
    supplyChainEmissions: roundTo(adjustedSupplyChain),
    profileAppliedFactors: {
      operationalDaysPerYear: operationalDaysPerYear || null,
      operationalDaysFactor: roundTo(operationalDaysFactor, 4),
      declaredUnitCount,
      configuredUnitCount,
      unitCoverageFactor: roundTo(unitCoverageFactor, 4)
    }
  };
};

const buildProfileOperationsSignals = (msme = {}, units = [], employees = [], supplyChain = [], estimate = {}) => {
  const business = msme.business || {};
  const manufacturingProfile = msme.manufacturingProfile || {};
  const contact = msme.contact || {};
  const address = contact.address || {};
  const normalizedUnits = Array.isArray(units) ? units : [];
  const processCount = normalizedUnits.reduce((sum, unit) => sum + (Array.isArray(unit.processes) ? unit.processes.length : 0), 0);
  const machineryCount = normalizedUnits.reduce((sum, unit) => {
    const unitProcesses = Array.isArray(unit.processes) ? unit.processes : [];
    return sum + unitProcesses.reduce((innerSum, process) => innerSum + (Array.isArray(process.machineries) ? process.machineries.length : 0), 0);
  }, 0);
  const materialsCount = normalizedUnits.reduce((sum, unit) => {
    const unitProcesses = Array.isArray(unit.processes) ? unit.processes : [];
    return sum + unitProcesses.reduce((innerSum, process) => innerSum + (Array.isArray(process.rawMaterials) ? process.rawMaterials.length : 0), 0);
  }, 0);
  const workflowOperationsData = msme.business?.manufacturingWorkflow?.operationsData || {};
  const chemicalOptions = CHEMICAL_OPTIONS_BY_DOMAIN[msme.businessDomain] || CHEMICAL_OPTIONS_BY_DOMAIN.default;
  const waterTreatmentOptions = WATER_TREATMENT_OPTIONS_BY_DOMAIN[msme.businessDomain] || WATER_TREATMENT_OPTIONS_BY_DOMAIN.default;
  const operationsMetrics = {
    powerConsumptionKwhPerMonth: toNonNegativeNumber(
      workflowOperationsData.powerConsumptionKwhPerMonth,
      toNonNegativeNumber(manufacturingProfile.powerConsumptionKwhPerMonth, 0)
    ),
    waterConsumptionKlPerMonth: toNonNegativeNumber(
      workflowOperationsData.waterUsageKlPerMonth,
      toNonNegativeNumber(manufacturingProfile.waterConsumptionKlPerMonth, 0)
    ),
    chemicalsConsumptionKgPerMonth: toNonNegativeNumber(
      workflowOperationsData.chemicalsUsageKgPerMonth,
      toNonNegativeNumber(manufacturingProfile.chemicalsConsumptionKgPerMonth, 0)
    ),
    fuelUsageLitersPerMonth: toNonNegativeNumber(workflowOperationsData.fuelUsageLitersPerMonth, 0),
    recycledWasteKgPerMonth: toNonNegativeNumber(manufacturingProfile.wasteRecycledKgPerMonth, 0),
    wasteWaterKlPerMonth: toNonNegativeNumber(manufacturingProfile.wasteWaterKlPerMonth, 0),
    solarInstallationKw: toNonNegativeNumber(
      workflowOperationsData.solarInstallationKw,
      toNonNegativeNumber(manufacturingProfile.solarInstallationKw, 0)
    ),
    solarGenerationKwhPerMonth: toNonNegativeNumber(
      workflowOperationsData.solarGenerationKwhPerMonth,
      toNonNegativeNumber(manufacturingProfile.solarGenerationKwhPerMonth, 0)
    ),
    importedRawMaterialsKgPerMonth: toNonNegativeNumber(manufacturingProfile.importedRawMaterialsKgPerMonth, 0),
    outputProductsKgPerMonth: toNonNegativeNumber(manufacturingProfile.outputProductsKgPerMonth, 0),
    servicesDeliveredPerMonth: toNonNegativeNumber(manufacturingProfile.servicesDeliveredPerMonth, 0)
  };
  const complianceCertifications = [
    ...(Array.isArray(manufacturingProfile.complianceCertifications) ? manufacturingProfile.complianceCertifications : []),
    ...(Array.isArray(manufacturingProfile.certifications) ? manufacturingProfile.certifications : [])
  ].filter(Boolean);
  const isoAndGhgAlignment = {
    iso14064Aligned: Boolean(manufacturingProfile.iso14064Aligned),
    iso14067Aligned: Boolean(manufacturingProfile.iso14067Aligned),
    ghgProtocolAligned: Boolean(manufacturingProfile.ghgProtocolAligned),
    complianceCertifications
  };
  const granularAgentNetwork = {
    rawMaterialsAgent: {
      focus: 'Raw-material extraction, sourcing and imports',
      enabled: true
    },
    processAgent: {
      focus: 'Process-wise production emissions',
      enabled: true
    },
    machineryAgent: {
      focus: 'Machine energy/fuel emissions',
      enabled: true
    },
    packagingAgent: {
      focus: 'Packaging material and conversion emissions',
      enabled: true
    },
    transportationAgent: {
      focus: 'Inbound/outbound logistics and shipment emissions',
      enabled: true
    },
    energyAgent: {
      focus: 'Grid, captive and solar energy accounting',
      enabled: true
    },
    chemicalsAgent: {
      focus: 'Chemical consumption and treatment emissions',
      enabled: true
    },
    waterAgent: {
      focus: 'Water intake and wastewater handling emissions',
      enabled: true
    },
    fuelAgent: {
      focus: 'Fuel purchase, combustion and fugitive usage tracking',
      enabled: true
    },
    transportFleetAgent: {
      focus: 'Transportation fleet utilization and emissions',
      enabled: true
    },
    powerQualityAgent: {
      focus: 'Grid power quality and consumption optimization insights',
      enabled: true
    },
    treatmentAgent: {
      focus: 'Water/chemical treatment pathway emissions and compliance',
      enabled: true
    }
  };

  return {
    profile: {
      companyType: msme.companyType || null,
      industry: msme.industry || null,
      businessDomain: msme.businessDomain || null,
      annualTurnover: toNonNegativeNumber(business.annualTurnover, 0),
      numberOfEmployees: toNonNegativeNumber(business.numberOfEmployees, 0),
      manufacturingUnitsDeclared: toNonNegativeNumber(business.manufacturingUnits, normalizedUnits.length),
      location: {
        city: address.city || manufacturingProfile.locationCity || null,
        state: address.state || manufacturingProfile.locationState || null,
        country: address.country || manufacturingProfile.locationCountry || null
      },
      operationsContext: {
        operationalDaysPerYear: toNonNegativeNumber(manufacturingProfile.operationalDaysPerYear, 0),
        primaryEnergySource: manufacturingProfile.primaryEnergySource || null,
        backupEnergySource: manufacturingProfile.backupEnergySource || null,
        supplyChainType: manufacturingProfile.supplyChainType || null,
        logisticsMode: manufacturingProfile.logisticsMode || null
      },
      operationsMetrics,
      operationsDataFeed: {
        selectedChemicalOptions: toTextList(workflowOperationsData.selectedChemicalOptions),
        selectedWaterTreatmentOptions: toTextList(workflowOperationsData.selectedWaterTreatmentOptions),
        suggestedChemicalOptions: chemicalOptions,
        suggestedWaterTreatmentOptions: waterTreatmentOptions
      },
      isoAndGhgAlignment
    },
    operations: {
      workflowUnits: normalizedUnits.length,
      processCount,
      machineryCount,
      materialsCount,
      employeeRecords: Array.isArray(employees) ? employees.length : 0,
      supplyChainLinks: Array.isArray(supplyChain) ? supplyChain.length : 0,
      transportationVehicles: Array.isArray(workflowOperationsData.transportationVehicles)
        ? workflowOperationsData.transportationVehicles.length
        : 0,
      granularAgentNetwork,
      agenticArchitecture: {
        model: 'multi_agent_stage_pipeline',
        standards: ['ISO 14064', 'ISO 14067', 'GHG Protocol'],
        principle: 'rigorous_use_of_profile_registration_and_workflow_data',
        nodes: [
          'registration_data_ingestion',
          'activity_data_normalization',
          'stage_level_emissions_agents',
          'compliance_alignment',
          'recommendation_generation'
        ]
      }
    },
    emissionsSummary: {
      totalCO2Emissions: toNonNegativeNumber(estimate.totalCO2Emissions, 0),
      processEmissions: toNonNegativeNumber(estimate.processEmissions, 0),
      scope3Emissions: toNonNegativeNumber(estimate.scope3Emissions, 0),
      machineryEmissions: toNonNegativeNumber(estimate.machineryEmissions, 0),
      rawMaterialEmissions: toNonNegativeNumber(estimate.rawMaterialEmissions, 0),
      commuteEmissions: toNonNegativeNumber(estimate.commuteEmissions, 0),
      supplyChainEmissions: toNonNegativeNumber(estimate.supplyChainEmissions, 0)
    }
  };
};

const getMsmePaymentSummary = getMsmePaymentQuote;

// @route   GET /api/msme/profile
// @desc    Get MSME profile
// @access  Private
router.get('/profile', auth, async (req, res) => {
  try {
    const msme = await MSME.findOne({ userId: req.user.userId });

    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    res.json({
      success: true,
      data: msme
    });

  } catch (error) {
    logger.error('Get MSME profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/msme/reduction-target
// @desc    Get emissions reduction target percentage for the MSME
// @access  Private
router.get('/reduction-target', auth, async (req, res) => {
  try {
    const msme = await MSME.findOne({ userId: req.user.userId }).select('sustainabilitySettings');

    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const reductionTargetPct = Number(msme.sustainabilitySettings?.reductionTargetPct);
    res.json({
      success: true,
      data: {
        reductionTargetPct: Number.isFinite(reductionTargetPct) ? reductionTargetPct : 10
      }
    });
  } catch (error) {
    logger.error('Get reduction target error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PUT /api/msme/reduction-target
// @desc    Update emissions reduction target percentage for the MSME
// @access  Private
router.put('/reduction-target', auth, async (req, res) => {
  try {
    const msme = await MSME.findOne({ userId: req.user.userId });

    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const rawValue = Number(req.body?.reductionTargetPct);
    if (!Number.isFinite(rawValue) || rawValue < 0 || rawValue > 40) {
      return res.status(400).json({
        success: false,
        message: 'Reduction target must be between 0 and 40 percent'
      });
    }

    msme.sustainabilitySettings = {
      ...(msme.sustainabilitySettings?.toObject?.() || msme.sustainabilitySettings || {}),
      reductionTargetPct: Math.round(rawValue * 10) / 10
    };
    await msme.save();

    res.json({
      success: true,
      message: 'Reduction target updated',
      data: {
        reductionTargetPct: msme.sustainabilitySettings.reductionTargetPct
      }
    });
  } catch (error) {
    logger.error('Update reduction target error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PUT /api/msme/profile
// @desc    Update MSME profile
// @access  Private
router.put('/profile', [auth], async (req, res) => {
  try {
    const msme = await MSME.findOne({ userId: req.user.userId });

    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const normalizedBody = normalizeMSMEPayload(req.body, msme.toObject());
    const validationErrors = [];

    if (hasOwnField(normalizedBody, 'companyName') && !String(normalizedBody.companyName || '').trim()) {
      validationErrors.push('Company name cannot be empty');
    }
    if (hasOwnField(normalizedBody, 'companyType') && !VALID_COMPANY_TYPES.has(normalizedBody.companyType)) {
      validationErrors.push('Invalid company type');
    }
    if (hasOwnField(normalizedBody, 'industry') && !String(normalizedBody.industry || '').trim()) {
      validationErrors.push('Industry cannot be empty');
    }
    if (hasOwnField(normalizedBody, 'businessDomain') && !VALID_BUSINESS_DOMAINS.has(normalizedBody.businessDomain)) {
      validationErrors.push('Invalid business domain');
    }
    if (hasOwnField(normalizedBody, 'udyamRegistrationNumber')) {
      const udyamValue = String(normalizedBody.udyamRegistrationNumber || '').trim();
      if (!udyamValue) {
        validationErrors.push('Udyog (UDYAM) registration number is required');
      } else if (!UDYAM_REGEX.test(udyamValue)) {
        validationErrors.push('Invalid UDYAM Registration Number format');
      }
    }
    if (hasOwnField(normalizedBody, 'contact') && normalizedBody.contact?.email) {
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedBody.contact.email);
      if (!isEmail) {
        validationErrors.push('Valid contact email is required');
      }
    }
    if (hasOwnField(normalizedBody, 'contact') && hasOwnField(normalizedBody.contact, 'phone') && !String(normalizedBody.contact.phone || '').trim()) {
      validationErrors.push('Contact phone cannot be empty');
    }

    const effectiveCompanyType = hasOwnField(normalizedBody, 'companyType')
      ? normalizedBody.companyType
      : msme.companyType;
    const effectiveAnnualTurnover = hasOwnField(normalizedBody, 'business')
      && hasOwnField(normalizedBody.business, 'annualTurnover')
      ? normalizedBody.business.annualTurnover
      : msme.business?.annualTurnover;
    const effectiveInvestment = hasOwnField(normalizedBody, 'business')
      && hasOwnField(normalizedBody.business, 'investment')
      ? normalizedBody.business.investment
      : msme.business?.investment;
    validationErrors.push(
      ...validateMSMEClassification({
        companyType: effectiveCompanyType,
        annualTurnover: effectiveAnnualTurnover,
        investment: effectiveInvestment
      })
    );

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: validationErrors
      });
    }

    // Update fields
    const allowedFields = [
      'companyName', 'companyType', 'industry', 'businessDomain', 'establishmentYear',
      'udyamRegistrationNumber',
      'contact', 'business', 'environmentalCompliance', 'manufacturingProfile'
    ];

    allowedFields.forEach(field => {
      if (hasOwnField(normalizedBody, field)) {
        if (typeof normalizedBody[field] === 'object' && !Array.isArray(normalizedBody[field])) {
          msme[field] = { ...msme[field], ...normalizedBody[field] };
        } else {
          msme[field] = normalizedBody[field];
        }
      }
    });

    await msme.save();

    logger.info(`MSME profile updated: ${msme._id}`, {
      userId: req.user.userId,
      updatedFields: Object.keys(req.body)
    });

    try {
      orchestrationManagerEventService.emitEvent('msme.profile_updated', {
        msmeId: msme._id?.toString(),
        updates: normalizedBody,
        businessDomain: msme.businessDomain,
        industry: msme.industry,
        manufacturingProfile: msme.manufacturingProfile || {}
      }, 'msme_profile');
    } catch (eventError) {
      logger.warn('Failed to emit orchestration event for MSME profile update', {
        error: eventError.message,
        msmeId: msme._id?.toString()
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: msme
    });

  } catch (error) {
    logger.error('Update MSME profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/msme/register
// @desc    Register MSME
// @access  Private
router.post('/register', [auth], async (req, res) => {
  try {
    if (req.user.role !== 'msme') {
      return res.status(403).json({
        success: false,
        message: 'Only MSME users can create MSME profiles'
      });
    }

    const normalizedBody = normalizeMSMEPayload(req.body);
    const validationErrors = [];

    if (!normalizedBody.companyName || !String(normalizedBody.companyName).trim()) {
      validationErrors.push('Company name is required');
    }
    if (!normalizedBody.companyType || !VALID_COMPANY_TYPES.has(normalizedBody.companyType)) {
      validationErrors.push('Valid company type is required');
    }
    if (!normalizedBody.industry || !String(normalizedBody.industry).trim()) {
      validationErrors.push('Industry is required');
    }
    if (!normalizedBody.businessDomain || !VALID_BUSINESS_DOMAINS.has(normalizedBody.businessDomain)) {
      validationErrors.push('Valid business domain is required');
    }
    let udyamTrimmed = normalizedBody.udyamRegistrationNumber
      ? String(normalizedBody.udyamRegistrationNumber).trim()
      : '';
    if (!udyamTrimmed && normalizedBody.udyogAadharNumber) {
      udyamTrimmed = String(normalizedBody.udyogAadharNumber).trim();
    }
    if (!udyamTrimmed) {
      validationErrors.push('Udyog (UDYAM) registration number is required');
    } else if (!UDYAM_REGEX.test(udyamTrimmed)) {
      validationErrors.push('Invalid UDYAM Registration Number format');
    }
    if (!normalizedBody.gstNumber || !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(normalizedBody.gstNumber)) {
      validationErrors.push('Invalid GST Number format');
    }
    if (!normalizedBody.panNumber || !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(normalizedBody.panNumber)) {
      validationErrors.push('Invalid PAN Number format');
    }
    if (!normalizedBody.contact?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedBody.contact.email)) {
      validationErrors.push('Valid email is required');
    }
    if (!normalizedBody.contact?.phone || !String(normalizedBody.contact.phone).trim()) {
      validationErrors.push('Phone is required');
    }
    if (!Number.isFinite(Number(normalizedBody.business?.annualTurnover))) {
      validationErrors.push('Annual turnover must be a number');
    }
    if (!Number.isInteger(Number(normalizedBody.business?.numberOfEmployees))) {
      validationErrors.push('Number of employees must be an integer');
    }
    if (!Number.isInteger(Number(normalizedBody.business?.manufacturingUnits))) {
      validationErrors.push('Number of manufacturing units must be an integer');
    }
    validationErrors.push(
      ...validateMSMEClassification({
        companyType: normalizedBody.companyType,
        annualTurnover: normalizedBody.business?.annualTurnover,
        investment: normalizedBody.business?.investment
      })
    );

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: validationErrors
      });
    }

    normalizedBody.udyamRegistrationNumber = udyamTrimmed.toUpperCase();
    if (normalizedBody.udyogAadharNumber) {
      delete normalizedBody.udyogAadharNumber;
    }

    // Check if MSME already exists
    const existingMSME = await MSME.findOne({ userId: req.user.userId });
    if (existingMSME) {
      return res.status(400).json({
        success: false,
        message: 'MSME profile already exists'
      });
    }

    // Create MSME profile
    const msme = new MSME({
      userId: req.user.userId,
      ...normalizedBody,
      isVerified: false
    });

    await msme.save();

    await createOrganizationForMsme(req.user.userId, msme);

    logger.info(`MSME registered: ${msme._id}`, {
      userId: req.user.userId,
      companyName: msme.companyName,
      companyType: msme.companyType
    });

    try {
      orchestrationManagerEventService.emitEvent('msme.registered', {
        msmeId: msme._id?.toString(),
        businessDomain: msme.businessDomain,
        industry: msme.industry,
        manufacturingProfile: msme.manufacturingProfile || {}
      }, 'msme_register');
    } catch (eventError) {
      logger.warn('Failed to emit orchestration event for MSME registration', {
        error: eventError.message,
        msmeId: msme._id?.toString()
      });
    }

    res.status(201).json({
      success: true,
      message: 'MSME registered successfully',
      data: msme,
      agentGuidance: buildRegistrationAgentGuidance(normalizedBody)
    });

  } catch (error) {
    logger.error('MSME registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/msme/manufacturing-workflow
// @desc    Get saved manufacturing workflow configuration and last estimate
// @access  Private
router.get('/manufacturing-workflow', auth, async (req, res) => {
  try {
    const msme = await MSME.findOne({ userId: req.user.userId });

    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    res.json({
      success: true,
      data: {
        ...(msme.business?.manufacturingWorkflow || {
          isLocked: false,
          lockedAt: null,
          employees: [],
          supplyChain: [],
          units: [],
          processes: [],
          latestEstimate: null,
          lastEstimatedAt: null
        }),
        ghgOperationalBoundary: msme.operations?.ghgOperationalBoundary || null
      }
    });
  } catch (error) {
    logger.error('Get manufacturing workflow error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/msme/operations-template
// @desc    Generate AI-assisted operations template from MSME profile/website
// @access  Private
router.post('/operations-template', auth, async (req, res) => {
  try {
    const { websiteUrl = '' } = req.body || {};
    const normalizedWebsiteUrl = String(websiteUrl || '').trim();
    if (normalizedWebsiteUrl) {
      try {
        await ensureSafeWebsiteUrl(normalizedWebsiteUrl);
      } catch (validationError) {
        return res.status(400).json({
          success: false,
          message: validationError.message || 'Invalid website URL'
        });
      }
    }
    const msme = await MSME.findOne({ userId: req.user.userId });
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const workflow = msme.business?.manufacturingWorkflow || {};
    const template = await generateOperationsTemplate({
      msmeProfile: msme.toObject(),
      workflow,
      websiteUrl: normalizedWebsiteUrl
    });

    return res.json({
      success: true,
      message: 'Operations template generated successfully',
      data: template
    });
  } catch (error) {
    logger.error('Generate operations template error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/msme/ghg-boundary-guidance
// @desc    Run organizational + operational boundary agent orchestration (GHG Protocol)
// @access  Private
router.post('/ghg-boundary-guidance', auth, async (req, res) => {
  try {
    const msme = await MSME.findOne({ userId: req.user.userId });
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }
    const workflow = msme.business?.manufacturingWorkflow || {};
    const guidance = await runGhgBoundaryAgentOrchestration({
      msmeData: msme.toObject(),
      workflowSummary: {
        employees: Array.isArray(workflow.employees) ? workflow.employees.length : 0,
        supplyChainLinks: Array.isArray(workflow.supplyChain) ? workflow.supplyChain.length : 0,
        units: Array.isArray(workflow.units) ? workflow.units.length : 0
      }
    });
    return res.json({
      success: true,
      message: 'GHG boundary guidance generated',
      data: guidance
    });
  } catch (error) {
    logger.error('GHG boundary guidance error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/msme/manufacturing-workflow/lock
// @desc    Lock/unlock manufacturing workflow for editing
// @access  Private
router.post('/manufacturing-workflow/lock', auth, async (req, res) => {
  try {
    const { isLocked } = req.body || {};
    if (typeof isLocked !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isLocked boolean is required'
      });
    }

    const msme = await MSME.findOne({ userId: req.user.userId });
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    msme.business = msme.business || {};
    msme.business.manufacturingWorkflow = msme.business.manufacturingWorkflow || {};
    msme.business.manufacturingWorkflow.isLocked = isLocked;
    msme.business.manufacturingWorkflow.lockedAt = isLocked ? new Date() : null;

    msme.markModified('business');
    await msme.save();

    try {
      orchestrationManagerEventService.emitEvent('msme.manufacturing_workflow.lock_changed', {
        msmeId: msme._id?.toString(),
        isLocked
      }, 'msme_manufacturing_workflow');
    } catch (eventError) {
      logger.warn('Failed to emit manufacturing workflow lock event', {
        error: eventError.message,
        msmeId: msme._id?.toString()
      });
    }

    return res.json({
      success: true,
      message: isLocked ? 'Manufacturing workflow locked' : 'Manufacturing workflow unlocked',
      data: {
        isLocked,
        lockedAt: msme.business.manufacturingWorkflow.lockedAt
      }
    });
  } catch (error) {
    logger.error('Lock manufacturing workflow error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/msme/manufacturing-workflow/estimate
// @desc    Estimate emissions for custom manufacturing workflow
// @access  Private
router.post('/manufacturing-workflow/estimate', auth, async (req, res) => {
  try {
    const {
      processes = [],
      units = [],
      employees = [],
      supplyChain = [],
      operationsData = {},
      ghgOperationalBoundary: incomingGhgOperationalBoundary = {},
      saveWorkflow = true,
      context = {}
    } = req.body || {};
    if ((!Array.isArray(units) || units.length === 0) && (!Array.isArray(processes) || processes.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'At least one manufacturing process is required under a unit'
      });
    }

    const msme = await MSME.findOne({ userId: req.user.userId });
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const workflowState = msme.business?.manufacturingWorkflow || {};
    if (saveWorkflow && workflowState.isLocked) {
      return res.status(423).json({
        success: false,
        message: 'Manufacturing workflow is locked. Unlock it to make changes.'
      });
    }

    const normalizedUnits = normalizeWorkflowUnits(units, processes);
    const normalizedEmployees = normalizeEmployees(employees, normalizedUnits);
    const normalizedSupplyChain = normalizeSupplyChain(supplyChain, normalizedUnits);
    const normalizedOperationsData = normalizeOperationsData(operationsData);
    const normalizedGhgOperationalBoundary = normalizeGhgOperationalBoundary(
      incomingGhgOperationalBoundary,
      msme.operations?.ghgOperationalBoundary || {}
    );
    const emissionFactorAgentContext = operationsEmissionFactorAgentService.createEmissionFactorAgentContext(msme.toObject());
    const rawEstimate = calculateMultiUnitWorkflowEstimate(
      normalizedUnits,
      normalizedEmployees,
      normalizedSupplyChain,
      emissionFactorAgentContext
    );
    let estimate = applyProfileDataToEstimate(msme.toObject(), rawEstimate, normalizedUnits);
    estimate = applyOperationalBoundaryToWorkflowEstimate(estimate, normalizedGhgOperationalBoundary);
    estimate = applyOperationsGridAndSolarToEstimate(
      estimate,
      normalizedOperationsData,
      estimate?.emissionFactorResolution?.electricityGridKgCo2PerKwh,
      normalizedGhgOperationalBoundary
    );

    const profileOperationsSignals = buildProfileOperationsSignals(
      msme.toObject(),
      normalizedUnits,
      normalizedEmployees,
      normalizedSupplyChain,
      estimate
    );

    const aiInsights = await workflowMultiAgentAdvisorService.generateWorkflowInsights({
      msmeData: msme.toObject(),
      units: normalizedUnits,
      employees: normalizedEmployees,
      supplyChain: normalizedSupplyChain,
      estimate,
      context: {
        ...context,
        profileOperationsSignals
      }
    });

    const aiProfile = {
      confidence: aiInsights?.confidence || 0,
      processes: aiInsights?.processProfile?.processes || [],
      machinery: aiInsights?.processProfile?.machinery || [],
      notes: aiInsights?.processProfile?.notes || [],
      resourceUnderstandingAgents: aiInsights?.orchestration?.resourceUnderstandingAgents || [],
      carbonEmissionAgents: aiInsights?.orchestration?.granularStageAgents || []
    };

    if (saveWorkflow) {
      const syncedSolarMetrics = syncSolarPowerFromOperations(msme, normalizedOperationsData);
      msme.business = msme.business || {};
      msme.business.manufacturingUnits = normalizedUnits.length;
      msme.business.manufacturingWorkflow = {
        isLocked: Boolean(workflowState.isLocked),
        lockedAt: workflowState.lockedAt || null,
        employees: normalizedEmployees,
        supplyChain: normalizedSupplyChain,
        operationsData: normalizedOperationsData,
        units: normalizedUnits,
        // Keep legacy field to avoid breaking old consumers.
        processes: normalizedUnits[0]?.processes || [],
        latestEstimate: {
          totalCO2Emissions: estimate.totalCO2Emissions,
          machineryEmissions: estimate.machineryEmissions,
          rawMaterialEmissions: estimate.rawMaterialEmissions,
          packagingMaterialEmissions: estimate.packagingMaterialEmissions,
          processAuxiliaryEmissions: estimate.processAuxiliaryEmissions || 0,
          scope3Emissions: estimate.scope3Emissions,
          commuteEmissions: estimate.commuteEmissions,
          supplyChainEmissions: estimate.supplyChainEmissions,
          valueChainEmissions: {
            upstream: estimate.valueChainEmissions?.upstream || 0,
            operations: estimate.valueChainEmissions?.operations || 0,
            downstream: estimate.valueChainEmissions?.downstream || 0,
            support: estimate.valueChainEmissions?.support || 0,
            total: estimate.valueChainEmissions?.total || 0
          }
        },
        lastEstimatedAt: new Date()
      };

      msme.operations = {
        sites: normalizedUnits.map((unit) => ({
          name: unit.name,
          city: unit.location || msme.contact?.address?.city || '',
          state: msme.contact?.address?.state || '',
          country: msme.contact?.address?.country || ''
        })),
        vehicles: normalizedOperationsData.transportationVehicles.map((vehicle) => ({
          type: vehicle.vehicleType,
          fuelType: vehicle.fuelType,
          ownership: vehicle.ownership,
          count: vehicle.count,
          monthlyDistanceKm: vehicle.monthlyDistanceKm
        })),
        subsidiaries: Array.isArray(msme.operations?.subsidiaries) ? msme.operations.subsidiaries : [],
        metrics: {
          powerConsumptionKwhPerMonth: normalizedOperationsData.powerConsumptionKwhPerMonth,
          waterConsumptionKlPerMonth: normalizedOperationsData.waterUsageKlPerMonth,
          chemicalsConsumptionKgPerMonth: normalizedOperationsData.chemicalsUsageKgPerMonth,
          fuelUsageLitersPerMonth: normalizedOperationsData.fuelUsageLitersPerMonth,
          recycledWasteKgPerMonth: toNonNegativeNumber(msme.manufacturingProfile?.wasteRecycledKgPerMonth, 0),
          wasteWaterKlPerMonth: toNonNegativeNumber(msme.manufacturingProfile?.wasteWaterKlPerMonth, 0),
          solarInstallationKw: syncedSolarMetrics.solarInstallationKw,
          solarGenerationKwhPerMonth: syncedSolarMetrics.solarGenerationKwhPerMonth,
          importedRawMaterialsKgPerMonth: toNonNegativeNumber(msme.manufacturingProfile?.importedRawMaterialsKgPerMonth, 0),
          outputProductsKgPerMonth: toNonNegativeNumber(msme.manufacturingProfile?.outputProductsKgPerMonth, 0),
          servicesDeliveredPerMonth: toNonNegativeNumber(msme.manufacturingProfile?.servicesDeliveredPerMonth, 0),
          annualTurnoverInr: toNonNegativeNumber(msme.business?.annualTurnover, 0),
          complianceCertifications: [
            ...(Array.isArray(msme.manufacturingProfile?.complianceCertifications) ? msme.manufacturingProfile.complianceCertifications : []),
            ...(Array.isArray(msme.manufacturingProfile?.certifications) ? msme.manufacturingProfile.certifications : [])
          ],
          iso14064Aligned: Boolean(msme.manufacturingProfile?.iso14064Aligned),
          iso14067Aligned: Boolean(msme.manufacturingProfile?.iso14067Aligned),
          ghgProtocolAligned: Boolean(msme.manufacturingProfile?.ghgProtocolAligned)
        },
        operationsDataFeed: {
          selectedChemicalOptions: normalizedOperationsData.selectedChemicalOptions,
          selectedWaterTreatmentOptions: normalizedOperationsData.selectedWaterTreatmentOptions
        },
        aiAgentRecommendations: {
          resourceUnderstandingAgents: aiInsights?.orchestration?.resourceUnderstandingAgents || [],
          carbonEmissionAgents: aiInsights?.orchestration?.granularStageAgents || []
        },
        ghgOperationalBoundary: normalizedGhgOperationalBoundary
      };
      msme.markModified('business');
      msme.markModified('manufacturingProfile');
      msme.markModified('operations');
      await msme.save();

      try {
        orchestrationManagerEventService.emitEvent('msme.manufacturing_workflow.updated', {
          msmeId: msme._id?.toString(),
          unitCount: normalizedUnits.length,
          totalCO2Emissions: estimate.totalCO2Emissions
        }, 'msme_manufacturing_workflow');
      } catch (eventError) {
        logger.warn('Failed to emit manufacturing workflow update event', {
          error: eventError.message,
          msmeId: msme._id?.toString()
        });
      }
    }

    return res.json({
      success: true,
      message: 'Manufacturing workflow estimated successfully',
      data: {
        workflow: {
          isLocked: Boolean(workflowState.isLocked),
          lockedAt: workflowState.lockedAt || null,
          employees: normalizedEmployees,
          supplyChain: normalizedSupplyChain,
          operationsData: normalizedOperationsData,
          units: normalizedUnits,
          processes: normalizedUnits[0]?.processes || [],
          lastEstimatedAt: saveWorkflow
            ? msme.business?.manufacturingWorkflow?.lastEstimatedAt
            : null,
          ghgOperationalBoundary: normalizedGhgOperationalBoundary
        },
        estimate,
        aiProfile,
        profileOperationsSignals
      }
    });
  } catch (error) {
    logger.error('Estimate manufacturing workflow error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/msme/stats
// @desc    Get MSME statistics
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    const msmeId = req.user.msmeId;
    
    if (!msmeId) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const Transaction = require('../models/Transaction');
    const CarbonAssessment = require('../models/CarbonAssessment');

    // Get transaction stats
    const totalTransactions = await Transaction.countDocuments({ msmeId });
    const totalAmount = await Transaction.aggregate([
      { $match: { msmeId: msmeId } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    // Get carbon assessment stats
    const MSME = require('../models/MSME');
    const msmeData = await MSME.findById(msmeId);

    const latestAssessment = await CarbonAssessment.findOne({ msmeId })
      .sort({ createdAt: -1 });

    const totalAssessments = await CarbonAssessment.countDocuments({ msmeId });

    const liveEmissionsAgg = await Transaction.aggregate([
      { $match: { msmeId } },
      {
        $group: {
          _id: null,
          total: { $sum: '$carbonFootprint.co2Emissions' }
        }
      }
    ]);
    const liveTransactionEmissionsKg = Number(liveEmissionsAgg[0]?.total) || 0;

    // Get monthly transaction trend
    const monthlyTransactions = await Transaction.aggregate([
      { $match: { msmeId: msmeId } },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' }
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          totalCO2: { $sum: '$carbonFootprint.co2Emissions' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $limit: 12 }
    ]);

    // Get carbon savings data
    const carbonCalculationService = require('../services/carbonCalculationService');
    const previousAssessment = await CarbonAssessment.findOne({ msmeId })
      .sort({ createdAt: -1 })
      .skip(1);

    let carbonSavings = null;
    if (latestAssessment && msmeData) {
      carbonSavings = carbonCalculationService.calculateCarbonSavings(
        msmeData,
        latestAssessment,
        previousAssessment
      );
    }

    const periodTransactions = latestAssessment?.period?.startDate && latestAssessment?.period?.endDate
      ? await Transaction.find({
        msmeId,
        date: {
          $gte: latestAssessment.period.startDate,
          $lte: latestAssessment.period.endDate
        },
        isSpam: { $ne: true },
        isDuplicate: { $ne: true }
      }).lean()
      : await Transaction.find({ msmeId, isSpam: { $ne: true }, isDuplicate: { $ne: true } }).lean();

    const enrichedLatestAssessment = latestAssessment && msmeData
      ? carbonCalculationService.enrichAssessmentForAnalytics(
        latestAssessment,
        msmeData,
        periodTransactions
      )
      : latestAssessment;

    const assessmentEmissionsKg = Number(enrichedLatestAssessment?.totalCO2Emissions)
      || Number(latestAssessment?.totalCO2Emissions)
      || 0;
    const totalCO2Emissions = Math.max(assessmentEmissionsKg, liveTransactionEmissionsKg);

    const currentScore = carbonCalculationService.resolveCurrentCarbonScore({
      enrichedLatestAssessment,
      latestAssessment,
      msmeData,
      totalCO2Emissions,
      periodTransactions
    });

    const recommendationAssessment = enrichedLatestAssessment || latestAssessment;
    let carbonRecommendations = Array.isArray(recommendationAssessment?.recommendations)
      ? recommendationAssessment.recommendations
      : [];
    if (carbonRecommendations.length === 0 && recommendationAssessment && msmeData) {
      try {
        carbonRecommendations = carbonCalculationService.generateRecommendations(
          recommendationAssessment,
          msmeData
        );
      } catch (recommendationError) {
        logger.warn(`Unable to generate carbon recommendations for MSME ${msmeId}:`, recommendationError);
      }
    }
    const topRecommendations = [...carbonRecommendations]
      .sort((a, b) => Number(b?.potentialCO2Reduction || 0) - Number(a?.potentialCO2Reduction || 0))
      .slice(0, 5);

    // Get carbon credits data
    let carbonCredits = null;
    try {
      carbonCredits = await carbonCreditsService.getMSMECredits(msmeId);
    } catch (error) {
      logger.warn(`Error getting carbon credits for MSME ${msmeId}:`, error);
    }

    const carbonCreditSummary = carbonCredits
      ? carbonCreditsService.getCreditSummary(carbonCredits)
      : null;

    const stats = {
      transactions: {
        total: totalTransactions,
        totalAmount: totalAmount[0]?.total || 0,
        monthlyTrend: monthlyTransactions
      },
      carbon: {
        currentScore,
        totalAssessments,
        lastAssessment: latestAssessment?.createdAt,
        totalCO2Emissions,
        esgScopes: latestAssessment?.esgScopes || null,
        assessmentPeriod: latestAssessment?.period || null,
        transactionCount: latestAssessment?.transactionCount ?? null,
        assessmentTotalAmount: latestAssessment?.totalAmount ?? null,
        assessmentType: latestAssessment?.assessmentType || null,
        predictions: Array.isArray(latestAssessment?.predictions) && latestAssessment.predictions.length
          ? latestAssessment.predictions.slice(0, 12).map((p) => ({
              month: p.month,
              predictedCO2: p.predictedCO2
            }))
          : [],
        categoryBreakdown: latestAssessment?.categoryBreakdown || null,
        recommendations: carbonRecommendations,
        savings: carbonSavings ? {
          totalSavings: carbonSavings.totalSavings,
          periodSavings: carbonSavings.periodSavings,
          savingsPercentage: carbonSavings.savingsPercentage,
          implementedRecommendations: carbonSavings.implementedRecommendations,
          potentialSavings: carbonSavings.potentialSavings,
          achievements: carbonSavings.achievements.length,
          performance: carbonSavings.benchmarkComparison.performance
        } : null
      },
      topRecommendations,
      profile: {
        isVerified: latestAssessment?.msmeId ? true : false,
        registrationDate: latestAssessment?.createdAt
      },
      carbonCredits: carbonCredits ? {
        allocatedCredits: carbonCredits.allocatedCredits,
        availableCredits: carbonCredits.availableCredits,
        usedCredits: carbonCredits.usedCredits,
        retiredCredits: carbonCredits.retiredCredits,
        earnedCredits: carbonCreditSummary?.earnedCredits || 0,
        transferredInCredits: carbonCreditSummary?.transferredInCredits || 0,
        transferredOutCredits: carbonCreditSummary?.transferredOutCredits || 0,
        netTransferredCredits: carbonCreditSummary?.netTransferredCredits || 0,
        totalCO2Reduced: carbonCredits.totalCO2Reduced,
        performanceScore: carbonCredits.performanceMetrics.participationScore,
        lastAllocation: carbonCredits.allocationHistory.length > 0 ? 
          carbonCredits.allocationHistory[carbonCredits.allocationHistory.length - 1].date : null,
        summary: carbonCreditSummary
      } : null
    };

    const latestWithDocumentBatchSummary = await CarbonAssessment.findOne({
      msmeId,
      documentBatchSummary: { $exists: true, $ne: null }
    }).sort({ createdAt: -1 }).lean();

    if (latestWithDocumentBatchSummary?.documentBatchSummary) {
      const dbs = latestWithDocumentBatchSummary.documentBatchSummary;
      stats.documentBulkUpload = {
        assessmentId: latestWithDocumentBatchSummary._id,
        periodType: dbs.periodType,
        totalDocuments: dbs.totalDocuments,
        totalTransactions: dbs.totalTransactions,
        totalAmount: dbs.totalAmount,
        totalCO2Emissions: dbs.totalCO2Emissions,
        periodBuckets: dbs.periodBuckets || [],
        generatedAt: dbs.generatedAt || latestWithDocumentBatchSummary.createdAt
      };
    } else {
      const bulkUploadAssessment = await CarbonAssessment.findOne({
        msmeId,
        $or: [
          { 'mobileBreakdown.source': 'document_bulk_upload' },
          { notes: /document_bulk_upload/i }
        ]
      }).sort({ createdAt: -1 }).lean();

      if (bulkUploadAssessment) {
        const txCount = Number(bulkUploadAssessment.transactionCount) || 0;
        stats.documentBulkUpload = {
          assessmentId: bulkUploadAssessment._id,
          periodType: 'date-wise',
          totalDocuments: 0,
          totalTransactions: txCount,
          totalAmount: Number(bulkUploadAssessment.totalAmount) || 0,
          totalCO2Emissions: Number(bulkUploadAssessment.totalCO2Emissions) || 0,
          periodBuckets: [],
          generatedAt: bulkUploadAssessment.updatedAt || bulkUploadAssessment.createdAt
        };
      }
    }

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Get MSME stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/msme/payment-summary
// @desc    Get payment amount derived from emissions and workflow intensity
// @access  Private (msme/admin only)
router.get('/payment-summary', auth, auth.requireRole('msme', 'admin'), async (req, res) => {
  try {
    const msmeId = req.user.msmeId;

    if (!msmeId) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const paymentSummary = await getMsmePaymentSummary(msmeId);
    if (!paymentSummary) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    return res.json({
      success: true,
      data: paymentSummary
    });
  } catch (error) {
    logger.error('Get MSME payment summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/msme/carbon-credits
// @desc    Get detailed carbon credits information for MSME
// @access  Private
router.get('/carbon-credits', auth, requireMsmePlanFeature('carbonCredits'), async (req, res) => {
  try {
    const msmeId = req.user.msmeId;
    
    if (!msmeId) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const carbonCredits = await carbonCreditsService.getMSMECredits(msmeId);
    const creditSummary = carbonCreditsService.getCreditSummary(carbonCredits);
    
    // Get recent allocation history
    const recentAllocations = carbonCredits.allocationHistory
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    // Get recent transactions
    const recentTransactions = carbonCredits.transactions
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10);

    // Calculate performance metrics
    const performanceMetrics = {
      carbonEfficiency: carbonCredits.performanceMetrics.carbonEfficiency,
      participationScore: carbonCredits.performanceMetrics.participationScore,
      totalContributions: carbonCredits.allocationHistory.length,
      averageContribution: carbonCredits.allocationHistory.length > 0 ?
        carbonCredits.allocationHistory.reduce((sum, h) => sum + h.creditsAllocated, 0) / carbonCredits.allocationHistory.length : 0,
      lastUpdated: carbonCredits.performanceMetrics.lastUpdated
    };

    res.json({
      success: true,
      data: {
        credits: {
          allocated: carbonCredits.allocatedCredits,
          available: carbonCredits.availableCredits,
          used: carbonCredits.usedCredits,
          retired: carbonCredits.retiredCredits,
          earned: creditSummary.earnedCredits,
          transferredIn: creditSummary.transferredInCredits,
          transferredOut: creditSummary.transferredOutCredits,
          netTransferred: creditSummary.netTransferredCredits,
          totalCO2Reduced: carbonCredits.totalCO2Reduced
        },
        summary: creditSummary,
        performance: performanceMetrics,
        recentAllocations,
        recentTransactions,
        poolId: carbonCredits.poolId,
        lastContribution: carbonCredits.lastContributionDate
      }
    });

  } catch (error) {
    logger.error('Get MSME carbon credits details error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/msme/carbon-credits/leaderboard
// @desc    Get carbon credits leaderboard for MSMEs
// @access  Private
router.get('/carbon-credits/leaderboard', auth, async (req, res) => {
  try {
    const { limit = 10, period = 'all' } = req.query;

    const leaderboard = await carbonCreditsService.getMSMELeaderboard(
      parseInt(limit),
      period
    );

    res.json({
      success: true,
      data: {
        leaderboard,
        period,
        totalParticipants: leaderboard.length
      }
    });

  } catch (error) {
    logger.error('Get MSME carbon credits leaderboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;