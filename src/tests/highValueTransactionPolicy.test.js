const {
  HIGH_VALUE_THRESHOLD_INR,
  HIGH_VALUE_BILL_UPLOAD_ENDPOINT,
  HIGH_VALUE_ELIGIBLE_CATEGORIES,
  HIGH_VALUE_WORKFLOWS,
  toFiniteNumber,
  isHighValueTransactionRequiringBill,
  buildHighValueUploadRequirement
} = require('../config/highValueTransactionPolicy');

describe('highValueTransactionPolicy', () => {
  describe('toFiniteNumber', () => {
    test('returns parsed number for numeric strings', () => {
      expect(toFiniteNumber('125000.5', 0)).toBe(125000.5);
    });

    test('returns fallback for non-numeric values', () => {
      expect(toFiniteNumber('not-a-number', 42)).toBe(42);
      expect(toFiniteNumber(undefined, 7)).toBe(7);
    });

    test('returns fallback for NaN and Infinity', () => {
      expect(toFiniteNumber(NaN, 1)).toBe(1);
      expect(toFiniteNumber(Infinity, 2)).toBe(2);
    });
  });

  describe('isHighValueTransactionRequiringBill', () => {
    test('should flag purchase transactions at or above threshold', () => {
      expect(
        isHighValueTransactionRequiringBill({
          amount: HIGH_VALUE_THRESHOLD_INR,
          transactionType: 'purchase'
        })
      ).toBe(true);

      expect(
        isHighValueTransactionRequiringBill({
          amount: HIGH_VALUE_THRESHOLD_INR + 1,
          transactionType: 'purchase'
        })
      ).toBe(true);
    });

    test('should not flag transactions below threshold', () => {
      expect(
        isHighValueTransactionRequiringBill({
          amount: HIGH_VALUE_THRESHOLD_INR - 1,
          transactionType: 'purchase'
        })
      ).toBe(false);

      expect(
        isHighValueTransactionRequiringBill({
          amount: 0,
          category: 'energy',
          transactionType: 'expense'
        })
      ).toBe(false);
    });

    test('should flag each eligible emission category above threshold', () => {
      for (const category of HIGH_VALUE_ELIGIBLE_CATEGORIES) {
        expect(
          isHighValueTransactionRequiringBill({
            amount: HIGH_VALUE_THRESHOLD_INR,
            category
          })
        ).toBe(true);
      }
    });

    test('should match categories case-insensitively', () => {
      expect(
        isHighValueTransactionRequiringBill({
          amount: HIGH_VALUE_THRESHOLD_INR,
          category: 'ENERGY'
        })
      ).toBe(true);
    });

    test.each(['purchase', 'expense', 'utility', 'transport'])(
      'should flag high-value %s transaction types without eligible category',
      (transactionType) => {
        expect(
          isHighValueTransactionRequiringBill({
            amount: HIGH_VALUE_THRESHOLD_INR,
            category: 'other',
            transactionType
          })
        ).toBe(true);
      }
    );

    test.each(['purchase', 'expense', 'utility', 'transport'])(
      'should match %s transaction type case-insensitively',
      (transactionType) => {
        expect(
          isHighValueTransactionRequiringBill({
            amount: HIGH_VALUE_THRESHOLD_INR,
            transactionType: transactionType.toUpperCase()
          })
        ).toBe(true);
      }
    );

    test('should not flag high amounts with ineligible category and type', () => {
      expect(
        isHighValueTransactionRequiringBill({
          amount: HIGH_VALUE_THRESHOLD_INR + 50000,
          category: 'income',
          transactionType: 'credit'
        })
      ).toBe(false);
    });

    test('should treat invalid amounts as zero', () => {
      expect(
        isHighValueTransactionRequiringBill({
          amount: 'invalid',
          category: 'energy'
        })
      ).toBe(false);
    });
  });

  describe('buildHighValueUploadRequirement', () => {
    const sampleTransaction = {
      sourceId: 'acct-001',
      amount: 500000,
      category: 'equipment',
      subcategory: 'machinery',
      transactionType: 'purchase',
      description: 'CNC machine purchase',
      currency: 'INR',
      date: new Date('2026-05-01'),
      vendor: 'Acme Industrial'
    };

    test('should build accounting workflow upload requirement', () => {
      const requirement = buildHighValueUploadRequirement(
        sampleTransaction,
        'acct-001',
        HIGH_VALUE_WORKFLOWS.ACCOUNTING
      );

      expect(requirement.workflow).toBe('high_value_accounting');
      expect(requirement.thresholdInr).toBe(HIGH_VALUE_THRESHOLD_INR);
      expect(requirement.policyGuideline).toContain('GHG Protocol');
      expect(requirement.requiredUpload.endpoint).toBe(HIGH_VALUE_BILL_UPLOAD_ENDPOINT);
      expect(requirement.requiredUpload.method).toBe('POST');
      expect(requirement.requiredUpload.fileField).toBe('document');
      expect(requirement.requiredUpload.allowedMimeTypes).toEqual(['application/pdf']);
      expect(requirement.requiredUpload.requiredPayload.sourceWorkflow).toBe('high_value_accounting');
      expect(requirement.requiredUpload.requiredPayload.linkedSourceId).toBe('acct-001');
      expect(requirement.requiredUpload.requiredPayload.documentType).toBe('bill');
      expect(requirement.requiredUpload.requiredPayload.linkedMessageId).toBeUndefined();
      expect(requirement.transactionPreview.messageId).toBeNull();
      expect(requirement.transactionPreview.vendor).toBe('Acme Industrial');
      expect(requirement.agenticArchitecture.stages).toContain('carbon_analyzer');
    });

    test('should build SMS workflow with linked message id', () => {
      const requirement = buildHighValueUploadRequirement(
        { ...sampleTransaction, sourceId: 'sms-99' },
        'msg-abc-123',
        HIGH_VALUE_WORKFLOWS.SMS
      );

      expect(requirement.workflow).toBe('high_value_sms');
      expect(requirement.requiredUpload.requiredPayload.sourceWorkflow).toBe('high_value_sms');
      expect(requirement.requiredUpload.requiredPayload.linkedMessageId).toBe('msg-abc-123');
      expect(requirement.requiredUpload.requiredPayload.linkedSourceId).toBe('sms-99');
      expect(requirement.transactionPreview.messageId).toBe('msg-abc-123');
    });

    test('should apply defaults for missing transaction fields', () => {
      const requirement = buildHighValueUploadRequirement({}, 'fallback-id');

      expect(requirement.transactionPreview.sourceId).toBe('fallback-id');
      expect(requirement.transactionPreview.currency).toBe('INR');
      expect(requirement.transactionPreview.category).toBe('other');
      expect(requirement.transactionPreview.subcategory).toBe('general');
      expect(requirement.transactionPreview.transactionType).toBe('other');
      expect(requirement.transactionPreview.description).toBe('');
      expect(requirement.transactionPreview.amount).toBe(0);
      expect(requirement.requiredUpload.requiredPayload.linkedTransactionId).toBeNull();
    });

    test('should include import row index and linked transaction id when provided', () => {
      const requirement = buildHighValueUploadRequirement(
        {
          sourceId: 'row-7',
          importRowIndex: 7,
          _id: 'mongo-txn-id',
          amount: 300000
        },
        'row-7',
        HIGH_VALUE_WORKFLOWS.ACCOUNTING
      );

      expect(requirement.transactionPreview.importRowIndex).toBe(7);
      expect(requirement.requiredUpload.requiredPayload.linkedTransactionId).toBe('mongo-txn-id');
    });
  });
});
