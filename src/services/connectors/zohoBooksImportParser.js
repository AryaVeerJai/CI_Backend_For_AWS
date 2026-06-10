const { parse: parseCsv } = require('csv-parse/sync');
const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');

/**
 * Keywords that identify Zoho Books transaction export files.
 * Used to accept CSV, XLSX, and PDF imports without manual format selection.
 */
const ZOHOBOOKS_IMPORT_KEYWORDS = [
  'zoho books',
  'transaction type',
  'reference no',
  'contact name',
  'amount inr',
  'amount (inr)',
  'gst %',
  'gst (%)',
  'zoho books export',
  'transaction list',
  'bank transactions'
];

const ZOHOBOOKS_XLSX_HEADERS = [
  'date',
  'transaction type',
  'reference no',
  'contact name',
  'category',
  'amount inr',
  'amount (inr)',
  'description'
];

const normalizeProbeText = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

const normalizeRowKeys = (row = {}) => {
  const normalized = {};
  Object.entries(row).forEach(([key, value]) => {
    normalized[String(key).trim()] = value;
  });
  return normalized;
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

const mapZohoRowToTransaction = (row = {}) => {
  const amount = parseAmount(
    pickField(row, ['Amount INR', 'Amount (INR)', 'amount inr', 'amount (inr)', 'total', 'amount'])
  );

  return {
    transaction_id: pickField(row, ['Reference No', 'reference no', 'reference_no', 'transaction_id']),
    transaction_date: pickField(row, ['Date', 'date', 'transaction_date']),
    transaction_type: pickField(row, ['Transaction Type', 'transaction type', 'transaction_type']),
    description: pickField(row, ['Description', 'description', 'notes']),
    total: amount,
    vendor_name: pickField(row, ['Contact Name', 'contact name', 'contact_name', 'vendor_name']),
    category: pickField(row, ['Category', 'category']),
    project: pickField(row, ['Project', 'project']),
    account: pickField(row, ['Account', 'account']),
    currency: 'INR'
  };
};

const scoreZohoBooksImportKeywords = (probeText) => {
  if (!probeText) return 0;
  return ZOHOBOOKS_IMPORT_KEYWORDS.reduce(
    (score, keyword) => (probeText.includes(keyword) ? score + 1 : score),
    0
  );
};

const detectZohoBooksImportFile = ({ filename = '', content = '', headers = [] } = {}) => {
  const loweredName = normalizeProbeText(filename);
  const probeParts = [loweredName, normalizeProbeText(content)];

  if (Array.isArray(headers) && headers.length > 0) {
    probeParts.push(headers.map((header) => normalizeProbeText(header)).join(' '));
  }

  const probeText = probeParts.join(' ');
  const keywordScore = scoreZohoBooksImportKeywords(probeText);

  const looksCsv = loweredName.endsWith('.csv') || probeText.includes('transaction type,reference no');
  const looksPdf = loweredName.endsWith('.pdf') || probeText.includes('%pdf');
  const headerMatches = Array.isArray(headers)
    ? ZOHOBOOKS_XLSX_HEADERS.filter((header) => headers.some(
      (candidate) => normalizeProbeText(candidate) === header
    )).length
    : 0;

  const accepted = keywordScore >= 2
    || headerMatches >= 4
    || (loweredName.includes('zoho') && (looksCsv || looksPdf || headerMatches >= 2))
    || (looksCsv && headerMatches >= 3);

  return {
    accepted,
    provider: 'zoho',
    keywordScore,
    headerMatches,
    format: looksPdf
      ? 'pdf'
      : headerMatches >= 4 || looksCsv
        ? looksCsv
          ? 'csv'
          : 'xlsx'
        : 'unknown',
    matchedKeywords: ZOHOBOOKS_IMPORT_KEYWORDS.filter((keyword) => probeText.includes(keyword))
  };
};

const filterValidTransactions = (transactions = []) => transactions.filter(
  (row) => row.transaction_date && row.total != null && Number.isFinite(Number(row.total))
);

const parseZohoBooksCsv = (content) => {
  const csvText = String(content || '').trim();
  if (!csvText) {
    return { transactions: [], meta: { format: 'csv', transactionCount: 0, headers: [] } };
  }

  const rows = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const transactions = filterValidTransactions(rows.map((row) => mapZohoRowToTransaction(row)));

  return {
    transactions,
    meta: {
      format: 'csv',
      transactionCount: transactions.length,
      headers
    }
  };
};

const parseZohoBooksXlsx = (buffer) => {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { transactions: [], meta: { format: 'xlsx', transactionCount: 0, headers: [] } };
  }

  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const transactions = filterValidTransactions(rows.map((row) => mapZohoRowToTransaction(row)));

  return {
    transactions,
    meta: {
      format: 'xlsx',
      sheetName,
      transactionCount: transactions.length,
      headers
    }
  };
};

const parsePdfTextRow = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;

  const match = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})\s+(Invoice|Credit Note|Expense|Journal|Bill)\s+([A-Z0-9-]+)\s+(.+?)\s+(Revenue|Waste Management|Fuel|Water|Electricity|Raw Materials|Logistics|Payroll|Other Purchases|Utilities)\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s+\d+\s+(.+)$/i
  );
  if (!match) {
    return null;
  }

  const [, date, transactionType, referenceNo, contactName, category, , amount, description] = match;
  return mapZohoRowToTransaction({
    Date: date,
    'Transaction Type': transactionType,
    'Reference No': referenceNo,
    'Contact Name': contactName.trim(),
    Category: category,
    'Amount INR': amount.replace(/,/g, ''),
    Description: description.trim()
  });
};

const parseZohoBooksPdfText = (text) => {
  const lines = String(text || '').split(/\r?\n/);
  const transactions = [];

  lines.forEach((line) => {
    const row = parsePdfTextRow(line);
    if (row) {
      transactions.push(row);
    }
  });

  return filterValidTransactions(transactions);
};

const parseZohoBooksPdf = async (buffer) => {
  const parsed = await pdfParse(buffer);
  const text = parsed?.text || '';
  const transactions = parseZohoBooksPdfText(text);

  return {
    transactions,
    meta: {
      format: 'pdf',
      transactionCount: transactions.length,
      textLength: text.length
    }
  };
};

const parseZohoBooksImportFile = async ({ filename = '', content = '', buffer = null } = {}) => {
  const loweredName = String(filename || '').toLowerCase();

  if (loweredName.endsWith('.pdf')) {
    const parsed = await parseZohoBooksPdf(buffer || content);
    return {
      ...parsed,
      detection: detectZohoBooksImportFile({ filename, content: '' })
    };
  }

  if (buffer || loweredName.endsWith('.xlsx') || loweredName.endsWith('.xls')) {
    const parsed = parseZohoBooksXlsx(buffer || content);
    return {
      ...parsed,
      detection: detectZohoBooksImportFile({
        filename,
        headers: parsed.meta.headers || []
      })
    };
  }

  if (loweredName.endsWith('.csv') || String(content || '').includes(',')) {
    const parsed = parseZohoBooksCsv(content);
    return {
      ...parsed,
      detection: detectZohoBooksImportFile({
        filename,
        content,
        headers: parsed.meta.headers || []
      })
    };
  }

  const detection = detectZohoBooksImportFile({ filename, content });
  return {
    transactions: [],
    meta: { format: 'unknown', transactionCount: 0 },
    detection
  };
};

module.exports = {
  ZOHOBOOKS_IMPORT_KEYWORDS,
  ZOHOBOOKS_XLSX_HEADERS,
  detectZohoBooksImportFile,
  mapZohoRowToTransaction,
  parseZohoBooksCsv,
  parseZohoBooksXlsx,
  parseZohoBooksPdf,
  parseZohoBooksPdfText,
  parseZohoBooksImportFile
};
