const packageJson = require('../../package.json');
const { PARTNER_SCOPES } = require('../services/partnerApiService');

const apiVersion = process.env.API_VERSION || packageJson.version || '2.3.2';

const quotaExceededResponse = {
  description: 'Usage quota exceeded (when PARTNER_USAGE_ENFORCEMENT=hard)',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/QuotaExceededResponse' }
    }
  }
};

const rateLimitResponse = {
  description: 'Per-minute rate limit exceeded for partner tier',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/RateLimitResponse' }
    }
  }
};

const partnerUsageHeaders = {
  'X-Partner-Usage-Api-Calls': {
    description: 'Billable API calls used in the current calendar month',
    schema: { type: 'integer' }
  },
  'X-Partner-Usage-Limit-Api-Calls': {
    description: 'Included API calls per month under the partnership agreement',
    schema: { type: 'integer' }
  },
  'X-Partner-Usage-Period-Reset': {
    description: 'ISO timestamp when monthly counters reset',
    schema: { type: 'string', format: 'date-time' }
  }
};

const buildPublicPartnerOpenApi = (baseUrl = '/api') => ({
  openapi: '3.0.3',
  info: {
    title: 'Carbon Intelligence Partner API',
    version: apiVersion,
    description:
      'Machine-to-machine APIs for banks, auditors, verification agencies, and integration partners. '
      + 'Authenticate with a partner API key via `Authorization: Bearer <key>` or `X-API-Key`. '
      + 'Responses include usage metering headers (`X-Partner-Usage-*`) on partner routes.'
  },
  servers: [{ url: baseUrl, description: 'API base path' }],
  tags: [
    { name: 'Public', description: 'Unauthenticated integration catalog' },
    { name: 'Partners', description: 'Partner API (API key required)' },
    { name: 'Metering', description: 'Usage quotas and billing estimates' }
  ],
  components: {
    securitySchemes: {
      partnerApiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Partner API key (ci_live_…). Bearer token with the same value is also accepted.'
      }
    },
    schemas: {
      SuccessEnvelope: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'object' }
        }
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string' }
        }
      },
      QuotaExceededResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          code: { type: 'string', example: 'PARTNER_QUOTA_EXCEEDED' },
          message: { type: 'string' },
          exceeded: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                metric: { type: 'string' },
                used: { type: 'integer' },
                limit: { type: 'integer' }
              }
            }
          }
        }
      },
      RateLimitResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          code: { type: 'string', example: 'PARTNER_RATE_LIMIT_EXCEEDED' },
          message: { type: 'string' },
          rateLimitTier: { type: 'string', enum: ['standard', 'elevated'] }
        }
      },
      UsageQuota: {
        type: 'object',
        properties: {
          metric: { type: 'string' },
          label: { type: 'string' },
          period: { type: 'string', enum: ['month', 'year'] },
          used: { type: 'integer' },
          limit: { type: 'integer' },
          remaining: { type: 'integer' },
          percentUsed: { type: 'number' },
          exceeded: { type: 'boolean' }
        }
      }
    }
  },
  paths: {
    '/v1/public/integration-catalog': {
      get: {
        tags: ['Public'],
        summary: 'Integration catalog and authentication guide',
        responses: { 200: { description: 'Catalog JSON' } }
      }
    },
    '/v1/public/openapi.json': {
      get: {
        tags: ['Public'],
        summary: 'OpenAPI 3 document for partner endpoints',
        responses: { 200: { description: 'OpenAPI JSON' } }
      }
    },
    '/v1/partners/me': {
      get: {
        tags: ['Partners'],
        summary: 'Current partner application profile',
        security: [{ partnerApiKey: [] }],
        responses: {
          200: { description: 'Partner profile', headers: partnerUsageHeaders },
          401: { description: 'Invalid API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          429: rateLimitResponse
        }
      }
    },
    '/v1/partners/usage': {
      get: {
        tags: ['Metering'],
        summary: 'Usage quotas, daily series, and indicative billing',
        security: [{ partnerApiKey: [] }],
        parameters: [
          {
            name: 'days',
            in: 'query',
            schema: { type: 'integer', default: 30, minimum: 7, maximum: 90 },
            description: 'Number of days for the daily usage series'
          }
        ],
        responses: {
          200: { description: 'Usage summary with quotas and billing estimate' },
          401: { description: 'Invalid API key' },
          429: rateLimitResponse
        }
      }
    },
    '/v1/partners/msmes': {
      get: {
        tags: ['Partners'],
        summary: 'List MSME summaries (scoped)',
        security: [{ partnerApiKey: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          200: { description: 'Paginated MSME list', headers: partnerUsageHeaders },
          429: { oneOf: [rateLimitResponse, quotaExceededResponse] }
        }
      }
    },
    '/v1/partners/msmes/{msmeId}/carbon-summary': {
      get: {
        tags: ['Partners'],
        summary: 'Latest carbon assessment summary for an MSME',
        security: [{ partnerApiKey: [] }],
        parameters: [{ name: 'msmeId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Carbon summary', headers: partnerUsageHeaders },
          404: { description: 'MSME not found' },
          429: { oneOf: [rateLimitResponse, quotaExceededResponse] }
        }
      }
    },
    '/v1/partners/msmes/{msmeId}/reports/overview': {
      get: {
        tags: ['Partners'],
        summary: 'Reporting readiness overview for an MSME',
        security: [{ partnerApiKey: [] }],
        parameters: [{ name: 'msmeId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Reports overview (metered as report pull)', headers: partnerUsageHeaders },
          429: { oneOf: [rateLimitResponse, quotaExceededResponse] }
        }
      }
    },
    '/v1/partners/msmes/{msmeId}/transactions/summary': {
      get: {
        tags: ['Partners'],
        summary: 'Aggregated transaction metrics (no line-item PII)',
        security: [{ partnerApiKey: [] }],
        parameters: [{ name: 'msmeId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Transaction summary', headers: partnerUsageHeaders },
          429: { oneOf: [rateLimitResponse, quotaExceededResponse] }
        }
      }
    },
    '/v1/partners/webhook': {
      patch: {
        tags: ['Partners'],
        summary: 'Configure outbound webhook URL',
        security: [{ partnerApiKey: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  webhookUrl: { type: 'string', nullable: true, description: 'HTTPS URL or null to clear' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Webhook configuration updated', headers: partnerUsageHeaders },
          400: { description: 'Invalid webhook URL' },
          403: { description: 'Missing webhooks:manage scope' },
          429: { oneOf: [rateLimitResponse, quotaExceededResponse] }
        }
      }
    }
  },
  'x-partner-scopes': PARTNER_SCOPES,
  'x-partner-metering': {
    enforcementMode: 'PARTNER_USAGE_ENFORCEMENT env (off | soft | hard)',
    rateLimitTiers: {
      standard: '60 requests / minute',
      elevated: '300 requests / minute'
    },
    usageHeaders: Object.keys(partnerUsageHeaders)
  }
});

module.exports = { buildPublicPartnerOpenApi, apiVersion };
