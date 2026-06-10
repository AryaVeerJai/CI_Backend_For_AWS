const referenceRecovery = require('../../../shared/referenceRecovery');
const vendorRecovery = require('../../../shared/vendorRecovery');
const dateRecovery = require('../../../shared/dateRecovery');
const itemAccuracyRecovery = require('../../../shared/itemAccuracyRecovery');
const fieldProvenance = require('../../../shared/fieldProvenance');
const fieldContract = require('../../../shared/fieldContract');
const itemCorrectionPolicy = require('../../../shared/itemCorrectionPolicy');
const documentProcessingService = require('../services/documentProcessingService');

describe('RC-5F referenceRecovery', () => {
  test('extractReferenceFromText finds Bill No with OCR normalization', () => {
    const text = 'Blll No: INV-2026-77\nTotal 1000';
    expect(referenceRecovery.extractReferenceFromText(text)).toBe('INV-2026-77');
  });

  test('extractReferenceFromText finds Document No label', () => {
    const text = 'Docurnent No: DOC/445/26';
    expect(referenceRecovery.extractReferenceFromText(text)).toBe('DOC/445/26');
  });

  test('isValidReferenceNumber rejects label tokens', () => {
    expect(referenceRecovery.isValidReferenceNumber('number')).toBe(false);
    expect(referenceRecovery.isValidReferenceNumber('INV-9')).toBe(true);
  });
});

describe('RC-5F vendorRecovery', () => {
  test('extractVendorFromText prefers header company suffix', () => {
    const text = 'Invoice No: 100\nAcme Industries Pvt Ltd\nGSTIN 27AABCU9603R1ZP';
    const vendor = vendorRecovery.extractVendorFromText(text, {
      isInvalidVendorName: (name) => documentProcessingService.isInvalidVendorName(name)
    });
    expect(vendor).toMatch(/Acme Industries/i);
  });

  test('extractVendorFromText rejects metadata lines', () => {
    const text = 'Invoice Number: ABC-1\nTotal Amount: 500';
    const vendor = vendorRecovery.extractVendorFromText(text, {
      isInvalidVendorName: (name) => documentProcessingService.isInvalidVendorName(name)
    });
    expect(vendor).toBeNull();
  });
});

describe('RC-5F dateRecovery', () => {
  test('extractInvoiceDateFromText prefers invoice date over due date', () => {
    const text = 'Due Date: 15/03/2026\nInvoice Date: 01/02/2026';
    const parsed = dateRecovery.extractInvoiceDateFromText(
      text,
      (value) => documentProcessingService.parseInvoiceDateForRecovery(value)
    );
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.getMonth()).toBe(1);
    expect(parsed.getDate()).toBe(1);
  });
});

describe('RC-5F itemAccuracyRecovery', () => {
  test('cleanItemDescription removes header junk and collapses whitespace', () => {
    expect(itemAccuracyRecovery.cleanItemDescription('  Steel   Beam   ')).toBe('Steel Beam');
    expect(itemAccuracyRecovery.cleanItemDescription('Particulars')).toBe('');
  });

  test('mergeContinuationLines merges split descriptions', () => {
    const merged = itemAccuracyRecovery.mergeContinuationLines([
      { name: 'Premium Steel', total: 100, quantity: 1, price: 100 },
      { name: 'coated finish' }
    ]);
    expect(merged[0].name).toMatch(/Premium Steel coated finish/i);
    expect(merged).toHaveLength(1);
  });

  test('applyItemAccuracyEnhancements derives quantity from total and price', () => {
    const items = itemAccuracyRecovery.applyItemAccuracyEnhancements([
      { name: 'Cable roll', quantity: null, price: 50, total: 200 }
    ]);
    expect(items[0].quantity).toBe(4);
    expect(items[0].item_provenance.source).toBe('math_derived');
    expect(items[0].item_confidence).toBeGreaterThan(0);
  });

  test('applyItemAccuracyEnhancements does not overwrite valid description', () => {
    const items = itemAccuracyRecovery.applyItemAccuracyEnhancements([
      { name: 'Valid Product Name', description: 'Valid Product Name', total: 10, quantity: 1, price: 10 }
    ]);
    expect(items[0].name).toBe('Valid Product Name');
  });
});

describe('RC-5F documentProcessingService', () => {
  const previousAccuracy = process.env.ACCURACY_RECOVERY_ENABLED;
  const previousItem = process.env.ITEM_RECOVERY_ENABLED;

  beforeEach(() => {
    process.env.ACCURACY_RECOVERY_ENABLED = '1';
  });

  afterEach(() => {
    if (previousAccuracy === undefined) {
      delete process.env.ACCURACY_RECOVERY_ENABLED;
    } else {
      process.env.ACCURACY_RECOVERY_ENABLED = previousAccuracy;
    }
    if (previousItem === undefined) {
      delete process.env.ITEM_RECOVERY_ENABLED;
    } else {
      process.env.ITEM_RECOVERY_ENABLED = previousItem;
    }
  });

  test('applyReferenceRecoveryFill uses reference_recovery provenance', () => {
    const extractedData = { amount: 500 };
    const rawText = 'lnvoice Number: BILL-7788';
    const filled = documentProcessingService.applyReferenceRecoveryFill(extractedData, rawText);
    expect(filled).toBe(true);
    expect(extractedData.referenceNumber).toBe('BILL-7788');
    expect(extractedData.fieldProvenance.fields.referenceNumber.winner).toEqual({
      source: 'reference_recovery',
      stage: 'recovery'
    });
  });

  test('applyReferenceRecoveryFill does not overwrite valid reference', () => {
    const extractedData = {
      referenceNumber: 'KEEP-001',
      invoice_number: 'KEEP-001'
    };
    const filled = documentProcessingService.applyReferenceRecoveryFill(
      extractedData,
      'Invoice No: NEW-999'
    );
    expect(filled).toBe(false);
    expect(extractedData.referenceNumber).toBe('KEEP-001');
  });

  test('applyVendorRecoveryFill uses vendor_recovery provenance', () => {
    const extractedData = {};
    const rawText = 'Supplier: Horizon Logistics LLP\nInvoice No: 1';
    const filled = documentProcessingService.applyVendorRecoveryFill(extractedData, rawText);
    expect(filled).toBe(true);
    expect(extractedData.vendor.name).toMatch(/Horizon Logistics/i);
    expect(extractedData.fieldProvenance.fields.vendor.winner.source).toBe('vendor_recovery');
  });

  test('applyVendorRecoveryFill does not overwrite valid vendor', () => {
    const extractedData = { vendor: { name: 'Stable Vendor Co' } };
    const filled = documentProcessingService.applyVendorRecoveryFill(
      extractedData,
      'Vendor: Other Name Ltd'
    );
    expect(filled).toBe(false);
    expect(extractedData.vendor.name).toBe('Stable Vendor Co');
  });

  test('applyDateRecoveryFill uses date_recovery provenance', () => {
    const extractedData = { amount: 100 };
    const rawText = 'Due Date: 20/05/2026\nBill Date: 10/04/2026';
    const filled = documentProcessingService.applyDateRecoveryFill(extractedData, rawText);
    expect(filled).toBe(true);
    expect(extractedData.fieldProvenance.fields.date.winner.source).toBe('date_recovery');
    expect(extractedData.date.getMonth()).toBe(3);
  });

  test('applyDateRecoveryFill does not overwrite valid date', () => {
    const existing = new Date('2026-01-15');
    const extractedData = { date: existing };
    const filled = documentProcessingService.applyDateRecoveryFill(
      extractedData,
      'Invoice Date: 02/02/2026'
    );
    expect(filled).toBe(false);
    expect(extractedData.date).toBe(existing);
  });

  test('applyPostMergeRecovery orders date_recovery before upload_timestamp', () => {
    const extractedData = { amount: 900 };
    documentProcessingService.applyPostMergeRecovery(extractedData, {
      document: { createdAt: new Date('2026-06-01'), metadata: {} },
      rawText: 'Invoice Date: 03/03/2026\nTotal 900',
      extractionWarnings: []
    });
    expect(extractedData.fieldProvenance.fields.date.winner.source).toBe('date_recovery');
  });

  test('applyItemRecoveryFill attaches item_confidence and multi_ocr_item provenance', () => {
    process.env.ITEM_RECOVERY_ENABLED = '1';
    const extractedData = {
      amount: 200,
      items: [{ name: 'Widget', total: 200, quantity: 2, price: 100 }]
    };
    const engineText = 'Widget 2 100 200';
    documentProcessingService.applyItemRecoveryFill(extractedData, {
      multiOcrEngineTexts: [
        { engine: 'pdf_native_text', text: engineText },
        { engine: 'pdf_ocr_tesseract', text: engineText }
      ],
      rawText: engineText
    });
    expect(extractedData.items[0].item_confidence).toBeGreaterThan(0);
    expect(extractedData.items[0].item_provenance).toBeDefined();
  });

  test('gapFillItemFromWinner preserves valid quantity and derives missing price', () => {
    const existing = { name: 'Bolt set', quantity: 5, total: 100 };
    const winner = {
      item: { name: 'Bolt set', quantity: 9, price: 20, total: 100 },
      action: itemCorrectionPolicy.CORRECTION_ACTION.ADMIT,
      engine: 'ocr_text_heuristic'
    };
    const filled = documentProcessingService.gapFillItemFromWinner(existing, winner);
    expect(filled.price).toBe(20);
    expect(filled.quantity).toBe(5);
  });

  test('field provenance helpers record RC-5F recovery sources', () => {
    const data = {};
    fieldProvenance.recordReferenceRecoveryFill(data, 'referenceNumber', { value: 'INV-1' });
    fieldProvenance.recordVendorRecoveryFill(data, 'vendor', { value: 'Vendor A' });
    fieldProvenance.recordDateRecoveryFill(data, 'date', { value: new Date('2026-02-01') });
    expect(data.fieldProvenance.fields.referenceNumber.winner.source).toBe('reference_recovery');
    expect(data.fieldProvenance.fields.vendor.winner.source).toBe('vendor_recovery');
    expect(data.fieldProvenance.fields.date.winner.source).toBe('date_recovery');
  });

  test('applyReferenceRecoveryFill disabled when feature flag off', () => {
    process.env.ACCURACY_RECOVERY_ENABLED = '0';
    const extractedData = {};
    const filled = documentProcessingService.applyReferenceRecoveryFill(
      extractedData,
      'Invoice No: OFF-1'
    );
    expect(filled).toBe(false);
    expect(fieldContract.readReferenceNumber(extractedData)).toBeNull();
  });
});
