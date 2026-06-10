/**
 * Canonical emission factor registry for backend, mobile sync, and MongoDB seeding.
 */
const REGISTRY_DOC = require('./emissionFactorRegistry.json');
const CARBON_SHARED = require('./carbonEmissionDefaults.json');

const freezeRegistryEntries = () => {
  const version = REGISTRY_DOC.registryVersion || CARBON_SHARED.configVersion || '2026-05-28';
  const entries = {};
  Object.entries(REGISTRY_DOC.factors || {}).forEach(([key, row]) => {
    entries[key] = Object.freeze({
      ...row,
      sourceVersion: row.sourceVersion || version
    });
  });
  return Object.freeze(entries);
};

const DEFAULT_FACTOR_REGISTRY = freezeRegistryEntries();

const getActivityEmissionFactors = () => {
  const tree = REGISTRY_DOC.activityTree || {};
  return {
    electricity: { ...(tree.electricity || {}) },
    fuel: { ...(tree.fuel || {}) },
    water: tree.water ?? 0.0004,
    solidWaste: tree.solidWaste ?? 0.5,
    hazardousWaste: tree.hazardousWaste ?? 2.0,
    materials: { ...(tree.materials || {}) },
    transport: { ...(tree.transport || {}) }
  };
};

const getIndustryFactors = () => ({ ...(REGISTRY_DOC.industryFactors || {}) });

const getDomainFactors = () => {
  const domains = REGISTRY_DOC.domainFactors || {};
  const result = {};
  Object.entries(domains).forEach(([domain, factors]) => {
    result[domain] = { ...factors };
  });
  return result;
};

const getRegionalGridFactors = () => ({ ...(REGISTRY_DOC.regionalGridKgCo2PerKwh || {}) });

const listRegistryFactorIds = () => Object.keys(DEFAULT_FACTOR_REGISTRY);

module.exports = {
  REGISTRY_VERSION: REGISTRY_DOC.registryVersion,
  METHODOLOGY_NOTE: REGISTRY_DOC.methodologyNote,
  DEFAULT_FACTOR_REGISTRY,
  getActivityEmissionFactors,
  getIndustryFactors,
  getDomainFactors,
  getRegionalGridFactors,
  listRegistryFactorIds
};
