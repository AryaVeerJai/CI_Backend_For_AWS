const path = require('path');

jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

const { spawn } = require('child_process');
const fs = require('fs').promises;
const ocrAutomationService = require('../services/ocrAutomationService');

const AUTOMATION_DIR = path.join(__dirname, '../../../ai-model/data/ocr_automation');

describe('ocrAutomationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getMetrics returns summary fields from latest report', async () => {
    const summary = {
      cases_run: 3,
      cases_passed: 2,
      pass_rate: 0.6667,
      field_accuracy: { gstin: 1 },
      mean_invoice_confidence: 0.9,
      processing_time_summary: { mean_ms: 100 }
    };
    jest.spyOn(ocrAutomationService, 'getLatestAutomationReport').mockResolvedValue({
      summary,
      full: { results: [] }
    });

    const metrics = await ocrAutomationService.getMetrics();
    expect(metrics.casesRun).toBe(3);
    expect(metrics.passRate).toBe(0.6667);
    expect(metrics.fieldAccuracy.gstin).toBe(1);
  });

  it('getFailedInvoices returns failure analysis structure', async () => {
    jest.spyOn(ocrAutomationService, 'getLatestAutomationReport').mockResolvedValue({
      full: {
        failure_analysis: {
          failed_invoices: [{ id: 'x' }],
          field_failure_counts: { amount: 1 },
          low_confidence_invoices: []
        }
      }
    });

    const data = await ocrAutomationService.getFailedInvoices();
    expect(data.failedInvoices).toHaveLength(1);
    expect(data.fieldFailureCounts.amount).toBe(1);
  });

  it('runAutomation spawns python module and persists report', async () => {
    const mockProc = {
      stdout: { on: jest.fn((ev, cb) => ev === 'data' && cb(Buffer.from('ok'))) },
      stderr: { on: jest.fn() },
      on: jest.fn((ev, cb) => {
        if (ev === 'close') setImmediate(() => cb(0));
      }),
      kill: jest.fn()
    };
    spawn.mockReturnValue(mockProc);

    const summary = {
      cases_run: 2,
      cases_passed: 2,
      pass_rate: 1,
      field_accuracy: {},
      mean_invoice_confidence: 0.95,
      failed_extractions: []
    };

    jest.spyOn(ocrAutomationService, 'getLatestAutomationReport').mockResolvedValue({
      summary,
      full: { results: [], failure_analysis: {}, regression: {} }
    });
    jest.spyOn(ocrAutomationService, 'persistReport').mockImplementation(async (report) => ({
      id: 'automation_test',
      summary: report.summary
    }));

    const result = await ocrAutomationService.runAutomation({ workers: 1 });
    expect(spawn).toHaveBeenCalled();
    expect(result.id).toBe('automation_test');
  });
});
