/**
 * RC-5D PR-5D-1 — item candidate correction policy (orchestration only).
 * ADMIT | DERIVE | CORRECT | MERGE | DROP | DEFER
 */

const CORRECTION_ACTION = Object.freeze({
  ADMIT: 'ADMIT',
  DERIVE: 'DERIVE',
  CORRECT: 'CORRECT',
  MERGE: 'MERGE',
  DROP: 'DROP',
  DEFER: 'DEFER'
});

const ITEM_FIELDS = Object.freeze(['name', 'quantity', 'price', 'total']);

const ITEM_ENGINE_PRIORITY = Object.freeze({
  pdf_native_text: 40,
  text_direct_decode: 35,
  backend_primary_ocr: 30,
  pdf_ocr_tesseract: 20,
  image_ocr_secondary: 20,
  ai_model: 15,
  ai_model_multi_ocr: 10,
  ocr_text_heuristic: 5
});

const DEFAULT_POLICY = Object.freeze({
  lineMathTolerance: 0.12,
  correctMathTolerance: 0.25,
  maxLineTotal: 500000,
  minLineTotal: 0.01,
  minQuantity: 0.01,
  maxQuantity: 10000,
  minNameLetters: 3,
  maxNameLength: 120
});

const SUMMARY_NAME_PATTERN = /\b(grand\s*total|net\s*total|gross\s*total|invoice\s*total|bill\s*total|total\s*amount|amount\s*after\s*tax|taxable\s*amount|taxable\s*value|round\s*[- ]?off|payable\s*amount|balance\s*amount|balance\s*due|amount\s*due|net\s*payable|sub\s*total|subtotal|total\s*in\s*words|amount\s*in\s*words)\b/i;

const STANDALONE_SUMMARY_PATTERN = /^\s*(total|subtotal|sub-total|sub\s+total|net|payable|balance|amount due|grand\s*total|invoice\s*total|bill\s*total|gross|net\s*amount)\s*:?\s*$/i;

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function isEmptyValue(value) {
  return value === null || value === undefined || value === '';
}

function isPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function normalizeItemName(name) {
  if (isEmptyValue(name)) {
    return '';
  }
  return String(name).replace(/\s+/g, ' ').trim().slice(0, DEFAULT_POLICY.maxNameLength);
}

function countLetters(name) {
  return (String(name || '').match(/[A-Za-z]/g) || []).length;
}

function isSummaryRowName(name) {
  const normalized = normalizeItemName(name);
  if (!normalized) {
    return false;
  }
  if (STANDALONE_SUMMARY_PATTERN.test(normalized)) {
    return true;
  }
  if (SUMMARY_NAME_PATTERN.test(normalized)) {
    return true;
  }
  const lowered = normalized.toLowerCase();
  if (normalized.split(/\s+/).length <= 2 && ['total', 'subtotal', 'sub total', 'net', 'payable', 'balance', 'amount'].includes(lowered)) {
    return true;
  }
  return false;
}

function isPlausibleItemName(name, options = {}) {
  const policy = { ...DEFAULT_POLICY, ...options };
  const normalized = normalizeItemName(name);
  if (!normalized) {
    return false;
  }
  if (isSummaryRowName(normalized)) {
    return false;
  }
  const letters = countLetters(normalized);
  return letters >= policy.minNameLetters && normalized.length <= policy.maxNameLength;
}

function readNumericFields(item = {}) {
  const quantity = Number(item.quantity ?? item.qty);
  const price = Number(item.price ?? item.unit_price ?? item.unitPrice);
  const total = Number(item.total ?? item.total_price ?? item.amount);
  return {
    quantity: isPositiveNumber(quantity) ? roundMoney(quantity) : null,
    price: isPositiveNumber(price) ? roundMoney(price) : null,
    total: isPositiveNumber(total) ? roundMoney(total) : null
  };
}

function lineMathDiff(quantity, price, total) {
  if (!isPositiveNumber(quantity) || !isPositiveNumber(price) || !isPositiveNumber(total)) {
    return null;
  }
  return Math.abs((quantity * price) - total) / Math.max(total, 1);
}

function computeLineMathScore(quantity, price, total, options = {}) {
  const policy = { ...DEFAULT_POLICY, ...options };
  const diff = lineMathDiff(quantity, price, total);
  if (diff === null) {
    return { score: 0, diff: null, coherent: false, correctable: false };
  }
  const coherent = diff <= policy.lineMathTolerance;
  const correctable = !coherent && diff <= policy.correctMathTolerance;
  const score = coherent
    ? 1
    : Math.max(0, 1 - (diff / Math.max(policy.correctMathTolerance, 0.01)));
  return { score: roundMoney(score), diff: roundMoney(diff), coherent, correctable };
}

function deriveMissingNumericFields(fields = {}, options = {}) {
  const policy = { ...DEFAULT_POLICY, ...options };
  const quantity = fields.quantity;
  const price = fields.price;
  const total = fields.total;

  const presentCount = [quantity, price, total].filter(isPositiveNumber).length;
  if (presentCount === 3) {
    return { fields: { quantity, price, total }, derivedFields: [], ambiguous: false };
  }
  if (presentCount < 2) {
    return { fields: { quantity, price, total }, derivedFields: [], ambiguous: presentCount === 1 };
  }

  if (isPositiveNumber(quantity) && isPositiveNumber(price) && !isPositiveNumber(total)) {
    const derivedTotal = roundMoney(quantity * price);
    if (derivedTotal >= policy.minLineTotal && derivedTotal <= policy.maxLineTotal) {
      return {
        fields: { quantity, price, total: derivedTotal },
        derivedFields: ['total'],
        ambiguous: false
      };
    }
    return { fields: { quantity, price, total }, derivedFields: [], ambiguous: true };
  }

  if (isPositiveNumber(total) && isPositiveNumber(quantity) && !isPositiveNumber(price)) {
    const derivedPrice = roundMoney(total / quantity);
    if (derivedPrice >= policy.minLineTotal && derivedPrice <= policy.maxLineTotal) {
      return {
        fields: { quantity, price: derivedPrice, total },
        derivedFields: ['price'],
        ambiguous: false
      };
    }
    return { fields: { quantity, price, total }, derivedFields: [], ambiguous: true };
  }

  if (isPositiveNumber(total) && isPositiveNumber(price) && !isPositiveNumber(quantity)) {
    const derivedQty = roundMoney(total / price);
    if (derivedQty >= policy.minQuantity && derivedQty <= policy.maxQuantity) {
      return {
        fields: { quantity: derivedQty, price, total },
        derivedFields: ['quantity'],
        ambiguous: false
      };
    }
    return { fields: { quantity, price, total }, derivedFields: [], ambiguous: true };
  }

  return { fields: { quantity, price, total }, derivedFields: [], ambiguous: true };
}

function correctMathFields(fields = {}, options = {}) {
  const policy = { ...DEFAULT_POLICY, ...options };
  const { quantity, price, total } = fields;
  const math = computeLineMathScore(quantity, price, total, policy);
  if (math.coherent) {
    return { fields: { quantity, price, total }, field: null };
  }
  if (!math.correctable) {
    return { fields: { quantity, price, total }, field: null };
  }

  const candidates = [];
  if (isPositiveNumber(quantity) && isPositiveNumber(price)) {
    candidates.push({
      field: 'total',
      fields: { quantity, price, total: roundMoney(quantity * price) },
      diff: lineMathDiff(quantity, price, roundMoney(quantity * price))
    });
  }
  if (isPositiveNumber(total) && isPositiveNumber(quantity)) {
    candidates.push({
      field: 'price',
      fields: { quantity, price: roundMoney(total / quantity), total },
      diff: lineMathDiff(quantity, roundMoney(total / quantity), total)
    });
  }
  if (isPositiveNumber(total) && isPositiveNumber(price)) {
    candidates.push({
      field: 'quantity',
      fields: { quantity: roundMoney(total / price), price, total },
      diff: lineMathDiff(roundMoney(total / price), price, total)
    });
  }

  const viable = candidates
    .filter((entry) => entry.diff !== null && entry.diff <= policy.correctMathTolerance)
    .sort((left, right) => left.diff - right.diff);

  if (viable.length === 0) {
    return { fields: { quantity, price, total }, field: null };
  }
  if (viable.length > 1 && Math.abs(viable[0].diff - viable[1].diff) < 0.001) {
    return { fields: { quantity, price, total }, field: null, ambiguous: true };
  }

  return { fields: viable[0].fields, field: viable[0].field, ambiguous: false };
}

function buildNormalizedItem(rawItem = {}, numericFields = {}) {
  const name = normalizeItemName(rawItem.name || rawItem.description || rawItem.item_name);
  return {
    ...rawItem,
    name,
    description: rawItem.description || name,
    quantity: numericFields.quantity,
    price: numericFields.price,
    total: numericFields.total
  };
}

function evaluateCandidate(rawItem = {}, options = {}) {
  const policy = { ...DEFAULT_POLICY, ...options };
  const name = normalizeItemName(rawItem.name || rawItem.description || rawItem.item_name);

  if (isSummaryRowName(name)) {
    return { action: CORRECTION_ACTION.DROP, item: null, reason: 'summary_row' };
  }

  if (!isPlausibleItemName(name, policy)) {
    return { action: CORRECTION_ACTION.DROP, item: null, reason: 'invalid_name' };
  }

  const numeric = readNumericFields(rawItem);
  const derived = deriveMissingNumericFields(numeric, policy);

  if (derived.ambiguous && derived.derivedFields.length === 0) {
    return {
      action: CORRECTION_ACTION.DEFER,
      item: buildNormalizedItem(rawItem, numeric),
      reason: 'ambiguous_numeric_fields'
    };
  }

  if (derived.derivedFields.length > 0) {
    const item = buildNormalizedItem(rawItem, derived.fields);
    if (!isPositiveNumber(item.total) || item.total > policy.maxLineTotal) {
      return { action: CORRECTION_ACTION.DROP, item: null, reason: 'invalid_total' };
    }
    return {
      action: CORRECTION_ACTION.DERIVE,
      item,
      reason: `derived_${derived.derivedFields.join('_')}`,
      derivedFields: derived.derivedFields
    };
  }

  const { quantity, price, total } = derived.fields;
  if (!isPositiveNumber(total) || total > policy.maxLineTotal) {
    return { action: CORRECTION_ACTION.DROP, item: null, reason: 'invalid_total' };
  }

  const math = computeLineMathScore(quantity, price, total, policy);
  if (math.coherent) {
    return {
      action: CORRECTION_ACTION.ADMIT,
      item: buildNormalizedItem(rawItem, { quantity, price, total }),
      reason: 'coherent',
      scores: { math: math.score }
    };
  }

  const corrected = correctMathFields({ quantity, price, total }, policy);
  if (corrected.ambiguous) {
    return {
      action: CORRECTION_ACTION.DEFER,
      item: buildNormalizedItem(rawItem, { quantity, price, total }),
      reason: 'ambiguous_math_correction'
    };
  }
  if (corrected.field) {
    return {
      action: CORRECTION_ACTION.CORRECT,
      item: buildNormalizedItem(rawItem, corrected.fields),
      reason: `corrected_${corrected.field}`,
      correctedField: corrected.field,
      scores: { math: computeLineMathScore(corrected.fields.quantity, corrected.fields.price, corrected.fields.total, policy).score }
    };
  }

  if (math.score < 0.5) {
    return { action: CORRECTION_ACTION.DROP, item: null, reason: 'math_incoherent' };
  }

  return {
    action: CORRECTION_ACTION.DEFER,
    item: buildNormalizedItem(rawItem, { quantity, price, total }),
    reason: 'ambiguous_math'
  };
}

function mergeItemRecords(left = {}, right = {}, options = {}) {
  const leftName = normalizeItemName(left.name || left.description);
  const rightName = normalizeItemName(right.name || right.description);
  const mergedName = rightName.length > leftName.length ? rightName : leftName;
  const leftPriority = ITEM_ENGINE_PRIORITY[left.engine] || 0;
  const rightPriority = ITEM_ENGINE_PRIORITY[right.engine] || 0;
  const preferred = rightPriority > leftPriority ? right : left;
  const fallback = preferred === right ? left : right;
  const numeric = readNumericFields(preferred.item || preferred);
  const fallbackNumeric = readNumericFields(fallback.item || fallback);

  return {
    action: CORRECTION_ACTION.MERGE,
    item: buildNormalizedItem(
      { ...(fallback.item || fallback), ...(preferred.item || preferred) },
      {
        quantity: numeric.quantity || fallbackNumeric.quantity,
        price: numeric.price || fallbackNumeric.price,
        total: numeric.total || fallbackNumeric.total
      }
    ),
    name: mergedName,
    engines: [...new Set([...(left.engines || [left.engine].filter(Boolean)), ...(right.engines || [right.engine].filter(Boolean))])],
    reason: 'duplicate_item_key',
    scores: {
      ...(preferred.scores || {}),
      ...(fallback.scores || {})
    }
  };
}

module.exports = {
  CORRECTION_ACTION,
  ITEM_FIELDS,
  ITEM_ENGINE_PRIORITY,
  DEFAULT_POLICY,
  normalizeItemName,
  isSummaryRowName,
  isPlausibleItemName,
  readNumericFields,
  lineMathDiff,
  computeLineMathScore,
  deriveMissingNumericFields,
  correctMathFields,
  evaluateCandidate,
  mergeItemRecords
};
