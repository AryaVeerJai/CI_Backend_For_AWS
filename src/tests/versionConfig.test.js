const restoreEnv = () => {
  delete process.env.API_VERSION;
  delete process.env.BASELINE_CODEBASE_VERSION;
};

describe('version config helpers', () => {
  beforeEach(() => {
    jest.resetModules();
    restoreEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  test('uses root package version as default baseline', () => {
    const { getBaselineCodebaseVersion } = require('../config/version');
    expect(getBaselineCodebaseVersion()).toBe('2.3.2');
  });

  test('uses backend package version as default API version', () => {
    const { getApiVersion } = require('../config/version');
    expect(getApiVersion()).toBe('2.3.2');
  });

  test('trims whitespace from environment overrides', () => {
    process.env.API_VERSION = '  4.0.1  ';
    process.env.BASELINE_CODEBASE_VERSION = '  4.0.1-baseline  ';

    const { getApiVersion, getBaselineCodebaseVersion } = require('../config/version');

    expect(getApiVersion()).toBe('4.0.1');
    expect(getBaselineCodebaseVersion()).toBe('4.0.1-baseline');
  });

  test('ignores blank environment overrides', () => {
    process.env.API_VERSION = '   ';
    process.env.BASELINE_CODEBASE_VERSION = '';

    const { getApiVersion, getBaselineCodebaseVersion } = require('../config/version');

    expect(getApiVersion()).toBe('2.3.2');
    expect(getBaselineCodebaseVersion()).toBe('2.3.2');
  });

  test('buildVersionMetadata returns paired api and baseline versions', () => {
    process.env.API_VERSION = '9.9.9';
    process.env.BASELINE_CODEBASE_VERSION = '9.9.9-baseline';

    const { buildVersionMetadata } = require('../config/version');

    expect(buildVersionMetadata()).toEqual({
      apiVersion: '9.9.9',
      baselineCodebaseVersion: '9.9.9-baseline',
    });
  });
});
