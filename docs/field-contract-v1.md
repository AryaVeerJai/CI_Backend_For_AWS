# Field Contract v1 (RC-4)

Single source of truth: **`shared/fieldContract.js`**

## Canonical persistence (`extractedData`)

| Field | Canonical path | Compatibility alias |
|-------|----------------|---------------------|
| Vendor | `vendor.name` | flat `vendor` string (read via helper) |
| Invoice number | `referenceNumber` | `invoice_number` |
| GSTIN (seller) | `gstin` | `seller_gstin`, `gst.seller_gstin` |

## Write boundary

`applyFieldContractWrite()` runs at the end of `extractedDataNormalizationService.normalizeExtractedDataForSave()` (all Mongo saves).

## Read boundary

- Backend duplicate detection: `readReferenceNumber`, `readVendorName`
- Automation: `fieldExtractor.extractAiSnapshot()` via `readContractFields()`

## Version marker

`extractedData.fieldContract.version` = `"1.0"` on new saves.

Existing documents without the marker continue to resolve via read helpers (no migration).
