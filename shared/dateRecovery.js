/**
 * RC-5F — invoice date recovery (label-aware, due-date avoidance).
 */

const INVOICE_DATE_LABEL_REGEX = /\b(?:invoice|bill|receipt|document|tax)\s*date\b/i;

const DUE_DATE_LABEL_REGEX = /\b(?:due|payment\s*due|pay\s*by|payable\s*on)\s*date\b/i;

const INLINE_INVOICE_DATE_REGEX = /\b(?:invoice|bill|receipt|document)\s*date\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4})/i;

const DATE_TOKEN_PATTERNS = [
  /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g,
  /\b\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\b/g,
  /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}\b/g,
  /\b[A-Za-z]{3,9}\s+\d{1,2},\s+\d{2,4}\b/g
];

function extractDateTokens(content) {
  const matches = [];
  for (const pattern of DATE_TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      matches.push(match[0]);
    }
  }
  return matches;
}

function scoreDateCandidate(line, token) {
  let score = 0;
  if (INVOICE_DATE_LABEL_REGEX.test(line)) {
    score += 10;
  }
  if (DUE_DATE_LABEL_REGEX.test(line)) {
    score -= 8;
  }
  if (/\bdate\b/i.test(line) && !DUE_DATE_LABEL_REGEX.test(line)) {
    score += 2;
  }
  if (line.toLowerCase().includes(token.toLowerCase())) {
    score += 1;
  }
  return score;
}

/**
 * Recover invoice date from OCR text; prefers invoice/bill/document labels over due dates.
 * @param {string} text
 * @param {(value: *) => Date|null} parseDocumentDate
 * @returns {Date|null}
 */
function extractInvoiceDateFromText(text = '', parseDocumentDate) {
  if (!text || typeof parseDocumentDate !== 'function') {
    return null;
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (DUE_DATE_LABEL_REGEX.test(line) && !INVOICE_DATE_LABEL_REGEX.test(line)) {
      continue;
    }
    const inline = line.match(INLINE_INVOICE_DATE_REGEX);
    if (inline?.[1]) {
      const parsed = parseDocumentDate(inline[1]);
      if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }

  const ranked = [];
  for (const line of lines) {
    if (!INVOICE_DATE_LABEL_REGEX.test(line)) {
      continue;
    }
    for (const token of extractDateTokens(line)) {
      const parsed = parseDocumentDate(token);
      if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
        continue;
      }
      ranked.push({
        parsed,
        score: scoreDateCandidate(line, token) + 5
      });
    }
  }

  for (const line of lines) {
    if (DUE_DATE_LABEL_REGEX.test(line) && !INVOICE_DATE_LABEL_REGEX.test(line)) {
      continue;
    }
    for (const token of extractDateTokens(line)) {
      const parsed = parseDocumentDate(token);
      if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
        continue;
      }
      ranked.push({
        parsed,
        score: scoreDateCandidate(line, token)
      });
    }
  }

  if (ranked.length === 0) {
    const nonDueLines = lines.filter((line) => !DUE_DATE_LABEL_REGEX.test(line) || INVOICE_DATE_LABEL_REGEX.test(line));
    for (const token of extractDateTokens(nonDueLines.join('\n'))) {
      const parsed = parseDocumentDate(token);
      if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
        ranked.push({ parsed, score: 0 });
      }
    }
  }

  ranked.sort((left, right) => right.score - left.score);
  return ranked[0]?.parsed || null;
}

module.exports = {
  INVOICE_DATE_LABEL_REGEX,
  DUE_DATE_LABEL_REGEX,
  extractInvoiceDateFromText
};
