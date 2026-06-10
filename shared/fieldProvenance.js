/**
 * Field Provenance v1 (RC-6 Phase 1) — record-only tracking at backend capture points.
 * Does not change extraction, reconcile winners, or confidence calculations.
 */

const FIELD_PROVENANCE_VERSION = '1.0';

const TRACKED_FIELDS = Object.freeze([
  'gstin',
  'referenceNumber',
  'date',
  'vendor',
  'amount'
]);

const RECONCILE_KEY_TO_PROVENANCE = Object.freeze({
  amount: 'amount',
  date: 'date',
  vendorName: 'vendor',
  gstin: 'gstin',
  referenceNumber: 'referenceNumber'
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isEmptyValue(value) {
  return value === null || value === undefined || value === '';
}

function readGstinValue(data) {
  const ed = asObject(data);
  return ed.gstin || ed.seller_gstin || ed.gst?.seller_gstin || null;
}

function readReferenceNumberValue(data) {
  const ed = asObject(data);
  return ed.referenceNumber || ed.invoice_number || null;
}

function readVendorValue(data) {
  const ed = asObject(data);
  const vendor = ed.vendor;
  if (typeof vendor === 'string') {
    const trimmed = vendor.trim();
    return trimmed || null;
  }
  if (vendor && typeof vendor === 'object') {
    return vendor.name || vendor.rawName || null;
  }
  return ed.vendorRaw || null;
}

function readFieldValue(data, fieldKey) {
  const ed = asObject(data);
  switch (fieldKey) {
    case 'gstin':
      return readGstinValue(ed);
    case 'referenceNumber':
      return readReferenceNumberValue(ed);
    case 'vendor':
      return readVendorValue(ed);
    case 'date':
      return ed.date ?? null;
    case 'amount': {
      const numeric = Number(ed.amount);
      return Number.isFinite(numeric) ? numeric : null;
    }
    default:
      return null;
  }
}

function ensureFieldProvenance(extractedData) {
  if (!extractedData || typeof extractedData !== 'object') {
    return null;
  }
  const existing = asObject(extractedData.fieldProvenance);
  if (!existing.fields || typeof existing.fields !== 'object') {
    existing.fields = {};
  }
  extractedData.fieldProvenance = existing;
  return existing;
}

function ensureFieldEntry(provenance, fieldKey) {
  if (!provenance.fields[fieldKey]) {
    provenance.fields[fieldKey] = {
      value: null,
      winner: null,
      modifications: []
    };
  }
  const entry = provenance.fields[fieldKey];
  if (!Array.isArray(entry.modifications)) {
    entry.modifications = [];
  }
  return entry;
}

function syncFieldValue(entry, value) {
  if (!isEmptyValue(value)) {
    entry.value = value;
  }
}

function recordWinner(extractedData, fieldKey, { value, source, stage }) {
  if (!TRACKED_FIELDS.includes(fieldKey)) {
    return;
  }
  const provenance = ensureFieldProvenance(extractedData);
  if (!provenance) {
    return;
  }
  const entry = ensureFieldEntry(provenance, fieldKey);
  if (!entry.winner && !isEmptyValue(value)) {
    entry.winner = {
      source: source || 'none',
      stage: stage || 'reconcile'
    };
  }
  syncFieldValue(entry, value);
}

function recordReconcileWinner(extractedData, reconcileKey, { value, source }) {
  const fieldKey = RECONCILE_KEY_TO_PROVENANCE[reconcileKey];
  if (!fieldKey) {
    return;
  }
  recordWinner(extractedData, fieldKey, {
    value,
    source,
    stage: 'reconcile'
  });
}

function recordPassthroughWinners(extractedData, aiData, { stage = 'ai_only' } = {}) {
  if (!aiData || typeof aiData !== 'object') {
    return;
  }
  for (const fieldKey of TRACKED_FIELDS) {
    const value = readFieldValue(aiData, fieldKey);
    if (!isEmptyValue(value)) {
      recordWinner(extractedData, fieldKey, {
        value,
        source: 'ai',
        stage
      });
    }
  }
}

function recordHintRecoveryFill(extractedData, fieldKey, { value } = {}) {
  recordRecoveryFill(extractedData, fieldKey, { value, source: 'ocr_hint' });
}

function recordMultiOcrRecoveryFill(extractedData, fieldKey, { value } = {}) {
  recordRecoveryFill(extractedData, fieldKey, { value, source: 'multi_ocr' });
}

function recordGstinRecoveryFill(extractedData, fieldKey, { value } = {}) {
  recordRecoveryFill(extractedData, fieldKey, { value, source: 'gstin_recovery' });
}

function recordReferenceRecoveryFill(extractedData, fieldKey, { value } = {}) {
  recordRecoveryFill(extractedData, fieldKey, { value, source: 'reference_recovery' });
}

function recordVendorRecoveryFill(extractedData, fieldKey, { value } = {}) {
  recordRecoveryFill(extractedData, fieldKey, { value, source: 'vendor_recovery' });
}

function recordDateRecoveryFill(extractedData, fieldKey, { value } = {}) {
  recordRecoveryFill(extractedData, fieldKey, { value, source: 'date_recovery' });
}

function recordRecoveryFill(extractedData, fieldKey, { value, source = 'ocr_text' } = {}) {
  if (!TRACKED_FIELDS.includes(fieldKey) || isEmptyValue(value)) {
    return;
  }
  const provenance = ensureFieldProvenance(extractedData);
  if (!provenance) {
    return;
  }
  const entry = ensureFieldEntry(provenance, fieldKey);
  const priorValue = entry.value;

  if (!entry.winner) {
    recordWinner(extractedData, fieldKey, {
      value,
      source,
      stage: 'recovery'
    });
    return;
  }

  if (priorValue !== value) {
    recordModification(extractedData, fieldKey, {
      stage: 'recovery',
      source,
      from: priorValue ?? null,
      to: value
    });
  } else {
    syncFieldValue(entry, value);
  }
}

function recordModification(extractedData, fieldKey, { stage, source, from, to }) {
  if (!TRACKED_FIELDS.includes(fieldKey)) {
    return;
  }
  const provenance = ensureFieldProvenance(extractedData);
  if (!provenance) {
    return;
  }
  const entry = ensureFieldEntry(provenance, fieldKey);
  const fromNorm = from === undefined ? null : from;
  const toNorm = to === undefined ? null : to;
  if (fromNorm === toNorm) {
    return;
  }
  entry.modifications.push({
    stage: stage || 'unknown',
    source: source || 'backend',
    from: fromNorm,
    to: toNorm,
    at: new Date().toISOString()
  });
  syncFieldValue(entry, toNorm);
}

function recordVendorNormalization(extractedData, vendorResult) {
  if (!extractedData || !vendorResult?.vendor) {
    return;
  }
  const original = vendorResult.meta?.original ?? extractVendorRawForProvenance(extractedData);
  const normalized = vendorResult.vendor.name ?? null;
  const metaSource = vendorResult.meta?.source || 'unchanged';

  if (isEmptyValue(normalized)) {
    return;
  }

  const provenance = ensureFieldProvenance(extractedData);
  if (!provenance) {
    return;
  }
  const entry = ensureFieldEntry(provenance, 'vendor');

  if (!entry.winner) {
    recordWinner(extractedData, 'vendor', {
      value: normalized,
      source: 'backend',
      stage: 'normalize_vendor'
    });
  } else {
    syncFieldValue(entry, normalized);
  }

  if (original !== normalized) {
    recordModification(extractedData, 'vendor', {
      stage: 'normalize_vendor',
      source: metaSource,
      from: original,
      to: normalized
    });
  }
}

function extractVendorRawForProvenance(extractedData) {
  const ed = asObject(extractedData);
  if (typeof ed.vendor === 'string') {
    return ed.vendor;
  }
  if (ed.vendor?.rawName) {
    return ed.vendor.rawName;
  }
  if (ed.vendor?.name) {
    return ed.vendor.name;
  }
  return ed.vendorRaw || null;
}

function finalizeProvenanceEnvelope(extractedData) {
  const provenance = ensureFieldProvenance(extractedData);
  if (!provenance) {
    return extractedData;
  }
  provenance.version = FIELD_PROVENANCE_VERSION;
  provenance.recordedAt = new Date().toISOString();
  return extractedData;
}

module.exports = {
  FIELD_PROVENANCE_VERSION,
  TRACKED_FIELDS,
  RECONCILE_KEY_TO_PROVENANCE,
  ensureFieldProvenance,
  recordWinner,
  recordReconcileWinner,
  recordPassthroughWinners,
  recordRecoveryFill,
  recordHintRecoveryFill,
  recordMultiOcrRecoveryFill,
  recordGstinRecoveryFill,
  recordReferenceRecoveryFill,
  recordVendorRecoveryFill,
  recordDateRecoveryFill,
  recordModification,
  recordVendorNormalization,
  readFieldValue,
  finalizeProvenanceEnvelope
};
