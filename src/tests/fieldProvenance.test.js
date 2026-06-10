const fieldProvenance = require('../../../shared/fieldProvenance');
const fieldContract = require('../../../shared/fieldContract');
const { normalizeExtractedDataForSave } = require('../services/extractedDataNormalizationService');

describe('fieldProvenance v1', () => {
  test('recordReconcileWinner sets winner and value', () => {
    const data = {};
    fieldProvenance.recordReconcileWinner(data, 'gstin', {
      value: '27AABCU9603R1ZP',
      source: 'ai'
    });
    expect(data.fieldProvenance.fields.gstin.winner).toEqual({
      source: 'ai',
      stage: 'reconcile'
    });
    expect(data.fieldProvenance.fields.gstin.value).toBe('27AABCU9603R1ZP');
  });

  test('recordReconcileWinner does not overwrite existing winner', () => {
    const data = {};
    fieldProvenance.recordReconcileWinner(data, 'amount', { value: 100, source: 'ai' });
    fieldProvenance.recordReconcileWinner(data, 'amount', { value: 200, source: 'ocr' });
    expect(data.fieldProvenance.fields.amount.winner.source).toBe('ai');
    expect(data.fieldProvenance.fields.amount.value).toBe(200);
  });

  test('recordRecoveryFill sets winner when field was empty', () => {
    const data = {};
    fieldProvenance.recordRecoveryFill(data, 'referenceNumber', {
      value: 'INV-2026-77',
      source: 'ocr_text'
    });
    expect(data.fieldProvenance.fields.referenceNumber.winner).toEqual({
      source: 'ocr_text',
      stage: 'recovery'
    });
    expect(data.fieldProvenance.fields.referenceNumber.value).toBe('INV-2026-77');
  });

  test('recordHintRecoveryFill records ocr_hint source', () => {
    const data = {};
    fieldProvenance.recordHintRecoveryFill(data, 'amount', { value: 7500 });
    expect(data.fieldProvenance.fields.amount.winner).toEqual({
      source: 'ocr_hint',
      stage: 'recovery'
    });
    expect(data.fieldProvenance.fields.amount.value).toBe(7500);
  });

  test('recordMultiOcrRecoveryFill records multi_ocr source', () => {
    const data = {};
    fieldProvenance.recordMultiOcrRecoveryFill(data, 'gstin', { value: '27AABCU9603R1ZP' });
    expect(data.fieldProvenance.fields.gstin.winner).toEqual({
      source: 'multi_ocr',
      stage: 'recovery'
    });
    expect(data.fieldProvenance.fields.gstin.value).toBe('27AABCU9603R1ZP');
  });

  test('recordRecoveryFill appends modification when winner already exists', () => {
    const data = {};
    fieldProvenance.recordReconcileWinner(data, 'amount', { value: 100, source: 'ocr' });
    fieldProvenance.recordRecoveryFill(data, 'amount', { value: 250, source: 'ocr_text' });
    expect(data.fieldProvenance.fields.amount.winner.stage).toBe('reconcile');
    expect(data.fieldProvenance.fields.amount.modifications).toHaveLength(1);
    expect(data.fieldProvenance.fields.amount.modifications[0].stage).toBe('recovery');
    expect(data.fieldProvenance.fields.amount.value).toBe(250);
  });

  test('recordPassthroughWinners maps vendor and referenceNumber from AI shape', () => {
    const data = {};
    fieldProvenance.recordPassthroughWinners(data, {
      invoice_number: 'INV-1',
      seller_gstin: '27AABCU9603R1ZP',
      vendor: 'Acme Ltd',
      amount: 500,
      date: '2026-01-01'
    });
    expect(data.fieldProvenance.fields.referenceNumber.winner.stage).toBe('ai_only');
    expect(data.fieldProvenance.fields.gstin.value).toBe('27AABCU9603R1ZP');
    expect(data.fieldProvenance.fields.vendor.value).toBe('Acme Ltd');
  });

  test('recordVendorNormalization appends modification and preserves reconcile winner', () => {
    const data = { vendor: { name: 'ACME LTD', rawName: 'ACME LTD' } };
    fieldProvenance.recordReconcileWinner(data, 'vendorName', {
      value: 'ACME LTD',
      source: 'ocr'
    });
    fieldProvenance.recordVendorNormalization(data, {
      vendor: { name: 'Acme Ltd', rawName: 'ACME LTD' },
      meta: { original: 'ACME LTD', normalized: 'Acme Ltd', source: 'unchanged' }
    });
    expect(data.fieldProvenance.fields.vendor.winner).toEqual({
      source: 'ocr',
      stage: 'reconcile'
    });
    expect(data.fieldProvenance.fields.vendor.modifications).toHaveLength(1);
    expect(data.fieldProvenance.fields.vendor.modifications[0].stage).toBe('normalize_vendor');
  });

  test('applyFieldContractWrite records mirror modifications and envelope', () => {
    const data = {
      referenceNumber: 'REF-1',
      invoice_number: 'INV-OLD',
      seller_gstin: '27AABCU9603R1ZP',
      vendor: 'Vendor One'
    };
    fieldContract.applyFieldContractWrite(data);
    expect(data.fieldProvenance.version).toBe('1.0');
    expect(data.fieldProvenance.recordedAt).toBeTruthy();
    expect(data.fieldProvenance.fields.referenceNumber.modifications[0].stage).toBe('field_contract');
    expect(data.fieldProvenance.fields.referenceNumber.modifications[0].from).toBe('INV-OLD');
    expect(data.fieldProvenance.fields.referenceNumber.modifications[0].to).toBe('REF-1');
  });

  test('normalizeExtractedDataForSave integrates vendor and contract provenance', () => {
    const data = {
      vendor: { name: 'test vendor pvt ltd', rawName: 'test vendor pvt ltd' },
      referenceNumber: 'REF-1',
      gstin: '27AABCU9603R1ZP',
      amount: 1000,
      date: new Date('2026-06-01'),
      category: 'other',
      subcategory: 'general'
    };
    normalizeExtractedDataForSave(data);
    expect(data.fieldProvenance.version).toBe('1.0');
    expect(data.fieldProvenance.fields.vendor).toBeDefined();
    expect(data.fieldContract.version).toBe('1.0');
  });
});
