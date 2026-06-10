const backendPackage = require('../../package.json');
const rootPackage = require('../../../package.json');

const DEFAULT_VERSION = '2.3.2';

const getMonorepoVersion = () => (
  normalizeVersion(rootPackage.version)
  || normalizeVersion(backendPackage.version)
  || DEFAULT_VERSION
);

const normalizeVersion = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
};

const getApiVersion = () => (
  normalizeVersion(process.env.API_VERSION)
  || getMonorepoVersion()
);

const getBaselineCodebaseVersion = () => (
  normalizeVersion(process.env.BASELINE_CODEBASE_VERSION)
  || getMonorepoVersion()
);

const buildVersionMetadata = () => ({
  apiVersion: getApiVersion(),
  baselineCodebaseVersion: getBaselineCodebaseVersion()
});

module.exports = {
  getApiVersion,
  getBaselineCodebaseVersion,
  buildVersionMetadata
};
