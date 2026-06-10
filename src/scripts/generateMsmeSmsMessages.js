const fs = require('fs');
const path = require('path');

const { generateMsmeSmsTestData, TRANSACTION_TYPES } = require('../utils/smsTestDataGenerator');
const { SECTOR_MODELS } = require('../services/sectorModelRegistry');

const DEFAULT_TOTAL = 10000;
const DEFAULT_SECTOR = 'manufacturing';

const normalizeKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, '_');

const listSectors = () => Object.values(SECTOR_MODELS)
  .map((sector) => `${sector.key} (${sector.label})`)
  .sort()
  .join(', ');

const resolveSectorKey = (value) => {
  if (!value) return null;
  const normalized = normalizeKey(value);
  if (SECTOR_MODELS[normalized]) return normalized;

  const labelMatch = Object.values(SECTOR_MODELS).find((sector) => (
    sector.label.toLowerCase() === String(value).trim().toLowerCase()
  ));
  return labelMatch ? labelMatch.key : null;
};

const parseArgs = (argv) => {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--sector') {
      options.sector = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--sector=')) {
      options.sector = arg.split('=').slice(1).join('=');
    } else if (arg === '--total') {
      options.total = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--total=')) {
      options.total = arg.split('=').slice(1).join('=');
    } else if (arg === '--output') {
      options.output = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = arg.split('=').slice(1).join('=');
    } else if (arg === '--transaction-types') {
      options.transactionTypes = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--transaction-types=')) {
      options.transactionTypes = arg.split('=').slice(1).join('=');
    } else if (arg === '--single-profile') {
      options.singleProfile = true;
    } else if (arg === '--multi-profile') {
      options.singleProfile = false;
    } else if (arg === '--pretty') {
      options.pretty = true;
    } else if (arg === '--no-pretty') {
      options.pretty = false;
    }
  }
  return options;
};

const printHelp = () => {
  /* eslint-disable no-console */
  console.log(`
Generate MSME SMS test messages.

Usage:
  node src/scripts/generateMsmeSmsMessages.js --sector textiles --total 10000

Options:
  --sector <key|label>         MSME sector key/label (default: ${DEFAULT_SECTOR})
  --total <count>              Number of messages (default: ${DEFAULT_TOTAL})
  --output <path>              Output JSON file path
  --transaction-types <list>   Comma-separated types (${TRANSACTION_TYPES.join(', ')})
  --single-profile             Use one MSME profile for all messages (default)
  --multi-profile              Vary MSME profile across messages
  --pretty                     Pretty-print JSON output
  --help, -h                   Show this help text

Available sectors:
  ${listSectors()}
  `.trim());
  /* eslint-enable no-console */
};

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const sectorInput = options.sector || DEFAULT_SECTOR;
const sectorKey = resolveSectorKey(sectorInput);
if (!sectorKey) {
  /* eslint-disable no-console */
  console.error(`Unknown sector: "${sectorInput}".`);
  console.error(`Available sectors: ${listSectors()}`);
  /* eslint-enable no-console */
  process.exit(1);
}

const totalMessages = Number.parseInt(options.total || DEFAULT_TOTAL, 10);
if (!Number.isFinite(totalMessages) || totalMessages <= 0) {
  /* eslint-disable no-console */
  console.error(`Invalid total count: "${options.total}". Must be a positive integer.`);
  /* eslint-enable no-console */
  process.exit(1);
}

const transactionTypes = options.transactionTypes
  ? options.transactionTypes.split(',').map((type) => type.trim()).filter(Boolean)
  : undefined;
const useSingleProfile = options.singleProfile !== undefined ? options.singleProfile : true;

const { messages, summary } = generateMsmeSmsTestData({
  totalMessages,
  sectorKey,
  transactionTypes,
  useSingleProfile
});

const payload = {
  generatedAt: new Date().toISOString(),
  sector: sectorKey,
  totalMessages,
  summary,
  messages
};

const defaultOutput = path.resolve(__dirname, '../../data', `msme_sms_${sectorKey}_${totalMessages}.json`);
const outputPath = options.output ? path.resolve(process.cwd(), options.output) : defaultOutput;
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(payload, null, options.pretty ? 2 : 0));

/* eslint-disable no-console */
console.log(`Generated ${messages.length} messages for sector "${sectorKey}".`);
console.log(`Output file: ${outputPath}`);
console.log(`Transaction types: ${summary.transactionTypes.join(', ')}`);
/* eslint-enable no-console */
