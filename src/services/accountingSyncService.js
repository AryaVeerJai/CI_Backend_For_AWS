const { API_CONNECTOR_IDS, getConnectorById } = require('./connectors/accountingConnectorRegistry');
const ZohoBooksClient = require('./connectors/zohoBooksClient');
const QuickBooksClient = require('./connectors/quickbooksClient');
const TallyPrimeClient = require('./connectors/tallyPrimeClient');
const MSME = require('../models/MSME');
const { parseTransactions } = require('./accountingTransactionParserService');
const msmeConnectorConnectionService = require('./msmeConnectorConnectionService');

class AccountingSyncService {
  constructor(options = {}) {
    this.zohoBooksClient = options.zohoBooksClient || new ZohoBooksClient();
    this.quickbooksClient = options.quickbooksClient || new QuickBooksClient();
    this.tallyPrimeClient = options.tallyPrimeClient || new TallyPrimeClient();
    this.msmeConnectorConnectionService = options.msmeConnectorConnectionService || msmeConnectorConnectionService;
  }

  getPlatformApiClient(providerId) {
    if (providerId === 'zoho') return this.zohoBooksClient;
    if (providerId === 'quickbooks') return this.quickbooksClient;
    if (providerId === 'tally') return this.tallyPrimeClient;
    return null;
  }

  async resolveApiClient(providerId, fetchOptions = {}) {
    const resolved = await this.msmeConnectorConnectionService.resolveApiClientForOwner({
      msmeId: fetchOptions.msmeId,
      organizationId: fetchOptions.organizationId,
      providerId,
      legalName: fetchOptions.legalName,
      companyName: fetchOptions.companyName
    });

    const tallyContext = providerId === 'tally'
      ? {
        companyName: fetchOptions.companyName || resolved.context?.companyName,
        legalName: fetchOptions.legalName || resolved.context?.legalName
      }
      : {};

    if (resolved.client && resolved.source === 'msme') {
      return resolved;
    }

    const platformClient = this.getPlatformApiClient(providerId);
    return {
      client: platformClient,
      source: platformClient?.isConfigured?.(tallyContext) ? 'platform' : null,
      context: {
        companyName: fetchOptions.companyName,
        legalName: fetchOptions.legalName
      }
    };
  }

  async resolveTallyCompanyName(fetchOptions = {}, tallyClient = null) {
    const explicit = String(fetchOptions.companyName || fetchOptions.legalName || '').trim();
    if (explicit) return explicit;

    if (fetchOptions.msmeId) {
      const msme = await MSME.findById(fetchOptions.msmeId).select('companyName').lean();
      const msmeName = String(msme?.companyName || '').trim();
      if (msmeName) return msmeName;
    }

    const client = tallyClient || this.tallyPrimeClient;
    return client.resolveCompanyName();
  }

  async getConnectorStatus(providerId, context = {}) {
    const connector = getConnectorById(providerId);
    if (!connector) {
      const error = new Error(`Unknown accounting connector: ${providerId}`);
      error.statusCode = 404;
      throw error;
    }

    const supportsApiSync = connector.integrationTypes.includes('api');
    const tallyContext = providerId === 'tally'
      ? {
        companyName: context.companyName,
        legalName: context.legalName
      }
      : {};

    const resolved = await this.resolveApiClient(providerId, {
      msmeId: context.msmeId,
      organizationId: context.organizationId,
      legalName: context.legalName,
      companyName: context.companyName
    });

    const client = resolved.client || this.getPlatformApiClient(providerId);
    const configuration = client
      ? client.getConfigurationStatus(providerId === 'tally' ? tallyContext : {})
      : null;

    const msmeConnection = context.msmeId || context.organizationId
      ? await this.msmeConnectorConnectionService.getConnection({
        msmeId: context.msmeId,
        organizationId: context.organizationId,
        provider: providerId
      })
      : null;

    const selfServeConnected = Boolean(msmeConnection && msmeConnection.status === 'connected');
    const apiConfigured = Boolean(configuration?.configured) || selfServeConnected;

    return {
      id: connector.id,
      name: connector.name,
      vendor: connector.vendor,
      supportsImport: connector.integrationTypes.includes('import'),
      supportsApiSync,
      connection: msmeConnection,
      api: configuration
        ? {
          ...configuration,
          configured: apiConfigured,
          selfServeConnected,
          connectionSource: resolved.source || (apiConfigured ? 'platform' : null),
          syncReady: apiConfigured
        }
        : {
          configured: selfServeConnected,
          selfServeConnected,
          connectionSource: resolved.source,
          syncReady: selfServeConnected
        }
    };
  }

  async listConnectorStatuses(context = {}) {
    const statuses = await Promise.all(
      API_CONNECTOR_IDS.map((providerId) => this.getConnectorStatus(providerId, context))
    );
    return statuses;
  }

  async fetchTransactionsFromProvider(providerId, fetchOptions = {}) {
    const normalizedProvider = String(providerId || '').trim().toLowerCase();

    if (!API_CONNECTOR_IDS.includes(normalizedProvider)) {
      const error = new Error(`Provider does not support API sync: ${normalizedProvider}`);
      error.statusCode = 400;
      throw error;
    }

    const resolved = await this.resolveApiClient(normalizedProvider, fetchOptions);
    const client = resolved.client;
    if (!client) {
      const error = new Error(`No API client registered for provider: ${normalizedProvider}`);
      error.statusCode = 500;
      throw error;
    }

    const tallyContext = normalizedProvider === 'tally'
      ? {
        companyName: fetchOptions.companyName || resolved.context?.companyName,
        legalName: fetchOptions.legalName || resolved.context?.legalName
      }
      : {};

    if (!client.isConfigured(tallyContext)) {
      const error = new Error(
        resolved.source === 'msme'
          ? 'Your connector credentials are incomplete. Open Data connectors and update your connection.'
          : 'Accounting API is not configured. Connect Tally, Zoho, or QuickBooks under Data connectors, or ask your administrator to set platform credentials.'
      );
      error.statusCode = resolved.source === 'msme' ? 400 : 503;
      throw error;
    }

    const syncAllPages = Boolean(fetchOptions.syncAllPages);

    if (normalizedProvider === 'zoho') {
      if (syncAllPages || fetchOptions.includeExpenses !== false) {
        return client.fetchAllTransactions({
          page: fetchOptions.page || 1,
          perPage: fetchOptions.perPage || 200,
          syncAllPages
        });
      }
      return client.fetchBankTransactions(fetchOptions);
    }

    if (normalizedProvider === 'quickbooks') {
      if (syncAllPages || fetchOptions.includeBills !== false) {
        return client.fetchAllTransactions({
          startPosition: fetchOptions.startPosition || 1,
          maxResults: fetchOptions.maxResults || 200,
          syncAllPages
        });
      }
      return client.fetchPurchases(fetchOptions);
    }

    if (normalizedProvider === 'tally') {
      const companyName = await this.resolveTallyCompanyName(fetchOptions, client);
      const result = await client.fetchAllTransactions({
        fromDate: fetchOptions.fromDate,
        toDate: fetchOptions.toDate,
        companyName,
        legalName: fetchOptions.legalName,
        reportId: fetchOptions.reportId,
        apiFormat: fetchOptions.apiFormat
      });
      return {
        transactions: result.transactions,
        pageContext: result.meta || null
      };
    }

    const error = new Error(`API sync is not implemented for provider: ${normalizedProvider}`);
    error.statusCode = 501;
    throw error;
  }

  async syncProviderTransactions(providerId, fetchOptions = {}) {
    const normalizedProvider = String(providerId || '').trim().toLowerCase();

    try {
      const fetchResult = await this.fetchTransactionsFromProvider(normalizedProvider, fetchOptions);
      const transactions = Array.isArray(fetchResult.transactions) ? fetchResult.transactions : [];

      const parsedResult = parseTransactions({
        provider: normalizedProvider,
        transactions
      });

      await this.msmeConnectorConnectionService.recordSyncResult({
        msmeId: fetchOptions.msmeId,
        organizationId: fetchOptions.organizationId,
        provider: normalizedProvider,
        errorMessage: null
      });

      return {
        provider: normalizedProvider,
        fetchedCount: transactions.length,
        parsedResult,
        fetchMeta: {
          pageContext: fetchResult.pageContext || null,
          startPosition: fetchResult.startPosition || null,
          maxResults: fetchResult.maxResults || null,
          syncAllPages: Boolean(fetchOptions.syncAllPages)
        }
      };
    } catch (error) {
      await this.msmeConnectorConnectionService.recordSyncResult({
        msmeId: fetchOptions.msmeId,
        organizationId: fetchOptions.organizationId,
        provider: normalizedProvider,
        errorMessage: error.message
      });
      throw error;
    }
  }
}

module.exports = new AccountingSyncService();
module.exports.AccountingSyncService = AccountingSyncService;
