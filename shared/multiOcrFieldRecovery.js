/**
 * Multi-engine OCR field recovery — rank cross-engine candidates for header fields.
 */

const FIELD_ENGINE_PRIORITY = Object.freeze({
  pdf_native_text: 40,
  text_direct_decode: 35,
  backend_primary_ocr: 30,
  pdf_ocr_tesseract: 20,
  image_ocr_secondary: 20,
  ai_model: 15,
  ai_model_multi_ocr: 10,
  ocr_text_heuristic: 5
});

const MULTI_OCR_FIELDS = Object.freeze([
  'gstin',
  'referenceNumber',
  'date',
  'amount'
]);

const EXTRACTOR_BY_FIELD = Object.freeze({
  gstin: 'extractGstin',
  referenceNumber: 'extractReferenceNumber',
  date: 'extractDate',
  amount: 'extractAmount'
});

function isEmptyValue(value) {
  return value === null || value === undefined || value === '';
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeFieldKey(fieldType, value, options = {}) {
  if (isEmptyValue(value)) {
    return null;
  }

  switch (fieldType) {
    case 'gstin':
      return String(value).toUpperCase().replace(/\s+/g, '');
    case 'referenceNumber': {
      const trimmed = String(value).trim();
      if (/^inv[\-\s]/i.test(trimmed)) {
        return trimmed.replace(/\s+/g, '').toUpperCase();
      }
      return trimmed.replace(/\s+/g, ' ');
    }
    case 'amount': {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? String(roundMoney(numeric)) : null;
    }
    case 'date': {
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString();
      }
      if (typeof options.parseDocumentDate === 'function') {
        const parsed = options.parseDocumentDate(value);
        if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
          return parsed.toISOString();
        }
      }
      return String(value).trim();
    }
    default:
      return String(value);
  }
}

function resolveFieldValue(fieldType, value, options = {}) {
  if (isEmptyValue(value)) {
    return null;
  }

  if (fieldType === 'date' && typeof options.parseDocumentDate === 'function') {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    const parsed = options.parseDocumentDate(value);
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (fieldType === 'amount') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? roundMoney(numeric) : null;
  }

  return value;
}

/**
 * Rank OCR field candidates; prefers cross-engine agreement, then engine priority.
 * @param {Array<{ value: *, engine: string, normalizedKey: string }>} candidates
 * @param {string} fieldType
 * @param {object} [options]
 * @returns {{ value: *, agreement: number, engines: string[], normalizedKey: string }|null}
 */
function rankFieldCandidates(candidates = [], fieldType = '', options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const viable = candidates
    .map((candidate) => {
      const normalizedKey = candidate.normalizedKey
        || normalizeFieldKey(fieldType, candidate.value, options);
      if (!normalizedKey || isEmptyValue(candidate.value)) {
        return null;
      }
      return {
        ...candidate,
        normalizedKey,
        value: resolveFieldValue(fieldType, candidate.value, options) ?? candidate.value
      };
    })
    .filter(Boolean);

  if (viable.length === 0) {
    return null;
  }

  const buckets = new Map();
  for (const candidate of viable) {
    if (!buckets.has(candidate.normalizedKey)) {
      buckets.set(candidate.normalizedKey, []);
    }
    buckets.get(candidate.normalizedKey).push(candidate);
  }

  let best = null;
  let bestAgreement = -1;
  let bestPriority = -1;

  for (const [normalizedKey, group] of buckets) {
    const engines = [];
    let prioritySum = 0;

    for (const candidate of group) {
      if (!engines.includes(candidate.engine)) {
        engines.push(candidate.engine);
        prioritySum += FIELD_ENGINE_PRIORITY[candidate.engine] || 0;
      }
    }

    const agreement = engines.length;
    const shouldReplace = (
      agreement > bestAgreement
      || (agreement === bestAgreement && prioritySum > bestPriority)
    );

    if (shouldReplace) {
      bestAgreement = agreement;
      bestPriority = prioritySum;
      best = {
        value: group[0].value,
        normalizedKey,
        agreement,
        engines: [...engines]
      };
    }
  }

  return best;
}

/**
 * Collect per-field winners from multi-engine OCR text blobs.
 * @param {Array<{ engine: string, text: string }>} engineTexts
 * @param {object} extractors
 * @param {{ parseDocumentDate?: (value: *) => Date|null }} [options]
 * @returns {Record<string, { value: *, agreement: number, engines: string[] }>}
 */
function pickMultiOcrFieldWinners(engineTexts = [], extractors = {}, options = {}) {
  const candidatesByField = Object.fromEntries(
    MULTI_OCR_FIELDS.map((field) => [field, []])
  );

  if (!Array.isArray(engineTexts)) {
    return {};
  }

  for (const entry of engineTexts) {
    const engine = entry?.engine;
    const text = entry?.text;
    if (!engine || !text) {
      continue;
    }

    for (const fieldType of MULTI_OCR_FIELDS) {
      const extractorName = EXTRACTOR_BY_FIELD[fieldType];
      const extractFn = extractors[extractorName];
      if (typeof extractFn !== 'function') {
        continue;
      }

      const rawValue = extractFn(text);
      const normalizedKey = normalizeFieldKey(fieldType, rawValue, options);
      if (!normalizedKey) {
        continue;
      }

      candidatesByField[fieldType].push({
        value: rawValue,
        engine,
        normalizedKey
      });
    }
  }

  const winners = {};
  for (const fieldType of MULTI_OCR_FIELDS) {
    const ranked = rankFieldCandidates(candidatesByField[fieldType], fieldType, options);
    if (ranked) {
      winners[fieldType] = ranked;
    }
  }

  return winners;
}

module.exports = {
  FIELD_ENGINE_PRIORITY,
  MULTI_OCR_FIELDS,
  normalizeFieldKey,
  rankFieldCandidates,
  pickMultiOcrFieldWinners
};
