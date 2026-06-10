const duplicateDetectionService = require('../services/duplicateDetectionService');

describe('DuplicateDetectionService - cross channel detection', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    duplicateDetectionService.recentTransactionsCache.clear();
  });

  test('should detect strong cross-channel duplicate outside same-channel window', async () => {
    const smsTransaction = {
      source: 'sms',
      sourceId: 'sms-123',
      amount: 2500,
      description: 'Payment to ABC Stationery Invoice INV9001',
      vendor: { name: 'ABC Stationery', category: 'office' },
      category: 'raw_materials',
      date: new Date('2026-01-01T10:00:00.000Z')
    };

    const documentTransaction = {
      source: 'manual',
      sourceId: 'doc-100',
      amount: 2500,
      description: 'Payment to ABC Stationery Invoice INV9001',
      vendor: { name: 'ABC Stationery', category: 'office' },
      category: 'raw_materials',
      date: new Date('2026-01-05T11:00:00.000Z'),
      metadata: {
        extractedData: {
          referenceNumber: 'INV-9001'
        }
      }
    };

    jest.spyOn(duplicateDetectionService, 'getRecentTransactions')
      .mockImplementation(async (_msmeId, _date, windowMs) => {
        if (windowMs === duplicateDetectionService.duplicateWindowMs) {
          return [];
        }
        return [documentTransaction];
      });
    jest.spyOn(duplicateDetectionService, 'cacheTransaction').mockImplementation(() => {});

    const detection = await duplicateDetectionService.detectDuplicate(smsTransaction, 'msme-123');

    expect(detection.isDuplicate).toBe(true);
    expect(['exact', 'near', 'fuzzy']).toContain(detection.duplicateType);
    expect(detection.similarityScore).toBeGreaterThanOrEqual(0.76);
    expect(detection.reasons.join(' ')).toMatch(/cross-channel/i);
  });

  test('should ignore weak cross-channel similarity to prevent false positives', async () => {
    const smsTransaction = {
      source: 'sms',
      sourceId: 'sms-220',
      amount: 1500,
      description: 'Office snacks purchase',
      vendor: { name: 'Cafe One', category: 'food' },
      category: 'other',
      date: new Date('2026-01-01T10:00:00.000Z')
    };

    const documentTransaction = {
      source: 'manual',
      sourceId: 'doc-220',
      amount: 1500,
      description: 'Quarterly audit fee',
      vendor: { name: 'Audit Partners LLP', category: 'services' },
      category: 'other',
      date: new Date('2026-01-20T10:00:00.000Z')
    };

    jest.spyOn(duplicateDetectionService, 'getRecentTransactions')
      .mockImplementation(async (_msmeId, _date, windowMs) => {
        if (windowMs === duplicateDetectionService.duplicateWindowMs) {
          return [];
        }
        return [documentTransaction];
      });
    jest.spyOn(duplicateDetectionService, 'cacheTransaction').mockImplementation(() => {});

    const detection = await duplicateDetectionService.detectDuplicate(smsTransaction, 'msme-220');

    expect(detection.isDuplicate).toBe(false);
    expect(detection.duplicateType).toBeNull();
    expect(detection.reasons).toHaveLength(0);
  });
});
