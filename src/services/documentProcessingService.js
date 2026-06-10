const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const { fromBuffer } = require('pdf2pic');
const { OEM } = require('tesseract.js');
const moment = require('moment');
const duplicateDetectionService = require('./duplicateDetectionService');
const carbonCalculationService = require('./carbonCalculationService');
const AIDataExtractionService = require('./aiDataExtractionService');
const aiAgentService = require('./aiAgentService');
const verifiedKnowledgeRagService = require('./verifiedKnowledgeRagService');
const categoryIntelligenceService = require('./categoryIntelligenceService');
const extractedDataNormalizationService = require('./extractedDataNormalizationService');
const ocrBenchmarkService = require('./ocrBenchmarkService');
const dataProcessorAgent = require('./agents/dataProcessorAgent');
const stateUtilityBoardBillAgent = require('./agents/stateUtilityBoardBillAgent');
const processMachineryProfilerAgent = require('./agents/processMachineryProfilerAgent');
const aiClient = require('../config/aiService');
const documentLifecycle = require('./documentLifecycle');
const documentProcessingExecution = require('./documentProcessingExecution');
const { startProcessingHeartbeat } = require('./documentProcessingHeartbeat');
const fieldContract = require('../../../shared/fieldContract');
const fieldProvenance = require('../../../shared/fieldProvenance');
const multiOcrFieldRecovery = require('../../../shared/multiOcrFieldRecovery');
const itemCorrectionPolicy = require('../../../shared/itemCorrectionPolicy');
const itemFieldRecovery = require('../../../shared/itemFieldRecovery');
const gstinRecovery = require('../../../shared/gstinRecovery');
const taxProfilePolicy = require('../../../shared/taxProfilePolicy');
const referenceRecovery = require('../../../shared/referenceRecovery');
const vendorRecovery = require('../../../shared/vendorRecovery');
const dateRecovery = require('../../../shared/dateRecovery');
const itemAccuracyRecovery = require('../../../shared/itemAccuracyRecovery');
const { config: lifecycleConfig } = require('../config/documentProcessingLifecycle');
const FormData = require('form-data');
const { assignProductsToTransaction, inferManufacturedProductsFromAgentContext } = require('../utils/productAttribution');

const OCR_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/bmp'
]);

const TEXT_DOCUMENT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv'
]);

const MIN_OCR_ACCURACY_FOR_CARBON_ANALYSIS = 0.65;

const OCR_QUALITY_REJECTION_PATTERNS = [
  /blurry/i,
  /not clear/i,
  /clearer document/i,
  /clear image/i,
  /clearer copy/i,
  /unable to read/i,
  /cannot read/i,
  /difficult to read/i,
  /characters/i,
  /illegible/i,
  /too faint/i,
  /upload a clear/i
];

const DEFAULT_OCR_QUALITY_REJECTION_MESSAGE =
  'We could not read this document clearly. Please upload a sharper, well-lit copy with all text in focus.';

/**
 * Extract a user-facing message from an AI /analyze error response.
 */
function extractAIAnalyzeErrorDetail(error) {
  const data = error?.response?.data;
  if (!data) {
    return null;
  }

  const { detail } = data;
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string' && item.trim()) {
          return item.trim();
        }
        if (item && typeof item.msg === 'string' && item.msg.trim()) {
          return item.msg.trim();
        }
        return null;
      })
      .filter(Boolean);
    if (messages.length > 0) {
      return messages.join(' ');
    }
  }

  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message.trim();
  }

  if (typeof data.error === 'string' && data.error.trim()) {
    return data.error.trim();
  }

  return null;
}

function isOcrQualityRejectionMessage(message) {
  if (!message || typeof message !== 'string') {
    return false;
  }
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }
  return OCR_QUALITY_REJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function classifyOcrQualityRejection(message) {
  const normalized = (message || '').trim();
  if (!normalized) {
    return { kind: 'ocr_quality', blurDetected: false };
  }
  if (/^This image looks blurry/i.test(normalized)) {
    return { kind: 'blur_pre_check', blurDetected: true };
  }
  if (/We could not read the text clearly/i.test(normalized)) {
    return { kind: 'low_ocr_confidence', blurDetected: false };
  }
  if (isOcrQualityRejectionMessage(normalized)) {
    return { kind: 'ocr_quality', blurDetected: false };
  }
  return { kind: 'unknown', blurDetected: false };
}

function buildOcrQualityRejectionValidation(message) {
  const { kind, blurDetected } = classifyOcrQualityRejection(message);
  const problematicSections = [];
  if (blurDetected) {
    problematicSections.push('blurry_scan');
  } else if (kind === 'low_ocr_confidence') {
    problematicSections.push('low_ocr_confidence');
  }
  return {
    unreadable: true,
    low_confidence: true,
    blur_detected: blurDetected,
    invoice_confidence: 0,
    ocr_quality_score: 0,
    gate_rejection_reason: kind,
    user_action: {
      action: 'reupload',
      message,
      problematic_sections: problematicSections,
      tips: [
        'Use even lighting and hold the camera steady to avoid motion blur.',
        'Capture the full invoice including GSTIN, line items, and totals.',
        'Prefer a flat scan or a photo taken directly above the page.'
      ]
    }
  };
}

/**
 * Parses --oem and --psm from a Tesseract CLI-style string (e.g. "--oem 1 --psm 11").
 * Values outside Tesseract ranges are ignored for that flag.
 */
function parseTesseractOemPsmFromCli(configString) {
  let oem = OEM.LSTM_ONLY;
  let psm = null;
  if (!configString || typeof configString !== 'string') {
    return { oem, psm };
  }
  const trimmed = configString.trim();
  if (!trimmed) {
    return { oem, psm };
  }
  const oemMatch = trimmed.match(/--oem\s+(\d+)/i);
  if (oemMatch) {
    const v = parseInt(oemMatch[1], 10);
    if (Number.isFinite(v) && v >= 0 && v <= 3) {
      oem = v;
    }
  }
  const psmMatch = trimmed.match(/--psm\s+(\d+)/i);
  if (psmMatch) {
    const v = parseInt(psmMatch[1], 10);
    if (Number.isFinite(v) && v >= 0 && v <= 13) {
      psm = String(v);
    }
  }
  return { oem, psm };
}
const GSTIN_REGEX = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/g;
const INVALID_VENDOR_NAMES = new Set([
  'item',
  'retail vendor',
  'unknown',
  'unknown vendor',
  'n/a',
  'na',
  'tax invoice',
  'digitally signed',
  'original copy',
  'gg stescbil original copy',
  'sleek bill',
  'bill of supply',
  'provider signature',
  'receiver signature',
  'customer notes',
  'invoicing made easy'
]);
const INVALID_VENDOR_PATTERN = /original\s*copy|sleek\s*bill|provider\s*signature|receiver\s*signature|stescbil|gg\s*stesc|customer\s*notes|invoicing\s*made/i;
const MAX_REASONABLE_LINE_ITEM_TOTAL = 500000;
const MAX_REASONABLE_INVOICE_AMOUNT = 25000000;
const ITEM_UNIT_REGEX = /\b(pcs?|nos?|units?|kg|g|gm|ltr|litre|liter|ml|box|pack|pair|mtr|meter|dozen)\b/i;
const ITEM_HEADER_REGEX = /(product|service|description|particular|item)/i;
const ITEM_COLUMN_HINT_REGEX = /(qty|quantity|rate|price|amount|total|igst|cgst|sgst|cess|hsn|sac)/i;

class DocumentProcessingService {
  constructor() {
    this.uploadDir = path.join(__dirname, '../../uploads');
    this.processedDir = path.join(__dirname, '../../processed');
    this.aiDataExtractionService = new AIDataExtractionService();
    this.ensureDirectories();
  }

  getTransactionModel() {
    return require('../models/Transaction');
  }

  cloneAIModelOutput(data = {}) {
    if (!data || typeof data !== 'object') {
      return {};
    }
    return JSON.parse(JSON.stringify(data));
  }

  /**
   * Resolve OCR/plain text from AI analyze payload (RC-5E AI-only path).
   */
  resolveOcrTextFromAiResult(aiResult) {
    if (!aiResult || typeof aiResult !== 'object') {
      return null;
    }
    const data = aiResult.data || {};
    const candidates = [
      data.rawText,
      data.raw_text,
      data.ocr_text,
      data.text,
      aiResult.rawText,
      aiResult.ocr_result?.text,
      aiResult.ocrResult?.text
    ];
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  buildSyntheticMultiOcrEngineTexts(rawText) {
    if (!rawText || !String(rawText).trim()) {
      return [];
    }
    const text = String(rawText).trim();
    return [
      {
        engine: 'ai_model_ocr',
        sourceType: 'ocr',
        text,
        textLength: text.length
      }
    ];
  }

  applyGstinRecoveryFill(extractedData = {}, rawText = null) {
    if (fieldContract.readGstin(extractedData)) {
      return false;
    }
    const text = rawText || extractedData.rawText || null;
    if (!text) {
      return false;
    }

    const strictMatches = gstinRecovery.extractStrictGstins(text);
    let gstData = null;
    let source = 'ocr_text';

    if (strictMatches.length > 0) {
      gstData = {
        gstin: strictMatches[0],
        seller_gstin: strictMatches[0],
        buyer_gstin: strictMatches[1] || null
      };
    } else {
      gstData = gstinRecovery.extractGstinFromText(text);
      if (gstData?.gstin) {
        source = 'gstin_recovery';
      }
    }

    if (!gstData?.gstin) {
      return false;
    }

    extractedData.gst = { ...(extractedData.gst || {}), ...gstData };
    extractedData.gstin = gstData.gstin;
    extractedData.seller_gstin = gstData.seller_gstin;
    extractedData.buyer_gstin = gstData.buyer_gstin;
    if (source === 'gstin_recovery') {
      fieldProvenance.recordGstinRecoveryFill(extractedData, 'gstin', { value: gstData.gstin });
    } else {
      fieldProvenance.recordRecoveryFill(extractedData, 'gstin', {
        value: gstData.gstin,
        source: 'ocr_text'
      });
    }
    return true;
  }

  applyReferenceRecoveryFill(extractedData = {}, rawText = null) {
    if (!this.isAccuracyRecoveryEnabled() || fieldContract.readReferenceNumber(extractedData)) {
      return false;
    }
    const text = rawText || extractedData.rawText || null;
    if (!text) {
      return false;
    }

    const recovered = referenceRecovery.extractReferenceFromText(text);
    if (recovered) {
      extractedData.referenceNumber = recovered;
      extractedData.invoice_number = recovered;
      fieldProvenance.recordReferenceRecoveryFill(extractedData, 'referenceNumber', {
        value: recovered
      });
      return true;
    }

    const fallback = this.extractReferenceNumberFromText(text);
    if (fallback && referenceRecovery.isValidReferenceNumber(fallback)) {
      extractedData.referenceNumber = fallback;
      extractedData.invoice_number = fallback;
      fieldProvenance.recordRecoveryFill(extractedData, 'referenceNumber', {
        value: fallback,
        source: 'ocr_text'
      });
      return true;
    }

    return false;
  }

  applyVendorRecoveryFill(extractedData = {}, rawText = null) {
    if (!this.isAccuracyRecoveryEnabled()) {
      return false;
    }
    const existingVendor = fieldContract.readVendorName(extractedData);
    if (existingVendor && !this.isInvalidVendorName(existingVendor)) {
      return false;
    }
    const text = rawText || extractedData.rawText || null;
    if (!text) {
      return false;
    }

    const vendorName = vendorRecovery.extractVendorFromText(text, {
      isInvalidVendorName: (name) => this.isInvalidVendorName(name)
    });
    if (!vendorName) {
      return false;
    }

    extractedData.vendor = { name: vendorName };
    fieldProvenance.recordVendorRecoveryFill(extractedData, 'vendor', { value: vendorName });
    return true;
  }

  applyDateRecoveryFill(extractedData = {}, rawText = null) {
    if (!this.isAccuracyRecoveryEnabled() || extractedData.date) {
      return false;
    }
    const text = rawText || extractedData.rawText || null;
    if (!text) {
      return false;
    }

    const parsedDate = dateRecovery.extractInvoiceDateFromText(
      text,
      (value) => this.parseInvoiceDateForRecovery(value)
    );
    if (!parsedDate) {
      return false;
    }

    extractedData.date = parsedDate;
    fieldProvenance.recordDateRecoveryFill(extractedData, 'date', { value: parsedDate });
    return true;
  }

  normalizeAIData(data = {}) {
    const normalized = { ...data };

    // Vendor normalize
    if (typeof normalized.vendor === "string") {
      normalized.vendor = { name: normalized.vendor };
    }

    // Date normalize
    if (normalized.date) {
      normalized.date = this.parseDocumentDate(normalized.date);
    }

    const referenceNumber = normalized.referenceNumber || normalized.invoice_number || null;
    if (referenceNumber) {
      normalized.referenceNumber = referenceNumber;
      normalized.invoice_number = referenceNumber;
    }

    const sellerGstin = normalized?.gst?.seller_gstin || normalized.seller_gstin || normalized.gstin || null;
    const buyerGstin = normalized?.gst?.buyer_gstin || normalized.buyer_gstin || null;
    const gstTotal = Number(normalized?.gst?.total);
    normalized.gstin = normalized.gstin || sellerGstin;
    normalized.seller_gstin = sellerGstin;
    normalized.buyer_gstin = buyerGstin;
    normalized.gst = {
      seller_gstin: sellerGstin,
      buyer_gstin: buyerGstin,
      total: Number.isFinite(gstTotal) ? gstTotal : 0
    };

    if (!normalized.vendor?.name || this.isInvalidVendorName(normalized.vendor?.name)) {
      normalized.vendor = null;
    }

    // Preserve hierarchical invoice labels from AI intelligence layer
    if (normalized.classification_intelligence) {
      const intel = normalized.classification_intelligence;
      normalized.invoiceCategory = intel.category || normalized.invoice_category;
      normalized.invoiceSubcategory = intel.subcategory || normalized.invoice_subcategory;
      normalized.classificationContext = {
        ...(normalized.classificationContext || {}),
        invoiceCategoryId: intel.category_id,
        invoiceSubcategoryId: intel.subcategory_id,
        sector: intel.sector,
        emissionScope: intel.emission_scope,
        carbonFactor: intel.carbon_factor,
        vendorType: intel.vendor_type,
        confidence: intel.confidence,
        classificationMethod: intel.classification_method,
        explainability: intel.explainability
      };
    }

    if (normalized.invoice_category && !normalized.invoiceCategory) {
      normalized.invoiceCategory = normalized.invoice_category;
    }
    if (normalized.invoice_subcategory && !normalized.invoiceSubcategory) {
      normalized.invoiceSubcategory = normalized.invoice_subcategory;
    }

    // Defaults
    normalized.currency = normalized.currency || "INR";
    normalized.category = normalized.category || "other";
    normalized.subcategory = normalized.subcategory || "general";

    return normalized;
  }

  attachOcrFieldsToExtractedData(extractedData = {}, aiPayload = {}, document = null) {
    const raw = aiPayload?.raw || aiPayload || {};
    const ocrValidation = raw.ocr_validation
      || aiPayload?.ocr_validation
      || ocrBenchmarkService.normalizeOcrValidation(raw, extractedData);
    if (ocrValidation) {
      extractedData.ocr_validation = ocrValidation;
    }
    const ocrMeta = raw.ocr_metadata || {
      engines: raw.ocr_engines,
      strategy: raw.ocr_strategy,
      page_count: raw.page_count,
      processing_time_ms: raw.processing_time_ms,
      thermal_detection: ocrValidation?.thermal_detection,
      blur_detected: ocrValidation?.blur_detected
    };
    if (ocrMeta) {
      extractedData.ocr_metadata = ocrMeta;
    }
    if (document) {
      document.metadata = document.metadata || {};
      document.metadata.ocr = {
        engines: ocrMeta.engines || [],
        strategy: ocrMeta.strategy || ocrMeta.ocr_strategy,
        thermalDetection: ocrValidation?.thermal_detection || null,
        blurDetected: Boolean(ocrValidation?.blur_detected),
        processingTimeMs: ocrMeta.processing_time_ms,
        pageCount: ocrMeta.page_count
      };
      document.ocrValidation = ocrValidation;
    }
    return extractedData;
  }

formatAIData(data = {}, rawText = '') {
  const parsedAmount = Number(data.amount);
  const parsedDate = this.parseDocumentDate(data.date);
  const extractedGst = this.extractGSTFromText(rawText) || {};
  const sellerGstin = data?.gst?.seller_gstin || data.seller_gstin || data.gstin || extractedGst.seller_gstin || null;
  const buyerGstin = data?.gst?.buyer_gstin || data.buyer_gstin || extractedGst.buyer_gstin || null;
  const gstTotal = Number(data?.gst?.total);
  const referenceNumber = data.referenceNumber || data.invoice_number || null;

  return {
    vendor: typeof data.vendor === "string"
      ? { name: data.vendor }
      : data.vendor || null,

    amount: Number.isFinite(parsedAmount) ? parsedAmount : null,

    date: parsedDate,

    referenceNumber,
    invoice_number: referenceNumber,

    gstin: data.gstin || sellerGstin || null,
    seller_gstin: sellerGstin,
    buyer_gstin: buyerGstin,
    gst: {
      seller_gstin: sellerGstin,
      buyer_gstin: buyerGstin,
      total: Number.isFinite(gstTotal) ? gstTotal : 0
    },

    items: Array.isArray(data.items) ? data.items : [],

    emission: Number(data.emission) || 0,

    category: data.category || "other",
    subcategory: data.subcategory || "general",

    ocr_validation: data.ocr_validation || null,
    ocr_metadata: data.ocr_metadata || null,
    ocr_user_action: data.ocr_user_action || data.ocr_validation?.user_action || null,

    description:
      data.description ||
      data.items?.[0]?.name ||
      data.vendor?.name ||
      "Invoice transaction",

    currency: data.currency || "INR",

    // 🔥 FULL RAW AI DATA
    raw: data
  };
}
  async callAIModel(fileBuffer, fileName, options = {}) {
  try {
    const form = new FormData();
    form.append('file', fileBuffer, fileName);
    if (options.forceFreshAnalyze) {
      form.append('force_fresh_analyze', '1');
    }

console.log("📡 Sending file to AI:", fileName);
console.time("AI_CALL");

const response = await aiClient.post('/analyze', form, {
  headers: form.getHeaders(),
  timeout: lifecycleConfig.aiRequestTimeoutMs
});
console.log("✅ AI Response received");
console.timeEnd("AI_CALL");
    return response.data;

  } catch (error) {
    const status = error.response?.status;
    const detail = extractAIAnalyzeErrorDetail(error);
    console.error("❌ AI call failed:", error.message);
    if (status) {
      console.error("❌ AI HTTP status:", status);
    }
    if (detail) {
      console.error("❌ AI response detail:", detail);
    }

    if (status === 422 && detail && isOcrQualityRejectionMessage(detail)) {
      return {
        rejected: true,
        rejectionMessage: detail,
        data: null
      };
    }

    return null;
  }
}

  async rejectDocumentForOcrQuality(document, rejectionMessage, startTime = Date.now()) {
    const message =
      rejectionMessage && String(rejectionMessage).trim()
        ? String(rejectionMessage).trim()
        : DEFAULT_OCR_QUALITY_REJECTION_MESSAGE;
    const ocrValidation = buildOcrQualityRejectionValidation(message);
    const rejectionKind = ocrValidation.gate_rejection_reason || 'ocr_quality';
    const processingTime = Date.now() - startTime;

    await documentLifecycle.markDocumentFailed(document, {
      message,
      errors: [message],
      warnings: [],
      processingTime,
      stage: 'ocr_quality_rejection',
      ocrValidation,
      metadataOcr: {
        blurDetected: Boolean(ocrValidation.blur_detected),
        rejectionReason: rejectionKind === 'blur_pre_check' ? 'blur_pre_check' : 'ocr_quality',
        gateRejectionReason: rejectionKind
      }
    });

    return {
      success: false,
      extractedData: null,
      errors: [message],
      warnings: [],
      processingTime
    };
  }

  isMultiOcrRecoveryEnabled() {
    const raw = String(process.env.MULTI_OCR_RECOVERY_ENABLED || '').trim().toLowerCase();
    return raw === '1' || raw === 'true';
  }

  isItemRecoveryEnabled() {
    const raw = String(process.env.ITEM_RECOVERY_ENABLED || '').trim().toLowerCase();
    return raw === '1' || raw === 'true';
  }

  isAccuracyRecoveryEnabled() {
    const raw = String(process.env.ACCURACY_RECOVERY_ENABLED || '').trim().toLowerCase();
    return raw === '1' || raw === 'true';
  }

  buildItemRecoverySourceEntries({
    multiOcrEngineTexts = null,
    rawText = null,
    aiItems = null,
    ocrItems = null
  } = {}) {
    const entries = [];

    if (Array.isArray(aiItems) && aiItems.length > 0) {
      entries.push({ engine: 'ai_model', items: aiItems });
    }
    if (Array.isArray(ocrItems) && ocrItems.length > 0) {
      entries.push({ engine: 'backend_primary_ocr', items: ocrItems });
    }
    if (Array.isArray(multiOcrEngineTexts)) {
      for (const engineEntry of multiOcrEngineTexts) {
        if (!engineEntry?.engine || !engineEntry?.text) {
          continue;
        }
        const parsedItems = this.extractItemsFromText(engineEntry.text);
        if (parsedItems.length > 0) {
          entries.push({ engine: engineEntry.engine, items: parsedItems });
        }
      }
    }
    if (rawText) {
      const parsedItems = this.extractItemsFromText(rawText);
      if (parsedItems.length > 0) {
        entries.push({ engine: 'ocr_text_heuristic', items: parsedItems });
      }
    }

    return entries;
  }

  readItemNumericFields(item = {}) {
    return itemCorrectionPolicy.readNumericFields(item);
  }

  isPopulatedItemNumeric(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0;
  }

  hasAdmittedItemIdentity(item = {}) {
    const name = itemCorrectionPolicy.normalizeItemName(item.name || item.description);
    const { total } = this.readItemNumericFields(item);
    return Boolean(name) && this.isPopulatedItemNumeric(total);
  }

  resolveItemRecoverySource(winnerRow = {}) {
    const action = winnerRow.action;
    if (
      action === itemCorrectionPolicy.CORRECTION_ACTION.DERIVE
      || action === itemCorrectionPolicy.CORRECTION_ACTION.CORRECT
    ) {
      return 'math_derived';
    }

    const engines = winnerRow.engines || [winnerRow.engine].filter(Boolean);
    const multiOcrEngines = new Set([
      'pdf_native_text',
      'pdf_ocr_tesseract',
      'image_ocr_secondary',
      'ai_model_multi_ocr'
    ]);

    if ((winnerRow.agreement || 0) >= 2 || engines.some((engine) => multiOcrEngines.has(engine))) {
      return 'multi_ocr_item';
    }

    return 'ocr_text_item';
  }

  formatRecoveredItemRow(winnerRow = {}) {
    const numeric = this.readItemNumericFields(winnerRow.item || {});
    const source = this.resolveItemRecoverySource(winnerRow);
    const cleanedName = itemAccuracyRecovery.cleanItemDescription(
      winnerRow.item?.name || winnerRow.item?.description
    );
    const row = {
      ...(winnerRow.item || {}),
      name: cleanedName || itemCorrectionPolicy.normalizeItemName(winnerRow.item?.name || winnerRow.item?.description),
      quantity: numeric.quantity,
      price: numeric.price,
      total: numeric.total,
      item_provenance: {
        source,
        stage: 'recovery',
        engines: winnerRow.engines || [winnerRow.engine].filter(Boolean),
        action: winnerRow.action || itemCorrectionPolicy.CORRECTION_ACTION.ADMIT
      }
    };
    row.description = row.name;
    row.item_confidence = itemAccuracyRecovery.scoreItemConfidence(row);
    return row;
  }

  gapFillItemFromWinner(existingItem = {}, winnerRow = {}) {
    const candidateItem = winnerRow.item || {};
    const existingNumeric = this.readItemNumericFields(existingItem);
    const candidateNumeric = this.readItemNumericFields(candidateItem);
    const filledFields = [];
    const nextItem = { ...existingItem };

    if (!this.isPopulatedItemNumeric(existingNumeric.quantity) && this.isPopulatedItemNumeric(candidateNumeric.quantity)) {
      nextItem.quantity = candidateNumeric.quantity;
      filledFields.push('quantity');
    }
    if (!this.isPopulatedItemNumeric(existingNumeric.price) && this.isPopulatedItemNumeric(candidateNumeric.price)) {
      nextItem.price = candidateNumeric.price;
      filledFields.push('price');
    }
    if (!this.isPopulatedItemNumeric(existingNumeric.total) && this.isPopulatedItemNumeric(candidateNumeric.total)) {
      nextItem.total = candidateNumeric.total;
      filledFields.push('total');
    }

    const descriptionFill = itemAccuracyRecovery.gapFillItemDescription(existingItem, candidateItem);
    if (descriptionFill) {
      nextItem.name = descriptionFill.name;
      nextItem.description = descriptionFill.description;
      filledFields.push('name');
    }

    if (filledFields.length === 0) {
      return null;
    }

    const usedMathDerive = (
      winnerRow.action === itemCorrectionPolicy.CORRECTION_ACTION.DERIVE
      || winnerRow.action === itemCorrectionPolicy.CORRECTION_ACTION.CORRECT
    );

    nextItem.item_provenance = {
      ...(existingItem.item_provenance || {}),
      source: usedMathDerive ? 'math_derived' : this.resolveItemRecoverySource(winnerRow),
      stage: 'recovery',
      filledFields,
      engines: winnerRow.engines || [winnerRow.engine].filter(Boolean)
    };

    if (nextItem.item_confidence === undefined || nextItem.item_confidence === null) {
      nextItem.item_confidence = itemAccuracyRecovery.scoreItemConfidence(nextItem);
    }

    return nextItem;
  }

  applyLocalItemMathDerive(item = {}) {
    if (!item || typeof item !== 'object') {
      return item;
    }

    const numeric = this.readItemNumericFields(item);
    const derived = itemCorrectionPolicy.deriveMissingNumericFields(numeric);
    if (derived.derivedFields.length === 0) {
      return item;
    }

    const nextItem = { ...item };
    const filledFields = [];

    for (const field of derived.derivedFields) {
      if (this.isPopulatedItemNumeric(numeric[field])) {
        continue;
      }
      nextItem[field] = derived.fields[field];
      filledFields.push(field);
    }

    if (filledFields.length === 0) {
      return item;
    }

    nextItem.item_provenance = {
      ...(item.item_provenance || {}),
      source: 'math_derived',
      stage: 'recovery',
      filledFields
    };

    return nextItem;
  }

  /**
   * Gap-fill line items from ranked OCR / multi-OCR candidates (orchestration only).
   */
  applyItemRecoveryFill(extractedData = {}, {
    multiOcrEngineTexts = null,
    rawText = null,
    aiItems = null,
    ocrItems = null
  } = {}) {
    if (!this.isItemRecoveryEnabled()) {
      return;
    }

    const sourceEntries = this.buildItemRecoverySourceEntries({
      multiOcrEngineTexts,
      rawText,
      aiItems,
      ocrItems
    });
    if (sourceEntries.length === 0) {
      return;
    }

    const invoiceAmount = Number(extractedData.amount);
    const { winners } = itemFieldRecovery.processItemCandidates(sourceEntries, {
      grandTotal: Number.isFinite(invoiceAmount) && invoiceAmount > 0 ? invoiceAmount : null
    });
    if (!Array.isArray(winners) || winners.length === 0) {
      return;
    }

    const existingItems = Array.isArray(extractedData.items) ? extractedData.items : [];
    if (existingItems.length === 0) {
      extractedData.items = winners.map((winnerRow) => this.formatRecoveredItemRow(winnerRow));
      extractedData.items = extractedData.items.map((item) => this.applyLocalItemMathDerive(item));
      return;
    }

    const winnerByName = new Map();
    for (const winnerRow of winners) {
      const nameKey = itemFieldRecovery.normalizeItemNameKey(winnerRow.item || {});
      if (!nameKey || winnerByName.has(nameKey)) {
        continue;
      }
      winnerByName.set(nameKey, winnerRow);
    }

    extractedData.items = existingItems.map((existingItem) => {
      if (!existingItem || typeof existingItem !== 'object') {
        return existingItem;
      }

      const nameKey = itemFieldRecovery.normalizeItemNameKey(existingItem);
      const winnerRow = nameKey ? winnerByName.get(nameKey) : null;
      if (!winnerRow) {
        return existingItem;
      }

      const filled = this.gapFillItemFromWinner(existingItem, winnerRow);
      return filled || existingItem;
    });

    extractedData.items = extractedData.items.map((item) => this.applyLocalItemMathDerive(item));
    extractedData.items = itemAccuracyRecovery.applyItemAccuracyEnhancements(extractedData.items);
  }

  buildMultiOcrExtractors() {
    return {
      extractGstin: (text) => this.extractGSTFromText(text)?.gstin || null,
      extractReferenceNumber: (text) => this.extractReferenceNumberFromText(text),
      extractDate: (text) => this.extractDateFromText(text),
      extractAmount: (text) => {
        const amountData = this.extractAmountFromText(text);
        return Number.isFinite(amountData?.amount) ? amountData.amount : null;
      }
    };
  }

  /**
   * Gap-fill from ranked multi-engine OCR candidates (orchestration only; existing extractors).
   */
  applyMultiOcrRecoveryFill(extractedData = {}, engineTexts = null) {
    if (!this.isMultiOcrRecoveryEnabled()) {
      return;
    }
    if (!Array.isArray(engineTexts) || engineTexts.length === 0) {
      return;
    }

    const winners = multiOcrFieldRecovery.pickMultiOcrFieldWinners(
      engineTexts,
      this.buildMultiOcrExtractors(),
      { parseDocumentDate: (value) => this.parseDocumentDate(value) }
    );

    if (!fieldContract.readGstin(extractedData) && winners.gstin?.value) {
      const gstin = winners.gstin.value;
      extractedData.gstin = gstin;
      extractedData.seller_gstin = gstin;
      extractedData.gst = {
        ...(extractedData.gst || {}),
        gstin,
        seller_gstin: gstin
      };
      fieldProvenance.recordMultiOcrRecoveryFill(extractedData, 'gstin', { value: gstin });
    }

    if (!fieldContract.readReferenceNumber(extractedData) && winners.referenceNumber?.value) {
      const referenceNumber = winners.referenceNumber.value;
      extractedData.referenceNumber = referenceNumber;
      extractedData.invoice_number = referenceNumber;
      fieldProvenance.recordMultiOcrRecoveryFill(extractedData, 'referenceNumber', {
        value: referenceNumber
      });
    }

    if (!extractedData.date && winners.date?.value) {
      const parsedDate = winners.date.value instanceof Date
        ? winners.date.value
        : this.parseDocumentDate(winners.date.value);
      if (parsedDate) {
        extractedData.date = parsedDate;
        fieldProvenance.recordMultiOcrRecoveryFill(extractedData, 'date', { value: parsedDate });
      }
    }

    if ((!extractedData.amount || extractedData.amount < 1) && winners.amount?.value) {
      const amount = Number(winners.amount.value);
      if (Number.isFinite(amount) && amount >= 1) {
        extractedData.amount = amount;
        fieldProvenance.recordMultiOcrRecoveryFill(extractedData, 'amount', { value: amount });
      }
    }
  }

  buildAIExtractionFromModel(aiResult) {
    if (!aiResult || !aiResult.data) {
      return null;
    }

    const data = this.cloneAIModelOutput(aiResult.data);

    const rawText = this.resolveOcrTextFromAiResult(aiResult);

    return {
      data,
      rawText,
      ocrFieldHints: data.ocr_field_hints || null
    };
  }

  /**
   * Gap-fill from AI-exported OCR hint candidates (orchestration only; no regex changes).
   */
  applyHintRecoveryFill(extractedData = {}, ocrFieldHints = null) {
    if (!ocrFieldHints || typeof ocrFieldHints !== 'object') {
      return;
    }

    if (!fieldContract.readGstin(extractedData)) {
      const hintGstin = ocrFieldHints.gstin_candidates?.[0];
      if (hintGstin) {
        extractedData.gstin = hintGstin;
        extractedData.seller_gstin = hintGstin;
        extractedData.gst = {
          ...(extractedData.gst || {}),
          gstin: hintGstin,
          seller_gstin: hintGstin
        };
        fieldProvenance.recordHintRecoveryFill(extractedData, 'gstin', { value: hintGstin });
      }
    }

    if (!fieldContract.readReferenceNumber(extractedData)) {
      const hintReference = ocrFieldHints.invoice_number_candidates?.[0];
      if (hintReference) {
        extractedData.referenceNumber = hintReference;
        extractedData.invoice_number = hintReference;
        fieldProvenance.recordHintRecoveryFill(extractedData, 'referenceNumber', {
          value: hintReference
        });
      }
    }

    if (!extractedData.date) {
      const hintDate = ocrFieldHints.date_candidates?.[0];
      if (hintDate) {
        const parsedDate = this.parseDocumentDate(hintDate);
        if (parsedDate) {
          extractedData.date = parsedDate;
          fieldProvenance.recordHintRecoveryFill(extractedData, 'date', { value: parsedDate });
        }
      }
    }

    if (!extractedData.amount || extractedData.amount < 1) {
      const totals = Array.isArray(ocrFieldHints.total_candidates)
        ? ocrFieldHints.total_candidates
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
        : [];
      if (totals.length > 0) {
        const hintAmount = Math.max(...totals);
        if (hintAmount >= 1) {
          extractedData.amount = hintAmount;
          fieldProvenance.recordHintRecoveryFill(extractedData, 'amount', { value: hintAmount });
        }
      }
    }
  }

  /**
   * Post-merge gap-fill using OCR hints first, then existing text extractors (orchestration only).
   */
  applyPostMergeRecovery(extractedData = {}, {
    document = {},
    rawText = null,
    extractionWarnings = [],
    ocrFieldHints = null,
    multiOcrEngineTexts = null,
    aiItems = null,
    ocrItems = null
  } = {}) {
    const warnings = Array.isArray(extractionWarnings) ? extractionWarnings : [];

    if (!extractedData.rawText && rawText) {
      extractedData.rawText = rawText;
    }

    const effectiveRawText = extractedData.rawText || rawText || null;

    if (!extractedData.description) {
      extractedData.description =
        extractedData.items?.[0]?.name ||
        extractedData.vendor?.name ||
        extractedData.vendor ||
        'Invoice transaction';
    }

    if (typeof extractedData.vendor === 'string' && extractedData.vendor.length < 50) {
      extractedData.vendor = { name: extractedData.vendor };
    }

    if (extractedData.vendor?.name && this.isInvalidVendorName(extractedData.vendor?.name)) {
      extractedData.vendor.name = 'Unknown Vendor';
    }

    this.applyCategoryIntelligence(extractedData, {
      text: effectiveRawText || extractedData.description || '',
      businessDomain: document?.metadata?.businessDomain || 'other'
    });

    this.applyVerifiedRagToExtractedData(extractedData, {
      text: extractedData.description || effectiveRawText || '',
      businessDomain: document?.metadata?.businessDomain || 'other',
      candidateLocation: extractedData.vendor?.location || ''
    });

    if (extractedData.date) {
      extractedData.date = this.parseDocumentDate(extractedData.date);
    }

    const effectiveHints = ocrFieldHints || extractedData.ocr_field_hints || null;
    this.applyHintRecoveryFill(extractedData, effectiveHints);
    this.applyMultiOcrRecoveryFill(extractedData, multiOcrEngineTexts);
    this.applyDateRecoveryFill(extractedData, effectiveRawText);

    if (!extractedData.date) {
      const fallbackDate = document?.createdAt ? new Date(document.createdAt) : null;
      if (fallbackDate && !Number.isNaN(fallbackDate.getTime())) {
        extractedData.date = fallbackDate;
        fieldProvenance.recordRecoveryFill(extractedData, 'date', {
          value: fallbackDate,
          source: 'upload_timestamp'
        });
        warnings.push('Date could not be confidently parsed; fallback to document upload timestamp.');
      } else {
        warnings.push('Date could not be parsed from source content.');
      }
    }

    if (!extractedData.amount || extractedData.amount < 1) {
      if (effectiveRawText) {
        const amountData = this.extractAmountFromText(effectiveRawText);
        if (amountData?.amount) {
          extractedData.amount = amountData.amount;
          fieldProvenance.recordRecoveryFill(extractedData, 'amount', {
            value: amountData.amount,
            source: 'ocr_text'
          });
        }
      }
    }

    this.applyVendorRecoveryFill(extractedData, effectiveRawText);
    if (!fieldContract.readVendorName(extractedData) && effectiveRawText) {
      const vendorName = this.extractVendorNameFromText(effectiveRawText);
      if (vendorName) {
        extractedData.vendor = { name: vendorName };
        fieldProvenance.recordRecoveryFill(extractedData, 'vendor', {
          value: vendorName,
          source: 'ocr_text'
        });
      }
    }

    this.applyGstinRecoveryFill(extractedData, effectiveRawText);
    taxProfilePolicy.attachGstinTaxPolicyMetadata(extractedData);
    this.applyReferenceRecoveryFill(extractedData, effectiveRawText);

    this.applyVerifiedRagToExtractedData(extractedData, {
      text: effectiveRawText || extractedData.description || '',
      businessDomain: document?.metadata?.businessDomain || 'other',
      candidateLocation: document?.metadata?.location || extractedData.vendor?.location || ''
    });

    this.applyItemRecoveryFill(extractedData, {
      multiOcrEngineTexts,
      rawText: effectiveRawText,
      aiItems,
      ocrItems
    });

    if (Array.isArray(extractedData.items) && (this.isItemRecoveryEnabled() || this.isAccuracyRecoveryEnabled())) {
      extractedData.items = itemAccuracyRecovery.applyItemAccuracyEnhancements(extractedData.items);
    }

    extractedData.items = this.sanitizeExtractedItems(extractedData.items);

    if (extractedData.ocr_field_hints) {
      delete extractedData.ocr_field_hints;
    }

    return { extractionWarnings: warnings };
  }

  async performMultiOCRAccuracyCheck(fileBuffer, document = {}, aiRawText = null, primaryRawText = null) {
    const mimeType = this.resolveMimeType(document);
    const engines = [];

    const addEngineOutput = (engine, text, sourceType = 'ocr') => {
      const normalizedText = this.normalizeDocumentText(text || '');
      if (!normalizedText || normalizedText.length < 10) {
        return;
      }

      if (engines.some(item => item.normalizedText === normalizedText)) {
        return;
      }

      engines.push({
        engine,
        sourceType,
        text: text.trim(),
        normalizedText,
        textLength: normalizedText.length
      });
    };

    addEngineOutput('backend_primary_ocr', primaryRawText, 'ocr');
    addEngineOutput('ai_model_multi_ocr', aiRawText, 'ai');

    if (this.isPdfMimeType(mimeType)) {
      const nativePdfText = await this.extractTextFromPDF(fileBuffer);
      addEngineOutput('pdf_native_text', nativePdfText, 'parser');

      const pdfOcrText = await this.extractTextFromPDFWithOCR(fileBuffer);
      addEngineOutput('pdf_ocr_tesseract', pdfOcrText, 'ocr');
    } else if (this.isImageMimeType(mimeType)) {
      const secondaryOcrText = await this.extractTextWithOCR(fileBuffer, {
        source: document?.originalName || 'image_secondary_ocr',
        tesseractConfig: '--oem 1 --psm 11'
      });
      addEngineOutput('image_ocr_secondary', secondaryOcrText, 'ocr');
    } else if (this.isTextMimeType(mimeType)) {
      const decodedText = this.decodeTextDocumentBuffer(fileBuffer);
      addEngineOutput('text_direct_decode', decodedText, 'parser');
    }

    if (engines.length === 0) {
      return {
        overall: 0,
        available: false,
        engines: [],
        pairwiseSimilarity: [],
        engineTexts: []
      };
    }

    const engineTexts = engines.map((engine) => ({
      engine: engine.engine,
      sourceType: engine.sourceType,
      text: engine.text
    }));

    if (engines.length === 1) {
      return {
        overall: 0.5,
        available: true,
        engines: engines.map(engine => ({
          engine: engine.engine,
          sourceType: engine.sourceType,
          textLength: engine.textLength,
          agreement: 0.5
        })),
        pairwiseSimilarity: [],
        engineTexts
      };
    }

    const pairwiseSimilarity = [];
    const perEngineAgreement = new Map();
    engines.forEach(engine => perEngineAgreement.set(engine.engine, []));

    for (let i = 0; i < engines.length; i += 1) {
      for (let j = i + 1; j < engines.length; j += 1) {
        const left = engines[i];
        const right = engines[j];
        const similarity = this.calculateTextSimilarity(left.normalizedText, right.normalizedText);
        pairwiseSimilarity.push({
          left: left.engine,
          right: right.engine,
          similarity: Math.round(similarity * 1000) / 1000
        });
        perEngineAgreement.get(left.engine).push(similarity);
        perEngineAgreement.get(right.engine).push(similarity);
      }
    }

    const scoredEngines = engines.map(engine => {
      const similarities = perEngineAgreement.get(engine.engine) || [];
      const agreement = similarities.length > 0
        ? similarities.reduce((sum, value) => sum + value, 0) / similarities.length
        : 1;
      return {
        engine: engine.engine,
        sourceType: engine.sourceType,
        textLength: engine.textLength,
        agreement: Math.round(agreement * 1000) / 1000
      };
    });

    const overall = scoredEngines.length > 0
      ? scoredEngines.reduce((sum, engine) => sum + engine.agreement, 0) / scoredEngines.length
      : 0;

    return {
      overall: Math.round(overall * 1000) / 1000,
      available: true,
      engines: scoredEngines,
      pairwiseSimilarity,
      engineTexts
    };
  }

  reconcileExtractionForAccuracy({ aiExtraction = null, ocrExtraction = null, ocrAccuracy = null }) {
    const aiData = aiExtraction?.data || null;
    const ocrData = ocrExtraction?.data || null;
    const hasAI = Boolean(aiData);
    const hasOCR = Boolean(ocrData);
    const independentOcr = ocrExtraction?.independentOcr !== false;

    if (hasAI && (!hasOCR || !independentOcr)) {
      const ocrAgreement = ocrAccuracy?.overall || 0;
      const extractedData = this.cloneAIModelOutput(aiData);
      fieldProvenance.recordPassthroughWinners(extractedData, aiData);
      return {
        extractedData,
        warnings: [],
        accuracyReport: {
          overall: Math.max(ocrAgreement, Number(aiData?.confidence?.overall) || 0),
          fieldAgreement: 1,
          ocrAgreement: Number(Number(ocrAgreement || 0).toFixed(3)),
          fields: {},
          ocrEngines: ocrAccuracy?.engines || []
        }
      };
    }

    if (!hasAI && !hasOCR) {
      return {
        extractedData: {},
        warnings: ['No extraction data available from AI or OCR.'],
        accuracyReport: {
          overall: 0,
          fieldAgreement: 0,
          ocrAgreement: ocrAccuracy?.overall || 0,
          fields: {},
          ocrEngines: ocrAccuracy?.engines || []
        }
      };
    }

    const extractedData = hasAI ? { ...aiData } : { ...ocrData };
    const warnings = [];
    const fieldRules = {
      amount: { critical: true },
      date: { critical: true },
      vendorName: { critical: true },
      gstin: { critical: true },
      seller_gstin: { critical: true },
      buyer_gstin: { critical: false },
      description: { critical: false },
      category: { critical: true },
      subcategory: { critical: false },
      referenceNumber: { critical: false },
      currency: { critical: false }
    };

    const selectedFields = {};
    let comparableFieldCount = 0;
    let matchedFieldCount = 0;

    const resolveString = value => (value ? String(value).trim() : '');
    const resolveDate = value => this.normalizeDateValue(value);
    const resolveAmount = value => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };

    const compareField = (fieldName, aiValue, ocrValue) => {
      const normalizedAI = fieldName === 'date'
        ? resolveDate(aiValue)
        : (fieldName === 'amount' ? resolveAmount(aiValue) : resolveString(aiValue).toLowerCase());
      const normalizedOCR = fieldName === 'date'
        ? resolveDate(ocrValue)
        : (fieldName === 'amount' ? resolveAmount(ocrValue) : resolveString(ocrValue).toLowerCase());

      if (normalizedAI === null || normalizedOCR === null || normalizedAI === '' || normalizedOCR === '') {
        return null;
      }
      if (fieldName === 'amount') {
        const diff = Math.abs(normalizedAI - normalizedOCR);
        const baseline = Math.max(Math.abs(normalizedAI), Math.abs(normalizedOCR), 1);
        return diff / baseline <= 0.05;
      }
      if (fieldName === 'date') {
        const dayDiff = Math.abs(new Date(normalizedAI).getTime() - new Date(normalizedOCR).getTime());
        return dayDiff <= 24 * 60 * 60 * 1000;
      }
      return this.calculateTextSimilarity(normalizedAI, normalizedOCR) >= 0.75;
    };

    const pickValue = (fieldName, aiValue, ocrValue) => {
      const hasAiValue = aiValue !== undefined && aiValue !== null && String(aiValue).trim() !== '';
      const hasOcrValue = ocrValue !== undefined && ocrValue !== null && String(ocrValue).trim() !== '';
      const agreement = compareField(fieldName, aiValue, ocrValue);
      const highOcrTrust = (ocrAccuracy?.overall || 0) >= MIN_OCR_ACCURACY_FOR_CARBON_ANALYSIS;

      if (agreement === true) {
        comparableFieldCount += 1;
        matchedFieldCount += 1;
      } else if (agreement === false) {
        comparableFieldCount += 1;
      }

      if (agreement === true) {
        return { value: hasAiValue ? aiValue : ocrValue, source: hasAiValue ? 'ai' : 'ocr', agreement: true };
      }
      if (hasAiValue && !hasOcrValue) {
        return { value: aiValue, source: 'ai', agreement };
      }
      if (!hasAiValue && hasOcrValue) {
        return { value: ocrValue, source: 'ocr', agreement };
      }
      if (!hasAiValue && !hasOcrValue) {
        return { value: null, source: 'none', agreement };
      }

      if (highOcrTrust && ['amount', 'date', 'vendorName'].includes(fieldName)) {
        return { value: ocrValue, source: 'ocr', agreement };
      }
      return { value: aiValue, source: 'ai', agreement };
    };

    const fieldMappings = [
      { key: 'amount', aiValue: aiData?.amount, ocrValue: ocrData?.amount, apply: value => { extractedData.amount = value; } },
      { key: 'date', aiValue: aiData?.date, ocrValue: ocrData?.date, apply: value => { extractedData.date = value; } },
      { key: 'vendorName', aiValue: aiData?.vendor?.name, ocrValue: ocrData?.vendor?.name, apply: value => { extractedData.vendor = { ...(extractedData.vendor || {}), name: value }; } },
      { key: 'description', aiValue: aiData?.description, ocrValue: ocrData?.description, apply: value => { extractedData.description = value; } },
      { key: 'category', aiValue: aiData?.category, ocrValue: ocrData?.category, apply: value => { extractedData.category = value; } },
      { key: 'subcategory', aiValue: aiData?.subcategory, ocrValue: ocrData?.subcategory, apply: value => { extractedData.subcategory = value; } },
      {
        key: 'gstin',
        aiValue: aiData?.gstin || aiData?.gst?.seller_gstin || aiData?.seller_gstin,
        ocrValue: ocrData?.gstin || ocrData?.gst?.seller_gstin || ocrData?.seller_gstin,
        apply: value => {
          extractedData.gstin = value;
          extractedData.gst = { ...(extractedData.gst || {}), seller_gstin: value };
          extractedData.seller_gstin = value;
        }
      },
      {
        key: 'seller_gstin',
        aiValue: aiData?.seller_gstin || aiData?.gst?.seller_gstin || aiData?.gstin,
        ocrValue: ocrData?.seller_gstin || ocrData?.gst?.seller_gstin || ocrData?.gstin,
        apply: value => {
          extractedData.seller_gstin = value;
          extractedData.gstin = extractedData.gstin || value;
          extractedData.gst = { ...(extractedData.gst || {}), seller_gstin: value };
        }
      },
      {
        key: 'buyer_gstin',
        aiValue: aiData?.buyer_gstin || aiData?.gst?.buyer_gstin,
        ocrValue: ocrData?.buyer_gstin || ocrData?.gst?.buyer_gstin,
        apply: value => {
          extractedData.buyer_gstin = value;
          extractedData.gst = { ...(extractedData.gst || {}), buyer_gstin: value };
        }
      },
      { key: 'referenceNumber', aiValue: aiData?.referenceNumber || aiData?.invoice_number, ocrValue: ocrData?.referenceNumber, apply: value => { extractedData.referenceNumber = value; } },
      { key: 'currency', aiValue: aiData?.currency, ocrValue: ocrData?.currency, apply: value => { extractedData.currency = value; } }
    ];

    fieldMappings.forEach(mapping => {
      const picked = pickValue(mapping.key, mapping.aiValue, mapping.ocrValue);
      if (picked.value !== null && picked.value !== undefined) {
        mapping.apply(picked.value);
      }
      selectedFields[mapping.key] = {
        selectedSource: picked.source,
        agreement: picked.agreement
      };

      fieldProvenance.recordReconcileWinner(extractedData, mapping.key, {
        value: picked.value,
        source: picked.source
      });

      if (picked.agreement === false && fieldRules[mapping.key]?.critical) {
        warnings.push(`Field mismatch detected for ${mapping.key}; selected ${picked.source.toUpperCase()} value.`);
      }
    });

    if (!extractedData.rawText) {
      extractedData.rawText = aiExtraction?.rawText || ocrExtraction?.rawText || null;
    }

    const fieldAgreement = comparableFieldCount > 0 ? matchedFieldCount / comparableFieldCount : 1;
    const ocrAgreement = ocrAccuracy?.overall || 0;
    const overall = Math.max(
      0,
      Math.min(
        1,
        Number((fieldAgreement * 0.6) + (ocrAgreement * 0.4)).toFixed(3)
      )
    );

    return {
      extractedData,
      warnings,
      accuracyReport: {
        overall,
        fieldAgreement: Number(fieldAgreement.toFixed(3)),
        ocrAgreement: Number(ocrAgreement.toFixed(3)),
        fields: selectedFields,
        ocrEngines: ocrAccuracy?.engines || []
      }
    };
  }

  normalizeDateValue(value) {
    const parsed = this.parseDocumentDate(value);
    if (!parsed) return null;
    return parsed.toISOString().slice(0, 10);
  }

  parseDocumentDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    const rawValue = String(value).trim();
    const ambiguousSlashDate = rawValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ambiguousSlashDate) {
      const first = Number(ambiguousSlashDate[1]);
      const second = Number(ambiguousSlashDate[2]);
      if (first <= 12 && second <= 12) {
        return null;
      }
    }

    const parsed = moment(rawValue, [
      'YYYY-MM-DD', 'YYYY/MM/DD',
      'MM/DD/YYYY', 'M/D/YYYY',
      'DD/MM/YYYY', 'D/M/YYYY',
      'MM-DD-YYYY', 'M-D-YYYY',
      'DD-MM-YYYY', 'D-M-YYYY',
      'DD MMM YYYY', 'D MMM YYYY', 'DD MMMM YYYY', 'D MMMM YYYY',
      'MMM D, YYYY', 'MMMM D, YYYY', 'MMM DD, YYYY', 'MMMM DD, YYYY'
    ], true);
    if (parsed.isValid()) {
      return parsed.toDate();
    }

    const nativeParsed = new Date(rawValue);
    return Number.isNaN(nativeParsed.getTime()) ? null : nativeParsed;
  }

  /**
   * RC-5F date recovery — prefer DD/MM/YYYY when parseDocumentDate rejects ambiguous slash dates.
   */
  parseInvoiceDateForRecovery(value) {
    const parsed = this.parseDocumentDate(value);
    if (parsed) {
      return parsed;
    }

    const rawValue = String(value).trim();
    const slashMatch = rawValue.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (!slashMatch) {
      return null;
    }

    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);
    if (year < 100) {
      year += year >= 70 ? 1900 : 2000;
    }
    if (day < 1 || day > 31 || month < 1 || month > 12) {
      return null;
    }

    const candidate = new Date(year, month - 1, day);
    return Number.isNaN(candidate.getTime()) ? null : candidate;
  }

  async ensureDirectories() {
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
      await fs.mkdir(this.processedDir, { recursive: true });
    } catch (error) {
      console.error('Error creating directories:', error);
    }
  }

  /**
   * Process uploaded document
   * @param {Object} document - Document object
   * @param {Buffer} fileBuffer - Uploaded file buffer
   * @returns {Object} - Processing result
   */

  /* const duplicateResult = await this.checkForDuplicates(document.msmeId, extractedData);
if (duplicateResult.isDuplicate) {
    console.log("⚠️ Duplicate found, skipping...");
    return { success: false, extractedData, errors: ["Duplicate document"] };
}
*/
  async processDocument(document, fileBuffer, options = {}) {
    const startTime = Date.now();
    const processingResult = {
      success: false,
      extractedData: null,
      errors: [],
      warnings: [],
      processingTime: 0
    };

    if (!documentLifecycle.isValidFileBuffer(fileBuffer)) {
      return documentLifecycle.failProcessingEntry(
        document,
        new Error('Document file buffer is missing or empty'),
        { stage: 'bootstrap_empty_buffer' }
      );
    }

    const execution = documentProcessingExecution.tryBeginExecution(document._id);
    if (!execution.acquired) {
      return {
        success: false,
        extractedData: null,
        errors: ['Processing is already in progress for this document'],
        warnings: [],
        processingTime: 0,
        skippedDuplicateExecution: true
      };
    }

    if (fileBuffer.length > lifecycleConfig.largeFileWarnBytes) {
      console.log('⚠️ Large file → AI slow');
    }

    let heartbeatSession = null;

    try {
      await documentLifecycle.transitionToProcessing(document);
      heartbeatSession = await startProcessingHeartbeat(document, {
        initialStage: 'processing_started'
      });

      if (heartbeatSession) {
        heartbeatSession.setStage('ai_analyze');
      }
      const forceFreshAnalyze = Boolean(options.forceFreshAnalyze);
      const aiResult = await this.callAIModel(fileBuffer, document.originalName, { forceFreshAnalyze });

      if (aiResult?.rejected) {
        const rejectionResult = await this.rejectDocumentForOcrQuality(
          document,
          aiResult.rejectionMessage,
          startTime
        );
        return {
          ...rejectionResult,
          processingTime: rejectionResult.processingTime
        };
      }

      const aiExtraction = this.buildAIExtractionFromModel(aiResult);
const aiSucceeded = Boolean(aiResult?.data);
const aiConfidence = Number(
  aiResult?.data?.confidence?.overall
  || aiResult?.data?.ocr_validation?.invoice_confidence
  || 0
);
      const skipBackendOcr =
        aiSucceeded
        && aiConfidence
        >= Number(process.env.AI_SKIP_BACKEND_OCR_MIN_CONFIDENCE || 0.45);

      let ocrExtraction = null;
      const aiOcrText = this.resolveOcrTextFromAiResult(aiResult);
      if (skipBackendOcr) {
        if (heartbeatSession) heartbeatSession.setStage('ai_extraction_only');
        ocrExtraction = {
          data: this.cloneAIModelOutput(aiResult.data),
          rawText: aiOcrText || aiExtraction?.rawText || null,
          carbonExtraction: null,
          independentOcr: false,
          extractionWarnings: ['Used AI model extraction; skipped duplicate backend OCR for speed.']
        };
        if (ocrExtraction.rawText && ocrExtraction.data && !ocrExtraction.data.rawText) {
          ocrExtraction.data.rawText = ocrExtraction.rawText;
        }
      } else {
        if (heartbeatSession) heartbeatSession.setStage('backend_ocr');
        ocrExtraction = await this.extractDataFromDocument(fileBuffer, document);
        if (ocrExtraction) {
          ocrExtraction.independentOcr = true;
        }
      }

      let ocrAccuracy = { engines: [], fieldScores: {}, overall: aiConfidence || 0 };
      const skipMultiOcrCheck = process.env.SKIP_MULTI_OCR_CHECK === '1';
      if (!skipMultiOcrCheck) {
        if (heartbeatSession) heartbeatSession.setStage('ocr_accuracy_check');
        ocrAccuracy = await this.performMultiOCRAccuracyCheck(
          fileBuffer,
          document,
          aiOcrText || aiExtraction?.rawText,
          ocrExtraction?.rawText
        );
      } else if (skipBackendOcr && aiOcrText) {
        ocrAccuracy = {
          engines: [{ engine: 'ai_model_ocr', sourceType: 'ocr', textLength: aiOcrText.length }],
          fieldScores: {},
          overall: aiConfidence || 0,
          engineTexts: this.buildSyntheticMultiOcrEngineTexts(aiOcrText)
        };
      }

      if (heartbeatSession) heartbeatSession.setStage('reconcile');
      const reconciliation = this.reconcileExtractionForAccuracy({
  aiExtraction,
  ocrExtraction,
  ocrAccuracy
});

console.log("🔥 AI RESPONSE FULL:", aiResult);

let extractedData = reconciliation.extractedData || {};
const extractionWarnings = [
  ...(ocrExtraction?.extractionWarnings || []),
  ...(reconciliation.warnings || [])
];
const carbonExtraction = ocrExtraction?.carbonExtraction || null;

if (reconciliation?.accuracyReport?.overall < MIN_OCR_ACCURACY_FOR_CARBON_ANALYSIS) {
  extractionWarnings.push(
    `Low OCR agreement (${Math.round(reconciliation.accuracyReport.overall * 100)}%): carbon analysis uses conservative fallback.`
  );
}

if (!aiResult || !aiResult.data) {
  console.log("⚡ AI slow/failed → using OCR fallback");
} else {
  console.log("🧠 RAW AI DATA:", aiResult.data);
  console.log("📦 ITEMS FROM AI:", extractedData.items);
}

const recoveryRawText =
  extractedData.rawText
  || ocrExtraction?.rawText
  || aiOcrText
  || aiExtraction?.rawText
  || aiResult?.data?.rawText
  || null;
let multiOcrEngineTexts = null;
if (this.isMultiOcrRecoveryEnabled()) {
  if (Array.isArray(ocrAccuracy?.engineTexts) && ocrAccuracy.engineTexts.length > 0) {
    multiOcrEngineTexts = ocrAccuracy.engineTexts;
  } else if (recoveryRawText) {
    multiOcrEngineTexts = this.buildSyntheticMultiOcrEngineTexts(recoveryRawText);
  }
}
this.applyPostMergeRecovery(extractedData, {
  document,
  rawText: recoveryRawText,
  extractionWarnings,
  ocrFieldHints: aiResult?.data?.ocr_field_hints || aiExtraction?.ocrFieldHints || null,
  multiOcrEngineTexts,
  aiItems: aiExtraction?.data?.items || aiResult?.data?.items || null,
  ocrItems: ocrExtraction?.data?.items || null
});

      if (Array.isArray(extractionWarnings) && extractionWarnings.length > 0) {
        processingResult.warnings.push(...extractionWarnings);
      }

      // Validate extracted data
      const validationResult = this.validateExtractedData(extractedData);
      processingResult.warnings.push(...validationResult.warnings);

      if (heartbeatSession) heartbeatSession.setStage('duplicate_check');
      const duplicateResult = await this.checkForDuplicates(document.msmeId, extractedData);

      if (duplicateResult.isDuplicate && !forceFreshAnalyze) {
        await documentLifecycle.transitionToDuplicate(document, duplicateResult);
        console.log('⚠️ Duplicate found, skipping...');
        return {
          success: false,
          extractedData,
          errors: ['Duplicate document']
        };
      }
      if (duplicateResult.isDuplicate && forceFreshAnalyze) {
        extractionWarnings.push(
          'Duplicate match detected during verification reprocess; extraction saved for audit.'
        );
        document.duplicateDetection = duplicateResult;
      }

      const nodeBoardAssessment = stateUtilityBoardBillAgent.analyzeStateUtilityBoardBill({
        document,
        extractedData,
        carbonExtraction
      });
      const pyBoard = extractedData.state_utility_board_bill || extractedData.raw?.state_utility_board_bill;
      const pythonBoardOk =
        pyBoard &&
        pyBoard.consolidate_emissions === true &&
        (pyBoard.utility_type === 'electricity' || pyBoard.utility_type === 'water');

      let consolidateUtilityBill = nodeBoardAssessment.consolidateAsSingleUtilityBill;
      let utilityBillType = nodeBoardAssessment.utilityType;
      if (pythonBoardOk) {
        if (!consolidateUtilityBill) {
          consolidateUtilityBill = true;
          utilityBillType = pyBoard.utility_type;
        } else if (!utilityBillType) {
          utilityBillType = pyBoard.utility_type;
        }
      }

      const boardAgents = [
        ...(nodeBoardAssessment.agents || []),
        ...(pythonBoardOk && Array.isArray(pyBoard.agents) ? pyBoard.agents : [])
      ];

      if (!aiSucceeded && consolidateUtilityBill && utilityBillType) {
        extractedData.emissionsAttribution = {
          mode: 'state_utility_board_total_bill',
          utilityType: utilityBillType,
          agents: boardAgents
        };
        if (utilityBillType === 'electricity') {
          extractedData.category = 'energy';
          const billText = String(extractedData.description || extractedData.rawText || '').toLowerCase();
          const solarBillSignals = (
            billText.includes('solar')
            || billText.includes('net meter')
            || billText.includes('net metering')
            || billText.includes('exported units')
            || billText.includes('solar generation')
          );
          if (solarBillSignals) {
            extractedData.subcategory = 'solar';
          } else if (!extractedData.subcategory || extractedData.subcategory === 'general') {
            extractedData.subcategory = 'grid';
          }
        } else if (utilityBillType === 'water') {
          extractedData.category = 'water';
        }
      }

      const rawItemFootprints = this.calculateItemCarbonFootprints(extractedData);
      const itemFootprints =
        consolidateUtilityBill && utilityBillType ? [] : rawItemFootprints;

      if (!aiSucceeded) {
        if (consolidateUtilityBill && utilityBillType && rawItemFootprints.length > 0) {
          extractionWarnings.push(
            'State electricity or water board bill: emissions use one consolidated bill total instead of per-line splits.'
          );
        }

        if (itemFootprints.length > 0) {
          extractedData.items = itemFootprints;
        }
      }

      // Calculate carbon footprint
      const transactionFootprint = await this.calculateCarbonFootprint(extractedData, itemFootprints);
      const msmeProfile = await this.fetchMsmeProfile(document.msmeId);
      const transactionAnalysis = await this.calculateDocumentCarbonAnalysis(
        document,
        extractedData,
        itemFootprints,
        msmeProfile
      );
      const hasSufficientAccuracy = (reconciliation?.accuracyReport?.overall || 0) >= MIN_OCR_ACCURACY_FOR_CARBON_ANALYSIS;
      const consumptionAnalysis = hasSufficientAccuracy
        ? await this.calculateBillReceiptCarbonAnalysis(
          document,
          extractedData,
          carbonExtraction,
          msmeProfile
        )
        : null;
      if (!hasSufficientAccuracy) {
        processingResult.warnings.push('Skipped consumption-based carbon analysis due to low OCR agreement score.');
      }
      const hasItemizedFootprints = itemFootprints.length > 0;
      const useConsumptionAnalysis = Boolean(consumptionAnalysis) && !hasItemizedFootprints;
      const carbonAnalysis = useConsumptionAnalysis
        ? consumptionAnalysis
        : (transactionAnalysis || consumptionAnalysis);
      const carbonFootprint = useConsumptionAnalysis && consumptionAnalysis
        ? this.buildCarbonFootprintFromAnalysis(consumptionAnalysis, extractedData)
        : transactionFootprint;


      Object.keys(extractedData).forEach(key => {
        if (extractedData[key] === undefined) {
          delete extractedData[key];
        }
      });
      if (!aiSucceeded) {
        this.attachOcrFieldsToExtractedData(extractedData, aiResult?.data || {}, document);
      }
      if (extractedData.ocr_validation?.user_action?.message) {
        processingResult.warnings.push(extractedData.ocr_validation.user_action.message);
      }
      if (extractedData.ocr_validation?.low_confidence) {
        processingResult.warnings.push(
          `OCR confidence ${Math.round((extractedData.ocr_validation.invoice_confidence || 0) * 100)}% — verify GSTIN, amount, and vendor.`
        );
      }

      const carbonFootprintForSave = carbonFootprint && carbonAnalysis
        ? {
            ...carbonFootprint,
            sustainabilityScore: carbonAnalysis.carbonScore || 0
          }
        : carbonFootprint;

      if (heartbeatSession) heartbeatSession.setStage('finalize_save');
      extractedData = await this.finalizeAndSaveProcessedDocument(document, extractedData, {
        status: 'processed',
        processingResults: {
          confidence: this.calculateConfidence(extractedData, reconciliation?.accuracyReport),
          processingTime: Date.now() - startTime,
          errors: processingResult.errors,
          warnings: processingResult.warnings,
          accuracyReport: reconciliation?.accuracyReport || null,
          ocrValidation: extractedData.ocr_validation || null
        },
        carbonFootprint: carbonFootprintForSave,
        carbonAnalysis: carbonAnalysis || undefined,
        duplicateDetection: duplicateResult
      });
      if (!carbonAnalysis && Array.isArray(processingResult.warnings)) {
        processingResult.warnings.push('Carbon analysis unavailable for this document');
      }
      console.log('✅ Document saved:', document._id);

      // Create transaction record if applicable
      const extractionQualityOk = this.isExtractionQualitySufficientForTransactions(
        extractedData,
        itemFootprints,
        reconciliation?.accuracyReport
      );
      if (!extractionQualityOk) {
        processingResult.warnings.push(
          'Skipped automatic transaction creation: extraction quality too low or line items unreliable.'
        );
      }

      if (extractedData && extractedData.amount > 0 && extractionQualityOk) {
        const transactionCreation = await this.createTransactionsFromDocument(document, itemFootprints);
        processingResult.transactionCreation = {
          created: transactionCreation.createdTransactions.length,
          skippedDuplicates: transactionCreation.skippedDuplicates.length,
          duplicateMatches: transactionCreation.skippedDuplicates.map(item => ({
            duplicateType: item.duplicateType,
            matchedTransactionId: item.matchedTransactionId,
            reasons: item.reasons
          }))
        };

        if (transactionCreation.skippedDuplicates.length > 0) {
          processingResult.warnings.push(
            `${transactionCreation.skippedDuplicates.length} duplicate transactions skipped (cross-channel duplicate resolution).`
          );
        }

        if (transactionCreation.createdTransactions.length > 0) {
          await this.updateMsmeCarbonAssessment(document.msmeId, extractedData.date || new Date());
        }
      }

      processingResult.success = true;
      processingResult.extractedData = extractedData;
      processingResult.carbonFootprint = carbonFootprint;
      processingResult.userClarificationRequests = this.buildDocumentUserClarifications({
        extractedData,
        document,
        processingResult,
        reconciliation
      });

    } catch (error) {
      console.error('Document processing error:', error);
      processingResult.errors.push(error.message);

      const processingTime = Date.now() - startTime;
      if (error.message.includes('Duplicate')) {
        await documentLifecycle.transitionToDuplicate(document, document.duplicateDetection || {
          isDuplicate: true,
          duplicateReasons: [error.message]
        });
      } else {
        await documentLifecycle.markDocumentFailed(document, {
          message: error.message,
          errors: processingResult.errors,
          warnings: processingResult.warnings,
          processingTime,
          stage: 'process_document_catch'
        });
      }
      console.log('✅ Document saved (final):', document._id);
    } finally {
      if (heartbeatSession) {
        await heartbeatSession.flush();
        heartbeatSession.stop();
      }
      documentProcessingExecution.endExecution(document._id, execution.token);
    }

    processingResult.processingTime = Date.now() - startTime;
    return processingResult;
  }

  /**
   * Process multiple uploaded documents in a single AI batch pipeline.
   * @param {Array<Object>} documents - Document model instances
   * @param {Array<Buffer>} fileBuffers - File buffers for uploaded documents
   * @param {Object} options - Processing options
   * @returns {Object} - Batch processing result
   */
  async processMultipleDocuments(documents = [], fileBuffers = [], options = {}) {
    const documentUploadProcessing = require('./documentUploadProcessing');
    const results = [];
    let skippedDuplicateTransactions = 0;

    for (let index = 0; index < documents.length; index += 1) {
      const document = documents[index];
      const fileBuffer = fileBuffers[index];
      if (!document) {
        continue;
      }

      if (!fileBuffer) {
        results.push({
          documentId: document._id,
          originalName: document.originalName,
          status: document.status,
          success: false,
          duplicateDetected: document.status === 'duplicate',
          skippedDuplicateExecution: false,
          processingTime: 0,
          transactionCreation: { created: 0, skippedDuplicates: 0, duplicateMatches: [] },
          errors: document.processingResults?.errors || ['Bulk file read failed'],
          warnings: document.processingResults?.warnings || []
        });
        continue;
      }

      let processingResult;
      try {
        processingResult = await documentUploadProcessing.processWithBuffer(document, fileBuffer, {
          source: 'bulk'
        });
      } catch (error) {
        processingResult = await documentLifecycle.failProcessingEntry(document, error, {
          stage: 'bulk_processing'
        });
      }

      skippedDuplicateTransactions += processingResult?.transactionCreation?.skippedDuplicates || 0;

      results.push({
        documentId: document._id,
        originalName: document.originalName,
        status: document.status,
        success: processingResult.success,
        duplicateDetected: document.status === 'duplicate',
        skippedDuplicateExecution: Boolean(processingResult.skippedDuplicateExecution),
        processingTime: processingResult.processingTime,
        transactionCreation: processingResult.transactionCreation || {
          created: 0,
          skippedDuplicates: 0,
          duplicateMatches: []
        },
        errors: processingResult.errors || [],
        warnings: processingResult.warnings || []
      });
    }

    const processedDocuments = documents.filter(doc => doc?.status === 'processed');
    const msmeId = options.msmeId || documents?.[0]?.msmeId;
    const msmeProfile = options.msmeProfile || await this.fetchMsmeProfile(msmeId);
    const aiBatchParsing = await this.parseMultipleDocumentsIntoTransactions(processedDocuments, msmeProfile);
    const emissionsAssessment = this.generatePeriodWiseEmissionsSummary(
      aiBatchParsing?.parsedTransactions || []
    );

    let persistedAssessmentId = null;
    if (msmeId && emissionsAssessment.totalTransactions > 0) {
      const persistedAssessment = await this.persistBulkUploadAssessment({
        msmeId,
        msmeProfile,
        emissionsAssessment
      });
      persistedAssessmentId = persistedAssessment?._id || null;
    }

    return {
      success: true,
      totalDocuments: documents.length,
      processedDocuments: processedDocuments.length,
      failedDocuments: documents.filter(doc => doc?.status === 'failed').length,
      duplicateDocuments: documents.filter(doc => doc?.status === 'duplicate').length,
      skippedDuplicateTransactions,
      results,
      aiBatchParsing,
      emissionsAssessment,
      assessmentId: persistedAssessmentId
    };
  }

  calculateIsoWeek(dateValue) {
    const date = new Date(Date.UTC(
      dateValue.getUTCFullYear(),
      dateValue.getUTCMonth(),
      dateValue.getUTCDate()
    ));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  buildPeriodWiseSummary(transactions = []) {
    return this.generatePeriodWiseEmissionsSummary(transactions);
  }

  aggregateTransactionsByPeriod(transactions = [], period = 'monthly') {
    const grouped = transactions.reduce((acc, transaction) => {
      const transactionDate = new Date(transaction.date || Date.now());
      if (Number.isNaN(transactionDate.getTime())) {
        return acc;
      }

      let key;
      if (period === 'annual') {
        key = `${transactionDate.getUTCFullYear()}`;
      } else if (period === 'weekly') {
        key = this.calculateIsoWeek(transactionDate);
      } else if (period === 'datewise') {
        key = transactionDate.toISOString().slice(0, 10);
      } else {
        key = transactionDate.toISOString().slice(0, 7);
      }

      if (!acc[key]) {
        acc[key] = {
          period: key,
          transactionCount: 0,
          totalAmount: 0,
          totalCO2Emissions: 0,
          categories: {}
        };
      }

      const amount = Number(transaction.amount) || 0;
      const emissions = Number(transaction?.carbonFootprint?.co2Emissions) || 0;
      const category = (transaction.category || 'other').toLowerCase();
      acc[key].transactionCount += 1;
      acc[key].totalAmount += amount;
      acc[key].totalCO2Emissions += emissions;
      acc[key].categories[category] = (acc[key].categories[category] || 0) + emissions;

      return acc;
    }, {});

    return Object.values(grouped)
      .map((entry) => ({
        ...entry,
        totalAmount: Number(entry.totalAmount.toFixed(2)),
        totalCO2Emissions: Number(entry.totalCO2Emissions.toFixed(3)),
        averageEmissionPerTransaction: entry.transactionCount > 0
          ? Number((entry.totalCO2Emissions / entry.transactionCount).toFixed(3))
          : 0
      }))
      .sort((left, right) => String(left.period).localeCompare(String(right.period)));
  }

  generatePeriodWiseEmissionsSummary(transactions = []) {
    const normalizedTransactions = (Array.isArray(transactions) ? transactions : [])
      .map((transaction, index) => {
        const carbonFootprint = transaction.carbonFootprint ||
          carbonCalculationService.calculateTransactionCarbonFootprint(transaction);
        return {
          ...transaction,
          sourceId: transaction.sourceId || `document_txn_${index + 1}`,
          carbonFootprint
        };
      });

    const totalTransactions = normalizedTransactions.length;
    const totalAmount = normalizedTransactions.reduce(
      (sum, transaction) => sum + (Number(transaction.amount) || 0),
      0
    );
    const totalCO2Emissions = normalizedTransactions.reduce(
      (sum, transaction) => sum + (Number(transaction?.carbonFootprint?.co2Emissions) || 0),
      0
    );

    const categoryMap = {};
    normalizedTransactions.forEach((transaction) => {
      const category = (transaction.category || 'other').toLowerCase();
      if (!categoryMap[category]) {
        categoryMap[category] = {
          category,
          transactionCount: 0,
          totalAmount: 0,
          totalCO2Emissions: 0
        };
      }
      categoryMap[category].transactionCount += 1;
      categoryMap[category].totalAmount += Number(transaction.amount) || 0;
      categoryMap[category].totalCO2Emissions += Number(transaction?.carbonFootprint?.co2Emissions) || 0;
    });

    const categoryBreakdown = Object.values(categoryMap)
      .map((entry) => ({
        ...entry,
        totalAmount: Number(entry.totalAmount.toFixed(2)),
        totalCO2Emissions: Number(entry.totalCO2Emissions.toFixed(3)),
        averageEmissionPerTransaction: entry.transactionCount > 0
          ? Number((entry.totalCO2Emissions / entry.transactionCount).toFixed(3))
          : 0
      }))
      .sort((left, right) => right.totalCO2Emissions - left.totalCO2Emissions);

    return {
      totalTransactions,
      totalAmount: Number(totalAmount.toFixed(2)),
      totalCO2Emissions: Number(totalCO2Emissions.toFixed(3)),
      averageEmissionPerTransaction: totalTransactions > 0
        ? Number((totalCO2Emissions / totalTransactions).toFixed(3))
        : 0,
      categoryBreakdown,
      periodWise: {
        annual: this.aggregateTransactionsByPeriod(normalizedTransactions, 'annual'),
        monthly: this.aggregateTransactionsByPeriod(normalizedTransactions, 'monthly'),
        weekly: this.aggregateTransactionsByPeriod(normalizedTransactions, 'weekly'),
        datewise: this.aggregateTransactionsByPeriod(normalizedTransactions, 'datewise')
      },
      granularTransactions: normalizedTransactions
        .sort((left, right) => {
          const leftDate = new Date(left.date || 0).getTime();
          const rightDate = new Date(right.date || 0).getTime();
          return rightDate - leftDate;
        })
        .slice(0, 500)
    };
  }

  async persistBulkUploadAssessment({ msmeId, msmeProfile, emissionsAssessment }) {
    try {
      const CarbonAssessment = require('../models/CarbonAssessment');
      const now = new Date();
      const allDates = (emissionsAssessment?.granularTransactions || [])
        .map((transaction) => new Date(transaction.date))
        .filter((date) => !Number.isNaN(date.getTime()))
        .sort((left, right) => left.getTime() - right.getTime());
      const periodStart = allDates[0] || now;
      const periodEnd = allDates[allDates.length - 1] || now;

      const assessment = new CarbonAssessment({
        msmeId,
        assessmentType: 'automatic',
        period: {
          startDate: periodStart,
          endDate: periodEnd
        },
        totalCO2Emissions: emissionsAssessment.totalCO2Emissions,
        totalAmount: emissionsAssessment.totalAmount,
        transactionCount: emissionsAssessment.totalTransactions,
        breakdown: {},
        esgScopes: {
          scope1: { total: 0 },
          scope2: { total: 0 },
          scope3: { total: emissionsAssessment.totalCO2Emissions }
        },
        carbonScore: carbonCalculationService.calculateCarbonScore({
          totalCO2Emissions: emissionsAssessment.totalCO2Emissions,
          transactionCount: emissionsAssessment.totalTransactions,
          totalSpend: emissionsAssessment.totalAmount,
          totalAmount: emissionsAssessment.totalAmount,
          breakdown: emissionsAssessment.breakdown || {}
        }, msmeProfile || {}),
        mobileBreakdown: {
          source: 'document_bulk_upload',
          periodWise: emissionsAssessment.periodWise,
          categoryBreakdown: emissionsAssessment.categoryBreakdown,
          averageEmissionPerTransaction: emissionsAssessment.averageEmissionPerTransaction
        },
        recommendations: [],
        status: 'completed',
        notes: 'document_bulk_upload_assessment'
      });

      await assessment.save();

      if (msmeProfile && assessment.carbonScore > 0) {
        const MSME = require('../models/MSME');
        await MSME.findByIdAndUpdate(msmeId, {
          carbonScore: assessment.carbonScore,
          lastCarbonAssessment: new Date()
        });
      }

      return assessment;
    } catch (error) {
      console.warn('Failed to persist bulk upload assessment:', error.message);
      return null;
    }
  }

  /**
   * AI model pipeline to parse multiple processed documents into transactions
   * and compute consolidated carbon emissions.
   * @param {Array<Object>} documents - Processed documents
   * @param {Object} msmeProfile - MSME profile
   * @returns {Object} - AI parsing and carbon analysis result
   */
  async parseMultipleDocumentsIntoTransactions(documents = [], msmeProfile = null) {
    const processedDocuments = documents.filter(doc => doc?.extractedData);
    if (processedDocuments.length === 0) {
      return {
        totalDocuments: 0,
        parsedTransactions: [],
        carbonAnalysis: null,
        documentSummary: null,
        parserStatistics: null
      };
    }

    try {
      const documentAnalysis = await aiAgentService.documentAnalyzerAgent({
        input: {
          documents: processedDocuments
        }
      });

      let derivedTransactions = Array.isArray(documentAnalysis?.derivedTransactions)
        ? documentAnalysis.derivedTransactions
        : [];

      if (derivedTransactions.length === 0) {
        derivedTransactions = processedDocuments.flatMap(document => this.buildDocumentTransactions(
          document,
          document.extractedData || {},
          document.extractedData?.items || [],
          msmeProfile || {}
        ));
      }

      const dataProcessorResult = await aiAgentService.dataProcessorAgent({
        input: {
          transactions: derivedTransactions,
          documents: processedDocuments,
          documentSummary: documentAnalysis?.summary,
          msmeData: msmeProfile || {},
          context: {
            source: 'document_batch_ai_model',
            transactionTypeContext: 'document_upload_batch'
          }
        }
      });

      const validatedTransactions = Array.isArray(dataProcessorResult?.validated) &&
        dataProcessorResult.validated.length > 0
        ? dataProcessorResult.validated
        : derivedTransactions;

      const runtimeContext = {
        msmeData: msmeProfile || {},
        __fuelPriceCache: {}
      };
      const parsedTransactions = [];
      for (const transaction of validatedTransactions) {
        if (transaction.carbonFootprint && Number.isFinite(Number(transaction.carbonFootprint.co2Emissions))) {
          parsedTransactions.push({
            ...transaction,
            carbonFootprint: carbonCalculationService.ensureCarbonFootprintMetrics(
              transaction,
              transaction.carbonFootprint
            )
          });
        } else {
          const footprint = await carbonCalculationService.calculateTransactionCarbonFootprintForAgent(
            transaction,
            runtimeContext
          );
          parsedTransactions.push({
            ...transaction,
            carbonFootprint: carbonCalculationService.ensureCarbonFootprintMetrics(transaction, footprint)
          });
        }
      }

      const carbonAnalysis = await aiAgentService.carbonAnalyzerAgent({
        input: {
          transactions: parsedTransactions,
          msmeData: msmeProfile || {},
          context: {
            source: 'document_batch_ai_model'
          }
        }
      });

      return {
        totalDocuments: processedDocuments.length,
        parsedTransactions,
        carbonAnalysis,
        documentSummary: documentAnalysis?.summary || null,
        parserStatistics: dataProcessorResult?.statistics || null
      };
    } catch (error) {
      console.warn('AI batch document parsing failed:', error.message);
      return {
        totalDocuments: processedDocuments.length,
        parsedTransactions: [],
        carbonAnalysis: null,
        documentSummary: null,
        parserStatistics: null,
        error: error.message
      };
    }
  }

  /**
   * Extract data from uploaded document based on MIME type.
   * @param {Buffer} fileBuffer - Uploaded file buffer
   * @param {Object} document - Document metadata
   * @returns {Object} - Extraction result
   */
  async extractDataFromDocument(fileBuffer, document = {}) {
    const mimeType = this.resolveMimeType(document);
    if (this.isPdfMimeType(mimeType)) {
      return this.extractDataFromPDF(fileBuffer, document);
    }
    if (this.isImageMimeType(mimeType)) {
      return this.extractDataFromImage(fileBuffer, document);
    }
    if (this.isTextMimeType(mimeType)) {
      return this.extractDataFromTextFile(fileBuffer, document);
    }

    return {
      data: this.buildFallbackExtractedData(document),
      rawText: null,
      carbonExtraction: null,
      extractionWarnings: [
        `Unsupported document MIME type "${mimeType || 'unknown'}"; using fallback values.`
      ]
    };
  }

  resolveMimeType(document = {}) {
    const rawMimeType = typeof document?.mimeType === 'string'
      ? document.mimeType.split(';')[0].trim().toLowerCase()
      : '';
    if (rawMimeType) {
      return rawMimeType;
    }

    const extension = path.extname(document?.originalName || document?.fileName || '').toLowerCase();
    const extensionMap = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.tif': 'image/tiff',
      '.tiff': 'image/tiff',
      '.bmp': 'image/bmp',
      '.txt': 'text/plain',
      '.csv': 'text/csv'
    };

    return extensionMap[extension] || 'application/octet-stream';
  }

  isPdfMimeType(mimeType = '') {
    return mimeType === 'application/pdf';
  }

  isImageMimeType(mimeType = '') {
    return OCR_IMAGE_MIME_TYPES.has(mimeType);
  }

  isTextMimeType(mimeType = '') {
    return TEXT_DOCUMENT_MIME_TYPES.has(mimeType);
  }

  /**
   * Extract data from PDF document.
   * @param {Buffer} fileBuffer - PDF file buffer
   * @param {Object} document - Document metadata
   * @returns {Object} - Extraction result
   */
  async extractDataFromPDF(fileBuffer, document = {}) {
    const extractionWarnings = [];
    try {
      let rawText = await this.extractTextFromPDF(fileBuffer);
      if (!rawText) {
        extractionWarnings.push('PDF text extraction returned no text; attempting OCR fallback.');
        rawText = await this.extractTextFromPDFWithOCR(fileBuffer);
      }
      if (!rawText) {
        extractionWarnings.push('Unable to read PDF content; using fallback values.');
        return {
          data: this.buildFallbackExtractedData(document),
          rawText: null,
          carbonExtraction: null,
          extractionWarnings
        };
      }

      return this.buildExtractionResultFromText(rawText, document, extractionWarnings, 'pdf');
    } catch (error) {
      console.error('PDF extraction error:', error);
      extractionWarnings.push('PDF extraction failed; using fallback values.');
      return {
        data: this.buildFallbackExtractedData(document),
        rawText: null,
        carbonExtraction: null,
        extractionWarnings
      };
    }
  }

  async extractDataFromImage(fileBuffer, document = {}) {
    const extractionWarnings = [];
    const rawText = await this.extractTextWithOCR(fileBuffer, {
      source: document?.originalName || 'uploaded image'
    });
    if (!rawText) {
      extractionWarnings.push('Image OCR failed; using fallback values.');
      return {
        data: this.buildFallbackExtractedData(document),
        rawText: null,
        carbonExtraction: null,
        extractionWarnings
      };
    }

    return this.buildExtractionResultFromText(rawText, document, extractionWarnings, 'image');
  }

  async extractDataFromTextFile(fileBuffer, document = {}) {
    const extractionWarnings = [];
    const rawText = this.decodeTextDocumentBuffer(fileBuffer);
    if (!rawText) {
      extractionWarnings.push('Text document is empty or unreadable; using fallback values.');
      return {
        data: this.buildFallbackExtractedData(document),
        rawText: null,
        carbonExtraction: null,
        extractionWarnings
      };
    }

    return this.buildExtractionResultFromText(rawText, document, extractionWarnings, 'text');
  }

  decodeTextDocumentBuffer(fileBuffer) {
    if (!fileBuffer) return null;
    try {
      const utf8Text = fileBuffer.toString('utf8');
      if (utf8Text.trim()) {
        return utf8Text;
      }
      const latin1Text = fileBuffer.toString('latin1');
      return latin1Text.trim() ? latin1Text : null;
    } catch (error) {
      console.warn('Failed to decode text document buffer:', error.message);
      return null;
    }
  }

  async extractTextFromPDFWithOCR(fileBuffer) {
    const rawMax = process.env.DOCUMENT_OCR_PDF_MAX_PAGES;
    const parsedMax = rawMax !== undefined && rawMax !== '' ? parseInt(rawMax, 10) : NaN;
    const maxPages = Math.min(50, Math.max(1, Number.isFinite(parsedMax) ? parsedMax : 10));
    const pageImages = await this.convertPdfPagesToImages(fileBuffer, maxPages);
    if (pageImages.length === 0) {
      return null;
    }

    const pageTexts = [];
    for (let index = 0; index < pageImages.length; index += 1) {
      const pageText = await this.extractTextWithOCR(pageImages[index], {
        source: `pdf_page_${index + 1}`
      });
      if (pageText) {
        pageTexts.push(pageText);
      }
    }

    if (pageTexts.length === 0) {
      return null;
    }

    return pageTexts.join('\n');
  }

  async convertPdfPagesToImages(fileBuffer, maxPages = 2) {
    if (!fileBuffer) {
      return [];
    }

    try {
      const ocrTempPath = path.join(this.processedDir, 'ocr-temp');
      await fs.mkdir(ocrTempPath, { recursive: true });

      const convert = fromBuffer(fileBuffer, {
        density: 180,
        format: 'png',
        width: 1600,
        height: 2200,
        savePath: ocrTempPath
      });

      const images = [];
      for (let page = 1; page <= maxPages; page += 1) {
        try {
          const pageResult = await convert(page, true);
          const pageImage = this.resolvePdfPageToImageBuffer(pageResult);
          if (!pageImage) {
            break;
          }
          images.push(pageImage);
        } catch (pageError) {
          if (page === 1) {
            throw pageError;
          }
          break;
        }
      }

      return images;
    } catch (error) {
      console.warn('PDF OCR fallback conversion failed:', error.message);
      return [];
    }
  }

  resolvePdfPageToImageBuffer(pageResult) {
    if (!pageResult) {
      return null;
    }
    if (Buffer.isBuffer(pageResult)) {
      return pageResult;
    }
    if (typeof pageResult.base64 === 'string' && pageResult.base64.trim()) {
      return Buffer.from(pageResult.base64, 'base64');
    }
    return null;
  }

  async extractTextWithOCR(fileBuffer, options = {}) {
    if (!fileBuffer) {
      return null;
    }

    try {
      const ocrLanguage = process.env.DOCUMENT_OCR_LANG || 'eng';
      const { oem, psm } = parseTesseractOemPsmFromCli(options.tesseractConfig);
      const workerOptions = { logger: () => null };
      const { createWorker } = require('tesseract.js');
      const worker = await createWorker(ocrLanguage, oem, workerOptions);
      try {
        if (psm != null) {
          await worker.setParameters({ tessedit_pageseg_mode: psm });
        }
        const result = await worker.recognize(fileBuffer);
        const text = result?.data?.text ? String(result.data.text) : '';
        return text.trim() ? text : null;
      } finally {
        await worker.terminate();
      }
    } catch (error) {
      const source = options.source ? ` (${options.source})` : '';
      console.warn(`OCR extraction failed${source}:`, error.message);
      return null;
    }
  }

  async extractTextFromPDF(fileBuffer) {
    if (!fileBuffer) {
      return null;
    }
    try {
      const parsed = await pdfParse(fileBuffer);
      const text = parsed?.text ? String(parsed.text) : '';
      return text.trim().length > 0 ? text : null;
    } catch (error) {
      console.error('PDF text parse error:', error);
      return null;
    }
  }

  async buildExtractionResultFromText(rawText, document = {}, extractionWarnings = [], sourceType = 'document') {
    const normalizedText = this.normalizeDocumentText(rawText);
    const extractedItems = this.extractItemsFromText(rawText);
    const amountData = this.extractAmountFromText(rawText);
    const documentDate = this.extractDateFromText(rawText);
    const vendorName = this.extractVendorNameFromText(rawText);
    const description = this.extractDescriptionFromText(rawText)
      || extractedItems[0]?.name
      || this.buildFallbackDescription(document, normalizedText);
    const referenceNumber = this.extractReferenceNumberFromText(rawText);
    const gstData = this.extractGSTFromText(rawText);
    const carbonExtraction = await this.extractCarbonDataFromText(rawText, document?.documentType);

    if (carbonExtraction?.extractedData &&
        carbonExtraction.extractedData.carbonRelevant === false) {
      extractionWarnings.push(`No carbon-relevant signals detected in ${sourceType} content.`);
    }

    const category = this.resolveCategoryFromSignals(carbonExtraction?.extractedData, normalizedText);
    const subcategory = this.resolveSubcategoryFromSignals(
      carbonExtraction?.extractedData,
      category,
      normalizedText
    );

    const extractedData = {
      currency: amountData?.currency || 'INR'
    };

    if (vendorName) {
      extractedData.vendor = { name: vendorName };
    }
    if (Number.isFinite(amountData?.amount)) {
      extractedData.amount = amountData.amount;
    }
    if (extractedItems.length > 0) {
      extractedData.items = extractedItems;
    }
    if (documentDate) {
      extractedData.date = documentDate;
    }
    if (description) {
      extractedData.description = description;
    }
    if (category) {
      extractedData.category = category;
    }
    if (subcategory) {
      extractedData.subcategory = subcategory;
    }
    if (referenceNumber) {
      extractedData.referenceNumber = referenceNumber;
    }
    if (gstData) {
      extractedData.gstin = gstData.gstin;
      extractedData.seller_gstin = gstData.seller_gstin;
      extractedData.buyer_gstin = gstData.buyer_gstin;
      extractedData.gst = {
        seller_gstin: gstData.seller_gstin,
        buyer_gstin: gstData.buyer_gstin,
        total: 0
      };
    }
    if (!Number.isFinite(extractedData.amount) && extractedItems.length > 0) {
      extractedData.amount = extractedItems.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
    }

    this.applyCategoryIntelligence(extractedData, {
      text: normalizedText,
      businessDomain: document?.metadata?.businessDomain || 'other'
    });

    this.applyVerifiedRagToExtractedData(extractedData, {
      text: normalizedText,
      businessDomain: document?.metadata?.businessDomain || 'other',
      candidateLocation: document?.metadata?.location || ''
    });

    return {
      data: extractedData,
      rawText,
      carbonExtraction,
      extractionWarnings
    };
  }

  normalizeDocumentText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  extractItemsFromText(text = '') {
    if (!text) return [];
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    const items = [];
    let hasSeenItemHeader = false;
    let inItemSection = false;

    for (const line of lines) {
      if (this.isItemHeaderLine(line)) {
        hasSeenItemHeader = true;
        inItemSection = true;
        continue;
      }

      if (this.isItemSectionTerminator(line)) {
        if (inItemSection && items.length > 0) {
          inItemSection = false;
        }
        continue;
      }

      const parsedItem = this.parseLineItemCandidate(line, {
        strict: hasSeenItemHeader || inItemSection
      });
      if (parsedItem) {
        items.push(parsedItem);
        inItemSection = true;
        continue;
      }

      if (items.length > 0 && inItemSection && this.isItemContinuationLine(line)) {
        const lastItem = items[items.length - 1];
        const mergedName = `${lastItem.name} ${line}`.replace(/\s+/g, ' ').trim();
        if (mergedName.length <= 220) {
          lastItem.name = mergedName;
        }
      }
    }

    const uniqueItems = [];
    const dedupeKeys = new Set();

    for (const item of items) {
      if (!item || !item.name || !Number.isFinite(item.total) || item.total <= 0) {
        continue;
      }

      // Normalize key once so duplicate checks stay O(1) even for large invoices.
      const normalizedName = item.name.toLowerCase();
      const roundedTotal = Number(item.total.toFixed(2));
      const dedupeKey = `${normalizedName}::${roundedTotal}`;

      if (dedupeKeys.has(dedupeKey)) {
        continue;
      }

      dedupeKeys.add(dedupeKey);
      uniqueItems.push(item);
    }

    return uniqueItems;
  }

  isItemHeaderLine(line = '') {
    const normalized = line.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized) return false;
    return ITEM_HEADER_REGEX.test(normalized) && ITEM_COLUMN_HINT_REGEX.test(normalized);
  }

  isItemSectionTerminator(line = '') {
    const normalized = line.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized) return false;
    return /^(?:sub\s*total|subtotal|grand total|total in words|total amount|amount due|bank details|terms and conditions|notes?|authori[sz]ed signatory|for recipient|gst payable|tax amount|round off)/i.test(normalized);
  }

  isItemNoiseLine(line = '') {
    const normalized = line.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized) return true;
    if (this.isItemSectionTerminator(normalized)) return true;
    return /(?:invoice|receipt|challan|waybill|lr no|vehicle|phone|mobile|email|website|address|gstin|pan|ifsc|account|branch|due date|billing|shipping|place of supply|state code|document type|hsn\/sac code)/i.test(normalized);
  }

  isItemContinuationLine(line = '') {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length < 2 || normalized.length > 120) return false;
    if (this.isItemNoiseLine(normalized) || this.isItemHeaderLine(normalized)) return false;
    const numberTokens = normalized.match(/\d[\d,]*(?:\.\d+)?/g) || [];
    if (numberTokens.length > 1) return false;
    if (!/[A-Za-z]/.test(normalized)) return false;
    return true;
  }

  parseLineItemCandidate(line = '', { strict = false } = {}) {
    const normalizedLine = line.replace(/\s+/g, ' ').trim();
    if (!normalizedLine || this.isItemNoiseLine(normalizedLine)) return null;

    const numberTokens = normalizedLine.match(/\d[\d,]*(?:\.\d+)?/g) || [];
    if (numberTokens.length < 2) return null;

    const numbers = numberTokens
      .map(token => this.parseAmount(token))
      .filter(value => Number.isFinite(value) && value > 0 && value < 1000000000);
    if (numbers.length < 2) return null;

    const probableTotal = numbers[numbers.length - 1];
    if (!Number.isFinite(probableTotal) || probableTotal <= 0) return null;

    let quantity = 1;
    let price = numbers[numbers.length - 2];
    let bestFit = null;

    for (let qtyIndex = 0; qtyIndex < numbers.length - 1; qtyIndex += 1) {
      const maybeQty = numbers[qtyIndex];
      if (maybeQty <= 0 || maybeQty > 10000) {
        continue;
      }
      for (let priceIndex = qtyIndex + 1; priceIndex < numbers.length - 1; priceIndex += 1) {
        const maybePrice = numbers[priceIndex];
        if (maybePrice <= 0 || maybePrice > 100000000) {
          continue;
        }
        for (let targetIndex = priceIndex + 1; targetIndex < numbers.length; targetIndex += 1) {
          const target = numbers[targetIndex];
          const product = maybeQty * maybePrice;
          const diff = Math.abs(product - target);
          const tolerance = Math.max(1, target * 0.15);
          if (diff > tolerance) {
            continue;
          }
          const score = diff + ((numbers.length - 1 - targetIndex) * 0.25);
          if (!bestFit || score < bestFit.score) {
            bestFit = {
              score,
              quantity: maybeQty,
              price: maybePrice
            };
          }
        }
      }
    }

    if (bestFit) {
      quantity = bestFit.quantity;
      price = bestFit.price;
    } else if (Number.isFinite(price) && price > 0 && Number.isFinite(probableTotal)) {
      const estimatedQty = probableTotal / price;
      if (estimatedQty > 0 && estimatedQty <= 10000) {
        quantity = estimatedQty;
      }
    }

    if (strict && !bestFit && numberTokens.length >= 6) {
      return null;
    }

    const candidateName = this.cleanItemName(normalizedLine, numberTokens);
    if (!candidateName || candidateName.length < 3) return null;

    return {
      name: candidateName,
      quantity: Number(quantity.toFixed(2)),
      price: Number(price.toFixed(2)),
      total: Number(probableTotal.toFixed(2))
    };
  }

  cleanItemName(line = '', numberTokens = []) {
    let cleaned = line.replace(/^\s*\d{1,3}[\.\)-]?\s+/, ' ');
    numberTokens.forEach(token => {
      cleaned = cleaned.replace(token, ' ');
    });
    cleaned = cleaned.replace(/[%₹$£€¥]/g, ' ');
    cleaned = cleaned.replace(/\b(?:igst|cgst|sgst|cess|hsn|sac|taxable|amount|rate|qty|quantity|total)\b/gi, ' ');
    cleaned = cleaned.replace(ITEM_UNIT_REGEX, ' ');
    cleaned = cleaned.replace(/[^\w\s\-\/&(),.]/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    if (!/[A-Za-z]{2,}/.test(cleaned)) {
      return '';
    }
    return cleaned;
  }

  async extractCarbonDataFromText(text, documentType) {
    if (!text) return null;
    try {
      const source = documentType ? `document_${documentType}` : 'document';
      return await this.aiDataExtractionService.extractCarbonDataFromText(text, source);
    } catch (error) {
      console.warn('AI carbon extraction failed:', error.message);
      return null;
    }
  }

  buildFallbackExtractedData(document = {}) {
    const fallbackDescription = this.buildFallbackDescription(document);
    return {
      currency: 'INR',
      description: fallbackDescription,
      date: document?.createdAt ? new Date(document.createdAt) : new Date(),
      category: 'other',
      subcategory: 'general'
    };
  }

  buildFallbackDescription(document = {}, normalizedText = '') {
    if (normalizedText) {
      return normalizedText.slice(0, 160);
    }
    if (document?.originalName) {
      return document.originalName;
    }
    if (document?.documentType) {
      return `${document.documentType} document`;
    }
    return 'Document transaction';
  }

  extractAmountFromText(text = '') {
    if (!text) return null;
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const labeledPatterns = [
      { regex: /amount\s*due/i, weight: 10 },
      { regex: /balance\s*due/i, weight: 9 },
      { regex: /net\s*payable/i, weight: 8 },
      { regex: /grand\s*total/i, weight: 7 },
      { regex: /total\s*due/i, weight: 7 },
      { regex: /(invoice total|bill total|total amount)/i, weight: 5 }
    ];
    const currencyRegex = /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)\s*(lakhs?|lacs?|crores?)?/gi;
    const bareAmountRegex = /\b([\d,]{1,12}(?:\.\d{1,2})?)\b/g;

    const candidates = [];
    const addCandidate = (value, currency, weight, line = '') => {
      const amount = this.parseAmount(value);
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_REASONABLE_INVOICE_AMOUNT) {
        return;
      }
      if (/total\s+invoice\s+value\s*\(in\s+figure\)/i.test(line) && amount > 50000) {
        return;
      }
      candidates.push({
        amount,
        currency: this.normalizeCurrency(currency),
        weight
      });
    };

    const scanLine = (line, weight, requireCurrency = false) => {
      let match;
      currencyRegex.lastIndex = 0;
      while ((match = currencyRegex.exec(line)) !== null) {
        const scaledValue = match[2] ? `${match[1]} ${match[2]}` : match[1];
        addCandidate(scaledValue, match[0], weight, line);
      }
      if (!requireCurrency) {
        bareAmountRegex.lastIndex = 0;
        while ((match = bareAmountRegex.exec(line)) !== null) {
          addCandidate(match[1], 'INR', weight - 2, line);
        }
      }
    };

    lines.forEach(line => {
      labeledPatterns.forEach(({ regex, weight }) => {
        if (regex.test(line)) {
          scanLine(line, weight, /amount\s*due/i.test(line));
        }
      });
    });

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => {
      if (b.weight !== a.weight) {
        return b.weight - a.weight;
      }
      return a.amount - b.amount;
    });

    return {
      amount: candidates[0].amount,
      currency: candidates[0].currency || 'INR'
    };
  }

  parseAmount(value) {
    if (value === null || value === undefined) return null;
    const normalizedValue = String(value).toLowerCase().replace(/,/g, '').trim();
    let multiplier = 1;
    if (/(lakhs?|lacs?)/.test(normalizedValue)) {
      multiplier = 100000;
    } else if (/crores?/.test(normalizedValue)) {
      multiplier = 10000000;
    }
    const cleaned = normalizedValue.replace(/\b(?:lakhs?|lacs?|crores?)\b/g, '').trim();
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed * multiplier : null;
  }

  normalizeCurrency(value = '') {
    const normalized = String(value).toUpperCase();
    if (normalized.includes('₹') || normalized.includes('INR') || normalized.includes('RS')) {
      return 'INR';
    }
    if (normalized.includes('USD') || normalized.includes('$')) {
      return 'USD';
    }
    if (normalized.includes('EUR') || normalized.includes('€')) {
      return 'EUR';
    }
    return 'INR';
  }

  extractDateFromText(text = '') {
    if (!text) return null;
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const labeledDateRegex = /invoice\s*date[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4})/i;
    for (const line of lines) {
      const labeled = line.match(labeledDateRegex);
      if (labeled?.[1]) {
        const parsed = this.parseDocumentDate(labeled[1]);
        if (parsed) {
          return parsed;
        }
      }
    }
    const dateLineRegex = /(invoice date|bill date|receipt date|date)/i;
    const dateFormats = [
      'DD/MM/YYYY', 'D/M/YYYY', 'DD-MM-YYYY', 'D-M-YYYY',
      'YYYY-MM-DD', 'YYYY/MM/DD',
      'DD MMM YYYY', 'D MMM YYYY', 'DD MMMM YYYY', 'D MMMM YYYY',
      'MMM D, YYYY', 'MMMM D, YYYY', 'MMM DD, YYYY', 'MMMM DD, YYYY'
    ];

    const extractCandidates = (content) => {
      const matches = [];
      const patterns = [
        /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g,
        /\b\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\b/g,
        /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}\b/g,
        /\b[A-Za-z]{3,9}\s+\d{1,2},\s+\d{2,4}\b/g
      ];
      patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          matches.push(match[0]);
        }
      });
      return matches;
    };

    const prioritizedLines = lines.filter(line => dateLineRegex.test(line));
    const candidates = prioritizedLines.length > 0
      ? extractCandidates(prioritizedLines.join(' '))
      : extractCandidates(text);

    for (const candidate of candidates) {
      const parsed = this.parseDocumentDate(candidate);
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  extractVendorNameFromText(text = '') {
    if (!text) return null;
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const labeledRegex = /(vendor|supplier|billed by|sold by|from|issuer)\s*[:\-]\s*(.+)/i;
    const ignoreRegex = /(invoice|receipt|bill|tax|gst|total|amount|date|original|signature|sleek)/i;
    const companySuffixRegex = /\b(LLC|LLP|LTD\.?|PRIVATE LIMITED|LIMITED|INDUSTRIES|ENTERPRISE)\b/i;

    for (const line of lines.slice(0, 30)) {
      if (companySuffixRegex.test(line) && !this.isInvalidVendorName(line)) {
        return line.slice(0, 80);
      }
    }

    for (const line of lines) {
      const match = line.match(labeledRegex);
      if (match && match[2]) {
        const candidate = match[2].trim();
        if (!this.isInvalidVendorName(candidate)) {
          return candidate;
        }
      }
    }

    const candidate = lines.slice(0, 10).find(line => {
      const hasLetters = /[A-Za-z]/.test(line);
      const lowDigitDensity = (line.match(/\d/g) || []).length <= 4;
      const looksLikeAddress = /(road|street|phase|sector|plot|lane|floor|near|district|state|india|\d{6})/i.test(line);
      return hasLetters
        && !ignoreRegex.test(line)
        && lowDigitDensity
        && !looksLikeAddress
        && !this.isInvalidVendorName(line);
    });

    return candidate || null;
  }

  extractDescriptionFromText(text = '') {
    if (!text) return null;
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const descriptionRegex = /(description|particulars|details|service|item)\s*[:\-]\s*(.+)/i;
    for (const line of lines) {
      const match = line.match(descriptionRegex);
      if (match && match[2]) {
        return match[2].trim();
      }
    }
    return null;
  }

  extractReferenceNumberFromText(text = '') {
    if (!text) return null;
    const recovered = referenceRecovery.extractReferenceFromText(text);
    if (recovered) {
      return recovered;
    }
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const referencePatterns = [
      /^(?:invoice|receipt|bill|ref(?:erence)?|txn|transaction)\b[\s\-]*(?:no\.?|number|#|id)?\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,24})\b/i,
      /^(?:invoice|receipt|bill|ref(?:erence)?|txn|transaction)\b[\s\-]*(?:no\.?|number|#|id)\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,24})\b/i,
      /\b(INV[\-/][A-Z0-9\-]{2,24})\b/i
    ];

    for (const line of lines) {
      for (const referenceRegex of referencePatterns) {
        const match = line.match(referenceRegex);
        const candidate = match?.[1]?.trim();
        if (referenceRecovery.isValidReferenceNumber(candidate)) {
          return referenceRecovery.normalizeReferenceCandidate(candidate);
        }
      }
    }
    return null;
  }

  extractGSTFromText(text = '') {
    const gstData = gstinRecovery.extractGstinFromText(text);
    if (!gstData) {
      return null;
    }
    return {
      ...gstData,
      total: 0
    };
  }

  isInvalidVendorName(name) {
    if (!name) return true;
    const normalized = String(name).trim().toLowerCase();
    if (!normalized) return true;
    if (INVALID_VENDOR_NAMES.has(normalized)) {
      return true;
    }
    if (INVALID_VENDOR_PATTERN.test(normalized)) {
      return true;
    }
    const letters = (normalized.match(/[a-z]/g) || []).length;
    const digits = (normalized.match(/\d/g) || []).length;
    if (letters < 3 || digits > letters * 2) {
      return true;
    }
    if (normalized.length > 90) {
      return true;
    }
    return false;
  }

  sanitizeExtractedItems(items = []) {
    if (!Array.isArray(items)) {
      return [];
    }
    const cleaned = [];
    const seen = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const name = String(item.name || '').replace(/\s+/g, ' ').trim();
      if (!name || this.isInvalidVendorName(name) || INVALID_VENDOR_PATTERN.test(name)) {
        continue;
      }
      const letters = (name.match(/[A-Za-z]/g) || []).length;
      if (letters < 3 || name.length > 120) {
        continue;
      }
      const total = Number(item.total);
      const quantity = Number(item.quantity);
      const price = Number(item.price);
      if (!Number.isFinite(total) || total <= 0 || total > MAX_REASONABLE_LINE_ITEM_TOTAL) {
        continue;
      }
      if (Number.isFinite(quantity) && Number.isFinite(price) && quantity > 0 && price > 0) {
        const expected = quantity * price;
        if (Math.abs(expected - total) > Math.max(5, total * 0.5) && total > expected * 8) {
          continue;
        }
      }
      const key = `${name.toLowerCase()}::${total.toFixed(2)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      cleaned.push({
        ...item,
        name: name.slice(0, 120),
        total: Number(total.toFixed(2)),
        quantity: Number.isFinite(quantity) && quantity > 0 ? Number(quantity.toFixed(2)) : 1,
        price: Number.isFinite(price) && price > 0 ? Number(price.toFixed(2)) : Number((total / Math.max(quantity || 1, 1)).toFixed(2))
      });
    }
    return cleaned;
  }

  isExtractionQualitySufficientForTransactions(extractedData = {}, itemFootprints = [], accuracyReport = null) {
    const amount = Number(extractedData?.amount) || 0;
    if (amount <= 0 || amount > MAX_REASONABLE_INVOICE_AMOUNT) {
      return false;
    }
    const vendorName = extractedData?.vendor?.name || extractedData?.vendor;
    if (!vendorName || this.isInvalidVendorName(vendorName)) {
      return false;
    }
    if (itemFootprints.length > 0) {
      const itemSum = itemFootprints.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
      if (itemSum > amount * 4 || (itemSum > 0 && itemSum < amount * 0.05)) {
        return false;
      }
      const garbageNames = itemFootprints.filter(row => this.isInvalidVendorName(row.name));
      if (garbageNames.length > 0) {
        return false;
      }
    }
    if (accuracyReport && Number.isFinite(accuracyReport.overall) && accuracyReport.overall < 0.35) {
      return false;
    }
    return true;
  }

  resolveCategoryFromSignals(carbonData, normalizedText = '') {
    if (carbonData && this.hasCarbonSignals(carbonData)) {
      if (carbonData.energy?.electricity?.consumption || carbonData.energy?.fuel?.consumption) {
        return 'energy';
      }
      if (carbonData.water?.consumption) {
        return 'water';
      }
      if (carbonData.waste?.solid?.quantity || carbonData.waste?.hazardous?.quantity) {
        return 'waste_management';
      }
      if (carbonData.transportation?.distance || carbonData.transportation?.fuelConsumption) {
        return 'transportation';
      }
      if (carbonData.materials?.rawMaterials?.quantity || carbonData.materials?.packaging?.quantity) {
        return 'raw_materials';
      }
    }

    return this.resolveItemCategory({ name: normalizedText }, { description: normalizedText });
  }

  resolveSubcategoryFromSignals(carbonData, category, normalizedText = '') {
    if (category === 'energy' && carbonData?.energy) {
      const renewableType = String(carbonData.energy.renewable?.type || '').toLowerCase();
      const text = String(normalizedText || '').toLowerCase();
      if (carbonData.energy.renewable?.percentage > 0) {
        if (renewableType.includes('solar') || text.includes('solar') || text.includes('photovoltaic')) {
          return 'solar';
        }
        return 'renewable';
      }
      if (text.includes('solar') || text.includes('photovoltaic') || text.includes('net meter')) {
        return 'solar';
      }
      if (carbonData.energy.fuel?.consumption > 0) {
        return 'fuel';
      }
      return 'grid';
    }

    return this.resolveItemSubcategory({ name: normalizedText }, category, { description: normalizedText });
  }

  hasCarbonSignals(carbonData) {
    if (!carbonData) return false;
    return Boolean(
      carbonData.energy?.electricity?.consumption ||
      carbonData.energy?.fuel?.consumption ||
      carbonData.materials?.rawMaterials?.quantity ||
      carbonData.materials?.packaging?.quantity ||
      carbonData.transportation?.distance ||
      carbonData.transportation?.fuelConsumption ||
      carbonData.waste?.solid?.quantity ||
      carbonData.waste?.hazardous?.quantity ||
      carbonData.water?.consumption
    );
  }

  /**
   * Normalize extractedData fields to match Document schema before Mongo save.
   */
  normalizeExtractedDataForSave(extractedData = {}) {
    return extractedDataNormalizationService.normalizeExtractedDataForSave(extractedData);
  }

  logExtractedDataNormalizationSnapshot(stage, extractedData = {}) {
    const vendor = extractedData?.vendor;
    const vendorValue = typeof vendor === 'string' ? vendor : vendor?.name;
    console.log(`[${stage}] typeof vendor:`, typeof vendor);
    console.log(`[${stage}] vendor value:`, vendorValue);
    console.log(`[${stage}] category value:`, extractedData?.category);
  }

  logExtractedDataOnDocument(stage, document) {
    const data = document?.get?.('extractedData') ?? document?.extractedData ?? {};
    const vendor = data?.vendor;
    console.log(`[${stage}] typeof vendor:`, typeof vendor);
    console.log(`[${stage}] vendor value:`, typeof vendor === 'string' ? vendor : vendor?.name);
    console.log(`[${stage}] category value:`, data?.category);
  }

  /**
   * Normalize extractedData and assign to the document (no save).
   */
  assignExtractedDataForSave(document, extractedData = {}) {
    const inputClone = JSON.parse(JSON.stringify(extractedData || {}));
    this.logExtractedDataNormalizationSnapshot('BEFORE NORMALIZATION', inputClone);
    const normalized = this.normalizeExtractedDataForSave(inputClone);
    this.logExtractedDataNormalizationSnapshot('AFTER NORMALIZATION', normalized);

    if (typeof normalized.vendor === 'string') {
      normalized.vendor = { name: normalized.vendor };
    }

    const plainExtractedData = JSON.parse(JSON.stringify(normalized));
    document.set('extractedData', plainExtractedData);
    document.markModified('extractedData');
    return plainExtractedData;
  }

  /**
   * Single persistence path: normalize → set extractedData → markModified → save.
   */
  async finalizeAndSaveProcessedDocument(document, extractedData, documentPatch = {}) {
    const normalizedExtractedData = this.assignExtractedDataForSave(document, extractedData);

    if (documentPatch.status) {
      await documentLifecycle.transitionDocument(document, documentPatch.status, {
        save: false,
        lifecycleMeta: { lastStage: 'finalize_save' }
      });
    }
    if (documentPatch.processingResults) {
      document.processingResults = documentPatch.processingResults;
    }
    if (documentPatch.carbonFootprint !== undefined) {
      document.carbonFootprint = documentPatch.carbonFootprint;
    }
    if (documentPatch.carbonAnalysis !== undefined) {
      document.carbonAnalysis = documentPatch.carbonAnalysis;
    }
    if (documentPatch.duplicateDetection !== undefined) {
      document.duplicateDetection = documentPatch.duplicateDetection;
    }

    this.logExtractedDataOnDocument('BEFORE SAVE', document);
    await document.save();
    this.logExtractedDataOnDocument('AFTER SAVE', document);
    console.log('✅ FINAL EXTRACTED DATA (persisted):', document.get('extractedData'));
    return normalizedExtractedData;
  }

  /**
   * Validate extracted data
   * @param {Object} extractedData - Extracted data
   * @returns {Object} - Validation result
   */
  validateExtractedData(extractedData) {
    const warnings = [];

    if (!extractedData.amount || extractedData.amount > MAX_REASONABLE_INVOICE_AMOUNT) {
      warnings.push('Amount not found or invalid');
    }

    if (!extractedData.date) {
      warnings.push('Date not found');
    }

    const vendorName = extractedData.vendor?.name || extractedData.vendor;
    if (!vendorName || this.isInvalidVendorName(vendorName)) {
      warnings.push('Vendor information not found or unreliable');
    }

    if (!extractedData.description) {
      warnings.push('Description not found');
    }

    const items = Array.isArray(extractedData.items) ? extractedData.items : [];
    if (items.length === 0) {
      warnings.push('No reliable line items extracted');
    } else if (extractedData.amount > 0) {
      const itemSum = items.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
      if (itemSum > extractedData.amount * 4) {
        warnings.push('Line item totals exceed invoice amount — possible OCR table corruption');
      }
    }

    return { warnings };
  }

  calculateItemCarbonFootprints(extractedData = {}) {
    const items = Array.isArray(extractedData.items) ? extractedData.items : [];
    if (items.length === 0) {
      return [];
    }

    return items.map(item => {
      const amount = this.resolveItemAmount(item);
      const category = this.resolveItemCategory(item, extractedData);
      const subcategory = this.resolveItemSubcategory(item, category, extractedData);
      const description = item.name || extractedData.description || 'Document item';

      const carbonFootprint = carbonCalculationService.calculateTransactionCarbonFootprint({
        amount,
        category,
        subcategory,
        description,
        vendor: extractedData.vendor
      });
      const estimatedScope = carbonCalculationService.estimateTransactionScope({
        category,
        subcategory,
        description
      });

      return {
        ...item,
        total: amount || item.total,
        category,
        subcategory,
        ragClassification: item.ragClassification || extractedData.ragClassification || null,
        carbonFootprint: {
          co2Emissions: carbonFootprint.co2Emissions || 0,
          emissionFactor: carbonFootprint.emissionFactor || 0,
          calculationMethod: carbonFootprint.calculationMethod || 'document_item',
          emissionBreakdown: carbonFootprint.emissionBreakdown,
          metrics: carbonFootprint.metrics,
          ghgProtocol: {
            standard: 'GHG Protocol Corporate Standard',
            scope: estimatedScope || 'scope3',
            methodology: 'line_item_bottom_up'
          }
        }
      };
    });
  }

  summarizeLineItemBreakup(itemFootprints = [], extractedData = {}) {
    const items = Array.isArray(itemFootprints) ? itemFootprints : [];
    if (items.length === 0) {
      return {
        lineItems: [],
        scopeTotals: {
          scope1: 0,
          scope2: 0,
          scope3: 0
        },
        categoryTotals: {}
      };
    }

    const scopeTotals = {
      scope1: 0,
      scope2: 0,
      scope3: 0
    };
    const categoryTotals = {};

    const lineItems = items.map((item, index) => {
      const emissions = Number(item?.carbonFootprint?.co2Emissions) || 0;
      const amount = Number(item?.total) || this.resolveItemAmount(item);
      const category = item?.category || extractedData.category || 'other';
      const subcategory = item?.subcategory || extractedData.subcategory || 'general';
      const description = item?.name || extractedData.description || `Line item ${index + 1}`;
      const estimatedScope =
        item?.carbonFootprint?.ghgProtocol?.scope ||
        carbonCalculationService.estimateTransactionScope({
          category,
          subcategory,
          description
        }) ||
        'scope3';

      if (scopeTotals[estimatedScope] !== undefined) {
        scopeTotals[estimatedScope] += emissions;
      }
      if (!categoryTotals[category]) {
        categoryTotals[category] = 0;
      }
      categoryTotals[category] += emissions;

      return {
        lineItemNo: index + 1,
        description,
        category,
        subcategory,
        amount,
        emissions: Math.round(emissions * 100) / 100,
        ghgScope: estimatedScope
      };
    });

    return {
      lineItems,
      scopeTotals: {
        scope1: Math.round((scopeTotals.scope1 || 0) * 100) / 100,
        scope2: Math.round((scopeTotals.scope2 || 0) * 100) / 100,
        scope3: Math.round((scopeTotals.scope3 || 0) * 100) / 100
      },
      categoryTotals: Object.entries(categoryTotals).reduce((acc, [category, emissions]) => {
        acc[category] = Math.round(emissions * 100) / 100;
        return acc;
      }, {})
    };
  }

  resolveItemAmount(item) {
    const quantity = Number(item?.quantity) || 0;
    const price = Number(item?.price) || 0;
    const total = Number(item?.total) || 0;
    if (total > 0) {
      return total;
    }
    if (quantity > 0 && price > 0) {
      return quantity * price;
    }
    return 0;
  }

  applyCategoryIntelligence(extractedData = {}, context = {}) {
    if (!extractedData || typeof extractedData !== 'object') {
      return extractedData;
    }

    const vendorName = typeof extractedData.vendor === 'string'
      ? extractedData.vendor
      : extractedData.vendor?.name;

    const classification = categoryIntelligenceService.classify({
      text: [
        context.text,
        extractedData.rawText,
        extractedData.description,
        extractedData.invoiceCategory,
        extractedData.invoice_category
      ].filter(Boolean).join(' '),
      vendor: vendorName,
      items: extractedData.items || [],
      mlLabel: extractedData.category,
      mlConf: Number(extractedData?.classification_intelligence?.confidence)
        || Number(extractedData?.confidence?.overall)
        || 0,
      sector: extractedData.sector || extractedData?.classificationContext?.sector,
      historicalCategory: context.historicalCategory || extractedData.category
    });

    const backendFields = categoryIntelligenceService.toBackendFields(classification);
    const allowed = categoryIntelligenceService.getAllowedBackendCategories();

    extractedData.invoiceCategory = classification.category;
    extractedData.invoiceSubcategory = classification.subcategory;
    extractedData.category = allowed.includes(backendFields.category)
      ? backendFields.category
      : 'other';
    extractedData.subcategory = backendFields.subcategory || 'general';
    extractedData.classificationContext = {
      ...(extractedData.classificationContext || {}),
      ...backendFields.classificationContext
    };
    extractedData.classificationIntelligence = classification;

    return extractedData;
  }

  resolveItemCategory(item, extractedData = {}) {
    const ragClassification = this.getRagClassification(item, extractedData);
    if (ragClassification?.category) {
      return ragClassification.category;
    }
    return categoryIntelligenceService.resolveItemCategory(item, extractedData);
  }

  resolveItemSubcategory(item, category, extractedData = {}) {
    const ragClassification = this.getRagClassification(item, extractedData);
    if (ragClassification?.subcategory) {
      return ragClassification.subcategory;
    }

    const text = String(
      [
        item?.name,
        item?.description,
        extractedData?.description,
        extractedData?.rawText
      ].filter(Boolean).join(' ')
    ).toLowerCase();

    if (category === 'energy') {
      if (text.includes('solar') || text.includes('photovoltaic') || text.includes(' pv ') || text.includes('net meter')) {
        return 'solar';
      }
      if (text.includes('wind') || text.includes('renewable')) return 'renewable';
      if (text.includes('coal')) return 'coal';
      if (text.includes('diesel')) return 'diesel';
      if (text.includes('petrol')) return 'petrol';
      if (text.includes('cng')) return 'cng';
      if (text.includes('lpg')) return 'lpg';
      if (text.includes('diesel') || text.includes('petrol') || text.includes('fuel')) return 'fuel';
      return 'grid';
    }

    if (category === 'transportation') {
      if (text.includes('diesel')) return 'diesel';
      if (text.includes('petrol')) return 'petrol';
      return 'general';
    }

    if (category === 'raw_materials') {
      if (text.includes('steel')) return 'steel';
      if (text.includes('aluminum')) return 'aluminum';
      if (text.includes('plastic')) return 'plastic';
      return 'general';
    }

    if (category === 'waste_management') {
      if (text.includes('hazardous') || text.includes('toxic')) return 'hazardous';
      if (text.includes('recycle')) return 'recycling';
      return 'solid';
    }

    return extractedData.subcategory || 'general';
  }

  getRagClassification(item = {}, extractedData = {}) {
    if (item?.ragClassification) {
      return item.ragClassification;
    }
    return extractedData?.ragClassification || null;
  }

  applyVerifiedRagToExtractedData(extractedData = {}, context = {}) {
    if (!extractedData || typeof extractedData !== 'object') {
      return;
    }

    const category = String(extractedData.category || '').toLowerCase();
    const subcategory = String(extractedData.subcategory || '').toLowerCase();
    const shouldResolve = (
      !category ||
      category === 'other' ||
      category === 'unknown' ||
      subcategory === 'general'
    );
    if (!shouldResolve) {
      return;
    }

    const classification = verifiedKnowledgeRagService.classifyUnknownTransaction({
      text: context.text || extractedData.description || '',
      businessDomain: context.businessDomain || 'other',
      transactionType: 'expense',
      parameterType: 'transaction',
      candidateLocation: context.candidateLocation || ''
    });
    if (!classification) {
      return;
    }

    extractedData.category = classification.category || extractedData.category || 'other';
    extractedData.subcategory = classification.subcategory || extractedData.subcategory || 'general';
    extractedData.ragClassification = {
      retrievalMethod: classification.retrievalMethod,
      normalizedLabel: classification.normalizedLabel,
      verifiedSource: classification.verifiedSource,
      referenceNote: classification.referenceNote,
      emissionFactor: classification.emissionFactor,
      matchedKeywords: classification.matchedKeywords,
      confidence: classification.confidence
    };
  }

  /**
   * Check for duplicate documents
   * @param {string} msmeId - MSME ID
   * @param {Object} extractedData - Extracted data
   * @returns {Object} - Duplicate detection result
   */
  async checkForDuplicates(msmeId, extractedData) {
    const Document = require('../models/Document');
    
    try {
      // Find similar documents within the last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      const recentDocuments = await Document.find({
        msmeId,
        status: 'processed',
        createdAt: { $gte: thirtyDaysAgo },
        'extractedData.amount': { $exists: true }
      });

      let bestMatch = null;
      let highestSimilarity = 0;
      const normalizedDateKey = this.buildDuplicateDateKey(extractedData?.date);
      const normalizedReferenceNumber = this.normalizeReferenceNumber(
        fieldContract.readReferenceNumber(extractedData)
      );
      const normalizedVendor = this.normalizeVendorName(fieldContract.readVendorName(extractedData));

      if (normalizedDateKey && normalizedReferenceNumber && normalizedVendor) {
        const strictKeyMatch = recentDocuments.find((doc) => (
          this.buildDuplicateDateKey(doc?.extractedData?.date) === normalizedDateKey
          && this.normalizeReferenceNumber(
            fieldContract.readReferenceNumber(doc?.extractedData)
          ) === normalizedReferenceNumber
          && this.normalizeVendorName(fieldContract.readVendorName(doc?.extractedData)) === normalizedVendor
        ));

        if (strictKeyMatch) {
          return {
            isDuplicate: true,
            duplicateType: 'exact',
            similarityScore: 1,
            matchedDocumentId: strictKeyMatch._id,
            duplicateReasons: ['Exact key match found (date + document number + vendor)']
          };
        }
      }

      for (const doc of recentDocuments) {
        const similarity = this.calculateDocumentSimilarity(extractedData, doc.extractedData);
        
        if (similarity > highestSimilarity) {
          highestSimilarity = similarity;
          bestMatch = doc;
        }
      }

      const thresholds = {
        exact: 0.95,
        near: 0.80,
        fuzzy: 0.65
      };

      if (highestSimilarity >= thresholds.exact) {
        return {
          isDuplicate: true,
          duplicateType: 'exact',
          similarityScore: highestSimilarity,
          matchedDocumentId: bestMatch._id,
          duplicateReasons: ['Exact match found']
        };
      } else if (highestSimilarity >= thresholds.near) {
        return {
          isDuplicate: true,
          duplicateType: 'near',
          similarityScore: highestSimilarity,
          matchedDocumentId: bestMatch._id,
          duplicateReasons: ['Near match found']
        };
      } else if (highestSimilarity >= thresholds.fuzzy) {
        return {
          isDuplicate: true,
          duplicateType: 'fuzzy',
          similarityScore: highestSimilarity,
          matchedDocumentId: bestMatch._id,
          duplicateReasons: ['Fuzzy match found']
        };
      }

      return {
        isDuplicate: false,
        duplicateType: null,
        similarityScore: highestSimilarity,
        matchedDocumentId: null,
        duplicateReasons: []
      };

    } catch (error) {
      console.error('Duplicate detection error:', error);
      return {
        isDuplicate: false,
        duplicateType: null,
        similarityScore: 0,
        matchedDocumentId: null,
        duplicateReasons: ['Error in duplicate detection']
      };
    }
  }

  buildDuplicateDateKey(dateValue) {
    if (!dateValue) return null;
    const parsed = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }

  normalizeReferenceNumber(referenceValue) {
    if (!referenceValue) return null;
    const normalized = String(referenceValue).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return normalized.length >= 3 ? normalized : null;
  }

  normalizeVendorName(vendorValue) {
    if (!vendorValue) return null;
    const normalized = String(vendorValue).toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    return normalized.length >= 2 ? normalized : null;
  }

  /**
   * Calculate similarity between two documents
   * @param {Object} doc1 - First document data
   * @param {Object} doc2 - Second document data
   * @returns {number} - Similarity score (0-1)
   */
  calculateDocumentSimilarity(doc1, doc2) {
    const weights = {
      amount: 0.3,
      vendor: 0.25,
      date: 0.2,
      description: 0.15,
      category: 0.1
    };

    let totalScore = 0;
    let totalWeight = 0;

    // Amount similarity
    if (doc1.amount && doc2.amount) {
      const amountSimilarity = this.calculateAmountSimilarity(doc1.amount, doc2.amount);
      totalScore += amountSimilarity * weights.amount;
      totalWeight += weights.amount;
    }

    // Vendor similarity
    if (doc1.vendor && doc2.vendor && doc1.vendor.name && doc2.vendor.name) {
      const vendorSimilarity = this.calculateTextSimilarity(doc1.vendor.name, doc2.vendor.name);
      totalScore += vendorSimilarity * weights.vendor;
      totalWeight += weights.vendor;
    }

    // Date similarity
    if (doc1.date && doc2.date) {
      const date1 = new Date(doc1.date);
      const date2 = new Date(doc2.date);
      const daysDiff = Math.abs(date1 - date2) / (1000 * 60 * 60 * 24);
      const dateSimilarity = daysDiff <= 1 ? 1 : Math.max(0, 1 - daysDiff / 30);
      totalScore += dateSimilarity * weights.date;
      totalWeight += weights.date;
    }

    // Description similarity
    if (doc1.description && doc2.description) {
      const descriptionSimilarity = this.calculateTextSimilarity(doc1.description, doc2.description);
      totalScore += descriptionSimilarity * weights.description;
      totalWeight += weights.description;
    }

    // Category similarity
    if (doc1.category && doc2.category) {
      const categorySimilarity = doc1.category === doc2.category ? 1 : 0;
      totalScore += categorySimilarity * weights.category;
      totalWeight += weights.category;
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * Calculate amount similarity
   * @param {number} amount1 - First amount
   * @param {number} amount2 - Second amount
   * @returns {number} - Similarity score (0-1)
   */
  calculateAmountSimilarity(amount1, amount2) {
    if (amount1 === amount2) return 1;
    
    const diff = Math.abs(amount1 - amount2);
    const avg = (amount1 + amount2) / 2;
    const relativeDiff = diff / avg;
    
    if (relativeDiff <= 0.01) return 0.95;
    if (relativeDiff <= 0.05) return 0.8;
    if (relativeDiff <= 0.20) return 0.6;
    
    return 0;
  }

  /**
   * Calculate text similarity using Jaccard similarity
   * @param {string} text1 - First text
   * @param {string} text2 - Second text
   * @returns {number} - Similarity score (0-1)
   */
  calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    if (text1 === text2) return 1;

    const normalize = (text) => text.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const normalized1 = normalize(text1);
    const normalized2 = normalize(text2);
    if (!normalized1 || !normalized2) return 0;

    const words1 = new Set(normalized1.split(/\s+/).filter(w => w.length > 0));
    const words2 = new Set(normalized2.split(/\s+/).filter(w => w.length > 0));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    const tokenSimilarity = union.size > 0 ? intersection.size / union.size : 0;
    const editDistance = this.calculateLevenshteinDistance(normalized1, normalized2);
    const charSimilarity = 1 - (editDistance / Math.max(normalized1.length, normalized2.length, 1));

    return Number(((charSimilarity * 0.7) + (tokenSimilarity * 0.3)).toFixed(3));
  }

  calculateLevenshteinDistance(leftText, rightText) {
    const leftLength = leftText.length;
    const rightLength = rightText.length;
    const matrix = Array.from({ length: leftLength + 1 }, () => new Array(rightLength + 1).fill(0));

    for (let row = 0; row <= leftLength; row += 1) {
      matrix[row][0] = row;
    }
    for (let col = 0; col <= rightLength; col += 1) {
      matrix[0][col] = col;
    }

    for (let row = 1; row <= leftLength; row += 1) {
      for (let col = 1; col <= rightLength; col += 1) {
        const substitutionCost = leftText[row - 1] === rightText[col - 1] ? 0 : 1;
        matrix[row][col] = Math.min(
          matrix[row - 1][col] + 1,
          matrix[row][col - 1] + 1,
          matrix[row - 1][col - 1] + substitutionCost
        );
      }
    }

    return matrix[leftLength][rightLength];
  }

  /**
   * Calculate carbon footprint for the document
   * @param {Object} extractedData - Extracted data
   * @returns {Object} - Carbon footprint data
   */
  async calculateCarbonFootprint(extractedData, itemFootprints = []) {
    try {
      const resolvedFootprints = itemFootprints.length > 0
        ? itemFootprints
        : (Array.isArray(extractedData.items)
          ? extractedData.items.filter(item => item?.carbonFootprint)
          : []);

      if (resolvedFootprints.length > 0) {
        const totals = resolvedFootprints.reduce((acc, item) => {
          const amount = Number(item.total) || 0;
          const co2 = Number(item.carbonFootprint?.co2Emissions) || 0;
          const factor = Number(item.carbonFootprint?.emissionFactor) || 0;
          acc.totalAmount += amount;
          acc.co2Emissions += co2;
          acc.weightedFactor += amount > 0 ? factor * amount : 0;
          const b = item.carbonFootprint?.emissionBreakdown;
          if (b && typeof b === 'object') {
            acc.scope1 += Number(b.scope1) || 0;
            acc.scope2 += Number(b.scope2) || 0;
            acc.scope3 += Number(b.scope3) || 0;
          }
          return acc;
        }, { totalAmount: 0, co2Emissions: 0, weightedFactor: 0, scope1: 0, scope2: 0, scope3: 0 });

        const emissionFactor = totals.totalAmount > 0
          ? totals.weightedFactor / totals.totalAmount
          : 0;

        return {
          co2Emissions: totals.co2Emissions,
          emissionFactor,
          calculationMethod: 'document_itemized',
          sustainabilityScore: 0,
          emissionBreakdown: {
            scope1: Math.round(totals.scope1 * 100) / 100,
            scope2: Math.round(totals.scope2 * 100) / 100,
            scope3: Math.round(totals.scope3 * 100) / 100
          }
        };
      }

      const carbonData = carbonCalculationService.calculateTransactionCarbonFootprint({
        amount: extractedData.amount,
        category: extractedData.category,
        subcategory: extractedData.subcategory,
        description: extractedData.description,
        vendor: extractedData.vendor
      });

      return {
        co2Emissions: carbonData.co2Emissions || 0,
        emissionFactor: carbonData.emissionFactor || 0,
        calculationMethod: carbonData.calculationMethod || 'document_summary',
        sustainabilityScore: carbonData.sustainabilityScore || 0,
        emissionBreakdown: carbonData.emissionBreakdown
      };
    } catch (error) {
      console.error('Carbon footprint calculation error:', error);
      return {
        co2Emissions: 0,
        emissionFactor: 0,
        calculationMethod: 'error',
        sustainabilityScore: 0
      };
    }
  }

  async fetchMsmeProfile(msmeId) {
    if (!msmeId) return null;
    try {
      const mongoose = require('mongoose');
      // Avoid long buffering delays when DB is unavailable (common in unit tests).
      if (mongoose.connection?.readyState !== 1) {
        return null;
      }
      const MSME = require('../models/MSME');
      return await MSME.findById(msmeId).lean();
    } catch (error) {
      console.warn('Failed to fetch MSME profile for document processing:', error.message);
      return null;
    }
  }

  buildCarbonFootprintFromAnalysis(analysis, extractedData = {}) {
    if (!analysis) return null;
    const totalAmount = Number(analysis.totalAmount) || Number(extractedData.amount) || 0;
    const emissionFactor = totalAmount > 0
      ? analysis.totalCO2Emissions / totalAmount
      : 0;
    return {
      co2Emissions: Number(analysis.totalCO2Emissions) || 0,
      emissionFactor: Math.round(emissionFactor * 10000) / 10000,
      calculationMethod: analysis.calculationMethod || 'document_analysis',
      sustainabilityScore: analysis.carbonScore || 0
    };
  }

  async calculateBillReceiptCarbonAnalysis(document, extractedData = {}, carbonExtraction = null, msmeProfileOverride = null) {
    try {
      if (!document || !['bill', 'receipt'].includes(document.documentType)) {
        return null;
      }
      const carbonData = carbonExtraction?.extractedData;
      if (!carbonData || (!carbonData.carbonRelevant && !this.hasCarbonSignals(carbonData))) {
        return null;
      }

      const msmeProfile = msmeProfileOverride || await this.fetchMsmeProfile(document.msmeId);
      if (!msmeProfile) {
        return null;
      }

      const calculation = await carbonCalculationService.calculateDocumentCarbonFootprint(
        carbonData,
        msmeProfile
      );
      const totalAmount = this.resolveAmountFromExtraction(extractedData, carbonData);

      const totalCO2Emissions = Number(calculation.totalCO2Emissions) || 0;
      let carbonScore = Number(calculation.carbonScore) || 0;
      if (carbonScore <= 0 && totalCO2Emissions > 0) {
        const canonical = carbonCalculationService.applyCanonicalCarbonScore(
          {
            ...calculation,
            totalCO2Emissions,
            totalAmount,
            totalSpend: totalAmount
          },
          msmeProfile
        );
        carbonScore = canonical.carbonScore;
      }

      return {
        totalCO2Emissions,
        totalAmount,
        transactionCount: totalAmount > 0 ? 1 : 0,
        categoryBreakdown: this.buildCategoryBreakdownFromAdvanced(calculation),
        breakdown: calculation.breakdown,
        esgScopes: calculation.scopeBreakdown,
        carbonScore,
        recommendations: calculation.recommendations || [],
        calculatedAt: new Date(),
        calculationMethod: 'document_bill_receipt_consumption'
      };
    } catch (error) {
      console.warn('Bill/receipt carbon analysis failed:', error.message);
      return null;
    }
  }

  buildCategoryBreakdownFromAdvanced(calculation = {}) {
    const breakdown = calculation.breakdown || {};
    return Object.entries(breakdown).reduce((acc, [category, data]) => {
      acc[category] = {
        count: null,
        amount: null,
        emissions: Number(data?.co2) || 0,
        emissionFactor: 0,
        percentage: Number(data?.percentage) || 0,
        subcategoryBreakdown: {}
      };
      return acc;
    }, {});
  }

  resolveAmountFromExtraction(extractedData = {}, carbonData = {}) {
    if (Number.isFinite(extractedData.amount) && extractedData.amount > 0) {
      return extractedData.amount;
    }
    const energyCost = Number(carbonData?.energy?.totalCost) || 0;
    return energyCost > 0 ? energyCost : 0;
  }

  buildDocumentTransactions(document, extractedData = {}, itemFootprints = [], msmeProfile = {}) {
    const mappingType = String(document?.metadata?.transactionMapping || 'company').toLowerCase() === 'product'
      ? 'product'
      : 'company';
    const selectedProducts = Array.isArray(document?.metadata?.selectedProducts)
      ? document.metadata.selectedProducts
      : [];
    const workflowMetadata = {
      documentId: document?._id?.toString?.() || null,
      sourceWorkflow: document?.metadata?.sourceWorkflow || null,
      linkedMessageId: document?.metadata?.linkedMessageId || null,
      linkedSourceId: document?.metadata?.linkedSourceId || null,
      linkedTransactionId: document?.metadata?.linkedTransactionId || null,
      transactionMapping: mappingType,
      selectedProducts
    };
    const baseTransaction = {
      msmeId: document.msmeId,
      source: 'manual',
      transactionType: this.mapDocumentToTransactionType(document.documentType),
      currency: extractedData.currency || 'INR',
      vendor: extractedData.vendor,
      date: extractedData.date || new Date(),
      description: extractedData.description || document.originalName || 'Document transaction',
      industry: msmeProfile?.industry,
      businessDomain: msmeProfile?.businessDomain,
      region: carbonCalculationService.resolveRegion(msmeProfile?.contact?.address?.state),
      location: {
        state: msmeProfile?.contact?.address?.state || 'unknown',
        country: msmeProfile?.contact?.address?.country || 'India'
      },
      sustainability: {
        isGreen: false,
        greenScore: 0
      },
      metadata: {
        originalText: extractedData.description || document.originalName || 'Document transaction',
        ragClassification: extractedData.ragClassification || null,
        extractedData: {
          source: 'document_upload',
          ...workflowMetadata
        },
        confidence: Number(document?.processingResults?.confidence) || 0.8
      }
    };

    const itemTransactions = Array.isArray(itemFootprints) ? itemFootprints : [];
    if (itemTransactions.length > 0) {
      return itemTransactions
        .map(item => {
          const amount = Number(item.total) || this.resolveItemAmount(item);
          const category = item.category || this.resolveItemCategory(item, extractedData);
          const subcategory = item.subcategory || this.resolveItemSubcategory(item, category, extractedData);
          if (!amount && !item.name) {
            return null;
          }
          return {
            ...baseTransaction,
            sourceId: `${document._id?.toString() || document.fileName}_${item.name || 'item'}`,
            amount,
            category,
            subcategory,
            description: item.name
              ? `${baseTransaction.description} - ${item.name}`
              : baseTransaction.description,
            carbonFootprint: item.carbonFootprint
          };
        })
        .filter(Boolean);
    }

    if (extractedData.amount && extractedData.amount > 0) {
      return [{
        ...baseTransaction,
        sourceId: document._id?.toString() || document.fileName,
        amount: extractedData.amount,
        category: extractedData.category || 'other',
        subcategory: extractedData.subcategory || 'general',
        carbonFootprint: document.carbonFootprint
      }];
    }

    return [];
  }

  async applyMultiParameterEmissionMapping(transactions = [], extractedData = {}, msmeProfile = {}) {
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return [];
    }

    let profileSignals = {};
    try {
      profileSignals = await processMachineryProfilerAgent.analyzeProfile({
        msmeData: msmeProfile || {},
        transactions,
        context: {
          region: carbonCalculationService.resolveRegion(msmeProfile?.contact?.address?.state)
        }
      });
    } catch (error) {
      // Keep mapping resilient when profile analysis cannot infer domain factors.
      profileSignals = {};
    }

    const processTokens = new Set((profileSignals?.processes || []).map(token => String(token).toLowerCase()));
    const machineryTokens = new Set((profileSignals?.machinery || []).map(token => String(token).toLowerCase()));
    const productTokens = new Set((profileSignals?.productSignals || []).map(token => String(token).toLowerCase()));

    const mapped = [];
    for (const transaction of transactions) {
      const vendorName = typeof transaction?.vendor === 'string'
        ? transaction.vendor
        : transaction?.vendor?.name;
      const combinedText = [
        transaction?.description || '',
        extractedData?.description || '',
        extractedData?.rawText || '',
        vendorName || ''
      ].join(' ').toLowerCase();

      const classified = await dataProcessorAgent.classifyTransaction(
        {
          ...transaction,
          vendor: vendorName ? { name: vendorName } : transaction.vendor
        },
        {
          msmeProfile,
          context: {
            businessDomain: msmeProfile?.businessDomain || 'other'
          }
        }
      );

      let category = classified?.category || transaction.category || extractedData.category || 'other';
      let subcategory = classified?.subcategory || transaction.subcategory || extractedData.subcategory || 'general';

      if (category === 'other' || category === 'unknown') {
        if (combinedText.match(/\b(diesel|petrol|cng|lpg|fuel|electricity|power|boiler)\b/)) {
          category = 'energy';
          if (subcategory === 'general') subcategory = 'fuel';
        } else if (combinedText.match(/\b(freight|logistics|transport|shipment|truck|fleet)\b/)) {
          category = 'transportation';
        } else if (combinedText.match(/\b(steel|aluminum|plastic|fabric|chemical|resin|polymer|raw material)\b/)) {
          category = 'raw_materials';
        }
      }

      if (subcategory === 'general') {
        const matchedProcess = [...processTokens].find(token => combinedText.includes(token.replace(/_/g, ' ')));
        const matchedMachinery = [...machineryTokens].find(token => combinedText.includes(token.replace(/_/g, ' ')));
        const matchedProduct = [...productTokens].find(token => combinedText.includes(token.replace(/_/g, ' ')));
        subcategory = matchedProcess || matchedMachinery || matchedProduct || subcategory;
      }

      mapped.push({
        ...transaction,
        category,
        subcategory,
        metadata: {
          ...(transaction.metadata || {}),
          mappingParameters: {
            profileSector: profileSignals?.sector || msmeProfile?.businessDomain || 'other',
            processSignals: profileSignals?.processes || [],
            machinerySignals: profileSignals?.machinery || [],
            productSignals: profileSignals?.productSignals || [],
            activitySignals: profileSignals?.activitySignals || {},
            classifierConfidence: Number(classified?.confidence) || 0,
            classificationNeedsReview: Boolean(classified?.processingMetadata?.needsReview)
          }
        }
      });
    }

    return mapped;
  }

  buildCategoryBreakdown(transactions = []) {
    return transactions.reduce((acc, transaction) => {
      const category = (transaction.category || 'other').toLowerCase();
      const subcategory = transaction.subcategory || 'general';
      const amount = Number(transaction.amount) || 0;
      const carbonFootprint = transaction.carbonFootprint ||
        carbonCalculationService.calculateTransactionCarbonFootprint(transaction);
      const emissions = Number(carbonFootprint.co2Emissions) || 0;

      if (!acc[category]) {
        acc[category] = {
          count: 0,
          amount: 0,
          emissions: 0,
          emissionFactor: 0,
          subcategoryBreakdown: {}
        };
      }

      acc[category].count += 1;
      acc[category].amount += amount;
      acc[category].emissions += emissions;
      acc[category].emissionFactor = acc[category].amount > 0
        ? acc[category].emissions / acc[category].amount
        : 0;
      acc[category].subcategoryBreakdown[subcategory] =
        (acc[category].subcategoryBreakdown[subcategory] || 0) + emissions;

      return acc;
    }, {});
  }

  async calculateDocumentCarbonAnalysis(document, extractedData = {}, itemFootprints = [], msmeProfileOverride = null) {
    try {
      const MSME = require('../models/MSME');
      const msmeProfile = msmeProfileOverride || await MSME.findById(document.msmeId).lean();
      if (!msmeProfile) {
        return null;
      }

      const transactions = this.buildDocumentTransactions(
        document,
        extractedData,
        itemFootprints,
        msmeProfile
      );
      if (transactions.length === 0) {
        return null;
      }
      const mappedTransactions = await this.applyMultiParameterEmissionMapping(
        transactions,
        extractedData,
        msmeProfile
      );

      const assessment = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
        msmeProfile,
        mappedTransactions
      );
      const totalAmount = mappedTransactions.reduce((sum, txn) => sum + (Number(txn.amount) || 0), 0);
      const lineItemBreakup = this.summarizeLineItemBreakup(itemFootprints, extractedData);

      return {
        totalCO2Emissions: assessment.totalCO2Emissions,
        totalAmount,
        transactionCount: mappedTransactions.length,
        categoryBreakdown: this.buildCategoryBreakdown(mappedTransactions),
        breakdown: assessment.breakdown,
        esgScopes: assessment.esgScopes,
        carbonScore: assessment.carbonScore,
        recommendations: assessment.recommendations,
        lineItemBreakup: lineItemBreakup.lineItems,
        ghgProtocol: {
          standard: 'GHG Protocol Corporate Standard',
          scopes: lineItemBreakup.scopeTotals,
          categoryTotals: lineItemBreakup.categoryTotals,
          method: 'document_line_item_bottom_up'
        },
        calculatedAt: new Date(),
        calculationMethod: 'document_transactions'
      };
    } catch (error) {
      console.error('Document carbon analysis error:', error);
      return null;
    }
  }

  /**
   * Calculate confidence score for extracted data
   * @param {Object} extractedData - Extracted data
   * @returns {number} - Confidence score (0-1)
   */
  calculateConfidence(extractedData, accuracyReport = null) {
    let score = 0;
    let totalFields = 0;

    const fields = ['amount', 'date', 'vendor', 'description', 'category'];
    
    const hasFieldValue = value => {
      if (value === null || value === undefined) return false;
      if (value instanceof Date) return !Number.isNaN(value.getTime());
      if (typeof value === 'string') return value.trim().length > 0;
      if (typeof value === 'object') return Object.keys(value).length > 0;
      return true;
    };

    fields.forEach(field => {
      totalFields++;
      if (hasFieldValue(extractedData[field])) {
        score += 1;
      }
    });

    const baseScore = totalFields > 0 ? score / totalFields : 0;
    const ocrAgreement = Number(accuracyReport?.overall);
    if (!Number.isFinite(ocrAgreement)) {
      return baseScore;
    }
    return Number(((baseScore * 0.7) + (ocrAgreement * 0.3)).toFixed(3));
  }

  buildDocumentUserClarifications({ extractedData = {}, document = {}, processingResult = {}, reconciliation = {} }) {
    const items = [];
    const docId = document?._id?.toString?.() || null;
    const confidence = this.calculateConfidence(extractedData, reconciliation?.accuracyReport);
    const ocrOverall = Number(reconciliation?.accuracyReport?.overall);

    if (confidence < MIN_OCR_ACCURACY_FOR_CARBON_ANALYSIS) {
      items.push({
        id: 'document_field_confidence',
        scope: 'document_extraction',
        severity: 'important',
        agentStep: 'document_analyzer',
        prompt:
          'Key fields (amount, date, vendor, or description) are incomplete or low-confidence. Please verify them against the original file before relying on carbon results.',
        detail: `Blended extraction confidence is about ${(confidence * 100).toFixed(0)}%.`,
        context: { documentId: docId, confidence }
      });
    }

    if (Number.isFinite(ocrOverall) && ocrOverall < MIN_OCR_ACCURACY_FOR_CARBON_ANALYSIS) {
      items.push({
        id: 'document_ocr_agreement',
        scope: 'document_extraction',
        severity: 'recommended',
        agentStep: 'document_analyzer',
        prompt:
          'Text from OCR and the analyzer disagree in places. If any line items, tax splits, or dates look wrong, correct them manually.',
        detail: `OCR agreement score is about ${(ocrOverall * 100).toFixed(0)}%.`,
        context: { documentId: docId, ocrOverall }
      });
    }

    const warns = Array.isArray(processingResult.warnings) ? processingResult.warnings : [];
    if (warns.some(w => /date could not/i.test(String(w)))) {
      items.push({
        id: 'document_invoice_date',
        scope: 'document_extraction',
        severity: 'important',
        agentStep: 'document_analyzer',
        prompt:
          'The invoice date is ambiguous or missing. Please confirm the correct document date (watch for DD/MM vs MM/DD).',
        context: { documentId: docId }
      });
    }

    const vendorName = extractedData?.vendor?.name || extractedData?.vendor;
    if (
      !vendorName ||
      String(vendorName).toLowerCase() === 'unknown vendor' ||
      INVALID_VENDOR_NAMES.has(String(vendorName).toLowerCase())
    ) {
      items.push({
        id: 'document_vendor',
        scope: 'document_extraction',
        severity: 'recommended',
        agentStep: 'document_analyzer',
        prompt: 'The supplier or vendor name could not be confirmed. Who should this invoice be attributed to?',
        context: { documentId: docId }
      });
    }

    if ((extractedData?.category || '').toLowerCase() === 'other') {
      items.push({
        id: 'document_category',
        scope: 'document_extraction',
        severity: 'recommended',
        agentStep: 'document_analyzer',
        prompt:
          'Spend category defaulted to “other”. What does this bill mainly represent (e.g. fuel, grid power, freight, raw material)?',
        context: { documentId: docId }
      });
    }

    return items;
  }

  mapDocumentToTransactionType(documentType) {
    switch (documentType) {
      case 'invoice':
      case 'bill':
        return 'expense';
      case 'receipt':
        return 'purchase';
      case 'statement':
        return 'other';
      default:
        return 'other';
    }
  }

  async updateMsmeCarbonAssessment(msmeId, referenceDate = new Date()) {
    try {
      const MSME = require('../models/MSME');
      const CarbonAssessment = require('../models/CarbonAssessment');
      const Transaction = this.getTransactionModel();

      const msmeProfile = await MSME.findById(msmeId);
      if (!msmeProfile) {
        return null;
      }

      const periodEnd = referenceDate ? new Date(referenceDate) : new Date();
      const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

      const windowTransactions = await Transaction.find({
        msmeId,
        date: { $gte: periodStart, $lte: periodEnd },
        isSpam: { $ne: true },
        isDuplicate: { $ne: true }
      }).lean();

      const assessmentData = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
        msmeProfile,
        windowTransactions
      );
      const normalizedBreakdown = assessmentData.breakdown || {};
      const periodWiseSummary = this.buildPeriodWiseSummary(windowTransactions);

      const existingAssessment = await CarbonAssessment.findOne({
        msmeId,
        'period.startDate': { $lte: periodEnd },
        'period.endDate': { $gte: periodStart }
      }).sort({ createdAt: -1 });

      if (existingAssessment) {
        existingAssessment.totalCO2Emissions = assessmentData.totalCO2Emissions;
        

existingAssessment.breakdown = normalizedBreakdown;
// 🔥 FIX END
        existingAssessment.esgScopes = assessmentData.esgScopes;
        existingAssessment.carbonScore = assessmentData.carbonScore;
        existingAssessment.recommendations = assessmentData.recommendations;
        existingAssessment.documentBulkSummary = periodWiseSummary;
        existingAssessment.status = 'completed';
        existingAssessment.period = {
          startDate: periodStart,
          endDate: periodEnd
        };
        await existingAssessment.save();
        console.log("✅ CarbonAssessment updated");
      } else {
        const newAssessment = new CarbonAssessment({
          msmeId,
          assessmentType: 'automatic',
          period: {
            startDate: periodStart,
            endDate: periodEnd
          },
          totalCO2Emissions: assessmentData.totalCO2Emissions,
          breakdown: normalizedBreakdown,
          esgScopes: assessmentData.esgScopes,
          carbonScore: assessmentData.carbonScore,
          recommendations: assessmentData.recommendations,
          documentBulkSummary: periodWiseSummary,
          status: 'completed'
        });
        await newAssessment.save();
        console.log("✅ CarbonAssessment created");
      }

      msmeProfile.carbonScore = assessmentData.carbonScore;
      msmeProfile.lastCarbonAssessment = new Date();
      await msmeProfile.save();

      return assessmentData;
    } catch (error) {
      console.error('Failed to update MSME carbon assessment:', error);
      return null;
    }
  }

  /**
   * Create transaction record from processed document
   * @param {Object} document - Processed document
   * @returns {Object} - Created/skipped transaction summary
   */
  async createTransactionsFromDocument(document, itemFootprints = []) {
  try {
    const Transaction = this.getTransactionModel();
    const msmeProfile = await this.fetchMsmeProfile(document.msmeId) || {
      businessDomain: 'other',
      industry: 'General',
      contact: { address: { state: 'unknown', country: 'India' } }
    };

    const aiData = {
      ...(document.extractedData?.raw || {}),
      ...(document.extractedData || {})
    };
    this.applyVerifiedRagToExtractedData(aiData, {
      text: aiData.rawText || aiData.description || aiData.product || '',
      businessDomain: document?.metadata?.businessDomain || 'other',
      candidateLocation: aiData?.vendor?.location || ''
    });

    let finalVendor = "Unknown Vendor";
    if (aiData.bert_entities && aiData.bert_entities.length > 0) {
      finalVendor = aiData.bert_entities[0].word;
    } else {
      const vName = typeof aiData.vendor === 'string' ? aiData.vendor : aiData.vendor?.name;
      const invalidNames = ["no", "amount", "total", "invoice", "item"];
      
      if (vName && !invalidNames.includes(vName.toLowerCase())) {
        finalVendor = vName;
      }
    }

    const builtTransactions = this.buildDocumentTransactions(
      document,
      {
        ...aiData,
        vendor: { name: finalVendor }
      },
      itemFootprints,
      msmeProfile
    );
    const mappedTransactions = await this.applyMultiParameterEmissionMapping(
      builtTransactions,
      aiData,
      msmeProfile
    );

    const createdTransactions = [];
    const skippedDuplicates = [];
    const tryCreateTransaction = async (payload) => {
      const duplicate = await duplicateDetectionService.detectDuplicate(
        payload,
        document.msmeId,
        { includeCrossChannel: true }
      );

      if (duplicate?.isDuplicate) {
        skippedDuplicates.push({
          sourceId: payload.sourceId,
          duplicateType: duplicate.duplicateType,
          matchedTransactionId: duplicate.matchedTransaction?._id || null
        });
        return null;
      }

      const mappingParams = payload?.metadata?.mappingParameters || {};
      const agentInferenceContext = {
        productSignals: mappingParams.productSignals || [],
        processes: mappingParams.processSignals || [],
        machinery: mappingParams.machinerySignals || []
      };

      const inferredProducts = inferManufacturedProductsFromAgentContext(
        payload,
        msmeProfile,
        agentInferenceContext
      );

      const workflowMetadataPerTxn = {
        documentId: document?._id?.toString?.() || null,
        sourceWorkflow: document?.metadata?.sourceWorkflow || null,
        linkedMessageId: document?.metadata?.linkedMessageId || null,
        linkedSourceId: document?.metadata?.linkedSourceId || null,
        linkedTransactionId: document?.metadata?.linkedTransactionId || null,
        transactionMapping: 'product',
        selectedProducts: inferredProducts,
        productAttributionSource: 'ai_agent_inference'
      };

      const enrichedForAssignment = inferredProducts.length > 0
        ? {
            ...payload,
            classificationContext: {
              ...(payload.classificationContext || {}),
              matchedProducts: inferredProducts,
              productSignals: agentInferenceContext.productSignals,
              source: 'document_ai_product_mapper'
            }
          }
        : { ...payload };

      const attributedPayload = assignProductsToTransaction(
        enrichedForAssignment,
        msmeProfile,
        {
          assignmentSource: inferredProducts.length > 0
            ? 'ai_agent_inference'
            : 'document_data_stage'
        }
      );

      const txn = new Transaction({
        ...attributedPayload,
        ownership: 'product',
        isProcessed: true,
        processedAt: new Date(),
        metadata: {
          ...(attributedPayload.metadata || {}),
          extractedData: {
            ...(attributedPayload.metadata?.extractedData || {}),
            ...workflowMetadataPerTxn
          }
        }
      });
      await txn.save();
      createdTransactions.push(txn);
      return txn;
    };

    for (const payload of mappedTransactions) {
      await tryCreateTransaction(payload);
    }

    return { createdTransactions, skippedDuplicates };

  } catch (error) {
    console.error("Error creating transaction from document:", error);
    throw error;
  }
}

  /**
   * Get document statistics for an MSME
   * @param {string} msmeId - MSME ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Object} - Document statistics
   */
  async getDocumentStatistics(scopeOrMsmeId, startDate, endDate) {
    const Document = require('../models/Document');

    const query =
      typeof scopeOrMsmeId === 'object' &&
      (scopeOrMsmeId.$or || scopeOrMsmeId.organizationId)
        ? { ...scopeOrMsmeId }
        : { msmeId: scopeOrMsmeId };
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const documents = await Document.find(query);
    
    const statistics = {
      totalDocuments: documents.length,
      documentsByType: {},
      documentsByStatus: {},
      totalAmount: 0,
      totalCarbonFootprint: 0,
      duplicateCount: 0,
      averageProcessingTime: 0,
      documentsByMonth: {}
    };

    let totalProcessingTime = 0;
    let processedCount = 0;

    documents.forEach(doc => {
      // By type
      statistics.documentsByType[doc.documentType] = (statistics.documentsByType[doc.documentType] || 0) + 1;
      
      // By status
      statistics.documentsByStatus[doc.status] = (statistics.documentsByStatus[doc.status] || 0) + 1;
      
      // Amount
      if (doc.extractedData && doc.extractedData.amount) {
        statistics.totalAmount += doc.extractedData.amount;
      }
      
      // Carbon footprint
      if (doc.carbonFootprint && doc.carbonFootprint.co2Emissions) {
        statistics.totalCarbonFootprint += doc.carbonFootprint.co2Emissions;
      }
      
      // Duplicates
      if (doc.duplicateDetection && doc.duplicateDetection.isDuplicate) {
        statistics.duplicateCount++;
      }
      
      // Processing time
      if (doc.processingResults && doc.processingResults.processingTime) {
        totalProcessingTime += doc.processingResults.processingTime;
        processedCount++;
      }
      
      // By month
      const month = doc.createdAt.toISOString().substring(0, 7);
      statistics.documentsByMonth[month] = (statistics.documentsByMonth[month] || 0) + 1;
    });

    statistics.averageProcessingTime = processedCount > 0 ? totalProcessingTime / processedCount : 0;

    return statistics;
  }
}

const documentProcessingService = new DocumentProcessingService();
documentProcessingService.parseTesseractOemPsmFromCli = parseTesseractOemPsmFromCli;
documentProcessingService.extractAIAnalyzeErrorDetail = extractAIAnalyzeErrorDetail;
documentProcessingService.isOcrQualityRejectionMessage = isOcrQualityRejectionMessage;
documentProcessingService.classifyOcrQualityRejection = classifyOcrQualityRejection;
documentProcessingService.buildOcrQualityRejectionValidation = buildOcrQualityRejectionValidation;
module.exports = documentProcessingService;
