const fs = require('fs');
const path = require('path');
const {
  detectTallyPrimeImportFile,
  parseTallyPrimeImportFile,
  parseTallyPrimeXml,
  parseTallyPrimeXlsx,
  parseTallyPrimePdfText
} = require('../services/connectors/tallyPrimeImportParser');
const parserService = require('../services/accountingTransactionParserService');

const SAMPLE_DIR = path.join(
  __dirname,
  '../../../ai-model/data/DataConnectors/Import/TallyPrime'
);
const SAMPLE_XML = path.join(SAMPLE_DIR, 'TallyPrime_Realistic_MSME_Export.xml');
const SAMPLE_XLSX = path.join(SAMPLE_DIR, 'TallyPrime_Realistic_MSME_Export.xlsx');
const SAMPLE_MSME_XLSX = path.join(SAMPLE_DIR, 'MSME_12Month_Dataset_Training.xlsx');
const SAMPLE_MSME_DYNAMIC_XLSX = path.join(SAMPLE_DIR, 'MSME_12Month_Dataset_Training_DynamicDescriptions.xlsx');

describe('tallyPrimeImportParser', () => {
  test('detects TallyPrime XML export by keywords', () => {
    const xml = fs.readFileSync(SAMPLE_XML, 'utf8');
    const detection = detectTallyPrimeImportFile({
      filename: 'TallyPrime_Realistic_MSME_Export.xml',
      content: xml
    });

    expect(detection.accepted).toBe(true);
    expect(detection.provider).toBe('tally');
    expect(detection.format).toBe('xml');
    expect(detection.keywordScore).toBeGreaterThanOrEqual(2);
  });

  test('detects TallyPrime XLSX export by headers', () => {
    const buffer = fs.readFileSync(SAMPLE_XLSX);
    const parsed = parseTallyPrimeXlsx(buffer);
    const detection = detectTallyPrimeImportFile({
      filename: 'TallyPrime_Realistic_MSME_Export.xlsx',
      headers: parsed.meta.headers
    });

    expect(detection.accepted).toBe(true);
    expect(detection.headerMatches).toBeGreaterThanOrEqual(4);
    expect(parsed.transactions.length).toBeGreaterThanOrEqual(7);
  });

  test('detects MSME 12-month XLSX export by headers', () => {
    const buffer = fs.readFileSync(SAMPLE_MSME_XLSX);
    const parsed = parseTallyPrimeXlsx(buffer);
    const detection = detectTallyPrimeImportFile({
      filename: 'MSME_12Month_Dataset_Training.xlsx',
      headers: parsed.meta.headers
    });

    expect(detection.accepted).toBe(true);
    expect(parsed.meta.layout).toBe('msme_12month');
    expect(parsed.transactions.length).toBeGreaterThanOrEqual(100);
  });

  test('parses realistic MSME XML vouchers with nested ledger amounts', () => {
    const xml = fs.readFileSync(SAMPLE_XML, 'utf8');
    const parsed = parseTallyPrimeXml(xml);

    expect(parsed.transactions.length).toBeGreaterThanOrEqual(7);
    const electricity = parsed.transactions.find((row) => /electricity/i.test(row.narration || ''));
    expect(electricity).toEqual(expect.objectContaining({
      voucher_number: 'JRN/001',
      party_name: 'Karnataka Electricity Board',
      amount: '18500',
      voucher_date: '2026-04-03'
    }));
  });

  test('normalizes realistic MSME XML through accounting parser', async () => {
    const xml = fs.readFileSync(SAMPLE_XML, 'utf8');
    const parsed = await parseTallyPrimeImportFile({
      filename: 'TallyPrime_Realistic_MSME_Export.xml',
      content: xml
    });

    const result = parserService.parseTransactions({
      provider: 'tally',
      transactions: parsed.transactions
    });

    expect(result.validRows.length).toBeGreaterThanOrEqual(7);
  });

  test('parses realistic MSME XLSX Day Book export rows', async () => {
    const buffer = fs.readFileSync(SAMPLE_XLSX);
    const parsed = await parseTallyPrimeImportFile({
      filename: 'TallyPrime_Realistic_MSME_Export.xlsx',
      buffer
    });

    expect(parsed.transactions.length).toBeGreaterThanOrEqual(7);
    const steel = parsed.transactions.find((row) => /steel/i.test(row.narration || ''));
    expect(steel).toEqual(expect.objectContaining({
      voucher_number: 'PUR/26-27/001',
      party_name: 'ABC Steel Suppliers',
      amount: '250000'
    }));
  });

  test('parses MSME 12-month training XLSX with voucher type and quantity', async () => {
    const buffer = fs.readFileSync(SAMPLE_MSME_XLSX);
    const parsed = await parseTallyPrimeImportFile({
      filename: 'MSME_12Month_Dataset_Training.xlsx',
      buffer
    });

    expect(parsed.transactions.length).toBeGreaterThanOrEqual(100);
    const electricity = parsed.transactions.find((row) => /electricity/i.test(row.voucher_type || ''));
    expect(electricity).toEqual(expect.objectContaining({
      voucher_number: expect.stringMatching(/^VCH/),
      amount: expect.any(String),
      quantity: expect.any(String),
      unit: 'kWh'
    }));
  });

  test('parses MSME dynamic descriptions XLSX', async () => {
    const buffer = fs.readFileSync(SAMPLE_MSME_DYNAMIC_XLSX);
    const parsed = await parseTallyPrimeImportFile({
      filename: 'MSME_12Month_Dataset_Training_DynamicDescriptions.xlsx',
      buffer
    });

    expect(parsed.transactions.length).toBeGreaterThanOrEqual(100);
    const diesel = parsed.transactions.find((row) => /diesel purchase/i.test(row.voucher_type || ''));
    expect(diesel).toEqual(expect.objectContaining({
      voucher_number: expect.stringMatching(/^VCH/),
      narration: expect.stringContaining('General Ledger')
    }));
  });

  test('parses TallyPrime Day Book PDF export text rows', () => {
    const sampleText = [
      'TallyPrime Day Book Export',
      'Date Voucher Type Voucher Number Party A/c Name Debit Amount Credit Amount Narration',
      '01-04-2026 Purchase PUR/26-27/001 ABC Steel Suppliers 250000 0 Steel coils purchased',
      '03-04-2026 Journal JRN/001 Karnataka Electricity Board 18500 0 Monthly electricity bill',
      '05-04-2026 Payment PAY/001 Indian Oil Corporation 42000 0 Diesel for DG set',
      '07-04-2026 Payroll SAL/001 Employees 375000 0 Monthly payroll',
      '10-04-2026 Sales SAL/26-27/001 XYZ Exports Ltd 0 850000 Export invoice'
    ].join('\n');

    const transactions = parseTallyPrimePdfText(sampleText);
    const detection = detectTallyPrimeImportFile({
      filename: 'Sample_MSME_TallyPrime_Transactions.pdf',
      content: sampleText
    });

    expect(detection.accepted).toBe(true);
    expect(detection.format).toBe('pdf');
    expect(transactions.length).toBeGreaterThanOrEqual(5);

    const electricity = transactions.find((row) => /electricity/i.test(row.narration || ''));
    expect(electricity).toEqual(expect.objectContaining({
      voucher_number: 'JRN/001',
      party_name: 'Karnataka Electricity Board',
      amount: '18500'
    }));
  });

  test('classifies TallyPrime sample transactions into emission categories', async () => {
    const buffer = fs.readFileSync(SAMPLE_XLSX);
    const parsed = await parseTallyPrimeImportFile({
      filename: 'TallyPrime_Realistic_MSME_Export.xlsx',
      buffer
    });

    const result = parserService.parseTransactions({
      provider: 'tally',
      transactions: parsed.transactions
    });

    expect(result.validRows.length).toBeGreaterThanOrEqual(7);

    const byDescription = (pattern) => result.validRows.find((row) => pattern.test(row.parsed.description || ''));

    expect(byDescription(/electricity/i)?.parsed.category).toBe('utilities');
    expect(byDescription(/electricity/i)?.parsed.subcategory).toBe('electricity_grid');
    expect(byDescription(/steel/i)?.parsed.category).toBe('raw_materials');
    expect(byDescription(/diesel/i)?.parsed.category).toBe('transportation');
    expect(byDescription(/water/i)?.parsed.category).toBe('utilities');
    expect(byDescription(/waste/i)?.parsed.category).toBe('waste_management');
    expect(byDescription(/chemical/i)?.parsed.category).toBe('raw_materials');
  });

  test('classifies MSME 12-month training transactions by voucher type', async () => {
    const buffer = fs.readFileSync(SAMPLE_MSME_XLSX);
    const parsed = await parseTallyPrimeImportFile({
      filename: 'MSME_12Month_Dataset_Training.xlsx',
      buffer
    });

    const result = parserService.parseTransactions({
      provider: 'tally',
      transactions: parsed.transactions.slice(0, 50)
    });

    expect(result.validRows.length).toBeGreaterThanOrEqual(40);

    const byVoucherType = (pattern) => result.validRows.find(
      (row) => pattern.test(row.original?.voucher_type || row.parsed.description || '')
    );

    expect(byVoucherType(/electricity charges/i)?.parsed.category).toBe('utilities');
    expect(byVoucherType(/diesel purchase/i)?.parsed.category).toBe('transportation');
    expect(byVoucherType(/raw material purchase/i)?.parsed.category).toBe('raw_materials');
    expect(byVoucherType(/logistics expense/i)?.parsed.category).toBe('transportation');
  });
});
