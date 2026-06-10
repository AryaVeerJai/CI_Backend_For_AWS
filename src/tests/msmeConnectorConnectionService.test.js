const mongoose = require('mongoose');
const MsmeConnectorConnection = require('../models/MsmeConnectorConnection');
const msmeConnectorConnectionService = require('../services/msmeConnectorConnectionService');
const { encryptJson } = require('../utils/connectorCredentialCrypto');

describe('msmeConnectorConnectionService', () => {
  const msmeId = new mongoose.Types.ObjectId();

  beforeEach(async () => {
    await MsmeConnectorConnection.deleteMany({});
  });

  test('saves import-only self-serve connection without encrypted credentials', async () => {
    const connection = await msmeConnectorConnectionService.upsertConnection({
      msmeId,
      provider: 'busy',
      connectionType: 'import'
    });

    expect(connection.provider).toBe('busy');
    expect(connection.connectionType).toBe('import');
    expect(connection.status).toBe('connected');

    const stored = await MsmeConnectorConnection.findOne({ msmeId, provider: 'busy' });
    expect(stored.encryptedCredentials).toBeNull();
  });

  test('encrypts and retrieves Zoho API credentials', async () => {
    await msmeConnectorConnectionService.upsertConnection({
      msmeId,
      provider: 'zoho',
      credentials: {
        organizationId: '6000000001',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token'
      }
    });

    const decrypted = await msmeConnectorConnectionService.getDecryptedCredentials({
      msmeId,
      provider: 'zoho'
    });

    expect(decrypted.organizationId).toBe('6000000001');
    expect(decrypted.refreshToken).toBe('refresh-token');
    expect(decrypted.clientSecret).toBe('client-secret');
  });

  test('disconnect clears encrypted credentials', async () => {
    await MsmeConnectorConnection.create({
      msmeId,
      provider: 'tally',
      connectionType: 'api',
      status: 'connected',
      encryptedCredentials: encryptJson({ enabled: true, companyName: 'Demo Co' })
    });

    const disconnected = await msmeConnectorConnectionService.disconnectConnection({
      msmeId,
      provider: 'tally'
    });

    expect(disconnected.status).toBe('disconnected');
    const stored = await MsmeConnectorConnection.findOne({ msmeId, provider: 'tally' });
    expect(stored.encryptedCredentials).toBeNull();
  });

  test('rejects incomplete Zoho credentials', async () => {
    await expect(msmeConnectorConnectionService.upsertConnection({
      msmeId,
      provider: 'zoho',
      credentials: { organizationId: '6000000001' }
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});
