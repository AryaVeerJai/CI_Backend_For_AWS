const request = require('supertest');

jest.mock('../config/database', () => jest.fn());
jest.mock('../services/aiAgentService', () => ({
  initialize: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../services/orchestrationManagerEventService', () => ({
  registerExternalListeners: jest.fn(),
  on: jest.fn()
}));
jest.mock('../services/realTimeMonitoringInstance', () => ({}));
jest.mock('../services/enhancedMonitoringService', () => ({}));
jest.mock('../services/dataFlowOptimizationService', () => ({}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const app = require('../server');

describe('Data processor routes', () => {
  test('returns 400 for invalid transactions JSON body', async () => {
    const response = await request(app)
      .post('/api/data-processor/test')
      .send({ transactions: '{not-json' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/invalid transactions json/i);
  });
});
