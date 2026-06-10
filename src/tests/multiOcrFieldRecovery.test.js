const multiOcrFieldRecovery = require('../../../shared/multiOcrFieldRecovery');

describe('multiOcrFieldRecovery v1', () => {
  const gstinA = '27AABCU9603R1ZP';
  const gstinB = '29AAACI1195H1ZK';

  test('rankFieldCandidates prefers cross-engine agreement', () => {
    const ranked = multiOcrFieldRecovery.rankFieldCandidates([
      { value: gstinA, engine: 'pdf_native_text', normalizedKey: gstinA },
      { value: gstinA, engine: 'pdf_ocr_tesseract', normalizedKey: gstinA },
      { value: gstinB, engine: 'backend_primary_ocr', normalizedKey: gstinB }
    ], 'gstin');

    expect(ranked.value).toBe(gstinA);
    expect(ranked.agreement).toBe(2);
    expect(ranked.engines).toEqual(expect.arrayContaining(['pdf_native_text', 'pdf_ocr_tesseract']));
  });

  test('rankFieldCandidates uses engine priority when only single-engine hits exist', () => {
    const ranked = multiOcrFieldRecovery.rankFieldCandidates([
      { value: gstinB, engine: 'ai_model_multi_ocr', normalizedKey: gstinB },
      { value: gstinA, engine: 'pdf_native_text', normalizedKey: gstinA }
    ], 'gstin');

    expect(ranked.value).toBe(gstinA);
    expect(ranked.agreement).toBe(1);
    expect(ranked.engines).toEqual(['pdf_native_text']);
  });

  test('pickMultiOcrFieldWinners collects and ranks per field', () => {
    const winners = multiOcrFieldRecovery.pickMultiOcrFieldWinners(
      [
        {
          engine: 'pdf_native_text',
          text: `GSTIN ${gstinA}\nInvoice No: INV-MULTI-1\nInvoice Date: 12/02/2026\nGrand Total: INR 7500.00`
        },
        {
          engine: 'pdf_ocr_tesseract',
          text: `GSTIN ${gstinA}\nInvoice No: INV-MULTI-1\nInvoice Date: 12/02/2026\nTotal Amount: INR 7500.00`
        }
      ],
      {
        extractGstin: (text) => (text.includes(gstinA) ? gstinA : null),
        extractReferenceNumber: (text) => (text.includes('INV-MULTI-1') ? 'INV-MULTI-1' : null),
        extractDate: (text) => (text.includes('12/02/2026') ? '12/02/2026' : null),
        extractAmount: (text) => (text.includes('7500') ? 7500 : null)
      },
      { parseDocumentDate: (value) => new Date('2026-02-12T00:00:00.000Z') }
    );

    expect(winners.gstin.value).toBe(gstinA);
    expect(winners.gstin.agreement).toBe(2);
    expect(winners.referenceNumber.value).toBe('INV-MULTI-1');
    expect(winners.amount.value).toBe(7500);
  });
});
