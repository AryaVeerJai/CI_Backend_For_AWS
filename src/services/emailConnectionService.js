const EmailConnection = require('../models/EmailConnection');
const emailIngestionAgent = require('./emailIngestionAgent');
const { encryptJson, decryptJson } = require('../utils/connectorCredentialCrypto');

const maskEmail = (email = '') => {
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return '***';
  const visible = local.length <= 2 ? '*' : `${local.slice(0, 2)}***`;
  return `${visible}@${domain}`;
};

const resolveImapSettings = (email, overrides = {}) => {
  const resolved = emailIngestionAgent.resolveConnectionSettings(email, {
    host: overrides.imapServer,
    port: overrides.imapPort,
    secure: overrides.secure
  });

  return {
    imapServer: overrides.imapServer || resolved.host,
    imapPort: overrides.imapPort || resolved.port,
    secure: overrides.secure !== undefined ? overrides.secure : resolved.secure
  };
};

const testMailboxConnection = async ({
  email,
  password,
  imapServer,
  imapPort,
  secure = true
}) => {
  const result = await emailIngestionAgent.fetchEmails({
    email,
    password,
    imapServer,
    imapPort,
    secure,
    limit: 1,
    sinceDays: 7
  });

  if (!result.success) {
    const error = new Error(result.error || 'Unable to connect to mailbox');
    error.statusCode = 400;
    throw error;
  }

  return {
    verified: true,
    mailbox: result.metadata?.mailbox || 'INBOX',
    connection: result.metadata?.connection || null
  };
};

const toPublicConnection = (connection) => ({
  id: connection._id,
  email: connection.email,
  emailMasked: maskEmail(connection.email),
  imapServer: connection.imapServer,
  imapPort: connection.imapPort,
  secure: connection.secure,
  status: connection.status,
  lastSyncAt: connection.lastSyncAt || null,
  lastSyncError: connection.lastSyncError || null,
  lastSyncSummary: connection.lastSyncSummary || null,
  connectedAt: connection.connectedAt,
  disconnectedAt: connection.disconnectedAt || null
});

class EmailConnectionService {
  async listConnections(msmeId) {
    const connections = await EmailConnection.find({
      msmeId,
      status: { $ne: 'disconnected' }
    }).sort({ connectedAt: -1 });

    return connections.map(toPublicConnection);
  }

  async connectAccount(msmeId, payload = {}) {
    const email = String(payload.email || '').trim().toLowerCase();
    const password = payload.password || payload.appPassword;

    if (!email || !password) {
      const error = new Error('Email and password are required');
      error.statusCode = 400;
      throw error;
    }

    const imapSettings = resolveImapSettings(email, payload);
    await testMailboxConnection({
      email,
      password,
      ...imapSettings
    });

    const encryptedCredentials = encryptJson({ password });
    const connection = await EmailConnection.findOneAndUpdate(
      { msmeId, email },
      {
        msmeId,
        email,
        ...imapSettings,
        encryptedCredentials,
        status: 'connected',
        lastSyncError: null,
        disconnectedAt: null,
        connectedAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return toPublicConnection(connection);
  }

  async disconnectAccount(msmeId, connectionId) {
    const connection = await EmailConnection.findOne({ _id: connectionId, msmeId });
    if (!connection) {
      const error = new Error('Email connection not found');
      error.statusCode = 404;
      throw error;
    }

    connection.status = 'disconnected';
    connection.disconnectedAt = new Date();
    connection.encryptedCredentials = null;
    await connection.save();

    return toPublicConnection(connection);
  }

  async getDecryptedCredentials(connection) {
    if (!connection?.encryptedCredentials) {
      const error = new Error('Email credentials are not available for this connection');
      error.statusCode = 400;
      throw error;
    }

    const credentials = decryptJson(connection.encryptedCredentials);
    if (!credentials?.password) {
      const error = new Error('Stored email credentials are invalid');
      error.statusCode = 400;
      throw error;
    }

    return credentials;
  }

  async getActiveConnection(msmeId, connectionId = null) {
    const query = connectionId
      ? { _id: connectionId, msmeId, status: 'connected' }
      : { msmeId, status: 'connected' };

    const connection = connectionId
      ? await EmailConnection.findOne(query)
      : await EmailConnection.findOne(query).sort({ connectedAt: -1 });

    if (!connection) {
      const error = new Error('No connected email account found');
      error.statusCode = 404;
      throw error;
    }

    return connection;
  }
}

module.exports = new EmailConnectionService();
