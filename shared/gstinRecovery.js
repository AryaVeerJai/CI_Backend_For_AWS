/**
 * RC-5E GSTIN recovery — label-aware extraction and OCR normalization.
 * Uses the same 15-character GSTIN shape as backend extractGSTFromText / AI validate_gst.
 */

const GSTIN_STRICT_REGEX = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/g;

const GSTIN_LABEL_REGEX = /\b(?:GSTIN|GST\s*(?:No\.?|Number|Registration(?:\s*No\.?)?))\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\s\-/]{8,24})/gi;

const GSTIN_DIGIT_MAP = Object.freeze({
  O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2'
});

const GSTIN_LETTER_MAP = Object.freeze({
  0: 'O', 1: 'I', 2: 'Z', 5: 'S', 6: 'G', 8: 'B'
});

const GSTIN_SLOT_KINDS = Object.freeze(['D', 'D', 'L', 'L', 'L', 'L', 'L', 'D', 'D', 'D', 'D', 'L', 'A', 'Z', 'A']);

function isValidGstin(value) {
  if (!value) return false;
  const token = String(value).toUpperCase().replace(/\s+/g, '');
  GSTIN_STRICT_REGEX.lastIndex = 0;
  return GSTIN_STRICT_REGEX.test(token) && token.length === 15;
}

function normalizeGstinToken(token) {
  if (!token) return null;
  let cleaned = String(token).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 15) return cleaned.length >= 10 ? cleaned : null;
  if (cleaned.length > 15) {
    cleaned = cleaned.slice(0, 15);
  }
  if (cleaned.length !== 15) return null;

  const chars = cleaned.split('');
  for (let idx = 0; idx < GSTIN_SLOT_KINDS.length; idx += 1) {
    const kind = GSTIN_SLOT_KINDS[idx];
    let ch = chars[idx];
    if (kind === 'D') {
      ch = GSTIN_DIGIT_MAP[ch] || ch;
      if (!/\d/.test(ch)) return null;
    } else if (kind === 'L') {
      ch = GSTIN_LETTER_MAP[ch] || ch;
      if (!/[A-Z]/.test(ch)) return null;
    } else if (kind === 'Z') {
      if (ch === '2' || ch === '7') ch = 'Z';
      if (ch !== 'Z') return null;
    } else if (kind === 'A') {
      ch = GSTIN_DIGIT_MAP[ch] || ch;
      if (!/[A-Z0-9]/.test(ch)) return null;
    }
    chars[idx] = ch;
  }
  const normalized = chars.join('');
  return isValidGstin(normalized) ? normalized : null;
}

function extractStrictGstins(text) {
  if (!text) return [];
  const upper = String(text).toUpperCase();
  GSTIN_STRICT_REGEX.lastIndex = 0;
  const matches = upper.match(GSTIN_STRICT_REGEX) || [];
  return [...new Set(matches.filter(isValidGstin))];
}

function extractLabelGstinCandidates(text) {
  if (!text) return [];
  const candidates = [];
  let match;
  GSTIN_LABEL_REGEX.lastIndex = 0;
  while ((match = GSTIN_LABEL_REGEX.exec(text)) !== null) {
    const fragment = String(match[1] || '').trim();
    const beforeNoise = fragment.split(/\s+(?:road|street|lane|avenue|pin|pincode|state|city|district)\b/i)[0];
    const alnum = beforeNoise.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (alnum.length >= 10) {
      candidates.push(alnum.slice(0, 15));
      if (alnum.length > 15) {
        for (let start = 0; start <= Math.min(3, alnum.length - 15); start += 1) {
          candidates.push(alnum.slice(start, start + 15));
        }
      }
    }
  }
  return [...new Set(candidates)];
}

/**
 * Extract GSTIN from OCR/raw text (strict matches first, then label-aware repair).
 * @returns {{ gstin: string, seller_gstin: string, buyer_gstin: string|null }|null}
 */
function applyGstinLabelTextCorrections(text = '') {
  return String(text)
    .replace(/GSMIN/gi, 'GSTIN')
    .replace(/G5TIN/gi, 'GSTIN')
    .replace(/GSTTN/gi, 'GSTIN')
    .replace(/GSTJN/gi, 'GSTIN')
    .replace(/GS\s+TIN/gi, 'GSTIN');
}

function extractGstinFromText(text = '') {
  if (!text || !String(text).trim()) return null;

  const corrected = applyGstinLabelTextCorrections(text);
  const strict = extractStrictGstins(corrected);
  if (strict.length > 0) {
    return {
      gstin: strict[0],
      seller_gstin: strict[0],
      buyer_gstin: strict[1] || null
    };
  }

  const labelCandidates = extractLabelGstinCandidates(corrected);
  for (const raw of labelCandidates) {
    const repaired = normalizeGstinToken(raw);
    if (repaired) {
      return {
        gstin: repaired,
        seller_gstin: repaired,
        buyer_gstin: null
      };
    }
  }

  return null;
}

module.exports = {
  GSTIN_STRICT_REGEX,
  GSTIN_LABEL_REGEX,
  isValidGstin,
  normalizeGstinToken,
  extractStrictGstins,
  extractLabelGstinCandidates,
  extractGstinFromText
};
