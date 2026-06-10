const governanceService = require('../ghgInventoryGovernanceService');
const CARBON_DEFAULTS = require('../../../../shared/carbonEmissionDefaults.json');
const { listRegistryFactorIds } = require('../../../../shared/emissionFactorRegistry');

/**
 * Agent: ensures versioned emission factor registry is seeded and returns active factors.
 */
const execute = async (task = {}) => {
  const { input = {} } = task;
  const factorIds = Array.isArray(input.factorIds) && input.factorIds.length > 0
    ? input.factorIds
    : listRegistryFactorIds();

  const seedResult = input.skipSeed
    ? { seeded: 0, configVersion: CARBON_DEFAULTS.configVersion }
    : await governanceService.seedDefaultFactorRegistry();

  const activeFactors = {};
  for (const id of factorIds) {
    activeFactors[id] = await governanceService.getActiveFactor(id);
  }

  return {
    agent: 'factor_registry',
    registryVersion: CARBON_DEFAULTS.configVersion,
    seedResult,
    activeFactors,
    methodologyNote: CARBON_DEFAULTS.methodologyNote,
    generatedAt: new Date().toISOString()
  };
};

module.exports = { execute };
