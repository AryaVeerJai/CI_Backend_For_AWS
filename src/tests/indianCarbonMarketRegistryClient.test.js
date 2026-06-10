jest.mock('axios');

const axios = require('axios');
const IndianCarbonMarketRegistryClient = require('../services/indianCarbonMarketRegistryClient');

describe('IndianCarbonMarketRegistryClient', () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...previousEnv };

    axios.create.mockReturnValue({
      request: jest.fn().mockResolvedValue({ data: { ok: true } })
    });
  });

  afterAll(() => {
    process.env = previousEnv;
  });

  test('reports configuration status from constructor options', () => {
    const client = new IndianCarbonMarketRegistryClient({
      enabled: true,
      baseUrl: 'https://registry.example.in',
      apiKey: 'registry-key',
      timeout: 20000
    });

    expect(client.getConfigurationStatus()).toEqual(expect.objectContaining({
      enabled: true,
      configured: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      timeoutMs: 20000,
      portalBaseUrl: expect.any(String),
      registryBaseUrl: expect.any(String)
    }));
  });

  test('throws when integration is disabled', async () => {
    const client = new IndianCarbonMarketRegistryClient({
      enabled: false,
      baseUrl: 'https://registry.example.in',
      apiKey: 'registry-key'
    });

    await expect(client.getHealthStatus())
      .rejects
      .toMatchObject({ statusCode: 503 });
  });

  test('throws when configuration is incomplete', async () => {
    const client = new IndianCarbonMarketRegistryClient({
      enabled: true,
      baseUrl: '',
      apiKey: ''
    });

    await expect(client.getHealthStatus())
      .rejects
      .toMatchObject({ statusCode: 500 });
  });

  test('syncs MSME credits using configured endpoint paths', async () => {
    const request = jest.fn().mockResolvedValue({
      data: { accountId: 'ICM-1234', availableCredits: 180 }
    });
    axios.create.mockReturnValue({ request });

    const client = new IndianCarbonMarketRegistryClient({
      enabled: true,
      baseUrl: 'https://registry.example.in',
      apiKey: 'registry-key',
      syncPath: '/v1/msmes/:msmeId/credits/sync'
    });

    const payload = { localBalances: { availableCredits: 150 } };
    const response = await client.syncMSMECredits('msme-42', payload);

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      url: '/v1/msmes/msme-42/credits/sync',
      data: payload,
      headers: expect.objectContaining({
        'x-api-key': 'registry-key'
      })
    }));
    expect(response).toEqual({ accountId: 'ICM-1234', availableCredits: 180 });
  });
});
