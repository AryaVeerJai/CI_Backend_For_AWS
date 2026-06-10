/**
 * PAT (Perform, Achieve and Trade) energy metrics — toe and SEC for designated consumers.
 * Uses BEE/IPCC conversion proxies when metered activity data is unavailable.
 */

const TOE_PER_KWH = 1 / 11630;
const TOE_PER_LITER_DIESEL = 0.00084;
const TOE_PER_LITER_PETROL = 0.00080;
const TOE_PER_KG_LPG = 0.00113;
const TOE_PER_KG_COAL = 0.000714;

const DC_SECTORS = new Set([
  'aluminium',
  'cement',
  'chlor-alkali',
  'fertilizer',
  'iron_steel',
  'pulp_paper',
  'textiles',
  'thermal_power'
]);

const toFinite = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const round2 = (value) => Math.round(toFinite(value) * 100) / 100;
const round4 = (value) => Math.round(toFinite(value) * 10000) / 10000;

const isDesignatedConsumer = (enterpriseProfile = {}) => {
  const sectorKey = String(enterpriseProfile.sector || enterpriseProfile.industry || '')
    .toLowerCase()
    .replace(/\s+/g, '_');
  return enterpriseProfile.regulatoryMandates?.patScheme === true
    || DC_SECTORS.has(sectorKey);
};

const resolveFuelToeFactor = (fuelType = 'diesel') => {
  const key = String(fuelType || '').toLowerCase();
  if (key === 'petrol') return TOE_PER_LITER_PETROL;
  if (key === 'lpg') return TOE_PER_KG_LPG;
  if (key === 'coal') return TOE_PER_KG_COAL;
  return TOE_PER_LITER_DIESEL;
};

const extractKwhFromTransaction = (transaction = {}) => {
  const unit = String(transaction.unit || transaction.metadata?.unit || '').toLowerCase();
  const quantity = toFinite(transaction.quantity, 0);
  if (quantity > 0 && ['kwh', 'kw-h', 'kilowatt-hour', 'kilowatt hour'].includes(unit)) {
    return quantity;
  }
  const activityUnit = String(transaction.activityUnit || '').toLowerCase();
  const activityQuantity = toFinite(transaction.activityQuantity, 0);
  if (activityQuantity > 0 && activityUnit === 'kwh') {
    return activityQuantity;
  }
  const amount = toFinite(transaction.amount, 0);
  if (amount > 0) {
    return amount / 8;
  }
  return 0;
};

const extractFuelLitersFromTransaction = (transaction = {}) => {
  const unit = String(transaction.unit || transaction.metadata?.unit || '').toLowerCase();
  const quantity = toFinite(transaction.quantity, 0);
  if (quantity > 0 && ['liter', 'litre', 'l', 'liters', 'litres'].includes(unit)) {
    return quantity;
  }
  const amount = toFinite(transaction.amount, 0);
  if (amount > 0) {
    return amount / 90;
  }
  return 0;
};

const computeTransactionToe = (transaction = {}) => {
  const category = String(transaction.category || '').toLowerCase();
  const subcategory = String(transaction.subcategory || '').toLowerCase();

  if (category === 'energy' || category === 'utilities') {
    if (subcategory === 'renewable') {
      return { toe: 0, method: 'renewable_excluded', energyType: 'renewable' };
    }
    if (['diesel', 'petrol', 'lpg', 'coal', 'cng', 'natural_gas'].includes(subcategory)) {
      const liters = extractFuelLitersFromTransaction(transaction);
      const factor = resolveFuelToeFactor(subcategory);
      return {
        toe: round4(liters * factor),
        method: liters > 0 ? 'fuel_liters' : 'fuel_spend_proxy',
        energyType: subcategory
      };
    }
    const kwh = extractKwhFromTransaction(transaction);
    return {
      toe: round4(kwh * TOE_PER_KWH),
      method: kwh > 0 ? 'electricity_kwh' : 'electricity_spend_proxy',
      energyType: 'electricity'
    };
  }

  if (category === 'transportation' || category === 'fuel') {
    const fuelType = subcategory || 'diesel';
    const liters = extractFuelLitersFromTransaction(transaction);
    const factor = resolveFuelToeFactor(fuelType);
    return {
      toe: round4(liters * factor),
      method: liters > 0 ? 'transport_fuel_liters' : 'transport_fuel_spend_proxy',
      energyType: fuelType
    };
  }

  return { toe: 0, method: 'not_energy', energyType: null };
};

const computePatEnergyMetrics = ({
  transactions = [],
  enterpriseProfile = {},
  productionOutput = null,
  productionUnit = null
} = {}) => {
  const energyCategories = new Set(['energy', 'utilities', 'fuel', 'electricity', 'transportation']);
  let totalToe = 0;
  let electricityToe = 0;
  let fuelToe = 0;
  let energyEmissionsKg = 0;

  transactions.forEach((tx) => {
    const category = String(tx.category || tx.carbonFootprint?.category || '').toLowerCase();
    if (!energyCategories.has(category)
      && !/fuel|electric|diesel|lpg|power/i.test(category)) {
      return;
    }

    const toeResult = computeTransactionToe(tx);
    totalToe += toeResult.toe;
    if (toeResult.energyType === 'electricity' || toeResult.energyType === 'renewable') {
      electricityToe += toeResult.toe;
    } else if (toeResult.energyType) {
      fuelToe += toeResult.toe;
    }
    energyEmissionsKg += toFinite(tx.carbonFootprint?.co2Emissions, 0);
  });

  const output = toFinite(productionOutput, 0)
    || toFinite(enterpriseProfile.annualProduction, 0)
    || toFinite(enterpriseProfile.productionVolume, 0);
  const unit = productionUnit
    || enterpriseProfile.productionUnit
    || enterpriseProfile.functionalUnit
    || null;

  const specificEnergyConsumption = output > 0 ? round4(totalToe / output) : null;

  return {
    scheme: 'BEE_PAT',
    designatedConsumer: isDesignatedConsumer(enterpriseProfile),
    totalEnergyToe: round4(totalToe),
    electricityToe: round4(electricityToe),
    fuelToe: round4(fuelToe),
    energyEmissionsKgCo2e: round2(energyEmissionsKg),
    specificEnergyConsumption,
    secUnit: unit ? `toe/${unit}` : 'toe/production_unit',
    productionOutput: output > 0 ? output : null,
    productionUnit: unit,
    conversionFactors: {
      toePerKwh: TOE_PER_KWH,
      toePerLiterDiesel: TOE_PER_LITER_DIESEL,
      toePerLiterPetrol: TOE_PER_LITER_PETROL,
      toePerKgLpg: TOE_PER_KG_LPG
    },
    dataQuality: output > 0 ? 'activity_with_production' : 'activity_proxy_no_production'
  };
};

module.exports = {
  DC_SECTORS,
  TOE_PER_KWH,
  isDesignatedConsumer,
  computeTransactionToe,
  computePatEnergyMetrics
};
