const gstinRecovery = require('../../../shared/gstinRecovery');
const fieldProvenance = require('../../../shared/fieldProvenance');
const fieldContract = require('../../../shared/fieldContract');
const documentProcessingService = require('../services/documentProcessingService');

describe('RC-5E gstinRecovery shared', () => {
  test('extractGstinFromText finds strict GSTIN', () => {
    const text = 'Seller GSTIN: 27AABCU9603R1ZP\nTotal INR 1000';
    const result = gstinRecovery.extractGstinFromText(text);
    expect(result?.gstin).toBe('27AABCU9603R1ZP');
  });

  test('label-based recovery repairs OCR noise near GSTIN label', () => {
    const text = 'Homes Apartment, Richmond\nGSTIN: 24AADCP1453JAZZ Road, Bengaluru\n560025';
    const result = gstinRecovery.extractGstinFromText(text);
    expect(result?.gstin).toBe('24AADCP1453JAZZ');
  });

  test('normalizeGstinToken fixes common OCR digit confusion', () => {
    expect(gstinRecovery.normalizeGstinToken('27AABCU9603R1ZP')).toBe('27AABCU9603R1ZP');
  });
});

describe('RC-5E documentProcessingService', () => {
  test('resolveOcrTextFromAiResult reads rawText from AI payload', () => {
    const text = 'GSTIN: 29AAACI1195H1ZK\nInvoice total 500';
    const resolved = documentProcessingService.resolveOcrTextFromAiResult({
      data: { rawText: text, confidence: { overall: 0.9 } }
    });
    expect(resolved).toBe(text);
  });

  test('applyGstinRecoveryFill uses gstin_recovery provenance for label repair', () => {
    const strictSpy = jest.spyOn(gstinRecovery, 'extractStrictGstins').mockReturnValue([]);
    const extractedData = { amount: 708 };
    const rawText = 'Vijaya Traders\nGSTIN: 24AADCP1453JAZZ Road, Bengaluru';
    try {
      const filled = documentProcessingService.applyGstinRecoveryFill(extractedData, rawText);
      expect(filled).toBe(true);
      expect(extractedData.gstin).toBe('24AADCP1453JAZZ');
      expect(extractedData.fieldProvenance.fields.gstin.winner).toEqual({
        source: 'gstin_recovery',
        stage: 'recovery'
      });
    } finally {
      strictSpy.mockRestore();
    }
  });

  test('applyGstinRecoveryFill does not overwrite valid GSTIN', () => {
    const existing = '29AAACI1195H1ZK';
    const extractedData = {
      gstin: existing,
      seller_gstin: existing
    };
    const filled = documentProcessingService.applyGstinRecoveryFill(
      extractedData,
      'GSTIN: 27AABCU9603R1ZP'
    );
    expect(filled).toBe(false);
    expect(extractedData.gstin).toBe(existing);
    expect(extractedData.fieldProvenance).toBeUndefined();
  });

  test('applyPostMergeRecovery on AI-only path persists rawText and recovers GSTIN', () => {
    const previousMulti = process.env.MULTI_OCR_RECOVERY_ENABLED;
    process.env.MULTI_OCR_RECOVERY_ENABLED = '1';
    try {
      const gstin = '27AABCU9603R1ZP';
      const rawText = `Vendor Name Pvt Ltd\nGSTIN: ${gstin}\nAmount 1200`;
      const extractedData = {
        vendor: { name: 'Vendor Name Pvt Ltd' },
        amount: 1200
      };

      documentProcessingService.applyPostMergeRecovery(extractedData, {
        document: { createdAt: new Date('2026-06-01'), metadata: {} },
        rawText,
        extractionWarnings: ['Used AI model extraction; skipped duplicate backend OCR for speed.'],
        multiOcrEngineTexts: documentProcessingService.buildSyntheticMultiOcrEngineTexts(rawText)
      });

      expect(extractedData.rawText).toBe(rawText);
      expect(fieldContract.readGstin(extractedData)).toBe(gstin);
    } finally {
      if (previousMulti === undefined) {
        delete process.env.MULTI_OCR_RECOVERY_ENABLED;
      } else {
        process.env.MULTI_OCR_RECOVERY_ENABLED = previousMulti;
      }
    }
  });

  test('callAIModel forwards forceFreshAnalyze to AI analyze request', async () => {
    const aiClient = require('../config/aiService');
    const postSpy = jest.spyOn(aiClient, 'post').mockResolvedValue({
      data: { success: true, data: { confidence: { overall: 0.8 }, rawText: 'GSTIN 27AABCU9603R1ZP' } }
    });
    try {
      await documentProcessingService.callAIModel(Buffer.from('test'), 'bill.jpg', {
        forceFreshAnalyze: true
      });
      expect(postSpy).toHaveBeenCalledWith(
        '/analyze',
        expect.anything(),
        expect.objectContaining({ timeout: expect.any(Number) })
      );
    } finally {
      postSpy.mockRestore();
    }
  });

  test('duplicate fresh analyze path is wired on reprocess route and upload processing', () => {
    const fs = require('fs');
    const path = require('path');
    const documentsRoute = fs.readFileSync(
      path.join(__dirname, '../routes/documents.js'),
      'utf8'
    );
    const uploadProcessing = fs.readFileSync(
      path.join(__dirname, '../services/documentUploadProcessing.js'),
      'utf8'
    );
    const processingService = fs.readFileSync(
      path.join(__dirname, '../services/documentProcessingService.js'),
      'utf8'
    );
    expect(documentsRoute).toMatch(/forceFreshAnalyze/);
    expect(uploadProcessing).toMatch(/forceFreshAnalyze/);
    expect(processingService).toMatch(/duplicateResult\.isDuplicate && !forceFreshAnalyze/);
  });

  test('buildSyntheticMultiOcrEngineTexts enables multi-OCR recovery on AI text', () => {
    const previousMulti = process.env.MULTI_OCR_RECOVERY_ENABLED;
    process.env.MULTI_OCR_RECOVERY_ENABLED = '1';
    try {
      const gstin = '27AABCU9603R1ZP';
      const text = `GSTIN ${gstin}\nTotal 900`;
      const extractedData = { amount: 900 };
      documentProcessingService.applyMultiOcrRecoveryFill(
        extractedData,
        documentProcessingService.buildSyntheticMultiOcrEngineTexts(text)
      );
      expect(extractedData.gstin).toBe(gstin);
    } finally {
      if (previousMulti === undefined) {
        delete process.env.MULTI_OCR_RECOVERY_ENABLED;
      } else {
        process.env.MULTI_OCR_RECOVERY_ENABLED = previousMulti;
      }
    }
  });
});
