const { SECTOR_MODELS } = require('../services/sectorModelRegistry');

const TRANSACTION_TYPES = [
  'purchase',
  'sale',
  'expense',
  'utility',
  'transport',
  'investment'
];

const SENDER_POOL = [
  'BANK',
  'UPI',
  'PAYTM',
  'IMPS',
  'NEFT',
  'RAZORPAY',
  'STRIPE',
  'MSME',
  'CASH',
  'CARD'
];

const LOCATIONS = [
  'Mumbai',
  'Delhi',
  'Bengaluru',
  'Hyderabad',
  'Pune',
  'Ahmedabad',
  'Jaipur',
  'Chennai',
  'Kolkata',
  'Surat',
  'Noida',
  'Indore',
  'Nagpur',
  'Lucknow',
  'Coimbatore'
];

const COMPANY_TYPES = ['micro', 'small', 'medium'];

const CUSTOMER_POOL = [
  'ABC Traders',
  'Global Retail',
  'Prime Distributors',
  'Metro Mart',
  'Sunrise Exports',
  'Northwind Logistics',
  'Greenfield Supplies',
  'Omega Retail',
  'Harbor Foods',
  'BlueWave Imports'
];

const VENDOR_SUFFIXES = [
  'Suppliers',
  'Industries',
  'Distributors',
  'Enterprises',
  'Works',
  'Solutions',
  'Services',
  'Traders',
  'Manufacturing Co',
  'Logistics'
];

const UTILITY_KINDS = ['electricity', 'water', 'gas', 'internet'];

const DEFAULT_DETAILS = {
  purchase: ['raw materials', 'components', 'packaging'],
  sale: ['product sale', 'service billing'],
  expense: ['service charge', 'maintenance fees', 'facility expense'],
  utility: ['electricity', 'water', 'gas'],
  transport: ['freight', 'delivery', 'logistics'],
  investment: ['capital infusion', 'equity funding', 'loan disbursed']
};

const toLabel = (value) => String(value || '').replace(/_/g, ' ').trim();

const titleCase = (value) => toLabel(value).replace(/\b\w/g, (char) => char.toUpperCase());

const pickFrom = (list, index) => list[index % list.length];

const normalizeKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, '_');

const resolveSectorKeys = ({ sectorKey, sectorKeys } = {}) => {
  if (sectorKey) {
    return [normalizeKey(sectorKey)];
  }

  if (Array.isArray(sectorKeys) && sectorKeys.length > 0) {
    return sectorKeys.map(normalizeKey);
  }

  return Object.keys(SECTOR_MODELS);
};

const validateSectorKeys = (keys) => {
  const invalid = keys.filter((key) => !SECTOR_MODELS[key]);
  if (invalid.length > 0) {
    const available = Object.keys(SECTOR_MODELS).sort().join(', ');
    throw new Error(`Unknown sector key(s): ${invalid.join(', ')}. Available sectors: ${available}`);
  }
  return keys;
};

const resolveTransactionTypes = (transactionTypes) => {
  if (!transactionTypes || transactionTypes.length === 0) {
    return TRANSACTION_TYPES;
  }

  const normalized = transactionTypes.map((type) => String(type || '').trim().toLowerCase()).filter(Boolean);
  const invalid = normalized.filter((type) => !TRANSACTION_TYPES.includes(type));
  if (invalid.length > 0) {
    throw new Error(`Unknown transaction type(s): ${invalid.join(', ')}. Allowed: ${TRANSACTION_TYPES.join(', ')}`);
  }
  return normalized;
};

const buildMessageBody = ({
  transactionType,
  amount,
  vendor,
  customer,
  detailLabel,
  processLabel,
  machineryLabel,
  location,
  sectorLabel,
  outputLabel,
  utilityKind
}) => {
  switch (transactionType) {
    case 'purchase':
      return `Rs. ${amount} paid to ${vendor} for ${detailLabel} purchase order for ${processLabel} process at ${location}.`;
    case 'sale':
      return `Rs. ${amount} received payment from ${customer} for ${outputLabel}.`;
    case 'expense':
      return `Rs. ${amount} service charge for ${machineryLabel} maintenance at ${location}.`;
    case 'utility': {
      const utilityLabel = utilityKind === 'electricity'
        ? 'electricity bill'
        : `${utilityKind} bill`;
      return `Utility ${utilityLabel} of Rs. ${amount} for ${processLabel} unit at ${location}.`;
    }
    case 'transport':
      return `Freight charges Rs. ${amount} for ${detailLabel} transport from ${location} supporting ${processLabel} operations.`;
    case 'investment':
      return `Equity investment of Rs. ${amount} received for ${sectorLabel} expansion of ${processLabel} line.`;
    default:
      return `Rs. ${amount} transaction recorded for ${processLabel} at ${location}.`;
  }
};

const buildMsmeProfile = (sectorKey, sector, index) => {
  const products = (sector.outputs && sector.outputs.length > 0)
    ? sector.outputs
    : (sector.inputs && sector.inputs.length > 0 ? sector.inputs : ['general']);

  return {
    businessDomain: sectorKey,
    industry: sector.label,
    companyType: COMPANY_TYPES[index % COMPANY_TYPES.length],
    business: {
      primaryProducts: products.slice(0, 2),
      manufacturingUnits: (index % 4) + 1
    }
  };
};

const generateMsmeSmsTestData = ({
  totalMessages = 10000,
  startDate = new Date('2024-01-01T08:00:00Z'),
  sectorKey,
  sectorKeys,
  transactionTypes,
  useSingleProfile = false,
  msmeProfile
} = {}) => {
  const resolvedSectorKeys = validateSectorKeys(resolveSectorKeys({ sectorKey, sectorKeys }));
  const resolvedTransactionTypes = resolveTransactionTypes(transactionTypes);

  if (useSingleProfile && resolvedSectorKeys.length > 1 && !msmeProfile) {
    throw new Error('useSingleProfile requires a single sector key unless msmeProfile is provided');
  }

  const summary = {
    totalMessages,
    sectorKeys: resolvedSectorKeys,
    transactionTypes: resolvedTransactionTypes,
    sectorCounts: {},
    transactionTypeCounts: {},
    processCounts: {}
  };
  const messages = [];
  const fixedProfile = msmeProfile
    || (useSingleProfile
      ? buildMsmeProfile(resolvedSectorKeys[0], SECTOR_MODELS[resolvedSectorKeys[0]], 0)
      : null);

  for (let index = 0; index < totalMessages; index += 1) {
    const resolvedSectorKey = resolvedSectorKeys[index % resolvedSectorKeys.length];
    const sector = SECTOR_MODELS[resolvedSectorKey];
    const transactionType = resolvedTransactionTypes[
      Math.floor(index / resolvedSectorKeys.length) % resolvedTransactionTypes.length
    ];

    const processList = (sector.processes && sector.processes.length > 0)
      ? sector.processes
      : ['operations'];
    const process = processList[index % processList.length];

    const machineryList = (sector.machinery && sector.machinery.length > 0)
      ? sector.machinery
      : ['equipment'];
    const machinery = pickFrom(machineryList, index);

    const detailList = (sector.transactionTypes
      && sector.transactionTypes[transactionType]
      && sector.transactionTypes[transactionType].length > 0)
      ? sector.transactionTypes[transactionType]
      : DEFAULT_DETAILS[transactionType];
    const detail = pickFrom(detailList, index);

    const outputList = (sector.outputs && sector.outputs.length > 0)
      ? sector.outputs
      : ['services'];
    const outputLabel = toLabel(pickFrom(outputList, index));

    const amount = 500 + ((index * 37) % 9500);
    const location = pickFrom(LOCATIONS, index);
    const sender = pickFrom(SENDER_POOL, index);
    const vendor = `${sector.label} ${pickFrom(VENDOR_SUFFIXES, index)}`;
    const customer = pickFrom(CUSTOMER_POOL, index);
    const utilityKind = pickFrom(UTILITY_KINDS, index);

    const body = buildMessageBody({
      transactionType,
      amount,
      vendor: titleCase(vendor),
      customer,
      detailLabel: toLabel(detail),
      processLabel: toLabel(process),
      machineryLabel: toLabel(machinery),
      location,
      sectorLabel: sector.label,
      outputLabel,
      utilityKind
    });

    const messageId = `msme_sms_${String(index + 1).padStart(5, '0')}`;
    const timestamp = new Date(startDate.getTime() + index * 60000).toISOString();

    const resolvedProfile = fixedProfile || buildMsmeProfile(resolvedSectorKey, sector, index);

    messages.push({
      body,
      sender,
      timestamp,
      messageId,
      msmeProfile: resolvedProfile,
      metadata: {
        sector: resolvedSectorKey,
        process,
        machinery,
        transactionType,
        detail: detail,
        amount,
        location
      }
    });

    summary.sectorCounts[resolvedSectorKey] = (summary.sectorCounts[resolvedSectorKey] || 0) + 1;
    summary.transactionTypeCounts[transactionType] = (summary.transactionTypeCounts[transactionType] || 0) + 1;
    summary.processCounts[resolvedSectorKey] = summary.processCounts[resolvedSectorKey] || {};
    summary.processCounts[resolvedSectorKey][process] = (summary.processCounts[resolvedSectorKey][process] || 0) + 1;
  }

  return {
    messages,
    summary
  };
};

module.exports = {
  TRANSACTION_TYPES,
  generateMsmeSmsTestData
};
