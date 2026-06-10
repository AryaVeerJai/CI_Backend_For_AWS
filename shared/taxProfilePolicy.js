/**
 * GSTIN tax profile policy — profile-aware required/optional GSTIN and precision-first emit rules.
 *
 * Utility, receipt, ticket, and banking documents do not require GSTIN;
 * tax/GST/B2B invoices do. Invalid or low-confidence GSTIN is never emitted.
 */

const gstinRecovery = require('./gstinRecovery');

const TAX_CLASSIFICATION_TAX_INVOICE = 'tax_invoice';
const TAX_CLASSIFICATION_GST_INVOICE = 'gst_invoice';
const TAX_CLASSIFICATION_B2B_INVOICE = 'b2b_invoice';
const TAX_CLASSIFICATION_UTILITY_BILL = 'utility_bill';
const TAX_CLASSIFICATION_RECEIPT = 'receipt';
const TAX_CLASSIFICATION_TICKET = 'ticket';
const TAX_CLASSIFICATION_BANKING_DOCUMENT = 'banking_document';
const TAX_CLASSIFICATION_UNKNOWN = 'unknown';

const GSTIN_OPTIONAL_INVOICE_PROFILES = new Set(['utility', 'utility_solar', 'banking']);

const GSTIN_REQUIRED_INVOICE_PROFILES = new Set([
  'retail',
  'office',
  'transport',
  'food',
  'cloud',
  'medical'
]);

const GSTIN_OPTIONAL_DOCUMENT_TYPES = new Set([
  'payment_receipt',
  'receipt',
  'travel_ticket',
  'ticket',
  'banking_statement',
  'bank_statement',
  'utility_bill',
  'passbook'
]);

const GSTIN_REQUIRED_DOCUMENT_TYPES = new Set([
  'tax_invoice',
  'gst_invoice',
  'invoice',
  'b2b_invoice'
]);

const OPTIONAL_DOCUMENT_PROFILE_PREFIXES = [
  'utilities.',
  'banking.',
  'transport.ticket',
  'hospitality.receipt'
];

const REQUIRED_DOCUMENT_PROFILE_PREFIXES = [
  'retail.',
  'office_operations.',
  'industrial.',
  'healthcare.pharmacy'
];

const GST_INVOICE_TEXT_RE = /\b(?:tax\s+invoice|gst\s*(?:tax\s*)?invoice|gstin)\b/i;
const UTILITY_TEXT_RE = /\b(?:electricity\s+bill|energy\s+charges|consumer\s+no|meter\s+reading|net[\s-]?metering|discom|bescom|utility\s+bill)\b/i;
const BANKING_TEXT_RE = /\b(?:account\s+statement|bank\s+statement|ifsc\b|neft\b|imps\b|upi\s+ref)\b/i;
const RECEIPT_TEXT_RE = /\b(?:payment\s+receipt|fee\s+receipt|cash\s+receipt|acknowledgement)\b/i;
const TICKET_TEXT_RE = /\b(?:boarding\s+pass|pnr\b|flight\s+ticket|train\s+ticket|travel\s+ticket)\b/i;

const PAN_LIKE_ON_GSTIN_SLOT_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

const DEFAULT_GSTIN_CONFIDENCE_MIN = 0.55;
const SCORE_TO_CONFIDENCE_DIVISOR = 20.0;

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

function documentProfileStr(data) {
  return norm(data.document_profile || data.profile_id);
}

function invoiceProfileStr(data) {
  return norm(data.invoice_profile);
}

function documentTypeStr(data) {
  return norm(data.document_type || data.doc_type);
}

function classificationFromInvoiceProfile(invoiceProfile) {
  if (GSTIN_OPTIONAL_INVOICE_PROFILES.has(invoiceProfile)) {
    if (invoiceProfile === 'banking') {
      return TAX_CLASSIFICATION_BANKING_DOCUMENT;
    }
    return TAX_CLASSIFICATION_UTILITY_BILL;
  }
  if (GSTIN_REQUIRED_INVOICE_PROFILES.has(invoiceProfile)) {
    if (invoiceProfile === 'office') {
      return TAX_CLASSIFICATION_B2B_INVOICE;
    }
    return TAX_CLASSIFICATION_GST_INVOICE;
  }
  return TAX_CLASSIFICATION_UNKNOWN;
}

function gstinRequiredFromDocumentType(documentType) {
  if (!documentType) {
    return null;
  }
  if (GSTIN_OPTIONAL_DOCUMENT_TYPES.has(documentType)) {
    return false;
  }
  if (GSTIN_REQUIRED_DOCUMENT_TYPES.has(documentType)) {
    return true;
  }
  if (documentType.includes('receipt') || documentType.includes('ticket')) {
    return false;
  }
  if (documentType.includes('invoice') && !documentType.includes('utility')) {
    return true;
  }
  return null;
}

function gstinRequiredFromDocumentProfile(documentProfile) {
  if (!documentProfile || documentProfile === 'unknown' || documentProfile === '') {
    return null;
  }
  for (const prefix of OPTIONAL_DOCUMENT_PROFILE_PREFIXES) {
    if (documentProfile.startsWith(prefix)) {
      return false;
    }
  }
  for (const prefix of REQUIRED_DOCUMENT_PROFILE_PREFIXES) {
    if (documentProfile.startsWith(prefix)) {
      return true;
    }
  }
  if (documentProfile.includes('utility') || documentProfile.includes('banking')) {
    return false;
  }
  return null;
}

function textHintClassification(text) {
  const lowered = String(text || '').toLowerCase();
  if (UTILITY_TEXT_RE.test(lowered)) {
    return TAX_CLASSIFICATION_UTILITY_BILL;
  }
  if (BANKING_TEXT_RE.test(lowered)) {
    return TAX_CLASSIFICATION_BANKING_DOCUMENT;
  }
  if (TICKET_TEXT_RE.test(lowered)) {
    return TAX_CLASSIFICATION_TICKET;
  }
  if (RECEIPT_TEXT_RE.test(lowered)) {
    return TAX_CLASSIFICATION_RECEIPT;
  }
  if (GST_INVOICE_TEXT_RE.test(lowered)) {
    return TAX_CLASSIFICATION_TAX_INVOICE;
  }
  return null;
}

function resolveTaxProfilePolicy(data = {}, { text = null } = {}) {
  const invoiceProfile = invoiceProfileStr(data);
  const documentType = documentTypeStr(data);
  const documentProfile = documentProfileStr(data);

  let gstinRequired = gstinRequiredFromDocumentType(documentType);
  let taxClassification = TAX_CLASSIFICATION_UNKNOWN;

  if (GSTIN_OPTIONAL_DOCUMENT_TYPES.has(documentType)) {
    if (documentType.includes('ticket')) {
      taxClassification = TAX_CLASSIFICATION_TICKET;
    } else if (documentType.includes('receipt')) {
      taxClassification = TAX_CLASSIFICATION_RECEIPT;
    } else if (documentType.includes('bank')) {
      taxClassification = TAX_CLASSIFICATION_BANKING_DOCUMENT;
    } else {
      taxClassification = TAX_CLASSIFICATION_RECEIPT;
    }
  }

  if (gstinRequired === null) {
    const profileReq = gstinRequiredFromDocumentProfile(documentProfile);
    if (profileReq !== null) {
      gstinRequired = profileReq;
    }
  }

  if (gstinRequired === null && invoiceProfile) {
    taxClassification = classificationFromInvoiceProfile(invoiceProfile);
    gstinRequired = !GSTIN_OPTIONAL_INVOICE_PROFILES.has(invoiceProfile);
    if (GSTIN_REQUIRED_INVOICE_PROFILES.has(invoiceProfile)) {
      if (invoiceProfile === 'office') {
        taxClassification = TAX_CLASSIFICATION_B2B_INVOICE;
      } else {
        taxClassification = TAX_CLASSIFICATION_GST_INVOICE;
      }
    }
  }

  const textHint = textHintClassification(text || '');
  if (textHint) {
    if (taxClassification === TAX_CLASSIFICATION_UNKNOWN) {
      taxClassification = textHint;
    }
    if ([
      TAX_CLASSIFICATION_UTILITY_BILL,
      TAX_CLASSIFICATION_BANKING_DOCUMENT,
      TAX_CLASSIFICATION_TICKET,
      TAX_CLASSIFICATION_RECEIPT
    ].includes(textHint)) {
      gstinRequired = false;
    } else if (textHint === TAX_CLASSIFICATION_TAX_INVOICE && gstinRequired !== false) {
      gstinRequired = true;
      taxClassification = TAX_CLASSIFICATION_TAX_INVOICE;
    }
  }

  if (gstinRequired === null) {
    gstinRequired = true;
    if (taxClassification === TAX_CLASSIFICATION_UNKNOWN) {
      taxClassification = TAX_CLASSIFICATION_GST_INVOICE;
    }
  }

  if (documentType === 'tax_invoice') {
    taxClassification = TAX_CLASSIFICATION_TAX_INVOICE;
    gstinRequired = true;
  }

  return {
    version: '1.0',
    tax_classification: taxClassification,
    gstin_required: Boolean(gstinRequired),
    invoice_profile: invoiceProfile || null,
    document_type: documentType || null,
    document_profile: documentProfile || null,
    gstin_confidence_min: DEFAULT_GSTIN_CONFIDENCE_MIN
  };
}

function gstinRequiredForData(data) {
  const policy = (data || {}).tax_profile_policy;
  if (policy && typeof policy === 'object' && 'gstin_required' in policy) {
    return Boolean(policy.gstin_required);
  }
  return Boolean(resolveTaxProfilePolicy(data || {}).gstin_required);
}

function scoreToConfidence(score) {
  return Math.round(Math.min(0.98, 0.35 + Number(score) / SCORE_TO_CONFIDENCE_DIVISOR) * 10000) / 10000;
}

function validateGst(raw) {
  if (!raw) {
    return null;
  }
  const token = String(raw).toUpperCase().replace(/\s+/g, '');
  if (gstinRecovery.isValidGstin(token)) {
    return token;
  }
  const repaired = gstinRecovery.normalizeGstinToken(token);
  return repaired && gstinRecovery.isValidGstin(repaired) ? repaired : null;
}

function collectGstinCandidates(text, vendorGstin) {
  const collected = new Map();

  function add(raw, confidence, source) {
    const validated = validateGst(raw);
    if (!validated) {
      return;
    }
    if (PAN_LIKE_ON_GSTIN_SLOT_RE.test(validated)) {
      return;
    }
    const prev = collected.get(validated);
    if (!prev || confidence > prev.confidence) {
      collected.set(validated, { confidence, source });
    }
  }

  if (vendorGstin) {
    add(vendorGstin, 0.88, 'vendor_details');
  }

  if (text && String(text).trim()) {
    const extracted = gstinRecovery.extractGstinFromText(text);
    if (extracted?.gstin) {
      add(extracted.gstin, 0.82, 'label_extraction');
    }
    if (extracted?.buyer_gstin) {
      add(extracted.buyer_gstin, 0.75, 'label_extraction');
    }

    const strictMatches = gstinRecovery.extractStrictGstins(text);
    strictMatches.forEach((match, index) => {
      add(match, 0.72 - index * 0.02, 'regex_fallback');
    });
  }

  return [...collected.entries()]
    .map(([gstin, { confidence, source }]) => [gstin, confidence, source])
    .sort((a, b) => b[1] - a[1]);
}

function resolveGstinWithPolicy(data, { text = null, confidenceMin = null } = {}) {
  const threshold = confidenceMin !== null && confidenceMin !== undefined
    ? Number(confidenceMin)
    : Number((data.tax_profile_policy || {}).gstin_confidence_min || DEFAULT_GSTIN_CONFIDENCE_MIN);

  let vendorGstin = null;
  const vendorDetails = data.vendor_details;
  if (vendorDetails && typeof vendorDetails === 'object') {
    vendorGstin = vendorDetails.gstin;
  }

  const candidates = collectGstinCandidates(text, vendorGstin);
  let seller = null;
  let sellerConf = null;
  let sellerSource = null;
  let buyer = null;

  if (candidates.length > 0) {
    [seller, sellerConf, sellerSource] = candidates[0];
    if (sellerConf !== null && sellerConf < threshold) {
      seller = null;
      sellerConf = null;
      sellerSource = null;
    }
    if (candidates.length > 1 && seller) {
      const [second, secondConf] = candidates[1];
      if (second !== seller && secondConf !== null && secondConf >= threshold) {
        buyer = second;
      }
    }
  }

  return [seller, sellerConf, sellerSource, buyer];
}

function attachGstinTaxPolicyMetadata(data, { text = null } = {}) {
  const policy = resolveTaxProfilePolicy(data, { text });
  data.tax_profile_policy = policy;
  data.tax_classification = policy.tax_classification;
  data.gstin_required = policy.gstin_required;
  return policy;
}

function applyGstinTaxPolicy(data, { text = null, confidenceMin = null } = {}) {
  const policy = attachGstinTaxPolicyMetadata(data, { text });
  const gstinRequired = Boolean(policy.gstin_required);

  const [seller, conf, source, buyer] = resolveGstinWithPolicy(data, { text, confidenceMin });

  data.gstin = seller;
  data.seller_gstin = seller;
  data.buyer_gstin = buyer;
  data.gstin_confidence = seller ? conf : null;
  data.gstin_source = seller ? source : null;
  data.gstin_extraction_status = seller
    ? 'present'
    : (gstinRequired ? 'missing' : 'expected_missing');

  if (data.vendor_details && typeof data.vendor_details === 'object') {
    data.vendor_details.gstin = seller;
  }

  const gstBlock = data.gst;
  if (gstBlock && typeof gstBlock === 'object') {
    gstBlock.seller_gstin = seller;
    gstBlock.buyer_gstin = buyer;
  } else if (seller || buyer) {
    data.gst = { seller_gstin: seller, buyer_gstin: buyer, total: 0 };
  }

  return data;
}

function shouldSuppressMissingGstinWarning(data) {
  return !gstinRequiredForData(data);
}

function validateGstinForReport(data, report, { text = null } = {}) {
  const policy = data.tax_profile_policy || resolveTaxProfilePolicy(data, { text });
  data.tax_profile_policy = policy;
  const gstinRequired = Boolean(policy.gstin_required);

  const rawGstin = data.gstin || data.seller_gstin;
  const validGst = validateGst(rawGstin);

  if (rawGstin && !validGst) {
    data.gstin = null;
    data.seller_gstin = null;
    if (gstinRequired) {
      report.errors.push('Invalid GSTIN');
      report.is_valid = false;
    }
    return;
  }

  if (validGst) {
    data.gstin = validGst;
    data.seller_gstin = validGst;
    return;
  }

  data.gstin = null;
  data.seller_gstin = null;
  if (gstinRequired) {
    if (Array.isArray(report.warnings)) {
      report.warnings.push('GSTIN not detected');
    }
  }
}

module.exports = {
  TAX_CLASSIFICATION_TAX_INVOICE,
  TAX_CLASSIFICATION_GST_INVOICE,
  TAX_CLASSIFICATION_B2B_INVOICE,
  TAX_CLASSIFICATION_UTILITY_BILL,
  TAX_CLASSIFICATION_RECEIPT,
  TAX_CLASSIFICATION_TICKET,
  TAX_CLASSIFICATION_BANKING_DOCUMENT,
  TAX_CLASSIFICATION_UNKNOWN,
  resolveTaxProfilePolicy,
  gstinRequiredForData,
  attachGstinTaxPolicyMetadata,
  applyGstinTaxPolicy,
  resolveGstinWithPolicy,
  shouldSuppressMissingGstinWarning,
  validateGstinForReport
};
