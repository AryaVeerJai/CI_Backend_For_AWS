const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

const AI_MODEL_ROOT = path.join(__dirname, '../../../ai-model');
const AUTOMATION_DIR = path.join(AI_MODEL_ROOT, 'data', 'ocr_automation');
const BENCHMARK_DIR = path.join(AI_MODEL_ROOT, 'data', 'ocr_benchmark');
const BENCHMARK_MANIFEST = path.join(AI_MODEL_ROOT, 'data', 'ocr_benchmark_cases.json');
const BACKEND_AUTOMATION_DIR = path.join(__dirname, '../../data/ocr_automation_reports');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

class OcrAutomationService {
  async ensureDirs() {
    await fs.mkdir(BACKEND_AUTOMATION_DIR, { recursive: true });
    await fs.mkdir(AUTOMATION_DIR, { recursive: true });
  }

  _spawnAutomation(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const py = process.platform === 'win32' ? 'python' : 'python3';
      const proc = spawn(py, ['-m', 'ocr.automation', ...args], {
        cwd: AI_MODEL_ROOT,
        env: process.env
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill('SIGTERM');
          reject(new Error(`Automation timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          return reject(new Error(stderr || stdout || `Automation exited with code ${code}`));
        }
        resolve({ stdout, stderr });
      });
    });
  }

  async _readJsonSafe(filePath, fallback = null) {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  async getLatestAutomationReport() {
    const summary = await this._readJsonSafe(path.join(AUTOMATION_DIR, 'automation_summary.json'));
    const full = await this._readJsonSafe(path.join(AUTOMATION_DIR, 'automation_report.json'));
    if (!summary && !full) {
      const bench = await this._readJsonSafe(path.join(BENCHMARK_DIR, 'benchmark_summary.json'));
      const benchFull = await this._readJsonSafe(path.join(BENCHMARK_DIR, 'benchmark_report.json'));
      if (!bench) {
        throw new Error('No automation report found');
      }
      return { summary: bench, full: benchFull };
    }
    return { summary: summary || full, full };
  }

  async runAutomation(options = {}) {
    await this.ensureDirs();
    const manifestPath = options.manifestPath || BENCHMARK_MANIFEST;
    const args = ['--manifest', manifestPath, '--out', AUTOMATION_DIR, '--workers', String(options.workers || 2)];

    if (options.writeBaseline) args.push('--write-baseline');
    if (options.rerunFailed) args.push('--rerun-failed');
    if (options.extractionOnly) args.push('--extraction-only');
    if (options.folderScan) args.push('--folder', options.folderScan);
    if (Array.isArray(options.caseIds) && options.caseIds.length) {
      args.push('--cases', ...options.caseIds);
    }

    await this._spawnAutomation(args, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const report = await this.getLatestAutomationReport();
    return this.persistReport(report, { ...options, runType: options.rerunFailed ? 'rerun_failed' : 'full' });
  }

  async rerunFailed(options = {}) {
    return this.runAutomation({ ...options, rerunFailed: true });
  }

  async persistReport(report, options = {}) {
    await this.ensureDirs();
    const id = `automation_${Date.now()}`;
    const summary = report.summary || report.full || {};
    const full = report.full || report.summary;

    const payload = {
      id,
      runType: options.runType || 'full',
      organizationId: options.organizationId || null,
      runBy: options.runBy || null,
      createdAt: new Date().toISOString(),
      summary,
      passRate: summary.pass_rate,
      casesRun: summary.cases_run,
      casesPassed: summary.cases_passed,
      casesFailed: summary.cases_failed,
      fieldAccuracy: summary.field_accuracy,
      meanInvoiceConfidence: summary.mean_invoice_confidence,
      processingMetrics: summary.processing_time_summary,
      failureAnalysis: full?.failure_analysis || summary.failure_analysis,
      regression: full?.regression || summary.regression,
      results: full?.results || [],
      failedExtractions: summary.failed_extractions || []
    };

    await fs.writeFile(
      path.join(BACKEND_AUTOMATION_DIR, `${id}.json`),
      JSON.stringify(payload, null, 2),
      'utf-8'
    );
    return payload;
  }

  async listReports(limit = 20) {
    await this.ensureDirs();
    const files = (await fs.readdir(BACKEND_AUTOMATION_DIR))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();

    const reports = [];
    for (const file of files.slice(0, limit)) {
      const doc = JSON.parse(await fs.readFile(path.join(BACKEND_AUTOMATION_DIR, file), 'utf-8'));
      reports.push({
        id: doc.id,
        createdAt: doc.createdAt,
        runType: doc.runType,
        casesRun: doc.casesRun ?? doc.summary?.cases_run,
        casesPassed: doc.casesPassed ?? doc.summary?.cases_passed,
        passRate: doc.passRate ?? doc.summary?.pass_rate,
        meanInvoiceConfidence: doc.meanInvoiceConfidence ?? doc.summary?.mean_invoice_confidence,
        failedCount: (doc.failedExtractions || []).length,
        regressionDegraded: Boolean(doc.regression?.degraded)
      });
    }
    return reports;
  }

  async getReportById(id) {
    const filePath = path.join(BACKEND_AUTOMATION_DIR, `${id}.json`);
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  }

  async getFailedInvoices(reportId = null) {
    let report;
    if (reportId) {
      report = await this.getReportById(reportId);
    } else {
      report = (await this.getLatestAutomationReport()).full;
    }
    const analysis = report?.failure_analysis || {};
    return {
      failedInvoices: analysis.failed_invoices || report?.failed_extractions || [],
      fieldFailureCounts: analysis.field_failure_counts || {},
      lowConfidence: analysis.low_confidence_invoices || []
    };
  }

  async getMetrics(reportId = null) {
    let summary;
    if (reportId) {
      const report = await this.getReportById(reportId);
      summary = report.summary;
    } else {
      summary = (await this.getLatestAutomationReport()).summary;
    }
    return {
      casesRun: summary?.cases_run,
      casesPassed: summary?.cases_passed,
      casesFailed: summary?.cases_failed,
      passRate: summary?.pass_rate,
      fieldAccuracy: summary?.field_accuracy,
      meanInvoiceConfidence: summary?.mean_invoice_confidence,
      ocrConfidenceSummary: summary?.ocr_confidence_summary,
      processingTimeSummary: summary?.processing_time_summary,
      meanProcessingTimeMs: summary?.mean_processing_time_ms
    };
  }

  async getRegression(reportId = null) {
    let regression;
    if (reportId) {
      const report = await this.getReportById(reportId);
      regression = report.regression;
    } else {
      const full = (await this.getLatestAutomationReport()).full;
      regression = full?.regression;
      if (!regression) {
        regression = await this._readJsonSafe(path.join(AUTOMATION_DIR, 'regression_report.json'), {});
      }
    }
    return regression || { has_baseline: false };
  }

  async getFailureAnalysis(reportId = null) {
    if (reportId) {
      const report = await this.getReportById(reportId);
      return report.failureAnalysis || {};
    }
    return this._readJsonSafe(path.join(AUTOMATION_DIR, 'failure_analysis.json'), {});
  }

  /** Merge automation + legacy benchmark history for dashboard */
  async listAllReportHistory(limit = 30) {
    const automation = await this.listReports(limit);
    return automation;
  }
}

module.exports = new OcrAutomationService();
