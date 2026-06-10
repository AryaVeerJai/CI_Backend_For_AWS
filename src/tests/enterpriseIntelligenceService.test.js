const {
  buildHotspots,
  buildConnectorStatus
} = require('../services/enterpriseIntelligenceService');

describe('enterpriseIntelligenceService', () => {
  it('builds hotspots ranked by CO2 emissions', () => {
    const transactions = [
      { _id: 'a', description: 'Low', category: 'other', carbonFootprint: { co2Emissions: 10 } },
      { _id: 'b', description: 'High', category: 'energy', carbonFootprint: { co2Emissions: 500 } },
      { _id: 'c', description: 'Mid', category: 'fuel', carbonFootprint: { co2Emissions: 100 } }
    ];
    const hotspots = buildHotspots(transactions, 2);
    expect(hotspots).toHaveLength(2);
    expect(hotspots[0].description).toBe('High');
    expect(hotspots[0].co2Kg).toBe(500);
  });

  it('lists accounting connector statuses', async () => {
    const connectors = await buildConnectorStatus();
    expect(Array.isArray(connectors)).toBe(true);
    expect(connectors.length).toBeGreaterThan(5);
    expect(connectors[0]).toHaveProperty('id');
    expect(connectors[0]).toHaveProperty('supportsImport');
  });
});
