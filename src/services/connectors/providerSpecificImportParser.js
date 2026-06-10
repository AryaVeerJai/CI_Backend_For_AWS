const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');
const { getFieldMapForProvider, resolveProviderId } = require('./accountingConnectorRegistry');

/**
 * Provider-specific import configs derived from Provider_Specific_Accounting_Exports.zip
 * and accountingConnectorRegistry field maps.
 */
const PROVIDER_IMPORT_CONFIGS = {
  busy: {
    productName: 'Busy Accounting',
    keywords: [
      'busy accounting',
      'busy infotech',
      'voucher type',
      'voucher no',
      'party name',
      'ledger',
      'narration',
      'gst %',
      'busy export',
      'vchdate',
      'vchno',
      'partyname'
    ],
    expectedHeaders: [
      'date',
      'voucher type',
      'voucher no',
      'party name',
      'ledger',
      'amount',
      'gst %',
      'narration'
    ],
    rowMap: {
      date: ['Date', 'date', 'VchDate'],
      description: ['Narration', 'narration', 'Description'],
      vendor: ['Party Name', 'party name', 'PartyName'],
      amount: ['Amount', 'amount', 'Debit', 'Credit'],
      voucherType: ['Voucher Type', 'voucher type', 'VchType'],
      reference: ['Voucher No', 'voucher no', 'VchNo']
    }
  },
  marg: {
    productName: 'Marg ERP',
    keywords: [
      'marg erp',
      'marg compusoft',
      'doc type',
      'doc no',
      'customer/vendor',
      'supplier_name',
      'bill_no',
      'net_amount',
      'marg export'
    ],
    expectedHeaders: [
      'date',
      'doc type',
      'doc no',
      'customer/vendor',
      'item',
      'qty',
      'tax',
      'amount'
    ],
    rowMap: {
      date: ['Date', 'date', 'bill_date'],
      description: ['Item', 'item', 'product_name', 'narration'],
      vendor: ['Customer/Vendor', 'customer/vendor', 'supplier_name'],
      amount: ['Amount', 'amount', 'net_amount'],
      voucherType: ['Doc Type', 'doc type'],
      reference: ['Doc No', 'doc no', 'bill_no']
    }
  },
  vyapar: {
    productName: 'Vyapar',
    keywords: [
      'vyapar',
      'simply vyapar',
      'invoice type',
      'invoice no',
      'party',
      'category',
      'vyapar export',
      'transaction report'
    ],
    expectedHeaders: [
      'date',
      'invoice type',
      'invoice no',
      'party',
      'category',
      'amount',
      'gst',
      'description'
    ],
    rowMap: {
      date: ['Date', 'date', 'transaction_date'],
      description: ['Description', 'description', 'notes'],
      vendor: ['Party', 'party', 'party_name'],
      amount: ['Amount', 'amount', 'total'],
      voucherType: ['Invoice Type', 'invoice type'],
      reference: ['Invoice No', 'invoice no'],
      category: ['Category', 'category']
    }
  },
  mybillbook: {
    productName: 'myBillBook',
    keywords: [
      'mybillbook',
      'flobiz',
      'bill type',
      'bill no',
      'party name',
      'item name',
      'notes',
      'mybillbook export',
      'invoice_date'
    ],
    expectedHeaders: [
      'date',
      'bill type',
      'bill no',
      'party name',
      'item name',
      'amount',
      'gst',
      'notes'
    ],
    rowMap: {
      date: ['Date', 'date', 'invoice_date'],
      description: ['Notes', 'notes', 'description', 'Item Name'],
      vendor: ['Party Name', 'party name', 'vendor_name'],
      amount: ['Amount', 'amount', 'total_amount'],
      voucherType: ['Bill Type', 'bill type'],
      reference: ['Bill No', 'bill no', 'invoice_number']
    }
  },
  khatabook: {
    productName: 'Khatabook',
    keywords: [
      'khatabook',
      'entry type',
      'entry no',
      'customer',
      'debit',
      'credit',
      'remarks',
      'khatabook export',
      'ledger entry'
    ],
    expectedHeaders: [
      'date',
      'entry type',
      'entry no',
      'customer',
      'debit',
      'credit',
      'remarks'
    ],
    rowMap: {
      date: ['Date', 'date', 'entry_date'],
      description: ['Remarks', 'remarks', 'note', 'description'],
      vendor: ['Customer', 'customer', 'contact_name'],
      amount: ['Debit', 'debit', 'Credit', 'credit', 'amount'],
      voucherType: ['Entry Type', 'entry type'],
      reference: ['Entry No', 'entry no', 'entry_id']
    }
  },
  quickbooks: {
    productName: 'QuickBooks',
    keywords: [
      'quickbooks',
      'intuit',
      'txn type',
      'txn id',
      'customer/vendor',
      'tax code',
      'memo',
      'quickbooks export',
      'txndate',
      'totalamt'
    ],
    expectedHeaders: [
      'date',
      'txn type',
      'txn id',
      'customer/vendor',
      'account',
      'amount',
      'tax code',
      'memo'
    ],
    rowMap: {
      date: ['Date', 'date', 'TxnDate'],
      description: ['Memo', 'memo', 'PrivateNote', 'description'],
      vendor: ['Customer/Vendor', 'customer/vendor'],
      amount: ['Amount', 'amount', 'TotalAmt'],
      voucherType: ['Txn Type', 'txn type', 'TxnType'],
      reference: ['Txn ID', 'txn id', 'Id']
    }
  },
  erpnext: {
    productName: 'ERPNext',
    keywords: [
      'erpnext',
      'frappe',
      'voucher type',
      'voucher no',
      'cost center',
      'posting_date',
      'erpnext export',
      'gl entry',
      'payment entry'
    ],
    expectedHeaders: [
      'date',
      'voucher type',
      'voucher no',
      'party',
      'cost center',
      'debit',
      'credit',
      'remarks'
    ],
    rowMap: {
      date: ['Date', 'date', 'posting_date'],
      description: ['Remarks', 'remarks', 'description', 'title'],
      vendor: ['Party', 'party', 'party_name'],
      amount: ['Debit', 'debit', 'Credit', 'credit', 'paid_amount'],
      voucherType: ['Voucher Type', 'voucher type'],
      reference: ['Voucher No', 'voucher no', 'name']
    }
  },
  odoo: {
    productName: 'Odoo',
    keywords: [
      'odoo',
      'odoo accounting',
      'journal',
      'entry no',
      'partner',
      'account',
      'label',
      'odoo export',
      'journal entry',
      'move_type'
    ],
    expectedHeaders: [
      'date',
      'journal',
      'entry no',
      'partner',
      'account',
      'debit',
      'credit',
      'label'
    ],
    rowMap: {
      date: ['Date', 'date', 'invoice_date'],
      description: ['Label', 'label', 'name', 'ref'],
      vendor: ['Partner', 'partner', 'partner_name'],
      amount: ['Debit', 'debit', 'Credit', 'credit', 'amount'],
      voucherType: ['Journal', 'journal'],
      reference: ['Entry No', 'entry no', 'name']
    }
  },
  clear: {
    productName: 'Clear',
    keywords: [
      'clear',
      'cleartax',
      'document type',
      'document no',
      'gstin',
      'taxable value',
      'gst amount',
      'total value',
      'clear export',
      'txndate'
    ],
    expectedHeaders: [
      'date',
      'document type',
      'document no',
      'gstin',
      'taxable value',
      'gst amount',
      'total value'
    ],
    rowMap: {
      date: ['Date', 'date', 'txnDate'],
      description: ['Document Type', 'document type', 'description'],
      vendor: ['GSTIN', 'gstin', 'partyName'],
      amount: ['Total Value', 'total value', 'amount', 'Taxable Value'],
      voucherType: ['Document Type', 'document type'],
      reference: ['Document No', 'document no', 'transactionId']
    }
  },
  profitbooks: {
    productName: 'ProfitBooks',
    keywords: [
      'profitbooks',
      'transaction type',
      'reference',
      'contact',
      'category',
      'profitbooks export',
      'voucher_date',
      'narration'
    ],
    expectedHeaders: [
      'date',
      'transaction type',
      'reference',
      'contact',
      'category',
      'amount',
      'description'
    ],
    rowMap: {
      date: ['Date', 'date', 'voucher_date'],
      description: ['Description', 'description', 'narration'],
      vendor: ['Contact', 'contact', 'party_name'],
      amount: ['Amount', 'amount', 'debit', 'credit'],
      voucherType: ['Transaction Type', 'transaction type'],
      reference: ['Reference', 'reference', 'voucher_no'],
      category: ['Category', 'category']
    }
  },
  hostbooks: {
    productName: 'HostBooks',
    keywords: [
      'hostbooks',
      'voucher',
      'reference no',
      'party',
      'ledger',
      'narration',
      'hostbooks export',
      'transaction_date',
      'payee'
    ],
    expectedHeaders: [
      'date',
      'voucher',
      'reference no',
      'party',
      'ledger',
      'amount',
      'gst',
      'narration'
    ],
    rowMap: {
      date: ['Date', 'date', 'transaction_date'],
      description: ['Narration', 'narration', 'description'],
      vendor: ['Party', 'party', 'payee'],
      amount: ['Amount', 'amount', 'debit', 'credit'],
      voucherType: ['Voucher', 'voucher'],
      reference: ['Reference No', 'reference no', 'reference']
    }
  }
};

const SUPPORTED_PROVIDER_IMPORT_IDS = Object.keys(PROVIDER_IMPORT_CONFIGS);

const normalizeProbeText = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

const normalizeRowKeys = (row = {}) => {
  const normalized = {};
  Object.entries(row).forEach(([key, value]) => {
    normalized[String(key).trim()] = value;
  });
  return normalized;
};

const pickField = (row, candidates = []) => {
  const normalized = normalizeRowKeys(row);
  const lowered = Object.fromEntries(
    Object.entries(normalized).map(([key, value]) => [normalizeProbeText(key), value])
  );

  for (const candidate of candidates) {
    const direct = normalized[candidate];
    if (direct != null && String(direct).trim() !== '') {
      return direct;
    }
    const loweredValue = lowered[normalizeProbeText(candidate)];
    if (loweredValue != null && String(loweredValue).trim() !== '') {
      return loweredValue;
    }
  }
  return null;
};

const parseAmount = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/,/g, '').trim());
    if (Number.isFinite(parsed)) {
      return Math.abs(parsed);
    }
  }
  return null;
};

const scoreProviderImportKeywords = (probeText, keywords = []) => {
  if (!probeText) return 0;
  return keywords.reduce(
    (score, keyword) => (probeText.includes(keyword) ? score + 1 : score),
    0
  );
};

const countHeaderMatches = (headers = [], expectedHeaders = []) => {
  if (!Array.isArray(headers) || headers.length === 0) {
    return 0;
  }
  return expectedHeaders.filter((header) => headers.some(
    (candidate) => normalizeProbeText(candidate) === header
  )).length;
};

const getProviderConfig = (providerId) => {
  const resolved = resolveProviderId(providerId);
  if (!resolved || !PROVIDER_IMPORT_CONFIGS[resolved]) {
    return null;
  }
  return { providerId: resolved, ...PROVIDER_IMPORT_CONFIGS[resolved] };
};

const detectProviderImportFile = ({ provider, filename = '', content = '', headers = [] } = {}) => {
  const config = getProviderConfig(provider);
  if (!config) {
    return {
      accepted: false,
      provider: resolveProviderId(provider) || provider,
      keywordScore: 0,
      headerMatches: 0,
      format: 'unknown',
      matchedKeywords: []
    };
  }

  const loweredName = normalizeProbeText(filename);
  const probeParts = [loweredName, normalizeProbeText(content)];

  if (Array.isArray(headers) && headers.length > 0) {
    probeParts.push(headers.map((header) => normalizeProbeText(header)).join(' '));
  }

  const probeText = probeParts.join(' ');
  const keywordScore = scoreProviderImportKeywords(probeText, config.keywords);
  const headerMatches = countHeaderMatches(headers, config.expectedHeaders);

  const looksPdf = loweredName.endsWith('.pdf') || probeText.includes('%pdf');
  const looksCsv = loweredName.endsWith('.csv');
  const looksXlsx = loweredName.endsWith('.xlsx') || loweredName.endsWith('.xls');
  const providerToken = config.providerId.replace(/_/g, '');

  const accepted = keywordScore >= 2
    || headerMatches >= 4
    || (loweredName.includes(providerToken) && (looksPdf || looksCsv || looksXlsx || headerMatches >= 2))
    || (loweredName.includes(config.productName.toLowerCase()) && headerMatches >= 2)
    || (looksPdf && keywordScore >= 1);

  return {
    accepted,
    provider: config.providerId,
    keywordScore,
    headerMatches,
    format: looksPdf
      ? 'pdf'
      : looksCsv
        ? 'csv'
        : headerMatches >= 3 || looksXlsx
          ? 'xlsx'
          : 'unknown',
    matchedKeywords: config.keywords.filter((keyword) => probeText.includes(keyword))
  };
};

const mapProviderRowToTransaction = (row = {}, rowMap = {}, providerId = '') => {
  const amount = parseAmount(
    pickField(row, rowMap.amount || [])
  ) ?? parseAmount(pickField(row, ['Debit', 'Credit', 'debit', 'credit']));

  const date = pickField(row, rowMap.date || []);
  const description = pickField(row, rowMap.description || []);
  const vendor = pickField(row, rowMap.vendor || []);
  const voucherType = pickField(row, rowMap.voucherType || []);
  const reference = pickField(row, rowMap.reference || []);
  const category = pickField(row, rowMap.category || []);

  const fieldMap = getFieldMapForProvider(providerId);
  const sourceIdKeys = fieldMap?.sourceIdKeys || ['id', 'reference', 'voucher_number'];

  const base = {
    date,
    description,
    amount: amount != null ? String(amount) : undefined,
    total: amount,
    category,
    voucher_type: voucherType,
    transaction_type: voucherType
  };

  if (providerId === 'busy') {
    return {
      ...base,
      VchNo: reference,
      VchDate: date,
      Narration: description,
      Debit: amount,
      PartyName: vendor
    };
  }

  if (providerId === 'marg') {
    return {
      ...base,
      bill_no: reference,
      bill_date: date,
      product_name: description,
      net_amount: amount,
      supplier_name: vendor
    };
  }

  if (providerId === 'vyapar') {
    return {
      ...base,
      transaction_id: reference,
      party_name: vendor
    };
  }

  if (providerId === 'mybillbook') {
    return {
      ...base,
      invoice_number: reference,
      invoice_date: date,
      total_amount: amount,
      vendor_name: vendor
    };
  }

  if (providerId === 'khatabook') {
    return {
      ...base,
      entry_id: reference,
      entry_date: date,
      note: description,
      contact_name: vendor
    };
  }

  if (providerId === 'quickbooks') {
    return {
      ...base,
      Id: reference,
      TxnDate: date,
      TotalAmt: amount,
      PrivateNote: description,
      EntityRef: vendor ? { name: vendor } : undefined
    };
  }

  if (providerId === 'erpnext') {
    return {
      ...base,
      name: reference,
      posting_date: date,
      remarks: description,
      debit: amount,
      party: vendor
    };
  }

  if (providerId === 'odoo') {
    return {
      ...base,
      name: reference,
      partner_name: vendor,
      label: description,
      debit: amount
    };
  }

  if (providerId === 'clear') {
    return {
      ...base,
      transactionId: reference,
      txnDate: date,
      partyName: vendor
    };
  }

  if (providerId === 'profitbooks') {
    return {
      ...base,
      voucher_no: reference,
      voucher_date: date,
      narration: description,
      party_name: vendor
    };
  }

  if (providerId === 'hostbooks') {
    return {
      ...base,
      reference,
      transaction_date: date,
      narration: description,
      payee: vendor
    };
  }

  const mapped = { ...base };
  sourceIdKeys.forEach((key) => {
    if (reference) mapped[key] = reference;
  });
  if (vendor) mapped.vendor_name = vendor;
  return mapped;
};

const filterValidTransactions = (transactions = []) => transactions.filter((row) => {
  const date = row.date || row.voucher_date || row.transaction_date || row.entry_date
    || row.invoice_date || row.TxnDate || row.posting_date || row.txnDate;
  const amount = parseAmount(
    row.amount ?? row.total ?? row.total_amount ?? row.Debit ?? row.debit
      ?? row.net_amount ?? row.TotalAmt
  );
  return date && amount != null && Number.isFinite(amount);
});

const parseProviderXlsx = (buffer, providerId) => {
  const config = getProviderConfig(providerId);
  if (!config) {
    return { transactions: [], meta: { format: 'xlsx', transactionCount: 0, headers: [] } };
  }

  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { transactions: [], meta: { format: 'xlsx', transactionCount: 0, headers: [] } };
  }

  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const transactions = filterValidTransactions(
    rows.map((row) => mapProviderRowToTransaction(row, config.rowMap, config.providerId))
  );

  return {
    transactions,
    meta: {
      format: 'xlsx',
      provider: config.providerId,
      sheetName,
      transactionCount: transactions.length,
      headers
    }
  };
};

const parsePdfTextRow = (line, rowMap = {}, providerId = '') => {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;

  const tabular = trimmed.match(
    /^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})\s+(\S+)\s+(\S+)\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s*(.*)$/i
  );
  if (!tabular) {
    return null;
  }

  const [, date, typeOrRef, refOrParty, partyOrDesc, amount, trailing = ''] = tabular;
  const parsedAmount = parseAmount(amount);
  if (parsedAmount == null) {
    return null;
  }

  return mapProviderRowToTransaction(
    {
      Date: date,
      [rowMap.voucherType?.[0] || 'Voucher Type']: typeOrRef,
      [rowMap.reference?.[0] || 'Reference']: refOrParty,
      [rowMap.vendor?.[0] || 'Party']: partyOrDesc.trim(),
      [rowMap.description?.[0] || 'Description']: trailing.trim() || partyOrDesc.trim(),
      Amount: parsedAmount
    },
    rowMap,
    providerId
  );
};

const parseProviderPdfText = (text, providerId) => {
  const config = getProviderConfig(providerId);
  if (!config) {
    return [];
  }

  const lines = String(text || '').split(/\r?\n/);
  const transactions = [];

  lines.forEach((line) => {
    const row = parsePdfTextRow(line, config.rowMap, config.providerId);
    if (row) {
      transactions.push(row);
    }
  });

  return filterValidTransactions(transactions);
};

const parseProviderPdf = async (buffer, providerId) => {
  const config = getProviderConfig(providerId);
  if (!config) {
    return {
      transactions: [],
      meta: { format: 'pdf', transactionCount: 0, textLength: 0 }
    };
  }

  const parsed = await pdfParse(buffer);
  const text = parsed?.text || '';
  const transactions = parseProviderPdfText(text, providerId);

  return {
    transactions,
    meta: {
      format: 'pdf',
      provider: config.providerId,
      transactionCount: transactions.length,
      textLength: text.length
    }
  };
};

const parseProviderImportFile = async ({ provider, filename = '', content = '', buffer = null } = {}) => {
  const config = getProviderConfig(provider);
  if (!config) {
    return {
      transactions: [],
      meta: { format: 'unknown', transactionCount: 0 },
      detection: detectProviderImportFile({ provider, filename, content })
    };
  }

  const loweredName = String(filename || '').toLowerCase();

  if (loweredName.endsWith('.pdf')) {
    const parsed = await parseProviderPdf(buffer || content, config.providerId);
    return {
      ...parsed,
      detection: detectProviderImportFile({
        provider: config.providerId,
        filename,
        content: parsed.meta?.textLength
          ? `${config.productName.toLowerCase()} export pdf ${config.keywords.slice(0, 4).join(' ')}`
          : ''
      })
    };
  }

  if (buffer || loweredName.endsWith('.xlsx') || loweredName.endsWith('.xls')) {
    const parsed = parseProviderXlsx(buffer || content, config.providerId);
    return {
      ...parsed,
      detection: detectProviderImportFile({
        provider: config.providerId,
        filename,
        headers: parsed.meta.headers || []
      })
    };
  }

  const detection = detectProviderImportFile({ provider: config.providerId, filename, content });
  return {
    transactions: [],
    meta: { format: 'unknown', transactionCount: 0 },
    detection
  };
};

const getProviderDisplayName = (providerId) => {
  const config = getProviderConfig(providerId);
  return config?.productName || providerId;
};

module.exports = {
  PROVIDER_IMPORT_CONFIGS,
  SUPPORTED_PROVIDER_IMPORT_IDS,
  detectProviderImportFile,
  parseProviderXlsx,
  parseProviderPdf,
  parseProviderPdfText,
  parseProviderImportFile,
  getProviderDisplayName,
  mapProviderRowToTransaction
};
