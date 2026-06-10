const {
  SUPPORTED_IMPORT_PROVIDERS,
  API_CONNECTOR_IDS,
  listConnectors,
  getConnectorById
} = require('../services/connectors/accountingConnectorRegistry');

describe('accountingConnectorRegistry', () => {
  test('lists major Indian accounting connectors', () => {
    const connectors = listConnectors();
    const ids = connectors.map((connector) => connector.id);

    expect(ids).toEqual(expect.arrayContaining([
      'tally',
      'zoho',
      'busy',
      'marg',
      'vyapar',
      'mybillbook',
      'khatabook',
      'quickbooks',
      'erpnext',
      'odoo',
      'clear',
      'profitbooks',
      'hostbooks'
    ]));
    expect(connectors.length).toBeGreaterThanOrEqual(13);
  });

  test('exposes import and API connector sets', () => {
    expect(SUPPORTED_IMPORT_PROVIDERS).toContain('busy');
    expect(SUPPORTED_IMPORT_PROVIDERS).toContain('zoho');
    expect(API_CONNECTOR_IDS).toEqual(expect.arrayContaining(['zoho', 'quickbooks', 'tally']));
  });

  test('returns connector metadata by id', () => {
    const busy = getConnectorById('busy');
    expect(busy).toEqual(expect.objectContaining({
      id: 'busy',
      name: 'Busy Accounting',
      integrationTypes: ['import']
    }));
  });
});
