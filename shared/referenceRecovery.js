/**
 * RC-5F — label-aware invoice / reference number recovery with OCR normalization.
 */

const REFERENCE_REJECT_TOKENS = new Set(['no', 'id', 'number', 'num', 'na', 'n/a']);

const REFERENCE_LABEL_PATTERNS = [
  /^(?:invoice|inv)\s*(?:no\.?|number|#|id)?\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,28})\b/i,
  /^(?:bill)\s*(?:no\.?|number|#|id)?\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,28})\b/i,
  /^(?:ref(?:erence)?)\s*(?:no\.?|number|#|id)?\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,28})\b/i,
  /^(?:document)\s*(?:no\.?|number|#|id)?\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,28})\b/i,
  /\b(?:invoice|inv)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,28})\b/i,
  /\b(?:bill)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,28})\b/i,
  /\b(?:ref(?:erence)?)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,28})\b/i,
  /\b(?:document)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,28})\b/i,
  /\b(INV[\-/][A-Z0-9\-]{2,24})\b/i
];

function applyReferenceLabelTextCorrections(text = '') {
  return String(text)
    .replace(/\blnvoice\b/gi, 'invoice')
    .replace(/\binv0ice\b/gi, 'invoice')
    .replace(/\bblll\b/gi, 'bill')
    .replace(/\brefrence\b/gi, 'reference')
    .replace(/\bdocurnent\b/gi, 'document')
    .replace(/\bn0\./gi, 'no.')
    .replace(/\bnurnber\b/gi, 'number');
}

function normalizeReferenceCandidate(candidate) {
  if (!candidate) {
    return null;
  }
  let value = String(candidate).trim();
  value = value.replace(/^#+\s*/, '');
  value = value.replace(/\s+/g, ' ');
  if (/^inv[\-\s]/i.test(value)) {
    value = value.replace(/\s+/g, '').toUpperCase();
  } else {
    value = value.replace(/\s+/g, ' ').trim();
  }
  return value || null;
}

function isValidReferenceNumber(candidate) {
  const normalized = normalizeReferenceCandidate(candidate);
  if (!normalized) {
    return false;
  }
  const lowered = normalized.toLowerCase();
  if (REFERENCE_REJECT_TOKENS.has(lowered)) {
    return false;
  }
  if (normalized.length < 3 || normalized.length > 32) {
    return false;
  }
  if (!/[A-Za-z0-9]/.test(normalized)) {
    return false;
  }
  if (/^(invoice|receipt|bill|reference|document|txn|transaction)$/i.test(normalized)) {
    return false;
  }
  return true;
}

function extractHashInvoiceReference(text) {
  const hashInv = text.match(/#\s*(INV[\-\s]?[A-Z0-9\-]{2,24})/i);
  if (hashInv?.[1]) {
    const candidate = hashInv[1].replace(/\s+/g, '').toUpperCase();
    return isValidReferenceNumber(candidate) ? candidate : null;
  }
  return null;
}

function extractLabelReferenceFromText(text = '') {
  const corrected = applyReferenceLabelTextCorrections(text);
  const lines = corrected.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    for (const pattern of REFERENCE_LABEL_PATTERNS) {
      const match = line.match(pattern);
      const raw = match?.[1]?.trim();
      const candidate = normalizeReferenceCandidate(raw);
      if (isValidReferenceNumber(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Label-aware reference extraction (RC-5F reference_recovery path).
 * @returns {string|null}
 */
function extractReferenceFromText(text = '') {
  if (!text || !String(text).trim()) {
    return null;
  }

  const corrected = applyReferenceLabelTextCorrections(text);
  const hashRef = extractHashInvoiceReference(corrected);
  if (hashRef) {
    return hashRef;
  }

  const labelRef = extractLabelReferenceFromText(corrected);
  if (labelRef) {
    return labelRef;
  }

  return null;
}

module.exports = {
  REFERENCE_LABEL_PATTERNS,
  applyReferenceLabelTextCorrections,
  normalizeReferenceCandidate,
  isValidReferenceNumber,
  extractReferenceFromText
};
