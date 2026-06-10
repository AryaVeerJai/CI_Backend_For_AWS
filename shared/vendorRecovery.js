/**
 * RC-5F — vendor recovery from OCR text (header-first, metadata rejection).
 */

const HEADER_LINE_LIMIT = 30;

const LABELED_VENDOR_REGEX = /(?:vendor|supplier|billed\s*by|sold\s*by|from|issuer|seller)\s*[:\-]\s*(.+)/i;

const METADATA_LINE_REGEX = /(?:invoice\s*(?:no|number|#)|bill\s*(?:no|number)|ref(?:erence)?\s*(?:no|number)|document\s*(?:no|number)|gstin|gst\s*(?:no|number)|total\s*amount|grand\s*total|sub\s*total|taxable|amount\s*due|due\s*date|invoice\s*date|bill\s*date|pin\s*code|pincode|phone|mobile|email|www\.|http)/i;

const COMPANY_SUFFIX_REGEX = /\b(LLC|LLP|LTD\.?|PRIVATE\s+LIMITED|LIMITED|INDUSTRIES|ENTERPRISE|PVT\.?\s*LTD\.?)\b/i;

const ADDRESS_HINT_REGEX = /(road|street|phase|sector|plot|lane|floor|near|district|state|india|\b\d{6}\b)/i;

const IGNORE_LINE_REGEX = /(invoice|receipt|bill|tax|gst|total|amount|date|original|signature|sleek|thank\s*you)/i;

function extractVendorFromText(text = '', { isInvalidVendorName } = {}) {
  if (!text || !String(text).trim()) {
    return null;
  }

  const invalidFn = typeof isInvalidVendorName === 'function'
    ? isInvalidVendorName
    : () => false;

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerLines = lines.slice(0, HEADER_LINE_LIMIT);

  for (const line of headerLines) {
    if (METADATA_LINE_REGEX.test(line)) {
      continue;
    }
    if (COMPANY_SUFFIX_REGEX.test(line) && !invalidFn(line)) {
      return line.slice(0, 80);
    }
  }

  for (const line of headerLines) {
    if (METADATA_LINE_REGEX.test(line)) {
      continue;
    }
    const match = line.match(LABELED_VENDOR_REGEX);
    if (match?.[1]) {
      const candidate = match[1].trim();
      if (!invalidFn(candidate) && !METADATA_LINE_REGEX.test(candidate)) {
        return candidate.slice(0, 80);
      }
    }
  }

  const candidate = headerLines.find((line) => {
    const hasLetters = /[A-Za-z]/.test(line);
    const lowDigitDensity = (line.match(/\d/g) || []).length <= 4;
    const looksLikeAddress = ADDRESS_HINT_REGEX.test(line);
    return hasLetters
      && !IGNORE_LINE_REGEX.test(line)
      && !METADATA_LINE_REGEX.test(line)
      && lowDigitDensity
      && !looksLikeAddress
      && !invalidFn(line);
  });

  return candidate ? candidate.slice(0, 80) : null;
}

module.exports = {
  HEADER_LINE_LIMIT,
  extractVendorFromText
};
