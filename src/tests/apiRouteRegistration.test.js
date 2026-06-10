const fs = require('fs');
const path = require('path');
const request = require('supertest');

jest.mock('../config/database', () => jest.fn());
jest.mock('../services/aiAgentService', () => ({
  initialize: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../services/orchestrationManagerEventService', () => ({
  registerExternalListeners: jest.fn(),
  emitEvent: jest.fn()
}));
jest.mock('../services/realTimeMonitoringInstance', () => ({}));
jest.mock('../services/enhancedMonitoringService', () => ({}));
jest.mock('../services/dataFlowOptimizationService', () => ({}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../models/UserIncentiveProfile', () => ({
  findOne: jest.fn().mockResolvedValue({
    rewards: [],
    dailyTasks: [],
    totalPoints: 0,
    level: 1,
    nextLevelPoints: 1000,
    currentLevelPoints: 0,
    streak: 0,
    carbonSaved: 0,
    recentActivities: [],
    save: jest.fn().mockResolvedValue(undefined)
  }),
  create: jest.fn()
}));

jest.mock('../models/MSME', () => ({
  findOne: jest.fn().mockResolvedValue(null),
  find: jest.fn().mockResolvedValue([])
}));

jest.mock('../models/CarbonAssessment', () => ({
  findOne: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null)
    })
  }),
  find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }),
  countDocuments: jest.fn().mockResolvedValue(0),
  aggregate: jest.fn().mockResolvedValue([])
}));

jest.mock('../models/Transaction', () => {
  const mockSave = jest.fn().mockResolvedValue(undefined);
  const MockTransaction = jest.fn().mockImplementation(function MockTransaction(data) {
    Object.assign(this, data);
    this._id = 'mock-transaction-id';
    this.toObject = () => ({ ...this, _id: this._id });
    this.save = mockSave;
    return this;
  });
  MockTransaction.find = jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    }),
  });
  MockTransaction.findOne = jest.fn().mockResolvedValue(null);
  MockTransaction.countDocuments = jest.fn().mockResolvedValue(0);
  return MockTransaction;
});

jest.mock('../middleware/auth', () => {
  const middleware = (req, res, next) => {
    req.user = {
      userId: 'test-user',
      msmeId: '507f1f77bcf86cd799439011',
      organizationId: '507f1f77bcf86cd799439012',
      role: 'msme'
    };
    next();
  };
  middleware.requireRole = () => (req, res, next) => next();
  middleware.requireMSMEProfile = () => (req, res, next) => next();
  middleware.requireOrganizationProfile = (req, res, next) => next();
  middleware.requireOperationalProfile = (req, res, next) => next();
  return middleware;
});

const extractApiRouteMounts = (serverFilePath) => {
  const source = fs.readFileSync(serverFilePath, 'utf8');
  return [...source.matchAll(/app\.use\('(\/api[^']*)'/g)].map((match) => match[1]);
};

const loadApp = (modulePath) => {
  jest.resetModules();
  process.env.NODE_ENV = 'test';
  return require(modulePath);
};

describe('API route registration', () => {
  let app;

  beforeEach(() => {
    app = loadApp('../server');
  });

  test('test-server.js mounts the same /api routes as server.js', () => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    const testServerPath = path.join(__dirname, '..', 'test-server.js');

    expect(extractApiRouteMounts(testServerPath)).toEqual(extractApiRouteMounts(serverPath));
  });

  test('GET /api/incentives is registered (not global 404)', async () => {
    const response = await request(app).get('/api/incentives');
    expect(response.status).not.toBe(404);
    expect(response.body.message).not.toBe('Route not found');
  });

  test('GET /api/incentives/finance-overview is registered (not global 404)', async () => {
    const response = await request(app).get('/api/incentives/finance-overview');
    expect(response.body.message).not.toBe('Route not found');
  });

  test('GET /api/finance/overview legacy alias is registered (not global 404)', async () => {
    const response = await request(app).get('/api/finance/overview');
    expect(response.body.message).not.toBe('Route not found');
  });

  test('GET /api/reporting is registered (not global 404)', async () => {
    const response = await request(app).get('/api/reporting');
    expect(response.status).not.toBe(404);
    expect(response.body.message).not.toBe('Route not found');
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data?.reports)).toBe(true);
  });

  test('GET /api/reports legacy alias is registered (not global 404)', async () => {
    const response = await request(app).get('/api/reports');
    expect(response.status).not.toBe(404);
    expect(response.body.message).not.toBe('Route not found');
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data?.reports)).toBe(true);
  });

  test('GET /api/carbon/assessments/document-bulk is registered before :id route', async () => {
    const response = await request(app).get('/api/carbon/assessments/document-bulk');
    expect(response.body.message).not.toBe('Route not found');
    expect(response.body.message).toBe('No document bulk assessment found');
  });

  test('GET /api/transactions/accounting/connectors is registered (not global 404)', async () => {
    const response = await request(app).get('/api/transactions/accounting/connectors');
    expect(response.status).not.toBe(404);
    expect(response.body.message).not.toBe('Route not found');
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data?.connectors)).toBe(true);
  });

  test('GET /api/accounting/connectors legacy alias is registered (not global 404)', async () => {
    const response = await request(app).get('/api/accounting/connectors');
    expect(response.status).not.toBe(404);
    expect(response.body.message).not.toBe('Route not found');
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data?.connectors)).toBe(true);
  });

  test('GET /api/transactions/accounting/connections is registered (MSME self-serve)', async () => {
    const response = await request(app).get('/api/transactions/accounting/connections');
    expect(response.status).not.toBe(404);
    expect(response.body.message).not.toBe('Route not found');
  });

  test('POST /api/transactions/import-accounting is registered before transactions :id route', async () => {
    const response = await request(app)
      .post('/api/transactions/import-accounting')
      .send({ provider: 'tally', transactions: [] });
    expect(response.body.message).not.toBe('Route not found');
  });

  test('POST /api/accounting/import-accounting-file is registered (legacy alias)', async () => {
    const response = await request(app)
      .post('/api/accounting/import-accounting-file');
    expect(response.body.message).not.toBe('Route not found');
    expect(response.status).not.toBe(404);
  });

  test('POST /api/transactions creates a manual transaction (not global 404)', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .send({ amount: 1000, category: 'energy', description: 'Manual entry' });
    expect(response.status).toBe(201);
    expect(response.body.message).not.toBe('Route not found');
    expect(response.body.success).toBe(true);
    expect(response.body.data?._id).toBe('mock-transaction-id');
  });

  test('GET /api/adeetie/overview is registered (not global 404)', async () => {
    const response = await request(app).get('/api/adeetie/overview');
    expect(response.body.message).not.toBe('Route not found');
  });

  test('GET /api/compliance-hub/overview is registered (not global 404)', async () => {
    const response = await request(app).get('/api/compliance-hub/overview');
    expect(response.body.message).not.toBe('Route not found');
  });

  test('GET /api/compliance-hub/india is registered (not global 404)', async () => {
    const response = await request(app).get('/api/compliance-hub/india');
    expect(response.body.message).not.toBe('Route not found');
  });

  test('GET /api/compliance-hub/export is registered (not global 404)', async () => {
    const response = await request(app).get('/api/compliance-hub/export');
    expect(response.body.message).not.toBe('Route not found');
  });

  test('GET /api/compliance/overview legacy alias is registered (not global 404)', async () => {
    const response = await request(app).get('/api/compliance/overview');
    expect(response.body.message).not.toBe('Route not found');
  });

  test('GET /api/compliance/india legacy alias is registered (not global 404)', async () => {
    const response = await request(app).get('/api/compliance/india');
    expect(response.body.message).not.toBe('Route not found');
  });

  test('GET /api/compliance/export legacy alias is registered (not global 404)', async () => {
    const response = await request(app).get('/api/compliance/export');
    expect(response.body.message).not.toBe('Route not found');
  });

  test('GET /api/carbon-forecasting/forecast is registered (not global 404)', async () => {
    const response = await request(app).get('/api/carbon-forecasting/forecast');
    expect(response.body.message).not.toBe('Route not found');
  });

  test('GET /api/v1/public/integration-catalog is registered', async () => {
    const response = await request(app).get('/api/v1/public/integration-catalog');
    expect(response.status).not.toBe(404);
    expect(response.body.success).toBe(true);
    expect(response.body.data?.authentication?.type).toBe('api_key');
  });

  test('GET /api/partner-portal/catalog is registered (not global 404)', async () => {
    const response = await request(app).get('/api/partner-portal/catalog');
    expect(response.body.message).not.toBe('Route not found');
  });
});

describe('test-server route registration parity', () => {
  let app;

  beforeEach(() => {
    app = loadApp('../test-server');
  });

  test.each([
    ['GET', '/api/incentives'],
    ['GET', '/api/incentives/finance-overview'],
    ['GET', '/api/finance/overview'],
    ['GET', '/api/reporting'],
    ['GET', '/api/transactions/accounting/connectors'],
    ['GET', '/api/adeetie/overview'],
    ['GET', '/api/compliance-hub/overview'],
    ['GET', '/api/compliance-hub/india'],
    ['GET', '/api/compliance-hub/export'],
    ['GET', '/api/compliance/overview'],
    ['GET', '/api/compliance/india'],
    ['GET', '/api/compliance/export'],
    ['GET', '/api/v1/public/integration-catalog'],
    ['GET', '/api/partner-portal/catalog']
  ])('%s %s is registered on test-server (not global 404)', async (method, routePath) => {
    const response = await request(app)[method.toLowerCase()](routePath);
    expect(response.body.message).not.toBe('Route not found');
  });

  test('POST /api/transactions is registered on test-server (not global 404)', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .send({ amount: 500, category: 'travel', description: 'Test entry' });
    expect(response.status).toBe(201);
    expect(response.body.message).not.toBe('Route not found');
    expect(response.body.success).toBe(true);
  });
});
