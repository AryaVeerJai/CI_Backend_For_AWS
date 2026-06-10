const axios = require('axios');
const logger = require('../../utils/logger');

class ZohoBooksClient {
  constructor(options = {}) {
    this.enabled = options.enabled ?? (process.env.ZOHO_BOOKS_ENABLED === 'true');
    this.clientId = options.clientId || process.env.ZOHO_BOOKS_CLIENT_ID || '';
    this.clientSecret = options.clientSecret || process.env.ZOHO_BOOKS_CLIENT_SECRET || '';
    this.refreshToken = options.refreshToken || process.env.ZOHO_BOOKS_REFRESH_TOKEN || '';
    this.organizationId = options.organizationId || process.env.ZOHO_BOOKS_ORGANIZATION_ID || '';
    this.apiDomain = options.apiDomain || process.env.ZOHO_BOOKS_API_DOMAIN || 'https://www.zohoapis.in';
    this.accountsDomain = options.accountsDomain || process.env.ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.in';
    this.timeout = Number(options.timeout || process.env.ZOHO_BOOKS_TIMEOUT_MS || 15000);

    this.http = axios.create({
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
      && Boolean(this.organizationId);
  }

  getConfigurationStatus() {
    return {
      enabled: this.enabled,
      configured: this.isConfigured(),
      organizationIdConfigured: Boolean(this.organizationId),
      clientIdConfigured: Boolean(this.clientId),
      clientSecretConfigured: Boolean(this.clientSecret),
      refreshTokenConfigured: Boolean(this.refreshToken),
      apiDomain: this.apiDomain,
      timeoutMs: this.timeout
    };
  }

  ensureAvailable() {
    if (!this.enabled) {
      const error = new Error('Zoho Books integration is disabled');
      error.statusCode = 503;
      throw error;
    }

    if (!this.isConfigured()) {
      const error = new Error('Zoho Books configuration is incomplete');
      error.statusCode = 500;
      throw error;
    }
  }

  async refreshAccessToken() {
    const response = await this.http.post(`${this.accountsDomain}/oauth/v2/token`, null, {
      params: {
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token'
      }
    });

    const { access_token: accessToken, expires_in: expiresInSec } = response.data || {};
    if (!accessToken) {
      throw new Error('Zoho Books token refresh did not return an access token');
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
        url: `${this.apiDomain}${path}`,
        params: options.params,
        data: options.data,
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      const apiMessage = error.response?.data?.message || error.message;
      logger.error('Zoho Books API request failed', {
        method,
        path,
        status: error.response?.status,
        error: apiMessage
      });

      const requestError = new Error(`Zoho Books request failed: ${apiMessage}`);
      requestError.statusCode = error.response?.status || 502;
      throw requestError;
    }
  }

  mapBankTransaction(txn = {}) {
    return {
      transaction_id: txn.transaction_id || txn.banktransaction_id,
      transaction_date: txn.date,
      description: txn.description || txn.reference_number,
      total: txn.amount,
      type: Number(txn.debit_or_credit) === 2 ? 'income' : 'expense',
      vendor_name: txn.payee || txn.customer_name,
      currency_code: txn.currency_code || 'INR'
    };
  }

  mapExpense(expense = {}) {
    return {
      transaction_id: expense.expense_id || expense.transaction_id,
      transaction_date: expense.date,
      description: expense.description || expense.reference_number || expense.account_name,
      total: expense.total ?? expense.amount,
      type: 'expense',
      vendor_name: expense.vendor_name || expense.customer_name,
      currency_code: expense.currency_code || 'INR'
    };
  }

  async fetchBankTransactions({ page = 1, perPage = 200 } = {}) {
    const data = await this.request('GET', '/books/v3/banktransactions', {
      params: {
        organization_id: this.organizationId,
        page,
        per_page: perPage
      }
    });

    const transactions = Array.isArray(data?.banktransactions) ? data.banktransactions : [];
    return {
      transactions: transactions.map((txn) => this.mapBankTransaction(txn)),
      pageContext: data?.page_context || null
    };
  }

  async fetchExpenses({ page = 1, perPage = 200 } = {}) {
    const data = await this.request('GET', '/books/v3/expenses', {
      params: {
        organization_id: this.organizationId,
        page,
        per_page: perPage
      }
    });

    const expenses = Array.isArray(data?.expenses) ? data.expenses : [];
    return {
      transactions: expenses.map((expense) => this.mapExpense(expense)),
      pageContext: data?.page_context || null
    };
  }

  async fetchAllTransactions({ page = 1, perPage = 200, syncAllPages = false } = {}) {
    const bankResult = await this.fetchBankTransactions({ page, perPage });
    let bankTransactions = [...bankResult.transactions];
    let bankPageContext = bankResult.pageContext;

    if (syncAllPages && bankPageContext?.has_more_page) {
      let nextPage = Number(bankPageContext.page || page) + 1;
      while (bankPageContext?.has_more_page) {
        const nextResult = await this.fetchBankTransactions({ page: nextPage, perPage });
        bankTransactions = bankTransactions.concat(nextResult.transactions);
        bankPageContext = nextResult.pageContext;
        nextPage += 1;
      }
    }

    const expenseResult = await this.fetchExpenses({ page: 1, perPage });
    let expenseTransactions = [...expenseResult.transactions];
    let expensePageContext = expenseResult.pageContext;

    if (syncAllPages && expensePageContext?.has_more_page) {
      let nextPage = Number(expensePageContext.page || 1) + 1;
      while (expensePageContext?.has_more_page) {
        const nextResult = await this.fetchExpenses({ page: nextPage, perPage });
        expenseTransactions = expenseTransactions.concat(nextResult.transactions);
        expensePageContext = nextResult.pageContext;
        nextPage += 1;
      }
    }

    return {
      transactions: bankTransactions.concat(expenseTransactions),
      pageContext: {
        bank: bankPageContext,
        expenses: expensePageContext
      }
    };
  }
}

module.exports = ZohoBooksClient;
