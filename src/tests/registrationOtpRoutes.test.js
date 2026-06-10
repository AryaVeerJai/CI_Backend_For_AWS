const express = require('express');
const request = require('supertest');

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const mockFindUserOne = jest.fn();
const mockUserSave = jest.fn();
jest.mock('../models/User', () => {
  function MockUser(data) {
    Object.assign(this, data);
    this._id = 'user-test-id';
    this.save = mockUserSave.mockResolvedValue(this);
    this.comparePassword = jest.fn();
  }
  MockUser.findOne = (...args) => mockFindUserOne(...args);
  return MockUser;
});

jest.mock('../models/MSME', () => ({
  findOne: jest.fn().mockResolvedValue(null)
}));

jest.mock('../models/Enterprise', () => ({
  findOne: jest.fn().mockResolvedValue(null)
}));

jest.mock('../utils/jwt', () => ({
  signJwt: jest.fn(() => 'signed-token'),
  verifyJwt: jest.fn()
}));

const registrationOtpService = require('../services/registrationOtpService');
const authRoutes = require('../routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('registration OTP routes when disabled for testing', () => {
  let originalOtpEnabled;

  beforeEach(() => {
    originalOtpEnabled = process.env.REGISTRATION_OTP_ENABLED;
    process.env.REGISTRATION_OTP_ENABLED = 'false';
    mockFindUserOne.mockResolvedValue(null);
    mockUserSave.mockClear();
    jest.spyOn(registrationOtpService, 'requestOtp');
    jest.spyOn(registrationOtpService, 'verifyOtp');
    jest.spyOn(registrationOtpService, 'consumeVerifiedSessionForRegistration');
  });

  afterEach(() => {
    process.env.REGISTRATION_OTP_ENABLED = originalOtpEnabled;
    jest.restoreAllMocks();
  });

  test('request-otp returns otpRequired false without dispatching OTP', async () => {
    const response = await request(app)
      .post('/api/auth/register/request-otp')
      .send({ email: 'test@example.com', phone: '9876543210' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.otpRequired).toBe(false);
    expect(registrationOtpService.requestOtp).toHaveBeenCalled();
  });

  test('verify-otp succeeds without OTP values', async () => {
    const response = await request(app)
      .post('/api/auth/register/verify-otp')
      .send({ sessionId: 'unused-session' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.verified).toBe(true);
    expect(registrationOtpService.verifyOtp).not.toHaveBeenCalled();
  });

  test('register creates account without otpSessionId', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'newuser@example.com',
        password: 'secret12',
        role: 'msme',
        profile: {
          firstName: 'Test',
          lastName: 'User',
          phone: '9876543210'
        }
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.token).toBe('signed-token');
    expect(registrationOtpService.consumeVerifiedSessionForRegistration).not.toHaveBeenCalled();
    expect(mockUserSave).toHaveBeenCalled();
  });
});
