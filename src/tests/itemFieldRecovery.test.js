const itemCorrectionPolicy = require('../../../shared/itemCorrectionPolicy');
const itemFieldRecovery = require('../../../shared/itemFieldRecovery');

describe('itemFieldRecovery v1', () => {
  test('agreement ranking prefers cross-engine matches', () => {
    const candidates = itemFieldRecovery.collectItemCandidates([
      {
        engine: 'pdf_native_text',
        items: [{ name: 'Copper Wire', quantity: 2, price: 50, total: 100 }]
      },
      {
        engine: 'pdf_ocr_tesseract',
        items: [{ name: 'Copper Wire', quantity: 2, price: 50, total: 100 }]
      },
      {
        engine: 'backend_primary_ocr',
        items: [{ name: 'Copper Wire', quantity: 2, price: 75, total: 150 }]
      }
    ]);

    const ranked = itemFieldRecovery.rankItemCandidates(candidates);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].agreement).toBe(2);
    expect(ranked[0].item.total).toBe(100);
    expect(ranked[0].engines).toEqual(expect.arrayContaining(['pdf_native_text', 'pdf_ocr_tesseract']));
  });

  test('engine priority tie-break when agreement is equal', () => {
    const ranked = itemFieldRecovery.rankItemCandidates([
      {
        action: itemCorrectionPolicy.CORRECTION_ACTION.ADMIT,
        engine: 'ai_model_multi_ocr',
        normalizedKey: 'panel mount::1200',
        item: { name: 'Panel Mount', quantity: 1, price: 1200, total: 1200 },
        scores: { math: 1, name: 0.6, grandTotalBand: 0.5, enginePriority: 0.25 },
        rankingScore: 0.5
      },
      {
        action: itemCorrectionPolicy.CORRECTION_ACTION.ADMIT,
        engine: 'pdf_native_text',
        normalizedKey: 'panel mount::1200',
        item: { name: 'Panel Mount', quantity: 1, price: 1200, total: 1200 },
        scores: { math: 1, name: 0.6, grandTotalBand: 0.5, enginePriority: 1 },
        rankingScore: 0.7
      }
    ]);

    expect(ranked[0].engines).toContain('pdf_native_text');
    expect(ranked[0].prioritySum).toBeGreaterThan(
      itemCorrectionPolicy.ITEM_ENGINE_PRIORITY.ai_model_multi_ocr
    );
  });

  test('merge duplicate items combines engines for identical line keys', () => {
    const collected = itemFieldRecovery.collectItemCandidates([
      {
        engine: 'backend_primary_ocr',
        items: [{ name: 'Solar Panel Module', quantity: 1, price: 500, total: 500 }]
      },
      {
        engine: 'image_ocr_secondary',
        items: [{ name: 'Solar Panel Module', quantity: 1, price: 500, total: 500 }]
      }
    ]);

    const merged = itemFieldRecovery.mergeDuplicateItems(collected);
    expect(merged).toHaveLength(1);
    expect(merged[0].action).toBe(itemCorrectionPolicy.CORRECTION_ACTION.MERGE);
    expect(merged[0].engines).toHaveLength(2);
    expect(merged[0].item.name).toBe('Solar Panel Module');
  });

  test('defer ambiguous candidates when engines disagree on total', () => {
    const pick = itemFieldRecovery.pickItemWinners(
      itemFieldRecovery.collectItemCandidates([
        {
          engine: 'pdf_native_text',
          items: [{ name: 'Hydraulic Pump', quantity: 1, price: 1000, total: 1000 }]
        },
        {
          engine: 'pdf_ocr_tesseract',
          items: [{ name: 'Hydraulic Pump', quantity: 1, price: 1200, total: 1200 }]
        }
      ])
    );

    expect(pick.deferred.length).toBeGreaterThanOrEqual(1);
    expect(pick.deferred[0].action).toBe(itemCorrectionPolicy.CORRECTION_ACTION.DEFER);
    expect(pick.deferred[0].reason).toBe('ambiguous_cross_engine_totals');
    expect(pick.winners).toHaveLength(0);
  });

  test('processItemCandidates returns winners for coherent single-engine rows', () => {
    const result = itemFieldRecovery.processItemCandidates([
      {
        engine: 'backend_primary_ocr',
        items: [{ name: 'Office Chair', quantity: 2, price: 150 }]
      }
    ]);

    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].item.total).toBe(300);
    expect(result.winners[0].action).toBe(itemCorrectionPolicy.CORRECTION_ACTION.DERIVE);
  });
});
