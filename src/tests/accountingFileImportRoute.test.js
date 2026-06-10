const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

jest.mock('../models/Transaction', () => {
  const mockSave = jest.fn().mockResolvedValue(undefined);
  const MockTransaction = jest.fn().mockImplementation(function MockTransaction(data) {
    Object.assign(this, data);
    this._id = `mock-transaction-${Math.random().toString(36).slice(2, 8)}`;
    this.toObject = () => ({ ...this, _id: this._id });
    this.save = mockSave;
    return this;
  });
  MockTransaction.find = jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([])
      }),
      lean: jest.fn().mockResolvedValue([])
    })
  });
  MockTransaction.findOne = jest.fn().mockResolvedValue(null);
  MockTransaction.countDocuments = jest.fn().mockResolvedValue(0);
  return MockTransaction;
});

jest.mock('../models/MSME', () => ({
  findById: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      industry: 'manufacturing',
      businessDomain: 'textiles'
    })
  })
}));

jest.mock('../models/MsmeConnectorConnection', () => ({
  find: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue([]) }),
  findOne: jest.fn().mockResolvedValue(null),
  findOneAndUpdate: jest.fn().mockResolvedValue(null),
  updateOne: jest.fn().mockResolvedValue({})
}));

jest.mock('../services/duplicateDetectionService', () => ({
  detectDuplicate: jest.fn().mockResolvedValue({ isDuplicate: false })
}));

jest.mock('../services/agents/dataProcessorAgent', () => ({
  processTransactions: jest.fn().mockResolvedValue({ classified: [], documentRequests: [] })
}));

jest.mock('../services/carbonCalculationService', () => ({
  calculateTransactionCarbonFootprint: jest.fn(() => ({ co2Emissions: 1.2, category: 'utilities' })),
  calculateTransactionCarbonFootprintForAgent: jest.fn(async () => ({
    co2Emissions: 2.4,
    category: 'utilities',
    calculationMethod: 'agent'
  }))
}));

jest.mock('../services/orchestrationManagerEventService', () => ({
  emitEvent: jest.fn()
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

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

const uploadErrorHandler = require('../middleware/uploadErrorHandler');
const transactionRoutes = require('../routes/transactions');
const accountingRoutes = require('../routes/accounting');

const SAMPLE_DIR = path.join(__dirname, '../../../ai-model/data/DataConnectors/Import');

const buildTransactionsApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/transactions', transactionRoutes);
  app.use(uploadErrorHandler);
  return app;
};

const buildAccountingApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/accounting', accountingRoutes);
  app.use(uploadErrorHandler);
  return app;
};

describe('accounting file import routes', () => {
  test('POST /api/transactions/import-accounting-file imports TallyPrime XML sample', async () => {
    const app = buildTransactionsApp();
    const filePath = path.join(SAMPLE_DIR, 'TallyPrime/TallyPrime_Realistic_MSME_Export.xml');
    const response = await request(app)
      .post('/api/transactions/import-accounting-file')
      .field('provider', 'tally')
      .attach('file', filePath);

    expect(response.body.message).not.toBe('Route not found');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data?.detection?.accepted).toBe(true);
  });

  test('POST /api/accounting/import-accounting-file is registered (legacy alias)', async () => {
    const app = buildAccountingApp();
    const filePath = path.join(SAMPLE_DIR, 'TallyPrime/TallyPrime_Realistic_MSME_Export.xml');
    const response = await request(app)
      .post('/api/accounting/import-accounting-file')
      .field('provider', 'tally')
      .attach('file', filePath);

    expect(response.body.message).not.toBe('Route not found');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('POST /api/transactions/import-accounting-file imports Busy XLSX sample', async () => {
    const app = buildTransactionsApp();
    const filePath = path.join(
      SAMPLE_DIR,
      'ProviderSpecific/Busy_Accounting_ProviderSpecific.xlsx'
    );
    const response = await request(app)
      .post('/api/transactions/import-accounting-file')
      .field('provider', 'busy')
      .field('runAgents', 'false')
      .field('runOrchestration', 'false')
      .attach('file', filePath);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data?.totals?.imported).toBeGreaterThan(0);
  });

  test('unsupported file type returns 400 not 500', async () => {
    const app = buildTransactionsApp();
    const response = await request(app)
      .post('/api/transactions/import-accounting-file')
      .field('provider', 'tally')
      .attach('file', Buffer.from('not an export'), 'notes.txt');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/unsupported/i);
  });
});
