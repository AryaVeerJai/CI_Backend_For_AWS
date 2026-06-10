const request = require('supertest');
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');

jest.mock('../middleware/auth', () => {
  const middleware = (req, res, next) => {
    const role = req.headers['x-test-role'] || 'msme';
    req.user = {
      role,
      msmeId: req.headers['x-test-msme-id'] || '507f1f77bcf86cd799439012',
      userId: '507f1f77bcf86cd799439011',
      email: 'msme@test.com'
    };
    next();
  };
  const allow = (req, res, next) => next();
  middleware.requireRole = () => allow;
  middleware.requireMSMEProfile = allow;
  middleware.requireOrganizationProfile = allow;
  middleware.requireOperationalProfile = allow;
  middleware.requireEnterpriseProfile = allow;
  return middleware;
});

const app = require('../server');
const spamDetectionService = require('../services/spamDetectionService');
const duplicateDetectionService = require('../services/duplicateDetectionService');

describe('Spam and Duplicate Detection', () => {
  let authToken;
  let msmeId;

  beforeAll(async () => {
    // Setup test data
    // This would typically involve creating a test user and MSME
    // For now, we'll mock the authentication
    authToken = 'test-token';
    msmeId = new mongoose.Types.ObjectId();
  });

  beforeEach(async () => {
    // Clean up test data
    await Transaction.deleteMany({});
  });

  describe('Spam Detection', () => {
    test('should detect spam transaction with suspicious keywords', async () => {
      const spamTransaction = {
        msmeId,
        source: 'sms',
        sourceId: 'test-123',
        transactionType: 'purchase',
        amount: 1000,
        currency: 'INR',
        description: 'URGENT! Act now! Free money guaranteed!',
        vendor: {
          name: 'Spam Vendor',
          category: 'other'
        },
        category: 'other',
        date: new Date()
      };

      const detection = spamDetectionService.detectSpam(spamTransaction, {
        sender: 'spam@suspicious.com',
        subject: 'URGENT OFFER!',
        body: 'URGENT! Act now! Free money guaranteed!'
      });

      expect(detection.isSpam).toBe(true);
      expect(detection.score).toBeGreaterThan(10);
      expect(detection.reasons.some((reason) => /spam keywords/i.test(reason))).toBe(true);
    });

    test('should not detect legitimate transaction as spam', async () => {
      const legitimateTransaction = {
        msmeId,
        source: 'sms',
        sourceId: 'test-124',
        transactionType: 'purchase',
        amount: 500,
        currency: 'INR',
        description: 'Payment for office supplies from ABC Stationery',
        vendor: {
          name: 'ABC Stationery',
          category: 'office'
        },
        category: 'raw_materials',
        date: new Date()
      };

      const detection = spamDetectionService.detectSpam(legitimateTransaction, {
        sender: 'billing@abcstationery.com',
        subject: 'Invoice #12345',
        body: 'Payment for office supplies from ABC Stationery'
      });

      expect(detection.isSpam).toBe(false);
      expect(detection.score).toBeLessThan(10);
    });

    test('should detect spam based on suspicious sender patterns', async () => {
      const transaction = {
        msmeId,
        source: 'email',
        sourceId: 'test-125',
        transactionType: 'purchase',
        amount: 200,
        currency: 'INR',
        description: 'Regular transaction',
        vendor: {
          name: 'Regular Vendor',
          category: 'other'
        },
        category: 'other',
        date: new Date()
      };

      const detection = spamDetectionService.detectSpam(transaction, {
        sender: 'spam@promo-marketing.com',
        subject: 'Transaction',
        body: 'Regular transaction'
      });

      expect(detection.score).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Duplicate Detection', () => {
    test('should detect exact duplicate within 10 seconds', async () => {
      const now = new Date();
      const transaction1 = {
        msmeId,
        source: 'sms',
        sourceId: 'test-126',
        transactionType: 'purchase',
        amount: 1000,
        currency: 'INR',
        description: 'Payment for office supplies',
        vendor: {
          name: 'ABC Stationery',
          category: 'office'
        },
        category: 'raw_materials',
        date: now
      };

      const transaction2 = {
        msmeId,
        source: 'sms',
        sourceId: 'test-127',
        transactionType: 'purchase',
        amount: 1000,
        currency: 'INR',
        description: 'Payment for office supplies',
        vendor: {
          name: 'ABC Stationery',
          category: 'office'
        },
        category: 'raw_materials',
        date: new Date(now.getTime() + 5000) // 5 seconds later
      };

      // Save first transaction
      const savedTransaction1 = new Transaction(transaction1);
      await savedTransaction1.save();

      // Detect duplicate for second transaction
      const detection = await duplicateDetectionService.detectDuplicate(transaction2, msmeId);

      expect(detection.isDuplicate).toBe(true);
      expect(detection.duplicateType).toBe('exact');
      expect(detection.similarityScore).toBe(1.0);
    });

    test('should detect near duplicate with high similarity', async () => {
      const now = new Date();
      const transaction1 = {
        msmeId,
        source: 'sms',
        sourceId: 'test-128',
        transactionType: 'purchase',
        amount: 1000,
        currency: 'INR',
        description: 'Payment for office supplies from ABC Stationery',
        vendor: {
          name: 'ABC Stationery',
          category: 'office'
        },
        category: 'raw_materials',
        date: now
      };

      const transaction2 = {
        msmeId,
        source: 'sms',
        sourceId: 'test-129',
        transactionType: 'purchase',
        amount: 1000,
        currency: 'INR',
        description: 'Payment for office supplies ABC Stationery',
        vendor: {
          name: 'ABC Stationery',
          category: 'office'
        },
        category: 'raw_materials',
        date: new Date(now.getTime() + 5000) // 5 seconds later
      };

      // Save first transaction
      const savedTransaction1 = new Transaction(transaction1);
      await savedTransaction1.save();

      // Detect duplicate for second transaction
      const detection = await duplicateDetectionService.detectDuplicate(transaction2, msmeId);

      expect(detection.isDuplicate).toBe(true);
      expect(detection.duplicateType).toBe('near');
      expect(detection.similarityScore).toBeGreaterThan(0.85);
    });

    test('should not detect duplicate for different transactions', async () => {
      const now = new Date();
      const transaction1 = {
        msmeId,
        source: 'sms',
        sourceId: 'test-130',
        transactionType: 'purchase',
        amount: 1000,
        currency: 'INR',
        description: 'Payment for office supplies',
        vendor: {
          name: 'ABC Stationery',
          category: 'office'
        },
        category: 'raw_materials',
        date: now
      };

      const transaction2 = {
        msmeId,
        source: 'sms',
        sourceId: 'test-131',
        transactionType: 'purchase',
        amount: 2000,
        currency: 'INR',
        description: 'Payment for equipment',
        vendor: {
          name: 'XYZ Equipment',
          category: 'equipment'
        },
        category: 'equipment',
        date: new Date(now.getTime() + 5000) // 5 seconds later
      };

      // Save first transaction
      const savedTransaction1 = new Transaction(transaction1);
      await savedTransaction1.save();

      // Detect duplicate for second transaction
      const detection = await duplicateDetectionService.detectDuplicate(transaction2, msmeId);

      expect(detection.isDuplicate).toBe(false);
      expect(detection.similarityScore).toBeLessThan(0.7);
    });

    test('should not detect duplicate outside time window', async () => {
      const now = new Date();
      const transaction1 = {
        msmeId,
        source: 'sms',
        sourceId: 'test-132',
        transactionType: 'purchase',
        amount: 1000,
        currency: 'INR',
        description: 'Payment for office supplies',
        vendor: {
          name: 'ABC Stationery',
          category: 'office'
        },
        category: 'raw_materials',
        date: now
      };

      const transaction2 = {
        msmeId,
        source: 'sms',
        sourceId: 'test-133',
        transactionType: 'purchase',
        amount: 1000,
        currency: 'INR',
        description: 'Payment for office supplies',
        vendor: {
          name: 'ABC Stationery',
          category: 'office'
        },
        category: 'raw_materials',
        date: new Date(now.getTime() + 15000) // 15 seconds later (outside window)
      };

      // Save first transaction
      const savedTransaction1 = new Transaction(transaction1);
      await savedTransaction1.save();

      // Detect duplicate for second transaction
      const detection = await duplicateDetectionService.detectDuplicate(transaction2, msmeId);

      expect(detection.isDuplicate).toBe(false);
    });
  });

  describe('Integration with Transaction Processing', () => {
    let detectDuplicateSpy;

    beforeEach(() => {
      detectDuplicateSpy = jest.spyOn(duplicateDetectionService, 'detectDuplicate');
    });

    afterEach(() => {
      detectDuplicateSpy.mockRestore();
    });

    test('should skip spam transaction in SMS processing', async () => {
      const response = await request(app)
        .post('/api/sms/process')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          body: 'URGENT! Act now! Free money guaranteed!',
          sender: 'spam@suspicious.com',
          timestamp: new Date().toISOString(),
          messageId: 'test-spam-001'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.skipped).toBe(true);
      expect(response.body.data.spam).toBe(true);
    });

    test('should skip duplicate transaction in SMS processing', async () => {
      detectDuplicateSpy
        .mockResolvedValueOnce({
          isDuplicate: false,
          duplicateType: null,
          similarityScore: 0,
          reasons: []
        })
        .mockResolvedValueOnce({
          isDuplicate: true,
          duplicateType: 'exact',
          similarityScore: 1,
          reasons: ['Exact match found'],
          matchedTransaction: { _id: new mongoose.Types.ObjectId() }
        });

      // First transaction
      const firstResponse = await request(app)
        .post('/api/sms/process')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          body: 'Payment for office supplies from ABC Stationery',
          sender: 'billing@abcstationery.com',
          timestamp: new Date().toISOString(),
          messageId: 'test-dup-001'
        });

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.body.success).toBe(true);
      expect(firstResponse.body.data.skipped).not.toBe(true);

      // Second transaction (duplicate)
      const secondResponse = await request(app)
        .post('/api/sms/process')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          body: 'Payment for office supplies from ABC Stationery',
          sender: 'billing@abcstationery.com',
          timestamp: new Date(Date.now() + 5000).toISOString(), // 5 seconds later
          messageId: 'test-dup-002'
        });

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body.success).toBe(true);
      expect(secondResponse.body.data.skipped).toBe(true);
      expect(secondResponse.body.data.duplicate).toBe(true);
    });

    test('should process legitimate transaction normally', async () => {
      detectDuplicateSpy.mockResolvedValue({
        isDuplicate: false,
        duplicateType: null,
        similarityScore: 0,
        reasons: []
      });

      const response = await request(app)
        .post('/api/sms/process')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          body: 'Rs. 450 paid to ABC Stationery for office supplies.',
          sender: 'billing@abcstationery.com',
          timestamp: new Date().toISOString(),
          messageId: 'test-legit-001'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(
        response.body.data.skipped === false
        || response.body.data.actionRequired === true
        || Boolean(response.body.data.transaction)
      ).toBe(true);
    });
  });

  describe('Admin Endpoints', () => {
    test('should get spam transactions', async () => {
      // Create a spam transaction
      const spamTransaction = new Transaction({
        msmeId,
        source: 'sms',
        sourceId: 'test-spam-admin-001',
        transactionType: 'purchase',
        amount: 1000,
        currency: 'INR',
        description: 'URGENT! Act now!',
        vendor: { name: 'Spam Vendor', category: 'other' },
        category: 'other',
        date: new Date(),
        isSpam: true,
        spamScore: 15,
        spamReasons: ['Contains spam keywords: urgent, act now'],
        spamConfidence: 0.9
      });
      await spamTransaction.save();

      const response = await request(app)
        .get('/api/admin/spam-transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-test-role', 'admin');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.transactions).toHaveLength(1);
      expect(response.body.data.transactions[0].isSpam).toBe(true);
    });

    test('should get duplicate transactions', async () => {
      // Create a duplicate transaction
      const duplicateTransaction = new Transaction({
        msmeId,
        source: 'sms',
        sourceId: 'test-dup-admin-001',
        transactionType: 'purchase',
        amount: 1000,
        currency: 'INR',
        description: 'Payment for office supplies',
        vendor: { name: 'ABC Stationery', category: 'office' },
        category: 'raw_materials',
        date: new Date(),
        isDuplicate: true,
        duplicateType: 'exact',
        similarityScore: 1.0,
        duplicateReasons: ['Exact match found']
      });
      await duplicateTransaction.save();

      const response = await request(app)
        .get('/api/admin/duplicate-transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-test-role', 'admin');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.transactions).toHaveLength(1);
      expect(response.body.data.transactions[0].isDuplicate).toBe(true);
    });

    test('should restore a spam transaction', async () => {
      // Create a spam transaction
      const spamTransaction = new Transaction({
        msmeId,
        source: 'sms',
        sourceId: 'test-restore-001',
        transactionType: 'purchase',
        amount: 1000,
        currency: 'INR',
        description: 'URGENT! Act now!',
        vendor: { name: 'Spam Vendor', category: 'other' },
        category: 'other',
        date: new Date(),
        isSpam: true,
        spamScore: 15,
        spamReasons: ['Contains spam keywords'],
        spamConfidence: 0.9
      });
      await spamTransaction.save();

      const response = await request(app)
        .put(`/api/admin/transactions/${spamTransaction._id}/restore`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-test-role', 'admin');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.isSpam).toBe(false);
      expect(response.body.data.isDuplicate).toBe(false);
    });
  });
});