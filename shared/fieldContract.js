/**
 * Field Contract v1 (RC-4) — single source of truth for canonical field names,
 * alias resolution (read), and persistence normalization (write).
 *
 * Canonical storage:
 *   vendor.name, referenceNumber, gstin, amount, date
 * Compatibility aliases (read/write mirror):
 *   invoice_number, seller_gstin, flat vendor string (read-only via helpers)
 */

const fieldProvenance = require('./fieldProvenance');

const FIELD_CONTRACT_VERSION = '1.0';

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function rawBlock(extractedData) {
  const ed = asObject(extractedData) || {};
  return asObject(ed.raw) || {};
}

/**
 * @param {object} [extractedData]
 * @returns {string|null}
 */
function readVendorName(extractedData) {
  const ed = asObject(extractedData) || {};
  const raw = rawBlock(extractedData);
  const vendor = ed.vendor ?? raw.vendor;
  if (typeof vendor === 'string') {
    const trimmed = vendor.trim();
    return trimmed || null;
  }
  if (vendor && typeof vendor === 'object') {
    return firstNonEmpty(vendor.name, vendor.rawName);
  }
  const vendorDetails = ed.vendor_details ?? raw.vendor_details;
  if (vendorDetails && typeof vendorDetails === 'object') {
    return firstNonEmpty(vendorDetails.name);
  }
  return firstNonEmpty(ed.vendorRaw, raw.vendorRaw);
}

/**
 * @param {object} [extractedData]
 * @returns {string|null}
 */
function readReferenceNumber(extractedData) {
  const ed = asObject(extractedData) || {};
  const raw = rawBlock(extractedData);
  return firstNonEmpty(
    ed.referenceNumber,
    ed.invoice_number,
    raw.referenceNumber,
    raw.invoice_number
  );
}

/**
 * @param {object} [extractedData]
 * @returns {string|null}
 */
function readGstin(extractedData) {
  const ed = asObject(extractedData) || {};
  const raw = rawBlock(extractedData);
  const gst = ed.gst ?? raw.gst;
  const vendorDetails = ed.vendor_details ?? raw.vendor_details;
  return firstNonEmpty(
    ed.gstin,
    ed.seller_gstin,
    gst?.seller_gstin,
    raw.gstin,
    raw.seller_gstin,
    raw.gst?.seller_gstin,
    vendorDetails?.gstin
  );
}

/**
 * Flat read surface for automation audit keys and API adapters.
 * @param {object} [extractedData]
 */
function readContractFields(extractedData) {
  const referenceNumber = readReferenceNumber(extractedData);
  const gstin = readGstin(extractedData);
  return {
    vendor: readVendorName(extractedData),
    referenceNumber,
    invoice_number: referenceNumber,
    gstin,
    seller_gstin: gstin
  };
}

/**
 * Normalize extractedData for persistence (does not mutate extraction logic).
 * Ensures canonical fields and compatibility aliases stay aligned.
 * @param {object} extractedData
 * @returns {object}
 */
function applyFieldContractWrite(extractedData) {
  if (!extractedData || typeof extractedData !== 'object') {
    return extractedData;
  }

  const vendorName = readVendorName(extractedData);
  if (vendorName) {
    if (typeof extractedData.vendor === 'string') {
      const vendorBefore = extractedData.vendor;
      extractedData.vendor = {
        name: vendorName,
        rawName: extractedData.vendor
      };
      fieldProvenance.recordModification(extractedData, 'vendor', {
        stage: 'field_contract',
        source: 'field_contract_mirror',
        from: vendorBefore,
        to: vendorName
      });
    } else if (!extractedData.vendor || typeof extractedData.vendor !== 'object') {
      extractedData.vendor = { name: vendorName };
    } else if (!extractedData.vendor.name) {
      extractedData.vendor = { ...extractedData.vendor, name: vendorName };
    }
  } else if (typeof extractedData.vendor === 'string' && extractedData.vendor.trim()) {
    const vendorBefore = extractedData.vendor;
    extractedData.vendor = {
      name: extractedData.vendor.trim(),
      rawName: extractedData.vendor
    };
    fieldProvenance.recordModification(extractedData, 'vendor', {
      stage: 'field_contract',
      source: 'field_contract_mirror',
      from: vendorBefore,
      to: extractedData.vendor.name
    });
  }

  const referenceNumber = readReferenceNumber(extractedData);
  if (referenceNumber) {
    const canonical = String(referenceNumber).trim();
    const invoiceBefore = extractedData.invoice_number;
    const referenceBefore = extractedData.referenceNumber;
    extractedData.referenceNumber = canonical;
    extractedData.invoice_number = canonical;
    if (invoiceBefore !== canonical) {
      fieldProvenance.recordModification(extractedData, 'referenceNumber', {
        stage: 'field_contract',
        source: 'field_contract_mirror',
        from: invoiceBefore ?? referenceBefore ?? null,
        to: canonical
      });
    }
  }

  const gstin = readGstin(extractedData);
  if (gstin) {
    const canonical = String(gstin).trim();
    const sellerBefore = extractedData.seller_gstin;
    const gstinBefore = extractedData.gstin;
    extractedData.gstin = canonical;
    extractedData.seller_gstin = canonical;
    extractedData.gst = {
      ...(asObject(extractedData.gst) || {}),
      seller_gstin: canonical
    };
    if (sellerBefore !== canonical || gstinBefore !== canonical) {
      fieldProvenance.recordModification(extractedData, 'gstin', {
        stage: 'field_contract',
        source: 'field_contract_mirror',
        from: sellerBefore ?? gstinBefore ?? null,
        to: canonical
      });
    }
  }

  extractedData.fieldContract = {
    ...(asObject(extractedData.fieldContract) || {}),
    version: FIELD_CONTRACT_VERSION,
    appliedAt: new Date().toISOString()
  };

  fieldProvenance.finalizeProvenanceEnvelope(extractedData);

  return extractedData;
}

module.exports = {
  FIELD_CONTRACT_VERSION,
  firstNonEmpty,
  readVendorName,
  readReferenceNumber,
  readGstin,
  readContractFields,
  applyFieldContractWrite
};
