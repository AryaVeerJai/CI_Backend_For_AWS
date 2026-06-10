const { normalizeGhgOrganizationalBoundary } = require('./ghgBoundaryFields');

const MSME_TYPE_TO_COMPANY_TYPE = {
  micro: 'micro',
  'micro enterprise': 'micro',
  small: 'small',
  'small enterprise': 'small',
  medium: 'medium',
  'medium enterprise': 'medium'
};

const toNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(normalized)) return true;
  if (['no', 'false', '0', 'n'].includes(normalized)) return false;
  return undefined;
};

const toString = (value) => {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
};

const toStringArray = (value) => {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => toString(item))
      .filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
  }

  const normalized = toString(value);
  if (!normalized) return undefined;

  const values = normalized
    .split(/[,;|]/g)
    .map((item) => item.trim())
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
};

const pickFirst = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
};

const normalizeCompanyType = (value) => {
  const normalized = toString(value);
  if (!normalized) return undefined;
  return MSME_TYPE_TO_COMPANY_TYPE[normalized.toLowerCase()] || undefined;
};

const normalizeBusinessDomain = (value) => {
  const normalized = toString(value);
  if (!normalized) return undefined;

  const lower = normalized.toLowerCase();
  if (lower.includes('manufactur') || lower.includes('engineering')) return 'manufacturing';
  if (lower.includes('logistic') || lower.includes('transport')) return 'logistics';
  if (lower.includes('textile')) return 'textiles';
  if (lower.includes('food')) return 'food_processing';
  if (lower.includes('electronic')) return 'electronics';
  if (lower.includes('automotive')) return 'automotive';
  if (lower.includes('construction')) return 'construction';
  if (lower.includes('service')) return 'services';
  if (lower.includes('retail')) return 'retail';
  if (lower.includes('trading') || lower.includes('trade')) return 'trading';
  return undefined;
};

const pruneUndefined = (input) => {
  if (!input || typeof input !== 'object') return input;
  const output = {};
  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined) return;
    output[key] = value;
  });
  return output;
};

const normalizeManufacturingProfile = (rawProfile = {}, fallbackProfile = {}) => {
  const raw = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
  const fallback = fallbackProfile && typeof fallbackProfile === 'object' ? fallbackProfile : {};

  const normalized = {
    msmeType: toString(pickFirst(raw.msmeType, fallback.msmeType)),
    industrySector: toString(pickFirst(raw.industrySector, fallback.industrySector)),
    nicCode: toString(pickFirst(raw.nicCode, fallback.nicCode)),
    yearOfEstablishment: toNumber(pickFirst(raw.yearOfEstablishment, fallback.yearOfEstablishment)),
    locationCity: toString(pickFirst(raw.locationCity, fallback.locationCity)),
    locationState: toString(pickFirst(raw.locationState, fallback.locationState)),
    locationCountry: toString(pickFirst(raw.locationCountry, fallback.locationCountry)),
    numberOfEmployees: toNumber(pickFirst(raw.numberOfEmployees, fallback.numberOfEmployees)),
    plantAreaSqft: toNumber(pickFirst(raw.plantAreaSqft, fallback.plantAreaSqft)),
    operationalDaysPerYear: toNumber(pickFirst(raw.operationalDaysPerYear, fallback.operationalDaysPerYear)),
    primaryEnergySource: toString(pickFirst(raw.primaryEnergySource, fallback.primaryEnergySource)),
    backupEnergySource: toString(pickFirst(raw.backupEnergySource, fallback.backupEnergySource)),
    mainFuelsUsed: toStringArray(pickFirst(raw.mainFuelsUsed, fallback.mainFuelsUsed)),
    waterSource: toString(pickFirst(raw.waterSource, fallback.waterSource)),
    wasteManagementPractice: toString(pickFirst(raw.wasteManagementPractice, fallback.wasteManagementPractice)),
    keyProducts: toStringArray(pickFirst(raw.keyProducts, fallback.keyProducts)),
    productionCapacityPerMonth: toNumber(pickFirst(raw.productionCapacityPerMonth, fallback.productionCapacityPerMonth)),
    productionCapacityUnit: toString(pickFirst(raw.productionCapacityUnit, fallback.productionCapacityUnit)),
    supplyChainType: toString(pickFirst(raw.supplyChainType, fallback.supplyChainType)),
    logisticsMode: toString(pickFirst(raw.logisticsMode, fallback.logisticsMode)),
    certifications: toStringArray(pickFirst(raw.certifications, fallback.certifications)),
    esgMaturityLevel: toString(pickFirst(raw.esgMaturityLevel, fallback.esgMaturityLevel)),
    digitalizationLevel: toString(pickFirst(raw.digitalizationLevel, fallback.digitalizationLevel)),
    carbonAccountingPractice: toString(pickFirst(raw.carbonAccountingPractice, fallback.carbonAccountingPractice)),
    regulatoryExposure: toStringArray(pickFirst(raw.regulatoryExposure, fallback.regulatoryExposure)),
    exportActivity: toBoolean(pickFirst(raw.exportActivity, fallback.exportActivity)),
    clusterAssociation: toString(pickFirst(raw.clusterAssociation, fallback.clusterAssociation)),
    beeSector: toString(pickFirst(raw.beeSector, fallback.beeSector)),
    adeetieClusterId: toString(pickFirst(raw.adeetieClusterId, fallback.adeetieClusterId)),
    powerConsumptionKwhPerMonth: toNumber(pickFirst(raw.powerConsumptionKwhPerMonth, fallback.powerConsumptionKwhPerMonth)),
    waterConsumptionKlPerMonth: toNumber(pickFirst(raw.waterConsumptionKlPerMonth, fallback.waterConsumptionKlPerMonth)),
    chemicalsConsumptionKgPerMonth: toNumber(pickFirst(raw.chemicalsConsumptionKgPerMonth, fallback.chemicalsConsumptionKgPerMonth)),
    wasteRecycledKgPerMonth: toNumber(pickFirst(raw.wasteRecycledKgPerMonth, fallback.wasteRecycledKgPerMonth)),
    wasteWaterKlPerMonth: toNumber(pickFirst(raw.wasteWaterKlPerMonth, fallback.wasteWaterKlPerMonth)),
    solarInstallationKw: toNumber(pickFirst(raw.solarInstallationKw, fallback.solarInstallationKw)),
    solarGenerationKwhPerMonth: toNumber(pickFirst(raw.solarGenerationKwhPerMonth, fallback.solarGenerationKwhPerMonth)),
    importedRawMaterialsKgPerMonth: toNumber(pickFirst(raw.importedRawMaterialsKgPerMonth, fallback.importedRawMaterialsKgPerMonth)),
    outputProductsKgPerMonth: toNumber(pickFirst(raw.outputProductsKgPerMonth, fallback.outputProductsKgPerMonth)),
    servicesDeliveredPerMonth: toNumber(pickFirst(raw.servicesDeliveredPerMonth, fallback.servicesDeliveredPerMonth)),
    complianceCertifications: toStringArray(pickFirst(raw.complianceCertifications, fallback.complianceCertifications)),
    iso14064Aligned: toBoolean(pickFirst(raw.iso14064Aligned, fallback.iso14064Aligned)),
    iso14067Aligned: toBoolean(pickFirst(raw.iso14067Aligned, fallback.iso14067Aligned)),
    ghgProtocolAligned: toBoolean(pickFirst(raw.ghgProtocolAligned, fallback.ghgProtocolAligned))
  };

  if (
    (raw.ghgOrganizationalBoundary && typeof raw.ghgOrganizationalBoundary === 'object')
    || (fallback.ghgOrganizationalBoundary && typeof fallback.ghgOrganizationalBoundary === 'object')
  ) {
    normalized.ghgOrganizationalBoundary = normalizeGhgOrganizationalBoundary(
      raw.ghgOrganizationalBoundary || {},
      fallback.ghgOrganizationalBoundary || {}
    );
  }

  return pruneUndefined(normalized);
};

const normalizeMSMEPayload = (rawPayload = {}, existingProfile = {}) => {
  const payload = rawPayload && typeof rawPayload === 'object' ? { ...rawPayload } : {};
  const existingManufacturingProfile = existingProfile?.manufacturingProfile || {};

  const rootMappedProfile = {
    msmeType: pickFirst(payload.MSME_Type, payload.msmeType),
    industrySector: pickFirst(payload.Industry_Sector, payload.industrySector),
    nicCode: pickFirst(payload.NIC_Code, payload.nicCode),
    yearOfEstablishment: pickFirst(payload.Year_of_Establishment, payload.yearOfEstablishment),
    locationCity: pickFirst(payload.Location_City, payload.locationCity),
    locationState: pickFirst(payload.Location_State, payload.locationState),
    locationCountry: pickFirst(payload.Country, payload.locationCountry),
    numberOfEmployees: pickFirst(payload.Number_of_Employees, payload.numberOfEmployees),
    plantAreaSqft: pickFirst(payload.Plant_Area_sqft, payload.plantAreaSqft),
    operationalDaysPerYear: pickFirst(payload.Operational_Days_Per_Year, payload.operationalDaysPerYear),
    primaryEnergySource: pickFirst(payload.Primary_Energy_Source, payload.primaryEnergySource),
    backupEnergySource: pickFirst(payload.Backup_Energy_Source, payload.backupEnergySource),
    mainFuelsUsed: pickFirst(payload.Main_Fuels_Used, payload.mainFuelsUsed),
    waterSource: pickFirst(payload.Water_Source, payload.waterSource),
    wasteManagementPractice: pickFirst(payload.Waste_Management_Practice, payload.wasteManagementPractice),
    keyProducts: pickFirst(payload.Key_Products, payload.keyProducts),
    productionCapacityPerMonth: pickFirst(payload.Production_Capacity_per_Month, payload.productionCapacityPerMonth),
    productionCapacityUnit: pickFirst(payload.Production_Capacity_Unit, payload.productionCapacityUnit),
    supplyChainType: pickFirst(payload.Supply_Chain_Type, payload.supplyChainType),
    logisticsMode: pickFirst(payload.Logistics_Mode, payload.logisticsMode),
    certifications: pickFirst(payload.Certifications, payload.certifications),
    esgMaturityLevel: pickFirst(payload.ESG_Maturity_Level, payload.esgMaturityLevel),
    digitalizationLevel: pickFirst(payload.Digitalization_Level, payload.digitalizationLevel),
    carbonAccountingPractice: pickFirst(payload.Carbon_Accounting_Practice, payload.carbonAccountingPractice),
    regulatoryExposure: pickFirst(payload.Regulatory_Exposure, payload.regulatoryExposure),
    exportActivity: pickFirst(payload.Export_Activity, payload.exportActivity),
    clusterAssociation: pickFirst(payload.Cluster_Association, payload.clusterAssociation)
    ,
    powerConsumptionKwhPerMonth: pickFirst(payload.powerConsumptionKwhPerMonth, payload.Power_Consumption_kWh_per_Month),
    waterConsumptionKlPerMonth: pickFirst(payload.waterConsumptionKlPerMonth, payload.Water_Consumption_kl_per_Month),
    chemicalsConsumptionKgPerMonth: pickFirst(payload.chemicalsConsumptionKgPerMonth, payload.Chemicals_Consumption_kg_per_Month),
    wasteRecycledKgPerMonth: pickFirst(payload.wasteRecycledKgPerMonth, payload.Waste_Recycled_kg_per_Month),
    wasteWaterKlPerMonth: pickFirst(payload.wasteWaterKlPerMonth, payload.Waste_Water_kl_per_Month),
    solarInstallationKw: pickFirst(payload.solarInstallationKw, payload.Solar_Installation_kW),
    solarGenerationKwhPerMonth: pickFirst(payload.solarGenerationKwhPerMonth, payload.Solar_Generation_kWh_per_Month),
    importedRawMaterialsKgPerMonth: pickFirst(payload.importedRawMaterialsKgPerMonth, payload.Imported_Raw_Materials_kg_per_Month),
    outputProductsKgPerMonth: pickFirst(payload.outputProductsKgPerMonth, payload.Output_Products_kg_per_Month),
    servicesDeliveredPerMonth: pickFirst(payload.servicesDeliveredPerMonth, payload.Services_Delivered_per_Month),
    complianceCertifications: pickFirst(payload.complianceCertifications, payload.Compliance_Certifications),
    iso14064Aligned: pickFirst(payload.iso14064Aligned, payload.ISO_14064_Aligned),
    iso14067Aligned: pickFirst(payload.iso14067Aligned, payload.ISO_14067_Aligned),
    ghgProtocolAligned: pickFirst(payload.ghgProtocolAligned, payload.GHG_Protocol_Aligned)
  };

  const explicitProfile = payload.manufacturingProfile && typeof payload.manufacturingProfile === 'object'
    ? payload.manufacturingProfile
    : {};

  const normalizedManufacturingProfile = normalizeManufacturingProfile(
    { ...rootMappedProfile, ...explicitProfile },
    existingManufacturingProfile
  );

  if (Object.keys(normalizedManufacturingProfile).length > 0) {
    payload.manufacturingProfile = normalizedManufacturingProfile;
  }

  payload.companyName = pickFirst(payload.companyName, payload.Company_Name);

  const companyTypeFromProfile = normalizeCompanyType(normalizedManufacturingProfile.msmeType);
  payload.companyType = pickFirst(payload.companyType, companyTypeFromProfile);

  payload.industry = pickFirst(payload.industry, normalizedManufacturingProfile.industrySector);

  payload.businessDomain = pickFirst(
    payload.businessDomain,
    normalizeBusinessDomain(normalizedManufacturingProfile.industrySector)
  );

  payload.establishmentYear = pickFirst(
    payload.establishmentYear,
    normalizedManufacturingProfile.yearOfEstablishment
  );

  const contact = payload.contact && typeof payload.contact === 'object' ? payload.contact : {};
  const address = contact.address && typeof contact.address === 'object' ? contact.address : {};
  const mergedAddress = pruneUndefined({
    ...address,
    city: pickFirst(address.city, normalizedManufacturingProfile.locationCity),
    state: pickFirst(address.state, normalizedManufacturingProfile.locationState),
    country: pickFirst(address.country, normalizedManufacturingProfile.locationCountry)
  });
  payload.contact = pruneUndefined({
    ...contact,
    address: mergedAddress
  });

  const business = payload.business && typeof payload.business === 'object' ? payload.business : {};
  payload.business = pruneUndefined({
    ...business,
    numberOfEmployees: pickFirst(business.numberOfEmployees, normalizedManufacturingProfile.numberOfEmployees),
    primaryProducts: pickFirst(
      business.primaryProducts,
      normalizedManufacturingProfile.keyProducts && normalizedManufacturingProfile.keyProducts.join(', ')
    )
  });

  return payload;
};

module.exports = {
  normalizeMSMEPayload,
  normalizeManufacturingProfile
};
