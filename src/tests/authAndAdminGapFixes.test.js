const request = require('supertest');

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

jest.mock('../middleware/auth', () => {
  const middleware = (req, res, next) => {
    const role = req.headers['x-test-role'] || 'admin';
    const msmeId = req.headers['x-test-msme-id'];
    req.user = {
      role,
      msmeId,
      userId: 'admin-user',
      email: 'admin@example.com'
    };
    next();
  };
  const allow = (req, res, next) => next();
  middleware.requireRole = (...allowedRoles) => (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    return next();
  };
  middleware.requireMSMEProfile = allow;
  middleware.requireOrganizationProfile = allow;
  middleware.requireOperationalProfile = allow;
  middleware.requireEnterpriseProfile = allow;
  return middleware;
});

jest.mock('../utils/jwt', () => ({
  getJwtSecret: jest.fn(() => process.env.JWT_SECRET || 'test-jwt-secret-for-ci'),
  signJwt: jest.fn(() => 'signed-token'),
  verifyJwt: jest.fn()
}));

const { verifyJwt: mockVerifyJwt } = require('../utils/jwt');

const mockFindUserById = jest.fn();
const mockFindUserOne = jest.fn();
jest.mock('../models/User', () => ({
  findById: (...args) => mockFindUserById(...args),
  findOne: (...args) => mockFindUserOne(...args)
}));

const mockFindMsmeOne = jest.fn();
jest.mock('../models/MSME', () => ({
  findOne: (...args) => mockFindMsmeOne(...args)
}));

const mockTransactionFind = jest.fn();
const mockTransactionCountDocuments = jest.fn();
const mockTransactionFindOne = jest.fn();
jest.mock('../models/Transaction', () => ({
  find: (...args) => mockTransactionFind(...args),
  countDocuments: (...args) => mockTransactionCountDocuments(...args),
  findOne: (...args) => mockTransactionFindOne(...args)
}));

jest.mock('../models/BillingModuleConfig', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  findById: jest.fn()
}));

const mockGetSpamStatistics = jest.fn();
jest.mock('../services/spamDetectionService', () => ({
  getSpamStatistics: (...args) => mockGetSpamStatistics(...args)
}));

const mockGetDuplicateStatistics = jest.fn();
jest.mock('../services/duplicateDetectionService', () => ({
  getDuplicateStatistics: (...args) => mockGetDuplicateStatistics(...args)
}));

const restoreEnv = () => {
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.FRONTEND_URL;
};

const createFindQuery = () => {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    populate: jest.fn().mockResolvedValue([])
  };
  return chain;
};

describe('Auth and admin gap fixes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    restoreEnv();
    mockVerifyJwt.mockReset();
    mockFindUserById.mockReset();
    mockFindUserOne.mockReset();
    mockFindMsmeOne.mockReset();
    mockTransactionFind.mockReset();
    mockTransactionCountDocuments.mockReset();
    mockTransactionFindOne.mockReset();
    mockGetSpamStatistics.mockReset();
    mockGetDuplicateStatistics.mockReset();
  });

  afterEach(() => {
    restoreEnv();
  });

  test('returns 401 on invalid token for /api/auth/me', async () => {
    mockVerifyJwt.mockImplementation(() => {
      const err = new Error('invalid');
      err.name = 'JsonWebTokenError';
      throw err;
    });

    const app = require('../server');
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer bad-token');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Token is not valid');
  });

  test('returns 401 on expired token for /api/auth/refresh', async () => {
    mockVerifyJwt.mockImplementation(() => {
      const err = new Error('expired');
      err.name = 'TokenExpiredError';
      throw err;
    });

    const app = require('../server');
    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', 'Bearer expired-token');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Token is not valid');
  });

  test('uses FRONTEND_URL when CORS_ALLOWED_ORIGINS is missing', async () => {
    jest.resetModules();
    process.env.FRONTEND_URL = 'https://frontend.example.com';
    const app = require('../server');
    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://frontend.example.com');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://frontend.example.com');
  });

  test('uses CORS_ALLOWED_ORIGINS list when configured', async () => {
    jest.resetModules();
    process.env.CORS_ALLOWED_ORIGINS = 'https://a.example.com, https://b.example.com';
    const app = require('../server');
    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://b.example.com');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://b.example.com');
  });

  test('admin spam-transactions query is not scoped to msmeId when admin has no msme', async () => {
    const findChain = createFindQuery();
    mockTransactionFind.mockReturnValue(findChain);
    mockTransactionCountDocuments.mockResolvedValue(0);

    const app = require('../server');
    const response = await request(app)
      .get('/api/admin/spam-transactions')
      .set('x-test-role', 'admin');

    expect(response.status).toBe(200);
    expect(mockTransactionFind).toHaveBeenCalledWith(expect.objectContaining({ isSpam: true }));
    const calledQuery = mockTransactionFind.mock.calls[0][0];
    expect(calledQuery.msmeId).toBeUndefined();
  });

  test('admin spam statistics passes undefined msmeId for global scope', async () => {
    mockGetSpamStatistics.mockResolvedValue({ totalSpamTransactions: 0 });

    const app = require('../server');
    const response = await request(app)
      .get('/api/admin/spam-statistics')
      .set('x-test-role', 'admin');

    expect(response.status).toBe(200);
    expect(mockGetSpamStatistics).toHaveBeenCalledWith(undefined, undefined, undefined);
  });
});
