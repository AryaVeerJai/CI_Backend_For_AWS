jest.mock('../utils/sendEmail', () => jest.fn().mockResolvedValue({ success: true }));

const { RegistrationOtpService } = require('../services/registrationOtpService');
const mockedSendEmail = require('../utils/sendEmail');

describe('RegistrationOtpService', () => {
  let originalEnv;
  let sessions;
  let service;
  let mockSmsClient;

  const clone = value => JSON.parse(JSON.stringify(value));

  const createSessionModel = () => ({
    async deleteMany(query) {
      sessions = sessions.filter(item => !(
        item.email === query.email &&
        item.phone === query.phone &&
        item.consumedAt === query.consumedAt
      ));
    },
    async create(payload) {
      const session = {
        ...clone(payload),
        emailVerified: false,
        mobileVerified: false,
        verifiedAt: null,
        consumedAt: null,
        save: jest.fn(async function save() {
          return this;
        })
      };
      sessions.push(session);
      return session;
    },
    async findOne(query) {
      const match = sessions.find(item => (
        (typeof query.sessionId === 'undefined' || item.sessionId === query.sessionId) &&
        (typeof query.consumedAt === 'undefined' || item.consumedAt === query.consumedAt) &&
        (typeof query.email === 'undefined' || item.email === query.email) &&
        (typeof query.phone === 'undefined' || item.phone === query.phone)
      ));

      if (!match) {
        return null;
      }

      return {
        ...match,
        save: jest.fn(async function save() {
          const index = sessions.findIndex(item => item.sessionId === this.sessionId);
          sessions[index] = {
            ...sessions[index],
            ...clone(this)
          };
          return this;
        })
      };
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    sessions = [];
    mockSmsClient = {
      sendMessage: jest.fn().mockResolvedValue({ success: true })
    };
    service = new RegistrationOtpService({
      otpSessionModel: createSessionModel(),
      smsClient: mockSmsClient,
      emailClient: mockedSendEmail,
      loggerInstance: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = originalEnv;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  test('returns otpRequired false when feature is disabled', async () => {
    process.env.REGISTRATION_OTP_ENABLED = 'false';

    const result = await service.requestOtp({
      email: 'test@example.com',
      phone: '9876543210'
    });

    expect(result).toEqual(expect.objectContaining({
      otpRequired: false
    }));
    expect(mockSmsClient.sendMessage).not.toHaveBeenCalled();
  });

  test('creates session and dispatches SMS using Airtel DLT header/template', async () => {
    process.env.REGISTRATION_OTP_ENABLED = 'true';
    process.env.AIRTEL_DLT_SMS_HEADER = 'AIRTELH';
    process.env.AIRTEL_DLT_OTP_TEMPLATE_ID = '120716000000000001';
    process.env.AIRTEL_DLT_OTP_MESSAGE = 'OTP {{OTP}} for registration.';

    const result = await service.requestOtp({
      email: 'test@example.com',
      phone: '+91-98765-43210'
    });

    expect(result.otpRequired).toBe(true);
    expect(result.sessionId).toBeTruthy();
    expect(mockSmsClient.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      senderId: 'AIRTELH',
      templateId: '120716000000000001',
      to: '9876543210'
    }));
    expect(mockedSendEmail).toHaveBeenCalled();
  });

  test('verifyOtp marks session verified only after both OTP values are correct', async () => {
    process.env.REGISTRATION_OTP_ENABLED = 'true';

    const requestResult = await service.requestOtp({
      email: 'test@example.com',
      phone: '9876543210'
    });
    const session = sessions.find(item => item.sessionId === requestResult.sessionId);

    // Override hash to deterministic known OTPs for test verification
    session.emailOtpHash = service.hashOtp('111111');
    session.mobileOtpHash = service.hashOtp('222222');

    const partial = await service.verifyOtp({
      sessionId: requestResult.sessionId,
      emailOtp: '111111',
      mobileOtp: '999999'
    });
    expect(partial.verified).toBe(false);
    expect(partial.emailVerified).toBe(true);
    expect(partial.mobileVerified).toBe(false);

    const complete = await service.verifyOtp({
      sessionId: requestResult.sessionId,
      emailOtp: '111111',
      mobileOtp: '222222'
    });
    expect(complete.verified).toBe(true);
    expect(complete.emailVerified).toBe(true);
    expect(complete.mobileVerified).toBe(true);
  });

  test('consumeVerifiedSessionForRegistration enforces prior verification', async () => {
    process.env.REGISTRATION_OTP_ENABLED = 'true';

    const requestResult = await service.requestOtp({
      email: 'test@example.com',
      phone: '9876543210'
    });

    await expect(service.consumeVerifiedSessionForRegistration({
      sessionId: requestResult.sessionId,
      email: 'test@example.com',
      phone: '9876543210'
    })).rejects.toThrow('Email and mobile OTP verification is required');
  });

  test('enforces resend cooldown for active session', async () => {
    process.env.REGISTRATION_OTP_ENABLED = 'true';
    process.env.REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS = '120';

    await service.requestOtp({
      email: 'cooldown@example.com',
      phone: '9876543210'
    });

    await expect(service.requestOtp({
      email: 'cooldown@example.com',
      phone: '9876543210'
    })).rejects.toThrow('Please wait');
  });

  test('locks session after max verification attempts', async () => {
    process.env.REGISTRATION_OTP_ENABLED = 'true';
    process.env.REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS = '2';
    process.env.REGISTRATION_OTP_LOCK_DURATION_SECONDS = '120';

    const requestResult = await service.requestOtp({
      email: 'lock@example.com',
      phone: '9876543210'
    });
    const session = sessions.find(item => item.sessionId === requestResult.sessionId);
    session.emailOtpHash = service.hashOtp('111111');
    session.mobileOtpHash = service.hashOtp('222222');

    await service.verifyOtp({
      sessionId: requestResult.sessionId,
      emailOtp: '111111',
      mobileOtp: '000000'
    });

    await expect(service.verifyOtp({
      sessionId: requestResult.sessionId,
      emailOtp: '111111',
      mobileOtp: '000000'
    })).rejects.toThrow('OTP verification attempts exceeded. Please request a new OTP.');

    await expect(service.verifyOtp({
      sessionId: requestResult.sessionId,
      emailOtp: '111111',
      mobileOtp: '222222'
    })).rejects.toThrow('OTP session is temporarily locked. Please retry later.');
  });

  test('locks session when resend attempts exceed max limit', async () => {
    process.env.REGISTRATION_OTP_ENABLED = 'true';
    process.env.REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS = '0';
    process.env.REGISTRATION_OTP_MAX_RESEND_ATTEMPTS = '1';
    process.env.REGISTRATION_OTP_LOCK_DURATION_SECONDS = '300';

    const first = await service.requestOtp({
      email: 'resend-lock@example.com',
      phone: '9876543210'
    });
    expect(first.otpRequired).toBe(true);

    const second = await service.requestOtp({
      email: 'resend-lock@example.com',
      phone: '9876543210'
    });
    expect(second.otpRequired).toBe(true);

    await expect(service.requestOtp({
      email: 'resend-lock@example.com',
      phone: '9876543210'
    })).rejects.toThrow('Maximum OTP resend attempts exceeded. Please try again later.');

    await expect(service.requestOtp({
      email: 'resend-lock@example.com',
      phone: '9876543210'
    })).rejects.toThrow('OTP session is temporarily locked. Please retry later.');
  });
});
