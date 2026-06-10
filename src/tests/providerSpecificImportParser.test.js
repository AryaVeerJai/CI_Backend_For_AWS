const fs = require('fs');
const path = require('path');
const {
  detectProviderImportFile,
  parseProviderImportFile,
  parseProviderXlsx,
  SUPPORTED_PROVIDER_IMPORT_IDS
} = require('../services/connectors/providerSpecificImportParser');
const parserService = require('../services/accountingTransactionParserService');

const SAMPLE_DIR = path.join(
  __dirname,
  '../../../ai-model/data/DataConnectors/Import/ProviderSpecific'
);

describe('providerSpecificImportParser', () => {
  test('lists all supported provider import ids', () => {
    expect(SUPPORTED_PROVIDER_IMPORT_IDS).toEqual(
      expect.arrayContaining(['busy', 'marg', 'vyapar', 'mybillbook', 'khatabook', 'quickbooks', 'erpnext', 'odoo', 'clear', 'profitbooks', 'hostbooks'])
    );
    expect(SUPPORTED_PROVIDER_IMPORT_IDS).toHaveLength(11);
  });

  test.each([
    ['busy', 'Busy_Accounting_ProviderSpecific.xlsx'],
    ['marg', 'Marg_ERP_ProviderSpecific.xlsx'],
    ['vyapar', 'Vyapar_ProviderSpecific.xlsx'],
    ['mybillbook', 'myBillBook_ProviderSpecific.xlsx'],
    ['khatabook', 'Khatabook_ProviderSpecific.xlsx'],
    ['quickbooks', 'QuickBooks_ProviderSpecific.xlsx'],
    ['erpnext', 'ERPNext_ProviderSpecific.xlsx'],
    ['odoo', 'Odoo_ProviderSpecific.xlsx'],
    ['clear', 'Clear_ProviderSpecific.xlsx'],
    ['profitbooks', 'ProfitBooks_ProviderSpecific.xlsx'],
    ['hostbooks', 'HostBooks_ProviderSpecific.xlsx']
  ])('detects %s XLSX export by headers', (provider, filename) => {
    const buffer = fs.readFileSync(path.join(SAMPLE_DIR, filename));
    const parsed = parseProviderXlsx(buffer, provider);
    const detection = detectProviderImportFile({
      provider,
      filename,
      headers: parsed.meta.headers
    });

    expect(detection.accepted).toBe(true);
    expect(detection.provider).toBe(provider);
    expect(detection.headerMatches).toBeGreaterThanOrEqual(4);
    expect(parsed.transactions.length).toBeGreaterThanOrEqual(100);
  });

  test('parses Busy export and normalizes through accounting parser', async () => {
    const buffer = fs.readFileSync(path.join(SAMPLE_DIR, 'Busy_Accounting_ProviderSpecific.xlsx'));
    const parsed = await parseProviderImportFile({
      provider: 'busy',
      filename: 'Busy_Accounting_ProviderSpecific.xlsx',
      buffer
    });

    expect(parsed.detection.accepted).toBe(true);
    expect(parsed.transactions.length).toBeGreaterThanOrEqual(100);

    const result = parserService.parseTransactions({
      provider: 'busy',
      transactions: parsed.transactions.slice(0, 5)
    });

    expect(result.validRows.length).toBeGreaterThanOrEqual(5);
    expect(result.validRows[0].parsed.source).toBe('busy');
  });

  test('accepts provider PDF probe by keywords', () => {
    const detection = detectProviderImportFile({
      provider: 'erpnext',
      filename: 'ERPNext_Export.pdf',
      content: 'erpnext export voucher type cost center debit credit remarks pdf'
    });

    expect(detection.accepted).toBe(true);
    expect(detection.format).toBe('pdf');
  });

  test('rejects unknown provider file detection', () => {
    const detection = detectProviderImportFile({
      provider: 'unknown_vendor',
      filename: 'random.csv',
      content: 'foo,bar,baz'
    });

    expect(detection.accepted).toBe(false);
  });
});
