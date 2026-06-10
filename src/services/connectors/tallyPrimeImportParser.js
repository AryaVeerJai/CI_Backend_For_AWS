const cheerio = require('cheerio');
const xlsx = require('xlsx');
const TallyPrimeClient = require('./tallyPrimeClient');

/**
 * Keywords that identify TallyPrime Day Book / voucher export files.
 * Used to accept XML, XLSX, CSV, PDF, and JSON imports without manual format selection.
 */
const TALLYPRIME_IMPORT_KEYWORDS = [
  'tallyrequest',
  'tallymessage',
  'tallyprime',
  'voucher type',
  'voucher number',
  'voucher no',
  'party a/c name',
  'party ledger name',
  'partyledgername',
  'vouchernumber',
  'vouchertypename',
  'allledgerentries',
  'day book export',
  'ledger name',
  'debit amount',
  'credit amount',
  'narration',
  'vchtype',
  'svcurrentcompany',
  'envelope',
  'amount inr',
  'cost center',
  'cost centre',
  'supplier',
  'quantity',
  'unit',
  'tallyprime day book export'
];

const TALLYPRIME_XLSX_HEADERS = [
  'date',
  'voucher type',
  'voucher number',
  'party a/c name',
  'ledger name',
  'debit amount',
  'credit amount',
  'narration'
];

const TALLYPRIME_MSME_XLSX_HEADERS = [
  'voucher no',
  'date',
  'voucher type',
  'description',
  'quantity',
  'unit',
  'amount inr',
  'cost center',
  'supplier'
];

const tallyClient = new TallyPrimeClient({ enabled: false });

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

const scoreTallyPrimeImportKeywords = (probeText) => {
  if (!probeText) return 0;
  return TALLYPRIME_IMPORT_KEYWORDS.reduce(
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

const detectTallyPrimeImportFile = ({ filename = '', content = '', headers = [] } = {}) => {
  const loweredName = normalizeProbeText(filename);
  const probeParts = [loweredName, normalizeProbeText(content)];

  if (Array.isArray(headers) && headers.length > 0) {
    probeParts.push(headers.map((header) => normalizeProbeText(header)).join(' '));
  }

  const probeText = probeParts.join(' ');
  const keywordScore = scoreTallyPrimeImportKeywords(probeText);

  const looksXml = loweredName.endsWith('.xml') || probeText.includes('<envelope') || probeText.includes('<tallymessage');
  const looksJson = loweredName.endsWith('.json') || probeText.trim().startsWith('[') || probeText.trim().startsWith('{');
  const looksPdf = loweredName.endsWith('.pdf') || probeText.includes('%pdf') || probeText.includes('tallyprime day book export');
  const dayBookHeaderMatches = countHeaderMatches(headers, TALLYPRIME_XLSX_HEADERS);
  const msmeHeaderMatches = countHeaderMatches(headers, TALLYPRIME_MSME_XLSX_HEADERS);
  const headerMatches = Math.max(dayBookHeaderMatches, msmeHeaderMatches);

  const accepted = keywordScore >= 2
    || (looksXml && keywordScore >= 1)
    || headerMatches >= 4
    || msmeHeaderMatches >= 5
    || (loweredName.includes('tally') && (looksXml || looksJson || looksPdf || headerMatches >= 2))
    || (looksPdf && keywordScore >= 1);

  return {
    accepted,
    provider: 'tally',
    keywordScore,
    headerMatches,
    format: looksPdf
      ? 'pdf'
      : looksXml
        ? 'xml'
        : headerMatches >= 4
          ? 'xlsx'
          : looksJson
            ? 'json'
            : 'unknown',
    matchedKeywords: TALLYPRIME_IMPORT_KEYWORDS.filter((keyword) => probeText.includes(keyword))
  };
};

const extractVoucherFromXmlNode = ($, element) => {
  const $voucher = $(element);
  const voucher = {};

  const vchType = $voucher.attr('VCHTYPE') || $voucher.attr('vchtype');
  if (vchType) {
    voucher.VOUCHERTYPENAME = String(vchType).trim();
  }

  $voucher.children().each((_, child) => {
    const tag = child.tagName || child.name;
    if (!tag) return;
    const key = String(tag).toUpperCase();
    const text = $(child).text().trim();
    if (text) voucher[key] = text;
  });

  const ledgerNames = [];
  const ledgerAmounts = [];
  $voucher.find('ALLLEDGERENTRIES\\.LIST, allledgerentries\\.list, ALLLEDGERENTRIES\\.LIST').each((_, entry) => {
    const ledgerName = $(entry).find('LEDGERNAME, ledgername').first().text().trim();
    const amount = $(entry).find('AMOUNT, amount').first().text().trim();
    if (ledgerName) ledgerNames.push(ledgerName);
    if (amount) ledgerAmounts.push(amount);
  });

  if (ledgerNames.length > 0 && !voucher.LEDGERNAME) {
    voucher.LEDGERNAME = ledgerNames[0];
  }
  if (ledgerAmounts.length > 0 && !voucher.AMOUNT) {
    voucher.AMOUNT = ledgerAmounts[0];
  }

  return voucher;
};

const parseTallyPrimeXml = (xmlContent) => {
  const xml = String(xmlContent || '').trim();
  if (!xml) {
    return { transactions: [], meta: { format: 'xml', voucherCount: 0 } };
  }

  const $ = cheerio.load(xml, { xmlMode: true });
  const vouchers = [];

  $('VOUCHER, voucher').each((_, element) => {
    const voucher = extractVoucherFromXmlNode($, element);
    if (Object.keys(voucher).length > 0) {
      vouchers.push(voucher);
    }
  });

  if (vouchers.length === 0) {
    const fallback = tallyClient.parseXmlResponse(xml);
    return {
      transactions: (fallback.vouchers || []).map((voucher) => tallyClient.mapVoucherToTransaction(voucher)),
      meta: { format: 'xml', voucherCount: fallback.vouchers?.length || 0, parser: 'legacy' }
    };
  }

  return {
    transactions: vouchers
      .map((voucher) => tallyClient.mapVoucherToTransaction(voucher))
      .filter((row) => row.voucher_date && (row.amount || row.debit || row.credit)),
    meta: { format: 'xml', voucherCount: vouchers.length, parser: 'enhanced' }
  };
};

const mapXlsxRowToTransaction = (row = {}) => {
  const normalized = normalizeRowKeys(row);
  const debit = tallyClient.parseAmount(normalized['Debit Amount'] ?? normalized['debit amount'] ?? normalized.Debit);
  const credit = tallyClient.parseAmount(normalized['Credit Amount'] ?? normalized['credit amount'] ?? normalized.Credit);
  const amount = debit || credit;

  return {
    voucher_number: normalized['Voucher Number'] || normalized['voucher number'] || normalized.VoucherNumber,
    voucher_date: normalized.Date || normalized.date || normalized['Voucher Date'],
    voucher_type: normalized['Voucher Type'] || normalized['voucher type'] || normalized.VoucherType,
    narration: normalized.Narration || normalized.narration || normalized.Description,
    ledger_name: normalized['Ledger Name'] || normalized['ledger name'] || normalized.LedgerName,
    party_name: normalized['Party A/c Name'] || normalized['Party Ledger Name'] || normalized.party_name,
    amount: amount != null ? String(amount) : undefined,
    debit: debit != null ? String(debit) : undefined,
    credit: credit != null ? String(credit) : undefined,
    reference: normalized.Reference || normalized.reference,
    cost_centre: normalized['Cost Centre'] || normalized['cost centre'],
    currency: 'INR'
  };
};

const mapMsmeXlsxRowToTransaction = (row = {}) => {
  const amount = tallyClient.parseAmount(
    pickField(row, ['Amount INR', 'Amount (INR)', 'amount inr', 'amount (inr)', 'Amount'])
  );

  return {
    voucher_number: pickField(row, ['Voucher No', 'Voucher Number', 'voucher no', 'voucher number']),
    voucher_date: pickField(row, ['Date', 'date']),
    voucher_type: pickField(row, ['Voucher Type', 'voucher type']),
    narration: pickField(row, ['Description', 'description', 'Narration', 'narration']),
    ledger_name: pickField(row, ['Ledger', 'ledger', 'Voucher Type', 'voucher type']),
    party_name: pickField(row, ['Supplier', 'supplier', 'Party A/c Name', 'party a/c name']),
    amount: amount != null ? String(amount) : undefined,
    debit: amount != null ? String(amount) : undefined,
    reference: pickField(row, ['Reference', 'reference']),
    cost_centre: pickField(row, ['Cost Center', 'Cost Centre', 'cost center', 'cost centre']),
    quantity: pickField(row, ['Quantity', 'quantity']) != null
      ? String(pickField(row, ['Quantity', 'quantity']))
      : undefined,
    unit: pickField(row, ['Unit', 'unit']),
    currency: 'INR'
  };
};

const isMsmeXlsxHeaders = (headers = []) => countHeaderMatches(headers, TALLYPRIME_MSME_XLSX_HEADERS) >= 5;

const filterValidTransactions = (transactions = []) => transactions.filter(
  (row) => row.voucher_date && (row.amount || row.debit || row.credit)
);

const parseTallyPrimeXlsx = (buffer) => {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { transactions: [], meta: { format: 'xlsx', voucherCount: 0, headers: [] } };
  }

  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const useMsmeFormat = isMsmeXlsxHeaders(headers);
  const transactions = filterValidTransactions(
    rows.map((row) => (useMsmeFormat ? mapMsmeXlsxRowToTransaction(row) : mapXlsxRowToTransaction(row)))
  );

  return {
    transactions,
    meta: {
      format: 'xlsx',
      layout: useMsmeFormat ? 'msme_12month' : 'day_book',
      sheetName,
      voucherCount: transactions.length,
      headers
    }
  };
};

const parsePdfTextRow = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;

  const dayBookMatch = trimmed.match(
    /^(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})\s+(\S+)\s+([A-Z0-9/-]+)\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+(.+)$/i
  );
  if (dayBookMatch) {
    const [, date, voucherType, voucherNumber, partyName, debit, credit, narration] = dayBookMatch;
    const debitAmount = tallyClient.parseAmount(debit);
    const creditAmount = tallyClient.parseAmount(credit);
    const amount = debitAmount || creditAmount;
    return {
      voucher_number: voucherNumber,
      voucher_date: date,
      voucher_type: voucherType,
      party_name: partyName.trim(),
      ledger_name: partyName.trim(),
      narration: narration.trim(),
      amount: amount != null ? String(amount) : undefined,
      debit: debitAmount != null ? String(debitAmount) : undefined,
      credit: creditAmount != null ? String(creditAmount) : undefined,
      currency: 'INR'
    };
  }

  const msmeMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})\s+([A-Za-z ]+?)\s+(VCH[A-Z0-9-]+)\s+(.+?)\s+([\d.]+)\s+(\S+)\s+([\d,]+(?:\.\d+)?)\s+(.+?)\s+(.+)$/i
  );
  if (msmeMatch) {
    const [, date, voucherType, voucherNumber, description, quantity, unit, amount, costCenter, supplier] = msmeMatch;
    const parsedAmount = tallyClient.parseAmount(amount);
    return {
      voucher_number: voucherNumber,
      voucher_date: date,
      voucher_type: voucherType.trim(),
      narration: description.trim(),
      ledger_name: voucherType.trim(),
      party_name: supplier.trim(),
      amount: parsedAmount != null ? String(parsedAmount) : undefined,
      debit: parsedAmount != null ? String(parsedAmount) : undefined,
      cost_centre: costCenter.trim(),
      quantity: quantity.trim(),
      unit: unit.trim(),
      currency: 'INR'
    };
  }

  return null;
};

const parseTallyPrimePdfText = (text) => {
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

const parseTallyPrimePdf = async (buffer) => {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  let text = '';

  try {
    // Lazy-load to avoid pdf.js module state conflicts with other parsers in test runs.
    const pdfParseLib = require('pdf-parse');
    const parsed = await pdfParseLib(input);
    text = parsed?.text || '';
  } catch (error) {
    text = '';
  }

  const transactions = parseTallyPrimePdfText(text);

  return {
    transactions,
    meta: {
      format: 'pdf',
      voucherCount: transactions.length,
      textLength: text.length
    }
  };
};

const parseTallyPrimeImportFile = async ({ filename = '', content = '', buffer = null } = {}) => {
  const loweredName = String(filename || '').toLowerCase();

  if (loweredName.endsWith('.pdf')) {
    const parsed = await parseTallyPrimePdf(buffer || content);
    return {
      ...parsed,
      detection: detectTallyPrimeImportFile({
        filename,
        content: parsed.meta?.textLength ? 'tallyprime day book export pdf' : ''
      })
    };
  }

  if (buffer || loweredName.endsWith('.xlsx') || loweredName.endsWith('.xls')) {
    const parsed = parseTallyPrimeXlsx(buffer || content);
    const detection = detectTallyPrimeImportFile({
      filename,
      headers: parsed.meta.headers || []
    });
    return {
      ...parsed,
      detection
    };
  }

  if (loweredName.endsWith('.xml') || String(content || '').trim().startsWith('<')) {
    const parsed = parseTallyPrimeXml(content);
    return {
      ...parsed,
      detection: detectTallyPrimeImportFile({ filename, content })
    };
  }

  const detection = detectTallyPrimeImportFile({ filename, content });
  return {
    transactions: [],
    meta: { format: 'unknown', voucherCount: 0 },
    detection
  };
};

module.exports = {
  TALLYPRIME_IMPORT_KEYWORDS,
  TALLYPRIME_XLSX_HEADERS,
  TALLYPRIME_MSME_XLSX_HEADERS,
  detectTallyPrimeImportFile,
  parseTallyPrimeXml,
  parseTallyPrimeXlsx,
  parseTallyPrimePdf,
  parseTallyPrimePdfText,
  parseTallyPrimeImportFile
};
