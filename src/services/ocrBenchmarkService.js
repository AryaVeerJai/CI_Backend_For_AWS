const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const ocrAutomationService = require('./ocrAutomationService');

const AI_MODEL_ROOT = path.join(__dirname, '../../../ai-model');
const BENCHMARK_DATA_DIR = path.join(AI_MODEL_ROOT, 'data', 'ocr_benchmark');
const BENCHMARK_MANIFEST = path.join(AI_MODEL_ROOT, 'data', 'ocr_benchmark_cases.json');
const BACKEND_REPORT_DIR = path.join(__dirname, '../../data/ocr_benchmark_reports');

class OcrBenchmarkService {
  async ensureDirs() {
    await fs.mkdir(BACKEND_REPORT_DIR, { recursive: true });
    await fs.mkdir(BENCHMARK_DATA_DIR, { recursive: true });
  }

  async runBenchmark(options = {}) {
    if (options.automation !== false) {
      return ocrAutomationService.runAutomation({
        organizationId: options.organizationId,
        runBy: options.runBy,
        manifestPath: options.manifestPath,
        workers: options.workers,
        writeBaseline: options.writeBaseline,
        rerunFailed: options.rerunFailed,
        folderScan: options.folderScan,
        caseIds: options.caseIds,
        extractionOnly: options.extractionOnly
      });
    }

    await this.ensureDirs();
    const manifestPath = options.manifestPath || BENCHMARK_MANIFEST;

    return new Promise((resolve, reject) => {
      const py = process.platform === 'win32' ? 'python' : 'python3';
      const args = ['-m', 'ocr.benchmark', '--manifest', manifestPath, '--out', BENCHMARK_DATA_DIR];
      const proc = spawn(py, args, { cwd: AI_MODEL_ROOT, env: process.env });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', async (code) => {
        if (code !== 0) {
          return reject(new Error(stderr || stdout || `Benchmark exited with code ${code}`));
        }
        try {
          const report = await this.getLatestReport();
          const stored = await this.persistReport(report, options);
          resolve(stored);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async getLatestReport() {
    try {
      return await ocrAutomationService.getLatestAutomationReport();
    } catch {
      const summaryPath = path.join(BENCHMARK_DATA_DIR, 'benchmark_summary.json');
      const reportPath = path.join(BENCHMARK_DATA_DIR, 'benchmark_report.json');
      const summaryRaw = await fs.readFile(summaryPath, 'utf-8');
      const summary = JSON.parse(summaryRaw);
      let full = null;
      try {
        full = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      } catch {
        full = null;
      }
      return { summary, full };
    }
  }

  async persistReport(report, options = {}) {
    await this.ensureDirs();
    const id = `benchmark_${Date.now()}`;
    const outPath = path.join(BACKEND_REPORT_DIR, `${id}.json`);
    const payload = {
      id,
      organizationId: options.organizationId || null,
      runBy: options.runBy || null,
      createdAt: new Date().toISOString(),
      summary: report.summary,
      results: report.full?.results || [],
      failedExtractions: report.full?.failed_extractions || report.summary?.failed_extractions || []
    };
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf-8');
    return payload;
  }

  async listReports(limit = 20) {
    await this.ensureDirs();
    const files = await fs.readdir(BACKEND_REPORT_DIR);
    const jsonFiles = files.filter((f) => f.endsWith('.json')).sort().reverse();
    const reports = [];
    for (const file of jsonFiles.slice(0, limit)) {
      const raw = await fs.readFile(path.join(BACKEND_REPORT_DIR, file), 'utf-8');
      const doc = JSON.parse(raw);
      reports.push({
        id: doc.id,
        createdAt: doc.createdAt,
        casesRun: doc.summary?.cases_run,
        fieldAccuracy: doc.summary?.field_accuracy,
        meanInvoiceConfidence: doc.summary?.mean_invoice_confidence,
        failedCount: (doc.failedExtractions || []).length
      });
    }
    return reports;
  }

  async getReportById(id) {
    const filePath = path.join(BACKEND_REPORT_DIR, `${id}.json`);
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  }

  normalizeOcrValidation(aiData = {}, extractedData = {}) {
    const fromAi = aiData.ocr_validation || aiData.raw?.ocr_validation || extractedData.ocr_validation;
    if (fromAi && typeof fromAi === 'object') {
      return fromAi;
    }
    return null;
  }

  buildUploadOcrPayload(document = {}) {
    const extracted = document.extractedData || {};
    const validation = extracted.ocr_validation || document.ocrValidation || null;
    const metadata = document.metadata?.ocr || extracted.ocr_metadata || {};
    return {
      ocrValidation: validation,
      ocrMetadata: {
        engines: metadata.engines || extracted.ocr_engines,
        strategy: metadata.strategy || extracted.ocr_strategy,
        thermalDetection: metadata.thermalDetection || validation?.thermal_detection,
        blurDetected: metadata.blurDetected || validation?.blur_detected,
        processingTimeMs: metadata.processingTimeMs,
        pageCount: metadata.pageCount
      },
      warnings: validation?.low_confidence
        ? [validation.user_action?.message || 'Low OCR confidence — please review extracted fields.']
        : [],
      userAction: validation?.user_action || null
    };
  }
}

module.exports = new OcrBenchmarkService();
