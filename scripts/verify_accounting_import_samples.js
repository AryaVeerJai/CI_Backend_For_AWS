#!/usr/bin/env node
/**
 * Verifies Data → Data connectors → Import files against bundled sample exports.
 * Parses each sample, normalizes rows, and writes a JSON summary report.
 */
const fs = require('fs');
const path = require('path');
const { parseTallyPrimeImportFile } = require('../src/services/connectors/tallyPrimeImportParser');
const { parseZohoBooksImportFile } = require('../src/services/connectors/zohoBooksImportParser');
const {
  parseProviderImportFile
} = require('../src/services/connectors/providerSpecificImportParser');
const { parseTransactions } = require('../src/services/accountingTransactionParserService');

const SAMPLE_ROOT = path.join(__dirname, '../../ai-model/data/DataConnectors/Import');
const REPORT_PATH = path.join(__dirname, '../../artifacts/accounting_import_verification_report.json');

const PROVIDER_FILE_MAP = {
  busy: 'ProviderSpecific/Busy_Accounting_ProviderSpecific.xlsx',
  marg: 'ProviderSpecific/Marg_ERP_ProviderSpecific.xlsx',
  vyapar: 'ProviderSpecific/Vyapar_ProviderSpecific.xlsx',
  mybillbook: 'ProviderSpecific/myBillBook_ProviderSpecific.xlsx',
  khatabook: 'ProviderSpecific/Khatabook_ProviderSpecific.xlsx',
  quickbooks: 'ProviderSpecific/QuickBooks_ProviderSpecific.xlsx',
  erpnext: 'ProviderSpecific/ERPNext_ProviderSpecific.xlsx',
  odoo: 'ProviderSpecific/Odoo_ProviderSpecific.xlsx',
  clear: 'ProviderSpecific/Clear_ProviderSpecific.xlsx',
  profitbooks: 'ProviderSpecific/ProfitBooks_ProviderSpecific.xlsx',
  hostbooks: 'ProviderSpecific/HostBooks_ProviderSpecific.xlsx'
};

const CORE_CASES = [
  { provider: 'tally', label: 'TallyPrime XML', file: 'TallyPrime/TallyPrime_Realistic_MSME_Export.xml' },
  { provider: 'tally', label: 'TallyPrime XLSX', file: 'TallyPrime/TallyPrime_Realistic_MSME_Export.xlsx' },
  { provider: 'zoho', label: 'Zoho Books CSV', file: 'ZohoBooks/ZohoBooks_12Month_Realistic_Export.csv' },
  ...Object.entries(PROVIDER_FILE_MAP).map(([provider, file]) => ({ provider, label: provider, file }))
];

async function parseSample({ provider, file }) {
  const absolutePath = path.join(SAMPLE_ROOT, file);
  const filename = path.basename(absolutePath);
  const loweredName = filename.toLowerCase();
  const isBinarySpreadsheet = loweredName.endsWith('.xlsx') || loweredName.endsWith('.xls');
  const isPdf = loweredName.endsWith('.pdf');
  const buffer = fs.readFileSync(absolutePath);

  if (provider === 'tally') {
    return parseTallyPrimeImportFile({
      filename,
      content: isBinarySpreadsheet || isPdf ? null : buffer.toString('utf8'),
      buffer: isBinarySpreadsheet || isPdf ? buffer : null
    });
  }

  if (provider === 'zoho') {
    return parseZohoBooksImportFile({
      filename,
      content: isBinarySpreadsheet || isPdf ? null : buffer.toString('utf8'),
      buffer: isBinarySpreadsheet || isPdf ? buffer : null
    });
  }

  return parseProviderImportFile({
    provider,
    filename,
    content: isBinarySpreadsheet || isPdf ? null : buffer.toString('utf8'),
    buffer: isBinarySpreadsheet || isPdf ? buffer : null
  });
}

async function main() {
  const results = [];
  let failures = 0;

  for (const sampleCase of CORE_CASES) {
    const entry = {
      provider: sampleCase.provider,
      label: sampleCase.label,
      file: sampleCase.file,
      ok: false
    };

    try {
      const parsedFile = await parseSample(sampleCase);
      entry.detectionAccepted = Boolean(parsedFile.detection?.accepted);
      entry.transactionCount = Array.isArray(parsedFile.transactions) ? parsedFile.transactions.length : 0;

      if (!entry.detectionAccepted) {
        entry.error = 'Export keyword detection failed';
        failures += 1;
      } else if (entry.transactionCount === 0) {
        entry.error = 'No transactions parsed from sample file';
        failures += 1;
      } else {
        const normalized = parseTransactions({
          provider: sampleCase.provider,
          transactions: parsedFile.transactions.slice(0, 25)
        });
        entry.validRows = normalized.validRows.length;
        entry.invalidRows = normalized.invalidRows.length;
        entry.ok = entry.validRows > 0;
        if (!entry.ok) {
          entry.error = 'No valid rows after normalization';
          failures += 1;
        }
      }
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      failures += 1;
    }

    results.push(entry);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sampleRoot: SAMPLE_ROOT,
    totalSamples: results.length,
    passed: results.filter((row) => row.ok).length,
    failed: failures,
    results
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // eslint-disable-next-line no-console
  console.log(`Accounting import verification: ${report.passed}/${report.totalSamples} passed`);
  // eslint-disable-next-line no-console
  console.log(`Report written to ${REPORT_PATH}`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
