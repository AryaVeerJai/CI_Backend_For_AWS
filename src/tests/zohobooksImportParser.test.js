const fs = require('fs');
const path = require('path');
const {
  detectZohoBooksImportFile,
  parseZohoBooksImportFile,
  parseZohoBooksCsv,
  parseZohoBooksXlsx
} = require('../services/connectors/zohoBooksImportParser');
const parserService = require('../services/accountingTransactionParserService');

const SAMPLE_DIR = path.join(
  __dirname,
  '../../../ai-model/data/DataConnectors/Import/ZohoBooks'
);
const SAMPLE_CSV = path.join(SAMPLE_DIR, 'ZohoBooks_12Month_Realistic_Export.csv');
const SAMPLE_XLSX = path.join(SAMPLE_DIR, 'ZohoBooks_12Month_Realistic_Export.xlsx');
const SAMPLE_MSME_XLSX = path.join(SAMPLE_DIR, 'ZohoBooks_MSME_Transactions_Sample.xlsx');

describe('zohoBooksImportParser', () => {
  test('detects Zoho Books CSV export by headers and keywords', () => {
    const csv = fs.readFileSync(SAMPLE_CSV, 'utf8');
    const parsed = parseZohoBooksCsv(csv);
    const detection = detectZohoBooksImportFile({
      filename: 'ZohoBooks_12Month_Realistic_Export.csv',
      content: csv,
      headers: parsed.meta.headers
    });

    expect(detection.accepted).toBe(true);
    expect(detection.provider).toBe('zoho');
    expect(detection.format).toBe('csv');
    expect(detection.headerMatches).toBeGreaterThanOrEqual(4);
  });

  test('detects Zoho Books XLSX export by headers', () => {
    const buffer = fs.readFileSync(SAMPLE_XLSX);
    const parsed = parseZohoBooksXlsx(buffer);
    const detection = detectZohoBooksImportFile({
      filename: 'ZohoBooks_12Month_Realistic_Export.xlsx',
      headers: parsed.meta.headers
    });

    expect(detection.accepted).toBe(true);
    expect(detection.headerMatches).toBeGreaterThanOrEqual(4);
    expect(parsed.transactions.length).toBeGreaterThanOrEqual(100);
  });

  test('parses realistic MSME CSV export rows', async () => {
    const csv = fs.readFileSync(SAMPLE_CSV, 'utf8');
    const parsed = await parseZohoBooksImportFile({
      filename: 'ZohoBooks_12Month_Realistic_Export.csv',
      content: csv
    });

    expect(parsed.transactions.length).toBeGreaterThanOrEqual(100);
    const diesel = parsed.transactions.find((row) => /diesel/i.test(row.description || ''));
    expect(diesel).toEqual(expect.objectContaining({
      transaction_id: expect.stringMatching(/^ZB-/),
      vendor_name: expect.any(String),
      total: expect.any(Number)
    }));
  });

  test('parses MSME sample XLSX with alternate amount column', async () => {
    const buffer = fs.readFileSync(SAMPLE_MSME_XLSX);
    const parsed = await parseZohoBooksImportFile({
      filename: 'ZohoBooks_MSME_Transactions_Sample.xlsx',
      buffer
    });

    expect(parsed.transactions.length).toBeGreaterThanOrEqual(7);
    const steel = parsed.transactions.find((row) => /steel/i.test(row.description || ''));
    expect(steel).toEqual(expect.objectContaining({
      transaction_id: 'BILL-001',
      vendor_name: 'ABC Steel Suppliers',
      total: 250000
    }));

    const electricity = parsed.transactions.find((row) => /electricity/i.test(row.description || ''));
    expect(electricity).toEqual(expect.objectContaining({
      transaction_id: 'EXP-001',
      vendor_name: 'BESCOM',
      total: 18500
    }));
  });

  test('classifies Zoho Books sample transactions into emission categories', async () => {
    const buffer = fs.readFileSync(SAMPLE_MSME_XLSX);
    const parsed = await parseZohoBooksImportFile({
      filename: 'ZohoBooks_MSME_Transactions_Sample.xlsx',
      buffer
    });

    const result = parserService.parseTransactions({
      provider: 'zoho',
      transactions: parsed.transactions
    });

    expect(result.validRows.length).toBeGreaterThanOrEqual(7);

    const byDescription = (pattern) => result.validRows.find((row) => pattern.test(row.parsed.description || ''));

    expect(byDescription(/electricity/i)?.parsed.category).toBe('utilities');
    expect(byDescription(/steel/i)?.parsed.category).toBe('raw_materials');
    expect(byDescription(/diesel/i)?.parsed.category).toBe('transportation');
    expect(byDescription(/water/i)?.parsed.category).toBe('utilities');
    expect(byDescription(/waste/i)?.parsed.category).toBe('waste_management');
  });
});
