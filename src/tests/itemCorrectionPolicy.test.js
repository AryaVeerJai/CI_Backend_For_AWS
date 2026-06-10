const itemCorrectionPolicy = require('../../../shared/itemCorrectionPolicy');

describe('itemCorrectionPolicy v1', () => {
  test('derive total from qty × price', () => {
    const derived = itemCorrectionPolicy.deriveMissingNumericFields({
      quantity: 4,
      price: 250,
      total: null
    });

    expect(derived.derivedFields).toEqual(['total']);
    expect(derived.fields.total).toBe(1000);
    expect(derived.ambiguous).toBe(false);
  });

  test('derive price from total ÷ qty', () => {
    const derived = itemCorrectionPolicy.deriveMissingNumericFields({
      quantity: 5,
      price: null,
      total: 500
    });

    expect(derived.derivedFields).toEqual(['price']);
    expect(derived.fields.price).toBe(100);
  });

  test('derive qty from total ÷ price', () => {
    const derived = itemCorrectionPolicy.deriveMissingNumericFields({
      quantity: null,
      price: 50,
      total: 200
    });

    expect(derived.derivedFields).toEqual(['quantity']);
    expect(derived.fields.quantity).toBe(4);
  });

  test('summary row drop', () => {
    const result = itemCorrectionPolicy.evaluateCandidate({
      name: 'Grand Total',
      quantity: 1,
      price: 5000,
      total: 5000
    });

    expect(result.action).toBe(itemCorrectionPolicy.CORRECTION_ACTION.DROP);
    expect(result.reason).toBe('summary_row');
    expect(result.item).toBeNull();
  });

  test('evaluateCandidate DERIVE applies derived total', () => {
    const result = itemCorrectionPolicy.evaluateCandidate({
      name: 'Widget Assembly',
      quantity: 2,
      price: 150
    });

    expect(result.action).toBe(itemCorrectionPolicy.CORRECTION_ACTION.DERIVE);
    expect(result.item.total).toBe(300);
    expect(result.derivedFields).toEqual(['total']);
  });

  test('evaluateCandidate ADMIT keeps coherent rows', () => {
    const result = itemCorrectionPolicy.evaluateCandidate({
      name: 'Steel Brackets',
      quantity: 3,
      price: 100,
      total: 300
    });

    expect(result.action).toBe(itemCorrectionPolicy.CORRECTION_ACTION.ADMIT);
    expect(result.item.total).toBe(300);
  });

  test('evaluateCandidate DEFER when only total is present', () => {
    const result = itemCorrectionPolicy.evaluateCandidate({
      name: 'Mystery Line',
      total: 999
    });

    expect(result.action).toBe(itemCorrectionPolicy.CORRECTION_ACTION.DEFER);
    expect(result.reason).toBe('ambiguous_numeric_fields');
  });

  test('mergeItemRecords prefers higher engine priority', () => {
    const merged = itemCorrectionPolicy.mergeItemRecords(
      {
        engine: 'ai_model_multi_ocr',
        item: { name: 'Cable', quantity: 1, price: 10, total: 10 }
      },
      {
        engine: 'pdf_native_text',
        item: { name: 'Cable Harness', quantity: 1, price: 10, total: 10 }
      }
    );

    expect(merged.action).toBe(itemCorrectionPolicy.CORRECTION_ACTION.MERGE);
    expect(merged.item.name).toBe('Cable Harness');
    expect(merged.engines).toEqual(expect.arrayContaining(['pdf_native_text', 'ai_model_multi_ocr']));
  });
});
