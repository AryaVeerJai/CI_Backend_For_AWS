const request = require('supertest');

jest.mock('../config/database', () => jest.fn());

jest.mock('../services/aiAgentService', () => ({
  initialize: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../services/orchestrationManagerEventService', () => ({
  registerExternalListeners: jest.fn()
}));

jest.mock('../services/realTimeMonitoringInstance', () => ({}));
jest.mock('../services/enhancedMonitoringService', () => ({}));
jest.mock('../services/dataFlowOptimizationService', () => ({}));

jest.mock('../routes/auth', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/msme', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/transactions', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/carbon', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/carbonTrading', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/sms', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/email', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/analytics', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/admin', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/incentives', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/reporting', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/ai-agents', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/ai-workflows', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/multi-agent-workflows', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/optimized-ai-agents', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/orchestration-manager', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/banks', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/greenLoans', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/carbonForecasting', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/carbonCredits', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/giftSchemes', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/giftApplications', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/fuelPrices', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/dataProcessor', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/adminMSME', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/documents', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/dataPrivacy', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/recommendations', () => {
  const express = require('express');
  return express.Router();
});
jest.mock('../routes/ai-carbon-analysis', () => {
  const express = require('express');
  return express.Router();
});

const restoreEnv = () => {
  delete process.env.API_VERSION;
  delete process.env.BASELINE_CODEBASE_VERSION;
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.FRONTEND_URL;
};

describe('Versioning endpoints', () => {
  beforeEach(() => {
    jest.resetModules();
    restoreEnv();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    restoreEnv();
  });

  test('returns default versions from package metadata', async () => {
    const app = require('../server');
    const response = await request(app).get('/api/version');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      apiVersion: '2.3.2',
      baselineCodebaseVersion: '2.3.2'
    });
  });

  test('returns environment overrides when provided', async () => {
    process.env.API_VERSION = '2.3.4';
    process.env.BASELINE_CODEBASE_VERSION = '2026.04.15-baseline';

    const app = require('../server');
    const response = await request(app).get('/api/version');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      apiVersion: '2.3.4',
      baselineCodebaseVersion: '2026.04.15-baseline'
    });
  });

  test('includes version metadata in /health response', async () => {
    process.env.API_VERSION = '3.1.0';
    process.env.BASELINE_CODEBASE_VERSION = '3.1.0-baseline';

    const app = require('../server');
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(['OK', 'DEGRADED']).toContain(response.body.status);
    expect(response.body.dependencies).toBeDefined();
    expect(response.body.aiAgents).toBeDefined();
    expect(response.body.version).toBe('3.1.0');
    expect(response.body.baselineCodebaseVersion).toBe('3.1.0-baseline');
  });

  test('applies CORS allowed origin from comma-separated env list', async () => {
    process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com, https://ops.example.com';
    const app = require('../server');

    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://ops.example.com');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://ops.example.com');
  });

  test('falls back to FRONTEND_URL when CORS_ALLOWED_ORIGINS is not configured', async () => {
    process.env.FRONTEND_URL = 'https://frontend.example.com';
    const app = require('../server');

    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://frontend.example.com');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://frontend.example.com');
  });

  test('returns only apiVersion and baselineCodebaseVersion in /api/version payload', async () => {
    const app = require('../server');
    const response = await request(app).get('/api/version');

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data).sort()).toEqual([
      'apiVersion',
      'baselineCodebaseVersion',
    ]);
  });

  test('trims whitespace from version environment overrides', async () => {
    process.env.API_VERSION = '  5.0.0  ';
    process.env.BASELINE_CODEBASE_VERSION = '  5.0.0-baseline  ';

    const app = require('../server');
    const response = await request(app).get('/api/version');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      apiVersion: '5.0.0',
      baselineCodebaseVersion: '5.0.0-baseline',
    });
  });

  test('rejects disallowed CORS origins without access-control header', async () => {
    process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com';
    const app = require('../server');

    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://evil.example.com');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
