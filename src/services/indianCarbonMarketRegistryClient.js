const axios = require('axios');
const logger = require('../utils/logger');
const {
  ICM_PORTAL_BASE_URL,
  ICM_REGISTRY_API_DEFAULT_BASE_URL
} = require('../constants/indianCarbonMarket');

class IndianCarbonMarketRegistryClient {
  constructor(options = {}) {
    this.enabled = options.enabled ?? (process.env.INDIAN_CARBON_REGISTRY_ENABLED === 'true');
    this.baseUrl = (
      options.baseUrl
      || process.env.INDIAN_CARBON_REGISTRY_BASE_URL
      || ICM_REGISTRY_API_DEFAULT_BASE_URL
    );
    this.portalBaseUrl = options.portalBaseUrl || process.env.INDIAN_CARBON_PORTAL_BASE_URL || ICM_PORTAL_BASE_URL;
    this.apiKey = options.apiKey || process.env.INDIAN_CARBON_REGISTRY_API_KEY || '';
    this.timeout = Number(options.timeout || process.env.INDIAN_CARBON_REGISTRY_TIMEOUT_MS || 15000);

    this.healthPath = options.healthPath || process.env.INDIAN_CARBON_REGISTRY_HEALTH_PATH || '/v1/health';
    this.msmeCreditsPath = options.msmeCreditsPath || process.env.INDIAN_CARBON_REGISTRY_MSME_CREDITS_PATH || '/v1/msmes/:msmeId/credits';
    this.syncPath = options.syncPath || process.env.INDIAN_CARBON_REGISTRY_SYNC_PATH || '/v1/msmes/:msmeId/credits/sync';
    this.retirementPath = options.retirementPath || process.env.INDIAN_CARBON_REGISTRY_RETIREMENT_PATH || '/v1/msmes/:msmeId/retirements';

    this.http = axios.create({
      baseURL: this.baseUrl || undefined,
      timeout: Number.isFinite(this.timeout) && this.timeout > 0 ? this.timeout : 15000
    });
  }

  isConfigured() {
    return this.enabled && Boolean(this.baseUrl) && Boolean(this.apiKey);
  }

  getConfigurationStatus() {
    return {
      enabled: this.enabled,
      configured: this.isConfigured(),
      baseUrlConfigured: Boolean(this.baseUrl),
      apiKeyConfigured: Boolean(this.apiKey),
      timeoutMs: this.timeout,
      portalBaseUrl: this.portalBaseUrl,
      registryBaseUrl: this.baseUrl || ICM_REGISTRY_API_DEFAULT_BASE_URL
    };
  }

  buildPath(pathTemplate, replacements = {}) {
    return Object.entries(replacements).reduce((path, [key, value]) => (
      path.replace(`:${key}`, encodeURIComponent(String(value)))
    ), pathTemplate);
  }

  ensureAvailable() {
    if (!this.enabled) {
      const error = new Error('Indian carbon market registry integration is disabled');
      error.statusCode = 503;
      throw error;
    }

    if (!this.baseUrl || !this.apiKey) {
      const error = new Error('Indian carbon market registry configuration is incomplete');
      error.statusCode = 500;
      throw error;
    }
  }

  async request(method, path, options = {}) {
    this.ensureAvailable();
    try {
      const response = await this.http.request({
        method,
        url: path,
        params: options.params,
        data: options.data,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey
        }
      });

      return response.data;
    } catch (error) {
      const registryErrorMessage = error.response?.data?.message || error.message;
      logger.error('Indian carbon market registry API request failed', {
        method,
        path,
        status: error.response?.status,
        error: registryErrorMessage
      });

      const requestError = new Error(`Indian carbon market registry request failed: ${registryErrorMessage}`);
      requestError.statusCode = error.response?.status || 502;
      throw requestError;
    }
  }

  async getHealthStatus() {
    return this.request('get', this.healthPath);
  }

  async getMSMECredits(msmeId) {
    const path = this.buildPath(this.msmeCreditsPath, { msmeId });
    return this.request('get', path);
  }

  async syncMSMECredits(msmeId, payload) {
    const path = this.buildPath(this.syncPath, { msmeId });
    return this.request('post', path, { data: payload });
  }

  async recordRetirement(msmeId, payload) {
    const path = this.buildPath(this.retirementPath, { msmeId });
    return this.request('post', path, { data: payload });
  }
}

module.exports = IndianCarbonMarketRegistryClient;
