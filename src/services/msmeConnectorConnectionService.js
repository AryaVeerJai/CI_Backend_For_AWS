const MsmeConnectorConnection = require('../models/MsmeConnectorConnection');
const {
  API_CONNECTOR_IDS,
  getConnectorById,
  resolveProviderId
} = require('./connectors/accountingConnectorRegistry');
const { getConnectSchemaForProvider } = require('../constants/msmeConnectorConnectSchemas');
const { encryptJson, decryptJson } = require('../utils/connectorCredentialCrypto');
const ZohoBooksClient = require('./connectors/zohoBooksClient');
const QuickBooksClient = require('./connectors/quickbooksClient');
const TallyPrimeClient = require('./connectors/tallyPrimeClient');

const SENSITIVE_KEYS = new Set([
  'clientSecret',
  'refreshToken',
  'client_secret',
  'refresh_token'
]);

const maskSecret = (value) => {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.length <= 4) return '****';
  return `${raw.slice(0, 2)}****${raw.slice(-2)}`;
};

const sanitizePublicMeta = (credentials = {}, existingMeta = {}) => {
  const meta = { ...existingMeta };
  Object.entries(credentials).forEach(([key, value]) => {
    if (SENSITIVE_KEYS.has(key)) {
      meta[`${key}Configured`] = Boolean(value);
      if (value) meta[`${key}Preview`] = maskSecret(value);
      return;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      meta[key] = value;
    }
  });
  return meta;
};

const resolveOwnerFilter = ({ msmeId, organizationId }) => {
  if (msmeId) return { msmeId };
  if (organizationId) return { organizationId };
  return null;
};

const buildApiClient = (providerId, credentials = {}) => {
  const enabled = credentials.enabled !== false;
  if (providerId === 'zoho') {
    return new ZohoBooksClient({
      enabled,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      organizationId: credentials.organizationId,
      apiDomain: credentials.apiDomain,
      accountsDomain: credentials.accountsDomain
    });
  }
  if (providerId === 'quickbooks') {
    return new QuickBooksClient({
      enabled,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      realmId: credentials.realmId,
      environment: credentials.environment
    });
  }
  if (providerId === 'tally') {
    return new TallyPrimeClient({
      enabled,
      host: credentials.host,
      port: credentials.port,
      companyName: credentials.companyName,
      apiFormat: credentials.apiFormat,
      reportId: credentials.reportId,
      defaultFromDate: credentials.fromDate,
      defaultToDate: credentials.toDate
    });
  }
  return null;
};

const validateApiCredentials = (providerId, credentials = {}) => {
  if (providerId === 'zoho') {
    const missing = ['organizationId', 'clientId', 'clientSecret', 'refreshToken']
      .filter((key) => !String(credentials[key] || '').trim());
    if (missing.length) {
      const error = new Error(`Zoho Books connect requires: ${missing.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }
    return { enabled: true, ...credentials };
  }

  if (providerId === 'quickbooks') {
    const missing = ['realmId', 'clientId', 'clientSecret', 'refreshToken']
      .filter((key) => !String(credentials[key] || '').trim());
    if (missing.length) {
      const error = new Error(`QuickBooks connect requires: ${missing.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }
    return { enabled: true, environment: credentials.environment || 'production', ...credentials };
  }

  if (providerId === 'tally') {
    const companyName = String(credentials.companyName || '').trim();
    if (!companyName) {
      const error = new Error('TallyPrime connect requires company name as shown in Tally');
      error.statusCode = 400;
      throw error;
    }
    return {
      enabled: true,
      host: credentials.host || 'localhost',
      port: Number(credentials.port || 9000),
      companyName,
      apiFormat: credentials.apiFormat || 'json',
      reportId: credentials.reportId || 'DayBook',
      fromDate: credentials.fromDate,
      toDate: credentials.toDate
    };
  }

  const error = new Error(`Provider does not support API self-serve connect: ${providerId}`);
  error.statusCode = 400;
  throw error;
};

const toConnectionResponse = (doc) => {
  if (!doc) return null;
  const connection = doc.toObject ? doc.toObject() : doc;
  return {
    provider: connection.provider,
    connectionType: connection.connectionType,
    status: connection.status,
    publicMeta: connection.publicMeta || {},
    lastSyncAt: connection.lastSyncAt || null,
    lastSyncError: connection.lastSyncError || null,
    connectedAt: connection.connectedAt || null,
    disconnectedAt: connection.disconnectedAt || null,
    updatedAt: connection.updatedAt || null
  };
};

const listConnections = async ({ msmeId, organizationId }) => {
  const filter = resolveOwnerFilter({ msmeId, organizationId });
  if (!filter) return [];

  const docs = await MsmeConnectorConnection.find({
    ...filter,
    status: { $ne: 'disconnected' }
  }).sort({ provider: 1 });

  return docs.map(toConnectionResponse);
};

const getConnection = async ({ msmeId, organizationId, provider }) => {
  const resolved = resolveProviderId(provider);
  if (!resolved) return null;

  const filter = resolveOwnerFilter({ msmeId, organizationId });
  if (!filter) return null;

  const doc = await MsmeConnectorConnection.findOne({
    ...filter,
    provider: resolved,
    status: { $ne: 'disconnected' }
  });

  return toConnectionResponse(doc);
};

const getDecryptedCredentials = async ({ msmeId, organizationId, provider }) => {
  const resolved = resolveProviderId(provider);
  if (!resolved) return null;

  const filter = resolveOwnerFilter({ msmeId, organizationId });
  if (!filter) return null;

  const doc = await MsmeConnectorConnection.findOne({
    ...filter,
    provider: resolved,
    status: 'connected'
  });

  if (!doc?.encryptedCredentials) return null;
  return decryptJson(doc.encryptedCredentials);
};

const upsertConnection = async ({
  msmeId,
  organizationId,
  provider,
  credentials = {},
  connectionType
}) => {
  const resolved = resolveProviderId(provider);
  const connector = getConnectorById(resolved);
  if (!connector) {
    const error = new Error(`Unknown accounting connector: ${provider}`);
    error.statusCode = 404;
    throw error;
  }

  const filter = resolveOwnerFilter({ msmeId, organizationId });
  if (!filter) {
    const error = new Error('MSME or organization profile required to save connector connection');
    error.statusCode = 404;
    throw error;
  }

  const schema = getConnectSchemaForProvider(resolved);
  const resolvedConnectionType = connectionType || schema.connectionType || 'import';

  let storedCredentials = { enabled: true };
  if (resolvedConnectionType === 'api') {
    if (!API_CONNECTOR_IDS.includes(resolved)) {
      const error = new Error(`${connector.name} supports file import only. Use Import file instead of API connect.`);
      error.statusCode = 400;
      throw error;
    }
    storedCredentials = validateApiCredentials(resolved, credentials);
  }

  const publicMeta = sanitizePublicMeta(storedCredentials, {
    productName: connector.name,
    vendor: connector.vendor
  });

  const encryptedCredentials = resolvedConnectionType === 'api'
    ? encryptJson(storedCredentials)
    : null;

  const doc = await MsmeConnectorConnection.findOneAndUpdate(
    { ...filter, provider: resolved },
    {
      $set: {
        ...filter,
        provider: resolved,
        connectionType: resolvedConnectionType,
        status: 'connected',
        encryptedCredentials,
        publicMeta,
        lastSyncError: null,
        connectedAt: new Date(),
        disconnectedAt: null
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return toConnectionResponse(doc);
};

const disconnectConnection = async ({ msmeId, organizationId, provider }) => {
  const resolved = resolveProviderId(provider);
  const filter = resolveOwnerFilter({ msmeId, organizationId });
  if (!resolved || !filter) {
    const error = new Error('Connector connection not found');
    error.statusCode = 404;
    throw error;
  }

  const doc = await MsmeConnectorConnection.findOneAndUpdate(
    { ...filter, provider: resolved },
    {
      $set: {
        status: 'disconnected',
        encryptedCredentials: null,
        disconnectedAt: new Date()
      }
    },
    { new: true }
  );

  if (!doc) {
    const error = new Error('Connector connection not found');
    error.statusCode = 404;
    throw error;
  }

  return toConnectionResponse(doc);
};

const recordSyncResult = async ({ msmeId, organizationId, provider, errorMessage = null }) => {
  const resolved = resolveProviderId(provider);
  const filter = resolveOwnerFilter({ msmeId, organizationId });
  if (!resolved || !filter) return;

  await MsmeConnectorConnection.updateOne(
    { ...filter, provider: resolved, status: 'connected' },
    {
      $set: {
        lastSyncAt: new Date(),
        lastSyncError: errorMessage,
        status: errorMessage ? 'error' : 'connected'
      }
    }
  );
};

const resolveApiClientForOwner = async ({
  msmeId,
  organizationId,
  providerId,
  legalName,
  companyName
}) => {
  const normalized = resolveProviderId(providerId);
  if (!normalized || !API_CONNECTOR_IDS.includes(normalized)) {
    return { client: null, source: null };
  }

  const ownerCredentials = await getDecryptedCredentials({
    msmeId,
    organizationId,
    provider: normalized
  });

  if (ownerCredentials) {
    const client = buildApiClient(normalized, ownerCredentials);
    const context = {
      companyName: ownerCredentials.companyName || companyName,
      legalName: ownerCredentials.companyName || legalName
    };
    return {
      client,
      source: 'msme',
      context
    };
  }

  const envClient = buildApiClient(normalized, { enabled: undefined });
  if (envClient?.isConfigured?.(normalized === 'tally' ? {
    companyName,
    legalName
  } : {})) {
    return {
      client: envClient,
      source: 'platform',
      context: { companyName, legalName }
    };
  }

  return { client: null, source: null, context: { companyName, legalName } };
};

const testConnection = async ({
  msmeId,
  organizationId,
  provider,
  credentials,
  legalName,
  companyName
}) => {
  const resolved = resolveProviderId(provider);
  if (!API_CONNECTOR_IDS.includes(resolved)) {
    const error = new Error('Connection test is only available for API connectors (Tally, Zoho, QuickBooks)');
    error.statusCode = 400;
    throw error;
  }

  let client;
  if (credentials && Object.keys(credentials).length > 0) {
    const validated = validateApiCredentials(resolved, credentials);
    client = buildApiClient(resolved, validated);
  } else {
    const resolvedClient = await resolveApiClientForOwner({
      msmeId,
      organizationId,
      providerId: resolved,
      legalName,
      companyName
    });
    client = resolvedClient.client;
    if (!client) {
      const error = new Error('No connector credentials found. Connect your accounting tool first.');
      error.statusCode = 400;
      throw error;
    }
  }

  const context = {
    companyName: credentials?.companyName || companyName,
    legalName: credentials?.companyName || legalName
  };

  if (!client.isConfigured(context)) {
    const error = new Error('Connector credentials are incomplete');
    error.statusCode = 400;
    throw error;
  }

  if (resolved === 'zoho') {
    await client.refreshAccessToken();
    return { ok: true, message: 'Zoho Books credentials verified' };
  }

  if (resolved === 'quickbooks') {
    await client.refreshAccessToken();
    return { ok: true, message: 'QuickBooks credentials verified' };
  }

  if (resolved === 'tally') {
    await client.fetchAllTransactions({
      fromDate: credentials?.fromDate,
      toDate: credentials?.toDate,
      companyName: context.companyName,
      legalName: context.legalName,
      syncAllPages: false
    });
    return { ok: true, message: 'TallyPrime HTTP server responded successfully' };
  }

  return { ok: true, message: 'Connection verified' };
};

const listConnectSchemas = () => API_CONNECTOR_IDS
  .concat(['busy', 'marg', 'vyapar', 'mybillbook', 'khatabook', 'erpnext', 'odoo', 'clear', 'profitbooks', 'hostbooks'])
  .map((providerId) => getConnectSchemaForProvider(providerId));

module.exports = {
  listConnections,
  getConnection,
  upsertConnection,
  disconnectConnection,
  getDecryptedCredentials,
  resolveApiClientForOwner,
  recordSyncResult,
  testConnection,
  listConnectSchemas,
  buildApiClient,
  sanitizePublicMeta
};
