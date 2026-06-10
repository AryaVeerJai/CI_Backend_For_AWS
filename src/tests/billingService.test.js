const billingService = require('../services/billingService');
const razorpayService = require('../services/razorpayService');

jest.mock('../models/BillingModuleConfig');
jest.mock('../models/UserBillingProfile');
jest.mock('../models/BillingPayment');
jest.mock('../services/msmePaymentQuoteService');

const BillingModuleConfig = require('../models/BillingModuleConfig');
const UserBillingProfile = require('../models/UserBillingProfile');
const BillingPayment = require('../models/BillingPayment');
const { getMsmePaymentQuote } = require('../services/msmePaymentQuoteService');

describe('billingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAZORPAY_KEY_ID = '';
    process.env.RAZORPAY_KEY_SECRET = '';
    razorpayService.resetRazorpayClient();
  });

  it('marks view role as billing not applicable', async () => {
    const status = await billingService.buildBillingStatus({
      userId: 'user-1',
      msmeId: 'msme-1',
      role: 'view'
    });

    expect(status.billingApplicable).toBe(false);
    expect(status.message).toMatch(/only available for MSME/i);
    expect(UserBillingProfile.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each(['partner', 'enterprise'])('marks %s role as billing not applicable', async (role) => {
    const status = await billingService.buildBillingStatus({
      userId: 'user-1',
      msmeId: 'msme-1',
      role
    });

    expect(status.billingApplicable).toBe(false);
    expect(UserBillingProfile.findOneAndUpdate).not.toHaveBeenCalled();
    if (role === 'partner') {
      expect(status.message).toMatch(/contract invoicing/i);
    } else {
      expect(status.message).toMatch(/MSME accounts/i);
    }
  });

  it('sets msmeId only in $set when upserting billing profile (no path conflict)', async () => {
    BillingModuleConfig.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        moduleEnabled: true,
        informationalOnly: true,
        provider: 'razorpay',
        methods: {},
        fixedPlans: []
      })
    });
    UserBillingProfile.findOneAndUpdate = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ userId: 'user-1', msmeId: 'msme-1' })
    });
    UserBillingProfile.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ userId: 'user-1', msmeId: 'msme-1', status: 'pending' })
    });
    BillingPayment.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([])
        })
      })
    });
    getMsmePaymentQuote.mockResolvedValue(null);

    await billingService.buildBillingStatus({
      userId: 'user-1',
      msmeId: 'msme-1',
      role: 'msme'
    });

    expect(UserBillingProfile.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [, update] = UserBillingProfile.findOneAndUpdate.mock.calls[0];
    expect(update.$setOnInsert).toEqual({
      userId: 'user-1',
      informationalOnly: true
    });
    expect(update.$setOnInsert).not.toHaveProperty('msmeId');
    expect(update.$set).toEqual({ msmeId: 'msme-1' });
    expect(Object.keys(update.$setOnInsert).filter((key) => key in update.$set)).toHaveLength(0);
  });

  it('returns usage and fixed plan options for msme role', async () => {
    BillingModuleConfig.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        moduleEnabled: true,
        informationalOnly: true,
        provider: 'razorpay',
        methods: { upi: true, netBanking: false, cards: true },
        fixedPlans: [
          {
            planId: 'msme_starter_monthly',
            name: 'Starter',
            amountInr: 1999,
            interval: 'monthly',
            isActive: true
          }
        ]
      })
    });
    UserBillingProfile.findOneAndUpdate = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        userId: 'user-1',
        pricingModel: 'usage_based',
        status: 'none',
        informationalOnly: true
      })
    });
    UserBillingProfile.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        userId: 'user-1',
        pricingModel: 'usage_based',
        status: 'none'
      })
    });
    BillingPayment.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([])
        })
      })
    });
    getMsmePaymentQuote.mockResolvedValue({
      currency: 'INR',
      paymentAmount: 3200,
      breakdown: { baseAmount: 1500 }
    });

    const status = await billingService.buildBillingStatus({
      userId: 'user-1',
      msmeId: 'msme-1',
      role: 'msme'
    });

    expect(status.billingApplicable).toBe(true);
    expect(status.usageQuote.paymentAmount).toBe(3200);
    expect(status.fixedPlans.length).toBeGreaterThanOrEqual(1);
    expect(status.fixedPlans.some((plan) => plan.planId === 'msme_starter_monthly')).toBe(true);
    expect(status.informationalOnly).toBe(true);
  });

  it('returns public pricing catalog without user context', async () => {
    BillingModuleConfig.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        moduleEnabled: false,
        informationalOnly: true,
        provider: 'razorpay',
        methods: { upi: true, netBanking: false, cards: true },
        fixedPlans: [
          {
            planId: 'msme_starter_monthly',
            name: 'Starter',
            description: 'Core carbon workspace',
            amountInr: 1999,
            interval: 'monthly',
            isActive: true
          }
        ]
      })
    });

    const pricing = await billingService.buildPublicPricing();

    expect(pricing.currency).toBe('INR');
    expect(pricing.fixedPlans.length).toBeGreaterThanOrEqual(1);
    expect(pricing.fixedPlans.some((plan) => plan.planId === 'msme_starter_monthly')).toBe(true);
    expect(pricing.usagePricing.baseAmountInr).toBe(1500);
    expect(pricing.usagePricing.starterFloorInr).toBe(1999);
    expect(pricing.enterprisePricing).toBeDefined();
    expect(pricing.channelPricing).toBeDefined();
    expect(pricing.guidance.defaultPricingModel).toBe('fixed_plan');
    expect(pricing.informationalOnly).toBe(true);
  });

  it.each(['admin', 'partner', 'enterprise'])('rejects checkout for %s role', async (role) => {
    await expect(billingService.createCheckout({
      userId: `${role}-1`,
      msmeId: 'msme-1',
      role,
      pricingModel: 'usage_based'
    })).rejects.toMatchObject({
      statusCode: 403
    });
  });

  it('markPaymentPaid activates plan and paidUntil on profile', async () => {
    const paidAt = new Date('2026-05-01T00:00:00.000Z');
    const paymentRecord = {
      userId: 'user-1',
      msmeId: 'msme-1',
      pricingModel: 'fixed_plan',
      planId: 'msme_growth_monthly',
      planInterval: 'monthly',
      amount: 5999,
      status: 'pending',
      paidAt: null,
      save: jest.fn().mockResolvedValue(undefined)
    };

    BillingPayment.findOne = jest.fn().mockResolvedValue(paymentRecord);
    UserBillingProfile.findOneAndUpdate = jest.fn().mockResolvedValue({});

    await billingService.markPaymentPaid({
      orderId: 'order_123',
      paymentId: 'pay_456',
      signature: 'sig'
    });

    expect(UserBillingProfile.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          selectedPlanId: 'msme_growth_monthly',
          planInterval: 'monthly',
          status: 'paid',
          paidUntil: expect.any(Date)
        })
      }),
      { upsert: true }
    );
  });
});

describe('razorpayService', () => {
  it('verifies payment signature when credentials are configured', () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'test_secret';
    const crypto = require('crypto');
    const orderId = 'order_123';
    const paymentId = 'pay_456';
    const signature = crypto
      .createHmac('sha256', 'test_secret')
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    expect(razorpayService.verifyPaymentSignature({ orderId, paymentId, signature })).toBe(true);
  });
});
