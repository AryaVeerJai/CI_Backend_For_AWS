const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../../utils/logger');

/**
 * TallyPrime HTTP integration client.
 * @see https://help.tallysolutions.com/integrate-with-tallyprime/
 * @see https://help.tallysolutions.com/tally-prime-integration-using-json-1/
 * @see https://help.tallysolutions.com/xml-integration/
 *
 * TallyPrime must run as an HTTP server (Exchange → Data Synchronization, port 9000)
 * with a company loaded. Requests use JSON (JSONEx) or XML export for the Day Book report.
 */
class TallyPrimeClient {
  constructor(options = {}) {
    this.enabled = options.enabled ?? (process.env.TALLY_ENABLED === 'true');
    this.host = options.host || process.env.TALLY_HOST || 'localhost';
    this.port = Number(options.port || process.env.TALLY_PORT || 9000);
    this.companyName = options.companyName || process.env.TALLY_COMPANY_NAME || '';
    this.apiFormat = String(options.apiFormat || process.env.TALLY_API_FORMAT || 'json').toLowerCase();
    this.reportId = options.reportId || process.env.TALLY_REPORT_ID || 'DayBook';
    this.timeout = Number(options.timeout || process.env.TALLY_TIMEOUT_MS || 30000);
    this.defaultFromDate = options.defaultFromDate || process.env.TALLY_FROM_DATE || '';
    this.defaultToDate = options.defaultToDate || process.env.TALLY_TO_DATE || '';

    const baseUrl = options.baseUrl
      || process.env.TALLY_BASE_URL
      || `http://${this.host}:${this.port}`;

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.http = axios.create({
      timeout: Number.isFinite(this.timeout) && this.timeout > 0 ? this.timeout : 30000,
      validateStatus: (status) => status >= 200 && status < 500
    });
  }

  /**
   * Resolve Tally SVCurrentCompany: request override, MSME/org legal name, then TALLY_COMPANY_NAME env.
   */
  resolveCompanyName(override) {
    const candidates = [override, this.companyName];
    for (const value of candidates) {
      const trimmed = String(value || '').trim();
      if (trimmed) return trimmed;
    }
    return '';
  }

  isConfigured(context = {}) {
    if (!this.enabled || !this.baseUrl) return false;
    return Boolean(this.resolveCompanyName(context.companyName || context.legalName));
  }

  getConfigurationStatus(context = {}) {
    const resolvedCompanyName = this.resolveCompanyName(
      context.companyName || context.legalName
    );
    return {
      enabled: this.enabled,
      configured: this.isConfigured(context),
      companyName: resolvedCompanyName || null,
      companyNameConfigured: Boolean(resolvedCompanyName),
      companyNameFromEnv: Boolean(this.companyName),
      host: this.host,
      port: this.port,
      baseUrl: this.baseUrl,
      apiFormat: this.apiFormat,
      reportId: this.reportId,
      timeoutMs: this.timeout,
      defaultFromDate: this.defaultFromDate || null,
      defaultToDate: this.defaultToDate || null
    };
  }

  ensureAvailable(context = {}) {
    if (!this.enabled) {
      const error = new Error('TallyPrime integration is disabled');
      error.statusCode = 503;
      throw error;
    }

    if (!this.baseUrl) {
      const error = new Error('TallyPrime base URL is not configured');
      error.statusCode = 500;
      throw error;
    }

    if (!this.resolveCompanyName(context.companyName || context.legalName)) {
      const error = new Error(
        'TallyPrime company name is required (must match the company open in TallyPrime; uses your MSME company name on sync, or set TALLY_COMPANY_NAME)'
      );
      error.statusCode = 500;
      throw error;
    }
  }

  /**
   * Normalize user-supplied dates to Tally YYYYMMDD.
   */
  toTallyDate(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (/^\d{8}$/.test(raw)) {
      const yyyy = Number(raw.slice(0, 4));
      const mm = Number(raw.slice(4, 6));
      const dd = Number(raw.slice(6, 8));
      const looksLikeYyyyMmDd = yyyy >= 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
      if (looksLikeYyyyMmDd) {
        return raw;
      }

      const day = Number(raw.slice(0, 2));
      const month = Number(raw.slice(2, 4));
      const year = Number(raw.slice(4, 8));
      const looksLikeDdMmYyyy = year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
      if (looksLikeDdMmYyyy) {
        return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
      }

      return raw;
    }
    const ddMmYyyy = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (ddMmYyyy) {
      return `${ddMmYyyy[3]}${ddMmYyyy[2]}${ddMmYyyy[1]}`;
    }
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getUTCFullYear();
      const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
      const d = String(parsed.getUTCDate()).padStart(2, '0');
      return `${y}${m}${d}`;
    }
    return null;
  }

  formatTallyDateForDisplay(tallyDate) {
    const normalized = this.toTallyDate(tallyDate);
    if (!normalized || normalized.length !== 8) {
      const ddMmYyyy = String(tallyDate || '').match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
      if (ddMmYyyy) {
        return `${ddMmYyyy[3]}-${ddMmYyyy[2]}-${ddMmYyyy[1]}`;
      }
      return tallyDate;
    }
    return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
  }

  buildJsonExportBody({ companyName, fromDate, toDate }) {
    const staticVariables = [
      { name: 'SVExportFormat', value: 'JSONEx' },
      { name: 'SVCurrentCompany', value: companyName },
      { name: 'SVExportInPlainFormat', value: 'Yes' }
    ];

    if (fromDate) {
      staticVariables.push({ name: 'SVFROMDATE', value: fromDate });
    }
    if (toDate) {
      staticVariables.push({ name: 'SVTODATE', value: toDate });
    }

    return { static_variables: staticVariables };
  }

  buildXmlExportEnvelope({ companyName, fromDate, toDate, reportId }) {
    const staticVars = [
      '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>',
      `<SVCURRENTCOMPANY>${this.escapeXml(companyName)}</SVCURRENTCOMPANY>`
    ];
    if (fromDate) staticVars.push(`<SVFROMDATE>${fromDate}</SVFROMDATE>`);
    if (toDate) staticVars.push(`<SVTODATE>${toDate}</SVTODATE>`);

    return [
      '<ENVELOPE>',
      '<HEADER>',
      '<VERSION>1</VERSION>',
      '<TALLYREQUEST>Export</TALLYREQUEST>',
      '<TYPE>Data</TYPE>',
      `<ID>${this.escapeXml(reportId)}</ID>`,
      '</HEADER>',
      '<BODY>',
      '<DESC>',
      '<STATICVARIABLES>',
      ...staticVars,
      '</STATICVARIABLES>',
      '</DESC>',
      '</BODY>',
      '</ENVELOPE>'
    ].join('');
  }

  escapeXml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async postJsonExport({ companyName, fromDate, toDate, reportId }) {
    const body = this.buildJsonExportBody({ companyName, fromDate, toDate });
    const response = await this.http.post(this.baseUrl, body, {
      headers: {
        'Content-Type': 'application/json',
        version: '1',
        tallyrequest: 'Export',
        type: 'Data',
        id: reportId
      },
      responseType: 'text',
      transformResponse: [(data) => data]
    });

    if (response.status >= 400) {
      const error = new Error(`TallyPrime HTTP ${response.status}`);
      error.statusCode = 502;
      throw error;
    }

    return this.parseResponsePayload(response.data, response.headers['content-type']);
  }

  async postXmlExport({ companyName, fromDate, toDate, reportId }) {
    const envelope = this.buildXmlExportEnvelope({ companyName, fromDate, toDate, reportId });
    const response = await this.http.post(this.baseUrl, envelope, {
      headers: {
        'Content-Type': 'text/xml'
      },
      responseType: 'text',
      transformResponse: [(data) => data]
    });

    if (response.status >= 400) {
      const error = new Error(`TallyPrime HTTP ${response.status}`);
      error.statusCode = 502;
      throw error;
    }

    return this.parseResponsePayload(response.data, response.headers['content-type']);
  }

  parseResponsePayload(rawPayload, contentType = '') {
    const payload = typeof rawPayload === 'string' ? rawPayload.trim() : rawPayload;
    if (!payload) {
      return { status: '0', vouchers: [], raw: null };
    }

    const looksJson = contentType.includes('json')
      || (typeof payload === 'string' && (payload.startsWith('{') || payload.startsWith('[')));

    if (looksJson) {
      try {
        const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
        return this.parseJsonResponse(parsed);
      } catch (error) {
        logger.warn('TallyPrime JSON response parse failed, attempting XML fallback', { error: error.message });
      }
    }

    if (typeof payload === 'string' && payload.includes('<')) {
      return this.parseXmlResponse(payload);
    }

    return { status: '0', vouchers: [], raw: payload };
  }

  parseJsonResponse(parsed) {
    const status = String(parsed?.status ?? parsed?.STATUS ?? '1');
    if (status === '0') {
      const message = parsed?.error || parsed?.LINEERROR || parsed?.remark || 'TallyPrime export failed';
      const error = new Error(message);
      error.statusCode = 502;
      throw error;
    }

    const vouchers = this.extractVouchersFromJson(parsed);
    return { status, vouchers, raw: parsed };
  }

  parseXmlResponse(xml) {
    const $ = cheerio.load(xml, { xmlMode: true });
    const status = $('STATUS').first().text().trim() || '1';
    if (status === '0') {
      const message = $('LINEERROR').first().text().trim() || 'TallyPrime XML export failed';
      const error = new Error(message);
      error.statusCode = 502;
      throw error;
    }

    const vouchers = [];
    $('VOUCHER').each((_, element) => {
      const voucher = {};
      const $voucher = $(element);
      $voucher.children().each((__, child) => {
        const tag = child.tagName || child.name;
        if (!tag) return;
        const key = String(tag).toUpperCase();
        const text = $(child).text().trim();
        if (text) voucher[key] = text;
      });
      if (Object.keys(voucher).length > 0) {
        vouchers.push(voucher);
      }
    });

    return { status, vouchers, raw: xml };
  }

  extractVouchersFromJson(node, results = [], depth = 0) {
    if (!node || depth > 30) return results;

    if (Array.isArray(node)) {
      node.forEach((item) => this.extractVouchersFromJson(item, results, depth + 1));
      return results;
    }

    if (typeof node !== 'object') return results;

    const normalized = this.normalizeObjectKeys(node);
    const hasVoucherSignal = Boolean(
      normalized.date
      || normalized.voucher_date
      || normalized.voucherdate
    ) && Boolean(
      normalized.narration
      || normalized.voucher_type
      || normalized.vouchertypename
      || normalized.voucher_number
      || normalized.vouchernumber
      || normalized.amount
      || normalized.debit
      || normalized.credit
    );

    if (hasVoucherSignal) {
      results.push(node);
    }

    Object.values(node).forEach((value) => {
      if (value && typeof value === 'object') {
        this.extractVouchersFromJson(value, results, depth + 1);
      }
    });

    return results;
  }

  normalizeObjectKeys(record = {}) {
    const normalized = {};
    Object.entries(record).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      const lowerKey = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (typeof value === 'object' && !Array.isArray(value)) {
        return;
      }
      normalized[lowerKey] = value;
    });
    return normalized;
  }

  pickField(record, keys = []) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
        return record[key];
      }
      const lower = String(key).toLowerCase();
      const match = Object.keys(record).find((entry) => entry.toLowerCase() === lower);
      if (match && record[match] !== undefined && record[match] !== '') {
        return record[match];
      }
    }
    return null;
  }

  parseAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const cleaned = String(value).replace(/,/g, '').trim();
    const negative = cleaned.startsWith('(') && cleaned.endsWith(')');
    const numeric = Number(cleaned.replace(/[()]/g, ''));
    if (!Number.isFinite(numeric)) return null;
    return negative ? -Math.abs(numeric) : numeric;
  }

  extractAmountFromVoucher(voucher = {}) {
    const direct = this.parseAmount(
      this.pickField(voucher, ['AMOUNT', 'amount', 'VALUE', 'value', 'BILLAMT', 'bill_amount'])
    );
    if (direct !== null && direct !== 0) {
      return Math.abs(direct);
    }

    const debit = this.parseAmount(this.pickField(voucher, ['DEBIT', 'debit']));
    const credit = this.parseAmount(this.pickField(voucher, ['CREDIT', 'credit']));
    if (debit !== null || credit !== null) {
      const debitAbs = debit !== null ? Math.abs(debit) : 0;
      const creditAbs = credit !== null ? Math.abs(credit) : 0;
      return Math.max(debitAbs, creditAbs) || debitAbs || creditAbs;
    }

    return null;
  }

  mapVoucherToTransaction(voucher = {}) {
    const dateRaw = this.pickField(voucher, [
      'DATE',
      'date',
      'VOUCHERDATE',
      'voucher_date',
      'voucherDate',
      'VCHDATE'
    ]);
    const amount = this.extractAmountFromVoucher(voucher);
    const debit = this.parseAmount(this.pickField(voucher, ['DEBIT', 'debit']));
    const credit = this.parseAmount(this.pickField(voucher, ['CREDIT', 'credit']));

    return {
      voucher_number: this.pickField(voucher, [
        'VOUCHERNUMBER',
        'voucher_number',
        'voucherNumber',
        'VCHNO',
        'vch_no',
        'id'
      ]),
      voucher_date: this.formatTallyDateForDisplay(dateRaw),
      narration: this.pickField(voucher, [
        'NARRATION',
        'narration',
        'DESCRIPTION',
        'description',
        'PARTICULARS',
        'particulars'
      ]),
      ledger_name: this.pickField(voucher, [
        'LEDGERNAME',
        'ledger_name',
        'ledgerName',
        'LEDGER_NAME'
      ]),
      amount: amount !== null ? String(amount) : undefined,
      debit: debit !== null ? String(Math.abs(debit)) : undefined,
      credit: credit !== null ? String(Math.abs(credit)) : undefined,
      party_name: this.pickField(voucher, [
        'PARTYLEDGERNAME',
        'party_name',
        'partyName',
        'LEDGERNAME',
        'ledger_name',
        'PARTYNAME',
        'vendor'
      ]),
      voucher_type: this.pickField(voucher, [
        'VOUCHERTYPENAME',
        'voucher_type',
        'voucherType',
        'VCHTYPE'
      ]),
      currency: this.pickField(voucher, ['CURRENCY', 'currency']) || 'INR'
    };
  }

  resolveDateRange(fetchOptions = {}) {
    const fromDate = this.toTallyDate(
      fetchOptions.fromDate || fetchOptions.from || this.defaultFromDate
    );
    const toDate = this.toTallyDate(
      fetchOptions.toDate || fetchOptions.to || this.defaultToDate
    );
    return { fromDate, toDate };
  }

  async exportDayBook(fetchOptions = {}) {
    this.ensureAvailable({
      companyName: fetchOptions.companyName,
      legalName: fetchOptions.legalName
    });

    const companyName = this.resolveCompanyName(
      fetchOptions.companyName || fetchOptions.legalName
    );
    const reportId = fetchOptions.reportId || this.reportId;
    const { fromDate, toDate } = this.resolveDateRange(fetchOptions);
    const useJson = (fetchOptions.apiFormat || this.apiFormat) !== 'xml';

    try {
      const exportResult = useJson
        ? await this.postJsonExport({ companyName, fromDate, toDate, reportId })
        : await this.postXmlExport({ companyName, fromDate, toDate, reportId });

      return {
        ...exportResult,
        companyName,
        reportId,
        fromDate,
        toDate,
        apiFormat: useJson ? 'json' : 'xml'
      };
    } catch (error) {
      const apiMessage = error.response?.data || error.message;
      logger.error('TallyPrime API request failed', {
        baseUrl: this.baseUrl,
        reportId,
        status: error.response?.status,
        error: apiMessage
      });

      const isConnectionError = error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND';
      const requestError = new Error(
        isConnectionError
          ? `Cannot reach TallyPrime at ${this.baseUrl}. Ensure Tally is running with HTTP server enabled on port ${this.port}.`
          : `TallyPrime request failed: ${apiMessage}`
      );
      requestError.statusCode = isConnectionError ? 503 : (error.statusCode || 502);
      throw requestError;
    }
  }

  async fetchDayBookTransactions(fetchOptions = {}) {
    const exportResult = await this.exportDayBook(fetchOptions);
    const rawVouchers = Array.isArray(exportResult.vouchers) ? exportResult.vouchers : [];
    const transactions = rawVouchers
      .map((voucher) => this.mapVoucherToTransaction(voucher))
      .filter((row) => row.voucher_date && (row.amount || row.debit || row.credit));

    return {
      transactions,
      meta: {
        companyName: exportResult.companyName,
        reportId: exportResult.reportId,
        fromDate: exportResult.fromDate,
        toDate: exportResult.toDate,
        apiFormat: exportResult.apiFormat,
        voucherCount: rawVouchers.length
      }
    };
  }

  /**
   * Entry point used by AccountingSyncService (same contract as Zoho/QuickBooks clients).
   */
  async fetchAllTransactions(fetchOptions = {}) {
    return this.fetchDayBookTransactions(fetchOptions);
  }
}

module.exports = TallyPrimeClient;
