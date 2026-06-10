const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const mockPartnerId = new mongoose.Types.ObjectId();
const mockUserId = new mongoose.Types.ObjectId();

const mockPartnerDoc = {
  _id: mockPartnerId,
  name: 'Portal Partner',
  organizationType: 'integration_partner',
  scopes: ['msme:read'],
  apiKeyPrefix: 'ci_live_portal1',
  isActive: true,
  billingPlanId: 'api_starter',
  contractAnnualFeeInr: 99000,
  usageLimits: {
    apiCallsPerMonth: 100000,
    webhookEventsPerMonth: 10000,
    reportPullsPerMonth: 2000,
    msmeMonitoredPerYear: 500
  },
  overageRates: {
    perApiCallInr: 0.15,
    perWebhookInr: 0.5,
    perReportPullInr: 5,
    perMsmeMonthInr: 25
  }
};

jest.mock('../models/User', () => ({
  findOne: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({})
}));

jest.mock('../models/PartnerApplication', () => ({
  findOne: jest.fn()
}));

jest.mock('../services/partnerUsageService', () => ({
  getPartnerDashboard: jest.fn().mockResolvedValue({
    partner: { id: mockPartnerId, name: 'Portal Partner' },
    statistics: { monthToDate: { totalCalls: 42 } },
    usageChart: [],
    billing: { estimatedTotalInr: 8250 }
  })
}));

jest.mock('../middleware/partnerAccountAuth', () => (req, res, next) => {
  req.user = {
    userId: mockUserId,
    email: 'partner@bank.example',
    role: 'partner'
  };
  req.partner = mockPartnerDoc;
  next();
});

const User = require('../models/User');
const PartnerApplication = require('../models/PartnerApplication');
const partnerAccountRoutes = require('../routes/partnerAccount');

const app = express();
app.use(express.json());
app.use('/api/partner-account', partnerAccountRoutes);

describe('Partner account portal routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /login rejects non-partner role', async () => {
    User.findOne.mockResolvedValue({
      _id: mockUserId,
      email: 'user@example.com',
      role: 'msme',
      isActive: true,
      comparePassword: jest.fn().mockResolvedValue(true)
    });

    const response = await request(app)
      .post('/api/partner-account/login')
      .send({ email: 'user@example.com', password: 'secret12' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/invalid partner/i);
  });

  test('POST /login succeeds for partner user', async () => {
    User.findOne.mockResolvedValue({
      _id: mockUserId,
      email: 'partner@bank.example',
      role: 'partner',
      isActive: true,
      profile: { firstName: 'Pat' },
      comparePassword: jest.fn().mockResolvedValue(true)
    });
    PartnerApplication.findOne.mockResolvedValue(mockPartnerDoc);

    const response = await request(app)
      .post('/api/partner-account/login')
      .send({ email: 'partner@bank.example', password: 'secret12' });

    expect(response.status).toBe(200);
    expect(response.body.data.token).toBeDefined();
    expect(response.body.data.partner.name).toBe('Portal Partner');
  });

  test('GET /dashboard returns usage and billing', async () => {
    const response = await request(app).get('/api/partner-account/dashboard');

    expect(response.status).toBe(200);
    expect(response.body.data.statistics.monthToDate.totalCalls).toBe(42);
    expect(response.body.data.billing.estimatedTotalInr).toBe(8250);
  });
});
