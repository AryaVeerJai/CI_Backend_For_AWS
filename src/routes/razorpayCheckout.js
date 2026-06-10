const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const razorpayService = require('../services/razorpayService');
const billingService = require('../services/billingService');
const logger = require('../utils/logger');
const { clientErrorPayload } = require('../utils/httpErrors');

const router = express.Router();

// @route   POST /api/create-order
// @desc    Create Razorpay order (Standard Web Checkout)
// @access  Private
router.post('/create-order', [
  auth,
  body('amount').optional().isInt({ min: razorpayService.MIN_AMOUNT_PAISE }).withMessage(
    `amount must be at least ${razorpayService.MIN_AMOUNT_PAISE} paise`
  ),
  body('currency').optional().isString().trim().isLength({ min: 3, max: 3 }),
  body('receipt').optional().isString().trim().isLength({ max: 40 }),
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

    const { amount, currency = 'INR', receipt, pricingModel, planId } = req.body;

    if (pricingModel) {
      const checkout = await billingService.createCheckout({
        userId: req.user.userId,
        msmeId: req.user.msmeId,
        role: req.user.role,
        pricingModel,
        planId
      });

      return res.json({
        success: true,
        order_id: checkout.order.id,
        amount: checkout.order.amount,
        currency: checkout.order.currency,
        key_id: checkout.razorpayKeyId || razorpayService.getPublicKeyId(),
        receipt: checkout.order.receipt,
        mock: checkout.mockCheckout === true,
        paymentId: checkout.paymentId
      });
    }

    const orderResult = await razorpayService.createOrderByPaise({
      amount,
      currency,
      receipt: receipt || `order_${req.user.userId}_${Date.now()}`
    });

    const order = orderResult.order;

    return res.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: razorpayService.getPublicKeyId(),
      receipt: order.receipt,
      mock: orderResult.mock === true
    });
  } catch (error) {
    logger.error('Create Razorpay order error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to create order',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/verify-payment
// @desc    Verify Razorpay payment signature (Standard Web Checkout)
// @access  Private
router.post('/verify-payment', [
  auth,
  body('razorpay_order_id').isString().trim().notEmpty(),
  body('razorpay_payment_id').isString().trim().notEmpty(),
  body('razorpay_signature').isString().trim().notEmpty()
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

    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature
    } = req.body;

    const isValid = razorpayService.verifyPaymentSignature({
      orderId,
      paymentId,
      signature
    });

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Payment signature verification failed'
      });
    }

    let billingRecord = null;
    try {
      billingRecord = await billingService.markPaymentPaid({
        orderId,
        paymentId,
        signature
      });
    } catch (billingError) {
      if (billingError.statusCode !== 404) {
        throw billingError;
      }
    }

    return res.json({
      success: true,
      message: 'Payment verified successfully',
      order_id: orderId,
      payment_id: paymentId,
      billingRecord
    });
  } catch (error) {
    logger.error('Verify Razorpay payment error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Payment verification failed',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;
