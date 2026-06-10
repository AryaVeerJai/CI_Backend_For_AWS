const axios = require('axios');
const logger = require('../../utils/logger');

class QuickBooksClient {
  constructor(options = {}) {
    this.enabled = options.enabled ?? (process.env.QUICKBOOKS_ENABLED === 'true');
    this.clientId = options.clientId || process.env.QUICKBOOKS_CLIENT_ID || '';
    this.clientSecret = options.clientSecret || process.env.QUICKBOOKS_CLIENT_SECRET || '';
    this.refreshToken = options.refreshToken || process.env.QUICKBOOKS_REFRESH_TOKEN || '';
    this.realmId = options.realmId || process.env.QUICKBOOKS_REALM_ID || '';
    this.environment = options.environment || process.env.QUICKBOOKS_ENVIRONMENT || 'production';
    this.timeout = Number(options.timeout || process.env.QUICKBOOKS_TIMEOUT_MS || 15000);

    const baseUrlByEnvironment = {
      sandbox: 'https://sandbox-quickbooks.api.intuit.com',
      production: 'https://quickbooks.api.intuit.com'
    };
    this.baseUrl = options.baseUrl || baseUrlByEnvironment[this.environment] || baseUrlByEnvironment.production;

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: Number.isFinite(this.timeout) && this.timeout > 0 ? this.timeout : 15000
    });

    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  isConfigured() {
    return this.enabled
      && Boolean(this.clientId)
      && Boolean(this.clientSecret)
      && Boolean(this.refreshToken)
      && Boolean(this.realmId);
  }

  getConfigurationStatus() {
    return {
      enabled: this.enabled,
      configured: this.isConfigured(),
      realmIdConfigured: Boolean(this.realmId),
      clientIdConfigured: Boolean(this.clientId),
      clientSecretConfigured: Boolean(this.clientSecret),
      refreshTokenConfigured: Boolean(this.refreshToken),
      environment: this.environment,
      baseUrl: this.baseUrl,
      timeoutMs: this.timeout
    };
  }

  ensureAvailable() {
    if (!this.enabled) {
      const error = new Error('QuickBooks integration is disabled');
      error.statusCode = 503;
      throw error;
    }

    if (!this.isConfigured()) {
      const error = new Error('QuickBooks configuration is incomplete');
      error.statusCode = 500;
      throw error;
    }
  }

  async refreshAccessToken() {
    const tokenResponse = await axios.post(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken
      }).toString(),
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: this.timeout
      }
    );

    const { access_token: accessToken, expires_in: expiresInSec } = tokenResponse.data || {};
    if (!accessToken) {
      throw new Error('QuickBooks token refresh did not return an access token');
    }

    this.accessToken = accessToken;
    const ttlMs = Number(expiresInSec || 3600) * 1000;
    this.accessTokenExpiresAt = Date.now() + ttlMs - 60000;
    return accessToken;
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }
    return this.refreshAccessToken();
  }

  async request(method, path, options = {}) {
    this.ensureAvailable();
    const accessToken = await this.getAccessToken();

    try {
      const response = await this.http.request({
        method,
        url: path,
        params: options.params,
        data: options.data,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      const apiMessage = error.response?.data?.Fault?.Error?.[0]?.Message
        || error.response?.data?.message
        || error.message;
      logger.error('QuickBooks API request failed', {
        method,
        path,
        status: error.response?.status,
        error: apiMessage
      });

      const requestError = new Error(`QuickBooks request failed: ${apiMessage}`);
      requestError.statusCode = error.response?.status || 502;
      throw requestError;
    }
  }

  mapPurchase(txn = {}) {
    return {
      Id: txn.Id,
      TxnDate: txn.TxnDate,
      TotalAmt: txn.TotalAmt,
      PrivateNote: txn.PrivateNote,
      DocNumber: txn.DocNumber,
      TxnType: 'Purchase',
      EntityRef: txn.EntityRef || txn.VendorRef,
      CurrencyRef: txn.CurrencyRef
    };
  }

  mapBill(txn = {}) {
    return {
      Id: txn.Id,
      TxnDate: txn.TxnDate,
      TotalAmt: txn.TotalAmt,
      PrivateNote: txn.PrivateNote || txn.Memo,
      DocNumber: txn.DocNumber,
      TxnType: 'Bill',
      EntityRef: txn.VendorRef,
      CurrencyRef: txn.CurrencyRef
    };
  }

  async queryEntities(entityName, { startPosition = 1, maxResults = 200 } = {}) {
    const query = `select * from ${entityName} startposition ${startPosition} maxresults ${maxResults}`;
    const data = await this.request('GET', `/v3/company/${this.realmId}/query`, {
      params: { query, minorversion: 70 }
    });

    const rows = data?.QueryResponse?.[entityName];
    const transactions = Array.isArray(rows) ? rows : (rows ? [rows] : []);

    return {
      transactions,
      startPosition,
      maxResults
    };
  }

  async fetchPurchases({ startPosition = 1, maxResults = 200 } = {}) {
    const result = await this.queryEntities('Purchase', { startPosition, maxResults });
    return {
      transactions: result.transactions.map((txn) => this.mapPurchase(txn)),
      startPosition: result.startPosition,
      maxResults: result.maxResults
    };
  }

  async fetchBills({ startPosition = 1, maxResults = 200 } = {}) {
    const result = await this.queryEntities('Bill', { startPosition, maxResults });
    return {
      transactions: result.transactions.map((txn) => this.mapBill(txn)),
      startPosition: result.startPosition,
      maxResults: result.maxResults
    };
  }

  async fetchAllTransactions({ startPosition = 1, maxResults = 200, syncAllPages = false } = {}) {
    const fetchEntityPages = async (fetchFn, mapFn) => {
      let position = startPosition;
      const collected = [];

      let hasMorePages = true;
      while (hasMorePages) {
        const result = await fetchFn({ startPosition: position, maxResults });
        collected.push(...result.transactions.map(mapFn));
        const fetchedCount = result.transactions.length;
        if (!syncAllPages || fetchedCount < maxResults) {
          hasMorePages = false;
        } else {
          position += fetchedCount;
        }
      }

      return collected;
    };

    const purchases = await fetchEntityPages(
      (opts) => this.fetchPurchases(opts),
      (txn) => txn
    );
    const bills = await fetchEntityPages(
      (opts) => this.fetchBills(opts),
      (txn) => txn
    );

    return {
      transactions: purchases.concat(bills),
      startPosition,
      maxResults
    };
  }
}

module.exports = QuickBooksClient;
