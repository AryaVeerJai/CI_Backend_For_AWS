/**
 * Self-serve connect field schemas for MSME accounting connectors.
 * Used by API validation and surfaced to the web client for connect dialogs.
 */
const MSME_CONNECTOR_CONNECT_SCHEMAS = {
  tally: {
    connectionType: 'api',
    title: 'Connect TallyPrime',
    helpText: 'Enable TallyPrime as an HTTP server (Exchange → Data Synchronization, port 9000) on the PC where Tally runs, then enter host and company name.',
    fields: [
      { key: 'host', label: 'Tally host', type: 'text', required: false, defaultValue: 'localhost', placeholder: 'localhost' },
      { key: 'port', label: 'Port', type: 'number', required: false, defaultValue: 9000 },
      { key: 'companyName', label: 'Company name in Tally', type: 'text', required: true, placeholder: 'Exact name as shown in TallyPrime' },
      { key: 'reportId', label: 'Report', type: 'text', required: false, defaultValue: 'DayBook' },
      { key: 'apiFormat', label: 'API format', type: 'select', required: false, options: ['json', 'xml'], defaultValue: 'json' }
    ]
  },
  zoho: {
    connectionType: 'api',
    title: 'Connect Zoho Books',
    helpText: 'Create a Zoho API client (India data center), generate a refresh token with Zoho Books scope, and paste credentials below.',
    fields: [
      { key: 'organizationId', label: 'Organization ID', type: 'text', required: true },
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client secret', type: 'password', required: true },
      { key: 'refreshToken', label: 'Refresh token', type: 'password', required: true },
      { key: 'apiDomain', label: 'API domain', type: 'text', required: false, defaultValue: 'https://www.zohoapis.in' },
      { key: 'accountsDomain', label: 'Accounts domain', type: 'text', required: false, defaultValue: 'https://accounts.zoho.in' }
    ]
  },
  quickbooks: {
    connectionType: 'api',
    title: 'Connect QuickBooks Online',
    helpText: 'Use your Intuit developer app credentials and OAuth refresh token for the India company realm.',
    fields: [
      { key: 'realmId', label: 'Realm ID (company)', type: 'text', required: true },
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client secret', type: 'password', required: true },
      { key: 'refreshToken', label: 'Refresh token', type: 'password', required: true },
      { key: 'environment', label: 'Environment', type: 'select', required: false, options: ['production', 'sandbox'], defaultValue: 'production' }
    ]
  }
};

const IMPORT_ONLY_SELF_SERVE = {
  connectionType: 'import',
  title: 'Use file import',
  helpText: 'Mark this tool as your accounting source and import JSON or CSV exports from the Data connectors page.'
};

const getConnectSchemaForProvider = (providerId) => {
  const normalized = String(providerId || '').trim().toLowerCase();
  if (MSME_CONNECTOR_CONNECT_SCHEMAS[normalized]) {
    return { provider: normalized, ...MSME_CONNECTOR_CONNECT_SCHEMAS[normalized] };
  }
  return { provider: normalized, ...IMPORT_ONLY_SELF_SERVE };
};

module.exports = {
  MSME_CONNECTOR_CONNECT_SCHEMAS,
  IMPORT_ONLY_SELF_SERVE,
  getConnectSchemaForProvider
};
