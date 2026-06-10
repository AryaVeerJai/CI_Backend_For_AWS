const request = require('supertest');
const crypto = require('crypto');

jest.mock('../config/database', () => jest.fn());
jest.mock('../services/aiAgentService', () => ({
  initialize: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../services/orchestrationManagerEventService', () => ({
  registerExternalListeners: jest.fn()
}));
jest.mock('../services/realTimeMonitoringInstance', () => ({}));
jest.mock('../services/enhancedMonitoringService', () => ({}));
jest.mock('../services/dataFlowOptimizationService', () => ({}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const mockPartner = {
  _id: '507f1f77bcf86cd799439099',
  name: 'Test Bank Partner',
  organizationType: 'bank_incentives_partner',
  scopes: ['msme:read', 'carbon:read'],
  apiKeyPrefix: 'ci_live_test1234',
  apiKeyHash: '',
  isActive: true,
  save: jest.fn().mockResolvedValue(undefined)
};

const TEST_API_KEY = 'ci_live_test1234_' + crypto.randomBytes(16).toString('base64url');

mockPartner.apiKeyHash = require('../services/partnerApiService').hashApiKey(TEST_API_KEY);

jest.mock('../models/PartnerApplication', () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  PARTNER_SCOPES: [
    'msme:read',
    'carbon:read',
    'reports:read',
    'transactions:summary',
    'webhooks:manage'
  ]
}));

jest.mock('../models/MSME', () => ({
  find: jest.fn(),
  findById: jest.fn(),
  countDocuments: jest.fn()
}));

jest.mock('../models/CarbonAssessment', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  countDocuments: jest.fn()
}));

jest.mock('../models/Transaction', () => ({
  countDocuments: jest.fn(),
  aggregate: jest.fn()
}));

jest.mock('../models/PartnerApiUsage', () => ({
  create: jest.fn().mockResolvedValue({}),
  countDocuments: jest.fn().mockResolvedValue(0),
  aggregate: jest.fn().mockResolvedValue([]),
  distinct: jest.fn().mockResolvedValue([])
}));

jest.mock('../services/partnerUsageService', () => {
  const actual = jest.requireActual('../services/partnerUsageService');
  return {
    ...actual,
    getCachedUsageCounts: jest.fn().mockResolvedValue({
      totalCalls: 0,
      apiCalls: 0,
      webhookCalls: 0,
      reportPullCalls: 0,
      distinctMsmeAccessed: 0
    }),
    getPartnerUsageSummary: jest.fn().mockResolvedValue({
      period: {},
      statistics: { monthToDate: { totalCalls: 0, apiCalls: 0 }, yearToDate: {} },
      dailySeries: [],
      quotas: [],
      billing: { estimatedTotalInr: 8250 },
      rateLimitTier: 'standard'
    })
  };
});

const PartnerApplication = require('../models/PartnerApplication');
const MSME = require('../models/MSME');
const CarbonAssessment = require('../models/CarbonAssessment');

describe('Partner public API', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    app = require('../server');

    PartnerApplication.findOne.mockImplementation(async (query) => {
      if (query.apiKeyPrefix === mockPartner.apiKeyPrefix) {
        return { ...mockPartner };
      }
      return null;
    });

    MSME.find.mockReturnValue({
      select: () => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: jest.fn().mockResolvedValue([
                {
                  _id: '507f1f77bcf86cd799439011',
                  companyName: 'Acme Fabrics',
                  industry: 'textiles',
                  status: 'verified',
                  businessDomain: 'manufacturing'
                }
              ])
            })
          })
        })
      })
    });
    MSME.countDocuments.mockResolvedValue(1);
    CarbonAssessment.find.mockReturnValue({
      sort: () => ({
        lean: jest.fn().mockResolvedValue([])
      })
    });
  });

  test('GET /api/v1/public/integration-catalog is public', async () => {
    const response = await request(app).get('/api/v1/public/integration-catalog');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.authentication.type).toBe('api_key');
    expect(Array.isArray(response.body.data.endpoints)).toBe(true);
    expect(response.body.data.partnershipPricing?.models?.length).toBeGreaterThan(0);
    expect(response.body.data.portalPath).toBe('/partners');
  });

  test('GET /api/v1/public/openapi.json returns OpenAPI document', async () => {
    const response = await request(app).get('/api/v1/public/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.3');
    expect(response.body.paths['/v1/partners/me']).toBeDefined();
  });

  test('GET /api/v1/partners/me requires API key', async () => {
    const response = await request(app).get('/api/v1/partners/me');
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test('GET /api/v1/partners/me returns partner profile with valid key', async () => {
    const response = await request(app)
      .get('/api/v1/partners/me')
      .set('X-API-Key', TEST_API_KEY);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.name).toBe('Test Bank Partner');
    expect(response.body.data.apiKeyMasked).toContain('••••');
  });

  test('GET /api/v1/partners/msmes lists summaries with msme:read scope', async () => {
    const response = await request(app)
      .get('/api/v1/partners/msmes')
      .set('Authorization', `Bearer ${TEST_API_KEY}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].companyName).toBe('Acme Fabrics');
  });

  test('GET /api/v1/partners/usage returns metering summary', async () => {
    const response = await request(app)
      .get('/api/v1/partners/usage')
      .set('X-API-Key', TEST_API_KEY);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.billing.estimatedTotalInr).toBe(8250);
  });
});
