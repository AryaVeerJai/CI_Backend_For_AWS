const { getConnectorById, getFieldMapForProvider } = require('./accountingConnectorRegistry');

const DEFAULT_CATEGORY = 'other';
const DEFAULT_CURRENCY = 'INR';
const DEFAULT_TRANSACTION_TYPE = 'expense';

const INCOME_TYPE_VALUES = new Set([
  'income',
  'sale',
  'sales',
  'receipt',
  'credit',
  'customer_payment',
  'payment_received',
  'in_invoice',
  'out_refund'
]);

const CATEGORY_SUBCATEGORY_MAPPINGS = [
  {
    category: 'utilities',
    subcategory: 'electricity_grid',
    keywords: [
      'electricity',
      'power bill',
      'electricity bill',
      'state electricity board',
      'electricity charges',
      'monthly electricity bill',
      'karnataka electricity board',
      'mseb',
      'bescom',
      'discom'
    ]
  },
  {
    category: 'utilities',
    subcategory: 'water_supply',
    keywords: [
      'water bill',
      'water tanker',
      'water supply',
      'water charges',
      'factory water bill',
      'water board',
      'jal board'
    ]
  },
  {
    category: 'utilities',
    subcategory: 'telecom_internet',
    keywords: ['internet', 'broadband', 'telecom', 'mobile recharge']
  },
  {
    category: 'transportation',
    subcategory: 'freight_logistics',
    keywords: ['freight', 'transport', 'logistics', 'shipment', 'courier']
  },
  {
    category: 'transportation',
    subcategory: 'fuel_diesel',
    keywords: [
      'diesel',
      'hsd',
      'fleet diesel',
      'fuel expense',
      'diesel for dg set',
      'dg set',
      'indian oil',
      'bharat petroleum',
      'hp petrol'
    ]
  },
  {
    category: 'transportation',
    subcategory: 'fuel_petrol',
    keywords: ['petrol', 'gasoline']
  },
  {
    category: 'raw_materials',
    subcategory: 'metals',
    keywords: [
      'raw material',
      'steel',
      'iron',
      'aluminium',
      'copper',
      'steel coils',
      'steel suppliers',
      'raw material purchase'
    ]
  },
  {
    category: 'raw_materials',
    subcategory: 'textiles_inputs',
    keywords: ['fabric', 'yarn', 'thread', 'cotton']
  },
  {
    category: 'raw_materials',
    subcategory: 'chemical_inputs',
    keywords: [
      'chemical',
      'solvent',
      'resin',
      'polymer',
      'production chemicals',
      'consumables purchase',
      'chemical supplier'
    ]
  },
  {
    category: 'equipment',
    subcategory: 'machinery_capex',
    keywords: ['machine', 'equipment', 'compressor', 'generator', 'boiler']
  },
  {
    category: 'maintenance',
    subcategory: 'amc_service',
    keywords: ['repair', 'service', 'maintenance', 'amc']
  },
  {
    category: 'energy',
    subcategory: 'fossil_fuel',
    keywords: ['gas', 'lpg', 'cng', 'coal', 'furnace oil']
  },
  {
    category: 'waste_management',
    subcategory: 'recycling_disposal',
    keywords: [
      'waste',
      'scrap disposal',
      'recycling',
      'hazardous disposal',
      'hazardous waste',
      'waste disposal',
      'waste handling',
      'waste disposal expense'
    ]
  }
];

const EXPORT_CATEGORY_ALIASES = {
  fuel: { category: 'transportation', subcategory: 'fuel_diesel' },
  logistics: { category: 'transportation', subcategory: 'freight_logistics' },
  revenue: { category: 'other', subcategory: 'general' },
  payroll: { category: 'other', subcategory: 'general' },
  other_purchases: { category: 'other', subcategory: 'general' }
};

const toStringValue = (value) => (value == null ? '' : String(value).trim());

const getNestedValue = (row, path) => {
  if (!path.includes('.')) {
    return row[path];
  }

  return path.split('.').reduce((current, key) => {
    if (current == null) return undefined;
    return current[key];
  }, row);
};

const pickFirst = (row, keys = []) => {
  for (const key of keys) {
    const value = getNestedValue(row, key);
    if (value != null && toStringValue(value) !== '') {
      return value;
    }
  }
  return null;
};

const parseAmount = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value);
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed)) {
      return Math.abs(parsed);
    }
  }

  return null;
};

const parseDateValue = (value) => {
  if (!value) return null;

  const raw = toStringValue(value);
  if (!raw) return null;

  const ddMmYyyy = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (ddMmYyyy) {
    const parsed = new Date(`${ddMmYyyy[3]}-${ddMmYyyy[2]}-${ddMmYyyy[1]}`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const tallyDate = raw.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (tallyDate) {
    const parsed = new Date(`${tallyDate[3]}-${tallyDate[2]}-${tallyDate[1]}`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const parsedDate = new Date(raw);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }
  return parsedDate;
};

const buildClassificationText = (...parts) => parts
  .map((part) => toStringValue(part))
  .filter(Boolean)
  .join(' ')
  .toLowerCase();

const inferCategoryDetails = (description, fallbackCategory, fallbackSubcategory, contextText = '') => {
  const directCategory = toStringValue(fallbackCategory).toLowerCase();
  const directSubcategory = toStringValue(fallbackSubcategory).toLowerCase();
  if (directCategory) {
    const normalizedCategory = directCategory.replace(/\s+/g, '_');
    const alias = EXPORT_CATEGORY_ALIASES[normalizedCategory];
    if (alias) {
      return {
        category: alias.category,
        subcategory: alias.subcategory,
        confidence: 0.98,
        matchedKeywords: []
      };
    }
    const allowed = [
      'raw_materials',
      'energy',
      'transportation',
      'waste_management',
      'water',
      'equipment',
      'maintenance',
      'utilities',
      'other'
    ];
    if (allowed.includes(normalizedCategory)) {
      return {
        category: normalizedCategory,
        subcategory: directSubcategory || 'general',
        confidence: 0.98,
        matchedKeywords: []
      };
    }
  }

  const descriptionText = buildClassificationText(description);
  const contextOnlyText = buildClassificationText(contextText);
  const combinedText = buildClassificationText(description, contextText);

  const scoreMapping = (mapping, sourceText, sourceWeight) => {
    const matchedKeywords = mapping.keywords.filter((keyword) => sourceText.includes(keyword));
    if (matchedKeywords.length === 0) {
      return null;
    }
    return {
      ...mapping,
      matchedKeywords,
      matchScore: sourceWeight + Math.max(...matchedKeywords.map((keyword) => keyword.length))
    };
  };

  const matches = CATEGORY_SUBCATEGORY_MAPPINGS
    .flatMap((mapping) => ([
      scoreMapping(mapping, descriptionText, 100),
      scoreMapping(mapping, contextOnlyText, 10),
      scoreMapping(mapping, combinedText, 1)
    ]))
    .filter(Boolean)
    .sort((left, right) => right.matchScore - left.matchScore);

  const matched = matches[0];
  if (matched) {
    return {
      category: matched.category,
      subcategory: directSubcategory || matched.subcategory,
      confidence: directSubcategory ? 0.95 : 0.9,
      matchedKeywords: matched.matchedKeywords
    };
  }

  return {
    category: DEFAULT_CATEGORY,
    subcategory: directSubcategory || 'general',
    confidence: directSubcategory ? 0.8 : 0.65,
    matchedKeywords: []
  };
};

const inferTransactionType = ({ amount, explicitType, voucherType, isCredit }) => {
  const normalizedExplicitType = toStringValue(explicitType).toLowerCase();
  if (['purchase', 'sale', 'expense', 'investment', 'utility', 'transport', 'other'].includes(normalizedExplicitType)) {
    return normalizedExplicitType;
  }

  if (INCOME_TYPE_VALUES.has(normalizedExplicitType)) {
    return 'sale';
  }

  const normalizedVoucherType = toStringValue(voucherType).toLowerCase();
  if (normalizedVoucherType.includes('purchase')) return 'purchase';
  if (normalizedVoucherType.includes('sales') || normalizedVoucherType.includes('sale')) return 'sale';
  if (normalizedVoucherType.includes('expense')) return 'expense';
  if (normalizedVoucherType.includes('utility')) return 'utility';
  if (normalizedVoucherType.includes('transport')) return 'transport';
  if (normalizedVoucherType.includes('receipt') || normalizedVoucherType.includes('payment_received')) {
    return 'sale';
  }

  if (isCredit === true) return 'sale';
  if (typeof amount === 'number' && amount < 0) return 'sale';
  return DEFAULT_TRANSACTION_TYPE;
};

const buildSourceId = (provider, row, index, sourceIdKeys = []) => {
  const candidateKeys = sourceIdKeys.length > 0
    ? sourceIdKeys
    : ['id', 'transaction_id', 'transactionId', 'voucher_number', 'voucherNumber', 'reference', 'refNo'];
  const selected = candidateKeys.map((key) => toStringValue(getNestedValue(row, key))).find(Boolean);
  if (selected) return `${provider}_${selected}`;
  return `${provider}_${Date.now()}_${index}`;
};

const resolveIsCredit = (row, fieldMap) => {
  const typeValue = toStringValue(pickFirst(row, fieldMap.transactionType || [])).toLowerCase();
  if (INCOME_TYPE_VALUES.has(typeValue)) {
    return true;
  }

  if (Array.isArray(fieldMap.incomeTypes)) {
    if (fieldMap.incomeTypes.some((incomeType) => typeValue === incomeType)) {
      return true;
    }
  }

  if (fieldMap.creditField && row[fieldMap.creditField] != null) {
    return true;
  }

  if (fieldMap.creditIndicator) {
    const { field, debitField } = fieldMap.creditIndicator;
    if (row[field] != null && (debitField == null || row[debitField] == null)) {
      return true;
    }
  }

  return false;
};

const normalizeAccountingRecord = (provider, row, index) => {
  const fieldMap = getFieldMapForProvider(provider);
  if (!fieldMap) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const amountRaw = pickFirst(row, fieldMap.amount);
  const amount = parseAmount(amountRaw);
  const isCredit = resolveIsCredit(row, fieldMap);
  const date = parseDateValue(pickFirst(row, fieldMap.date));
  const description = toStringValue(pickFirst(row, fieldMap.description));
  const vendorName = toStringValue(pickFirst(row, fieldMap.vendor));
  const ledgerName = toStringValue(pickFirst(row, fieldMap.ledger || []));
  const classificationText = buildClassificationText(description, vendorName, ledgerName);
  const categoryDetails = inferCategoryDetails(
    description,
    pickFirst(row, fieldMap.category),
    pickFirst(row, fieldMap.subcategory),
    classificationText
  );

  const connector = getConnectorById(provider);
  const displayName = connector?.name || provider.charAt(0).toUpperCase() + provider.slice(1);

  return {
    source: provider,
    sourceId: buildSourceId(provider, row, index, fieldMap.sourceIdKeys),
    transactionType: inferTransactionType({
      amount: typeof amountRaw === 'number' ? amountRaw : null,
      explicitType: pickFirst(row, fieldMap.transactionType),
      voucherType: pickFirst(row, fieldMap.voucherType),
      isCredit
    }),
    amount,
    currency: toStringValue(pickFirst(row, fieldMap.currency)) || DEFAULT_CURRENCY,
    description: description || ledgerName || `${displayName} transaction ${index + 1}`,
    vendor: {
      name: vendorName || 'Unknown Vendor'
    },
    category: categoryDetails.category,
    subcategory: categoryDetails.subcategory,
    date,
    metadata: {
      extractedData: row,
      accountingProvider: provider,
      accountingProviderDisplayName: displayName,
      confidence: 0.85,
      classification: categoryDetails
    }
  };
};

module.exports = {
  normalizeAccountingRecord,
  inferCategoryDetails,
  parseAmount,
  parseDateValue
};
