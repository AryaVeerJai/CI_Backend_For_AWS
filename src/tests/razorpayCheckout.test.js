const crypto = require('crypto');
const razorpayService = require('../services/razorpayService');

describe('razorpayService standard checkout', () => {
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = '';
    process.env.RAZORPAY_KEY_SECRET = '';
    razorpayService.resetRazorpayClient();
  });

  it('rejects orders below minimum amount in paise', async () => {
    await expect(razorpayService.createOrderByPaise({
      amount: 50,
      currency: 'INR'
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns mock order when credentials are not configured', async () => {
    const result = await razorpayService.createOrderByPaise({
      amount: 10000,
      currency: 'INR',
      receipt: 'test_receipt'
    });

    expect(result.mock).toBe(true);
    expect(result.order.amount).toBe(10000);
    expect(result.order.currency).toBe('INR');
  });

  it('verifies payment signature when credentials are configured', () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'test_secret';
    const orderId = 'order_123';
    const paymentId = 'pay_456';
    const signature = crypto
      .createHmac('sha256', 'test_secret')
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    expect(razorpayService.verifyPaymentSignature({ orderId, paymentId, signature })).toBe(true);
    expect(razorpayService.verifyPaymentSignature({
      orderId,
      paymentId,
      signature: 'invalid'
    })).toBe(false);
  });
});
