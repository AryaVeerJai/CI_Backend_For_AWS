/**
 * RC-5F — item description cleanup, confidence scoring, and gap-fill helpers (extends RC-5D).
 */

const itemCorrectionPolicy = require('./itemCorrectionPolicy');

const HEADER_JUNK_PATTERN = /^(?:sr\.?\s*no\.?|s\.?\s*no\.?|#|qty|quantity|rate|amount|hsn|sac|particulars|description|item|items|unit|uom|price|total)\b/i;

const METADATA_FRAGMENT_PATTERN = /\b(?:gstin|invoice\s*no|bill\s*no|ref(?:erence)?\s*no|document\s*no|pan\s*no|cin\s*no|phone|mobile|email|www\.|http|pin\s*code|state\s*code)\b/i;

const CONTINUATION_LINE_PATTERN = /^[a-z(][\w\s\-\/.,]{2,}$/i;

function isPopulatedDescription(name) {
  const normalized = itemCorrectionPolicy.normalizeItemName(name);
  return itemCorrectionPolicy.isPlausibleItemName(normalized);
}

function cleanItemDescription(name) {
  if (name === null || name === undefined) {
    return '';
  }
  let value = String(name)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  value = value.replace(/^[\d.]+\s+/, '');
  value = value.replace(/^\W+/, '');
  if (HEADER_JUNK_PATTERN.test(value)) {
    return '';
  }
  if (METADATA_FRAGMENT_PATTERN.test(value)) {
    return '';
  }
  return itemCorrectionPolicy.normalizeItemName(value);
}

function mergeContinuationLines(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const merged = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const item = { ...raw };
    const name = cleanItemDescription(item.name || item.description);
    const numeric = itemCorrectionPolicy.readNumericFields(item);
    const hasIdentity = isPopulatedDescription(name) && Number.isFinite(numeric.total) && numeric.total > 0;

    if (
      merged.length > 0
      && !hasIdentity
      && name
      && CONTINUATION_LINE_PATTERN.test(name)
      && !itemCorrectionPolicy.isSummaryRowName(name)
    ) {
      const prior = merged[merged.length - 1];
      const priorName = cleanItemDescription(prior.name || prior.description);
      if (priorName) {
        prior.name = itemCorrectionPolicy.normalizeItemName(`${priorName} ${name}`);
        prior.description = prior.name;
        continue;
      }
    }

    if (name) {
      item.name = name;
      item.description = name;
    }
    merged.push(item);
  }

  return merged;
}

function scoreItemConfidence(item = {}) {
  const name = cleanItemDescription(item.name || item.description);
  const numeric = itemCorrectionPolicy.readNumericFields(item);
  let score = 0.35;

  if (isPopulatedDescription(name)) {
    score += 0.25;
    const letters = (name.match(/[A-Za-z]/g) || []).length;
    if (letters >= 6) {
      score += 0.1;
    }
  } else {
    score -= 0.2;
  }

  const populated = ['quantity', 'price', 'total'].filter((field) => {
    const value = numeric[field];
    return Number.isFinite(value) && value > 0;
  }).length;
  score += populated * 0.1;

  const math = itemCorrectionPolicy.computeLineMathScore(
    numeric.quantity,
    numeric.price,
    numeric.total
  );
  if (math.coherent) {
    score += 0.15;
  } else if (math.correctable) {
    score += 0.05;
  }

  const provenance = item.item_provenance || {};
  if (provenance.source === 'multi_ocr_item') {
    score += 0.05;
  }
  if (provenance.source === 'math_derived') {
    score += 0.03;
  }

  return Math.max(0, Math.min(1, Math.round(score * 10000) / 10000));
}

function gapFillItemDescription(existingItem = {}, candidateItem = {}) {
  const existingName = cleanItemDescription(existingItem.name || existingItem.description);
  if (isPopulatedDescription(existingName)) {
    return null;
  }
  const candidateName = cleanItemDescription(candidateItem.name || candidateItem.description);
  if (!isPopulatedDescription(candidateName)) {
    return null;
  }
  return {
    name: candidateName,
    description: candidateName
  };
}

/**
 * Apply description cleanup and confidence to items without overwriting valid fields.
 */
function applyItemAccuracyEnhancements(items = [], options = {}) {
  if (!Array.isArray(items)) {
    return [];
  }

  const merged = mergeContinuationLines(items);
  return merged.map((raw) => {
    const item = { ...raw };
    const existingName = item.name || item.description;
    const cleaned = cleanItemDescription(existingName);

    if (!isPopulatedDescription(existingName) && isPopulatedDescription(cleaned)) {
      item.name = cleaned;
      item.description = cleaned;
      item.item_provenance = {
        ...(item.item_provenance || {}),
        source: item.item_provenance?.source || 'ocr_text_item',
        stage: 'recovery',
        filledFields: [...new Set([...(item.item_provenance?.filledFields || []), 'name'])]
      };
    } else if (isPopulatedDescription(cleaned)) {
      item.name = cleaned;
      item.description = cleaned;
    }

    const derived = itemCorrectionPolicy.deriveMissingNumericFields(
      itemCorrectionPolicy.readNumericFields(item),
      options
    );
    for (const field of derived.derivedFields) {
      const existingNumeric = itemCorrectionPolicy.readNumericFields(item);
      if (Number.isFinite(existingNumeric[field]) && existingNumeric[field] > 0) {
        continue;
      }
      item[field] = derived.fields[field];
      item.item_provenance = {
        ...(item.item_provenance || {}),
        source: 'math_derived',
        stage: 'recovery',
        filledFields: [...new Set([...(item.item_provenance?.filledFields || []), field])],
        action: 'DERIVE'
      };
    }

    if (item.item_confidence === undefined || item.item_confidence === null) {
      item.item_confidence = scoreItemConfidence(item);
    }

    if (!item.item_provenance) {
      item.item_provenance = {
        source: 'ocr_text_item',
        stage: 'recovery'
      };
    }

    return item;
  });
}

module.exports = {
  cleanItemDescription,
  mergeContinuationLines,
  scoreItemConfidence,
  gapFillItemDescription,
  applyItemAccuracyEnhancements,
  isPopulatedDescription
};
