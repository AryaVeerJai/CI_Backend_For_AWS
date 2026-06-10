const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../middleware/auth', () => {
  const middleware = (req, res, next) => {
    req.user = {
      role: req.headers['x-test-role'] || 'admin',
      userId: 'admin-user-id',
      email: 'admin@example.com'
    };
    next();
  };
  middleware.requireRole = (...allowedRoles) => (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    return next();
  };
  middleware.requireMSMEProfile = (req, res, next) => next();
  middleware.requireOrganizationProfile = (req, res, next) => next();
  middleware.requireOperationalProfile = (req, res, next) => next();
  middleware.requireEnterpriseProfile = (req, res, next) => next();
  return middleware;
});

describe('GET /api/admin/msme/:id', () => {
  let mongod;
  let msmeId;
  let adminUserId;
  let app;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    const adminMsmeRoutes = require('../routes/adminMSME');
    app = express();
    app.use(express.json());
    app.use('/api/admin/msme', adminMsmeRoutes);

    const User = require('../models/User');
    const MSME = require('../models/MSME');

    const msmeUser = await User.create({
      email: 'msme-detail@test.com',
      password: 'secret12',
      role: 'msme',
      profile: { firstName: 'Detail', lastName: 'User' }
    });

    adminUserId = (await User.create({
      email: 'admin-detail@test.com',
      password: 'secret12',
      role: 'admin',
      profile: { firstName: 'Admin', lastName: 'User' }
    }))._id;

    const msme = await MSME.create({
      userId: msmeUser._id,
      companyName: 'Detail Test MSME',
      companyType: 'small',
      industry: 'Manufacturing',
      businessDomain: 'manufacturing',
      establishmentYear: 2018,
      udyamRegistrationNumber: 'UDYAM-GJ-01-1234567',
      gstNumber: '27AAPCS1751H1ZO',
      panNumber: 'AAPCS1751H',
      contact: {
        email: 'msme-detail@test.com',
        phone: '9876543210'
      },
      business: {
        annualTurnover: 5,
        numberOfEmployees: 25,
        manufacturingUnits: 1,
        primaryProducts: 'Components'
      },
      status: 'pending',
      adminNotes: [{
        note: 'Initial review note',
        addedBy: adminUserId,
        addedAt: new Date()
      }]
    });

    msmeId = msme._id.toString();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  test('returns MSME detail and viewData without StrictPopulateError', async () => {
    const response = await request(app)
      .get(`/api/admin/msme/${msmeId}`)
      .set('x-test-role', 'admin');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.msme.companyName).toBe('Detail Test MSME');
    expect(response.body.data.msme.adminNotes).toHaveLength(1);
    expect(response.body.data.msme.adminNotes[0].addedBy.email).toBe('admin-detail@test.com');
    expect(Array.isArray(response.body.data.viewData.billsUploaded)).toBe(true);
    expect(Array.isArray(response.body.data.viewData.transactionsStored)).toBe(true);
    expect(Array.isArray(response.body.data.viewData.reporting.endpoints)).toBe(true);
    expect(response.body.data.viewData.paymentSummary).toBeTruthy();
  });

  test('view role receives detail without payment summary', async () => {
    const response = await request(app)
      .get(`/api/admin/msme/${msmeId}`)
      .set('x-test-role', 'view');

    expect(response.status).toBe(200);
    expect(response.body.data.viewData.paymentSummary).toBeNull();
  });
});
