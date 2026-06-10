const {
  buildAccountingSyncStatus
} = require('../services/complianceHubService');

describe('Compliance Hub Service', () => {
  test('lists accounting connectors with sync readiness flags', async () => {
    const statuses = await buildAccountingSyncStatus();
    expect(Array.isArray(statuses)).toBe(true);
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      supportsImport: expect.any(Boolean)
    });
  });
});
