jest.mock('../services/emailIngestionAgent', () => ({
  resolveConnectionSettings: jest.fn(() => ({
    host: 'imap.gmail.com',
    port: 993,
    secure: true
  })),
  fetchEmails: jest.fn()
}));

jest.mock('../utils/connectorCredentialCrypto', () => ({
  encryptJson: jest.fn(() => 'encrypted:test'),
  decryptJson: jest.fn(() => ({ password: 'app-password' }))
}));

const emailIngestionAgent = require('../services/emailIngestionAgent');
const EmailConnection = require('../models/EmailConnection');
const emailConnectionService = require('../services/emailConnectionService');

describe('EmailConnectionService', () => {
  const msmeId = '507f1f77bcf86cd799439011';

  beforeEach(async () => {
    await EmailConnection.deleteMany({});
    jest.clearAllMocks();
  });

  test('connectAccount verifies mailbox and stores encrypted credentials', async () => {
    emailIngestionAgent.fetchEmails.mockResolvedValue({
      success: true,
      emails: [],
      metadata: { mailbox: 'INBOX', connection: { host: 'imap.gmail.com', port: 993 } }
    });

    const connection = await emailConnectionService.connectAccount(msmeId, {
      email: 'finance@example.com',
      password: 'app-password',
      imapServer: 'imap.gmail.com',
      imapPort: 993
    });

    expect(connection.email).toBe('finance@example.com');
    expect(connection.status).toBe('connected');
    expect(emailIngestionAgent.fetchEmails).toHaveBeenCalled();

    const stored = await EmailConnection.findOne({ msmeId, email: 'finance@example.com' });
    expect(stored.encryptedCredentials).toBe('encrypted:test');
  });

  test('connectAccount rejects invalid mailbox credentials', async () => {
    emailIngestionAgent.fetchEmails.mockResolvedValue({
      success: false,
      error: 'Invalid credentials'
    });

    await expect(emailConnectionService.connectAccount(msmeId, {
      email: 'finance@example.com',
      password: 'bad-password'
    })).rejects.toMatchObject({
      message: 'Invalid credentials',
      statusCode: 400
    });
  });

  test('disconnectAccount clears stored credentials', async () => {
    const created = await EmailConnection.create({
      msmeId,
      email: 'finance@example.com',
      imapServer: 'imap.gmail.com',
      imapPort: 993,
      encryptedCredentials: 'encrypted:test',
      status: 'connected'
    });

    const disconnected = await emailConnectionService.disconnectAccount(msmeId, created._id);
    expect(disconnected.status).toBe('disconnected');

    const stored = await EmailConnection.findById(created._id);
    expect(stored.encryptedCredentials).toBeNull();
  });
});
