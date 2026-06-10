const { MSMENotificationService, NOTIFICATION_TYPES } = require('../services/msmeNotificationService');

describe('MSMENotificationService', () => {
  let originalNotificationsEnv;
  let mockClient;
  let mockModel;
  let service;
  let msmeRecord;

  beforeAll(() => {
    originalNotificationsEnv = process.env.MSG91_NOTIFICATIONS_ENABLED;
  });

  beforeEach(() => {
    process.env.MSG91_NOTIFICATIONS_ENABLED = 'true';

    msmeRecord = {
      _id: '507f1f77bcf86cd799439011',
      companyName: 'Green Works Ltd',
      carbonScore: 72,
      contact: { phone: '9876543210' }
    };

    mockClient = {
      sendMessage: jest.fn().mockResolvedValue({ success: true })
    };

    mockModel = {
      findById: jest.fn(() => ({
        select: jest.fn().mockResolvedValue(msmeRecord)
      }))
    };

    service = new MSMENotificationService({
      msg91Client: mockClient,
      msmeModel: mockModel
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.MSG91_NOTIFICATIONS_ENABLED = originalNotificationsEnv;
  });

  test('returns supported notification types', () => {
    const types = service.getSupportedTypes();

    expect(types).toEqual(expect.arrayContaining(Object.values(NOTIFICATION_TYPES)));
  });

  test('sendProgressUpdate sends formatted message via MSG91 when enabled', async () => {
    const result = await service.sendProgressUpdate('507f1f77bcf86cd799439011', {
      milestone: 'Carbon audit',
      status: 'completed',
      eta: '2025-11-30',
      nextSteps: ['Submit report', 'Review incentives'],
      notes: 'Great progress!'
    });

    expect(mockModel.findById).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
    expect(mockClient.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      to: '9876543210',
      message: expect.stringContaining('Carbon audit')
    }));
    expect(result).toMatchObject({
      msmeId: msmeRecord._id,
      type: NOTIFICATION_TYPES.PROGRESS,
      skipped: false
    });
  });

  test('sendNotification delegates to specialised handler', async () => {
    const spy = jest.spyOn(service, 'sendCarbonScoreUpdate').mockResolvedValue({ success: true });

    await service.sendNotification(NOTIFICATION_TYPES.CARBON_SCORE, 'msme-123', { score: 80 });

    expect(spy).toHaveBeenCalledWith('msme-123', { score: 80 });
    spy.mockRestore();
  });

  test('sendCustomNotification throws for missing message', async () => {
    await expect(service.sendCustomNotification('msme-123'))
      .rejects
      .toThrow('Message is required for custom notifications');
  });

  test('sendCustomNotification sends provided message when enabled', async () => {
    const result = await service.sendCustomNotification('507f1f77bcf86cd799439011', 'Hello MSME', { type: 'custom_alert' });

    expect(mockClient.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Hello MSME'
    }));
    expect(result).toMatchObject({
      type: 'custom_alert',
      skipped: false
    });
  });

  test('dispatch throws when phone number missing', async () => {
    const localService = new MSMENotificationService({
      msg91Client: mockClient,
      msmeModel: {
        findById: jest.fn(() => ({ select: jest.fn().mockResolvedValue({
          _id: 'abc123',
          companyName: 'Eco Unit',
          carbonScore: 45,
          contact: {}
        }) }))
      }
    });

    await expect(localService.sendProgressUpdate('abc123', { milestone: 'Test', status: 'pending' }))
      .rejects
      .toThrow('MSME abc123 does not have a registered phone number');
  });

  test('dispatch skips sending when MSG91 notifications are disabled', async () => {
    process.env.MSG91_NOTIFICATIONS_ENABLED = 'false';
    mockClient.sendMessage.mockClear();

    const disabledService = new MSMENotificationService({
      msg91Client: mockClient,
      msmeModel: mockModel
    });

    const result = await disabledService.sendProgressUpdate('507f1f77bcf86cd799439011', {
      milestone: 'Carbon audit',
      status: 'completed'
    });

    expect(mockClient.sendMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      msmeId: msmeRecord._id,
      skipped: true,
      reason: 'notifications_disabled'
    });
  });
});
