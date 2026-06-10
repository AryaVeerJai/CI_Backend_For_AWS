const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const billingService = require('../services/billingService');
const razorpayService = require('../services/razorpayService');
const logger = require('../utils/logger');
const { clientErrorPayload } = require('../utils/httpErrors');

const router = express.Router();

// @route   GET /api/billing/plans/public
// @desc    Public MSME plan catalog and usage-pricing overview (no auth)
// @access  Public
router.get('/plans/public', async (req, res) => {
  try {
    const data = await billingService.buildPublicPricing();
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get public pricing plans error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

const requireMsmeBillingActor = [
  auth,
  auth.requireRole('msme'),
  auth.requireMSMEProfile
];

// @route   GET /api/billing/status
// @desc    Billing profile, quotes, and payment history (informational; MSME only)
// @access  Private (msme)
router.get('/status', requireMsmeBillingActor, async (req, res) => {
  try {
    const data = await billingService.buildBillingStatus({
      userId: req.user.userId,
      msmeId: req.user.msmeId,
      role: req.user.role
    });

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Get billing status error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/billing/quote
// @desc    Usage-based quote and available fixed plans
// @access  Private (msme)
router.get('/quote', requireMsmeBillingActor, async (req, res) => {
  try {
    const data = await billingService.buildBillingStatus({
      userId: req.user.userId,
      msmeId: req.user.msmeId,
      role: req.user.role
    });

    return res.json({
      success: true,
      data: {
        usageQuote: data.usageQuote,
        fixedPlans: data.fixedPlans,
        moduleEnabled: data.moduleEnabled,
        informationalOnly: data.informationalOnly
      }
    });
  } catch (error) {
    logger.error('Get billing quote error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/billing/checkout
// @desc    Create Razorpay order for usage-based or fixed plan payment (MSME payer only)
// @access  Private (msme)
router.post('/checkout', [
  ...requireMsmeBillingActor,
  body('pricingModel').optional().isIn(['usage_based', 'fixed_plan']),
  body('planId').optional().isString().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const pricingModel = req.body.pricingModel || 'usage_based';
    const data = await billingService.createCheckout({
      userId: req.user.userId,
      msmeId: req.user.msmeId,
      role: req.user.role,
      pricingModel,
      planId: req.body.planId
    });

    return res.json({
      success: true,
      message: data.informationalOnly
        ? 'Checkout created. Payments are informational and do not restrict platform access.'
        : 'Checkout created successfully',
      data
    });
  } catch (error) {
    logger.error('Billing checkout error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/billing/verify-payment
// @desc    Verify Razorpay payment signature after client checkout
// @access  Private (msme)
router.post('/verify-payment', [
  ...requireMsmeBillingActor,
  body('razorpay_order_id').isString().trim(),
  body('razorpay_payment_id').isString().trim(),
  body('razorpay_signature').isString().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const paymentRecord = await billingService.markPaymentPaid({
      orderId: req.body.razorpay_order_id,
      paymentId: req.body.razorpay_payment_id,
      signature: req.body.razorpay_signature
    });

    return res.json({
      success: true,
      message: 'Payment verified successfully',
      data: paymentRecord
    });
  } catch (error) {
    logger.error('Billing verify payment error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// Webhook router exported separately for raw body parsing in server.js
const webhookRouter = express.Router();

webhookRouter.post('/', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.body;

    if (!Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ success: false, message: 'Invalid webhook payload' });
    }

    if (!razorpayService.verifyWebhookSignature(rawBody, signature)) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    const result = await billingService.handleWebhookEvent(event);

    return res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Billing webhook error:', error);
    return res.status(500).json({
      success: false,
      message: 'Webhook processing failed'
    });
  }
});

module.exports = router;
module.exports.webhookRouter = webhookRouter;
