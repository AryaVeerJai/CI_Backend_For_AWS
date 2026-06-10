const crypto = require('crypto');
const Razorpay = require('razorpay');
const logger = require('../utils/logger');

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';
const MIN_AMOUNT_PAISE = 100;

let razorpayClient = null;

const getCredentials = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  return {
    keyId,
    keySecret,
    webhookSecret,
    isConfigured: Boolean(keyId && keySecret)
  };
};

const getRazorpayClient = () => {
  const { keyId, keySecret, isConfigured } = getCredentials();
  if (!isConfigured) {
    return null;
  }

  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });
  }

  return razorpayClient;
};

const resetRazorpayClient = () => {
  razorpayClient = null;
};

const toPaise = (amountInr) => Math.round(Number(amountInr) * 100);

const normalizeRazorpayError = (error) => {
  const statusCode = error?.statusCode || error?.response?.status;
  const description = error?.error?.description
    || error?.error?.reason
    || error?.message
    || 'Razorpay API request failed';

  const normalized = new Error(description);
  normalized.statusCode = statusCode === 401 ? 401 : 500;
  normalized.razorpayError = error?.error || null;
  return normalized;
};

const createOrderByPaise = async ({
  amount,
  currency = 'INR',
  receipt,
  notes = {}
}) => {
  const amountPaise = Math.round(Number(amount));
  if (!Number.isFinite(amountPaise) || amountPaise < MIN_AMOUNT_PAISE) {
    const error = new Error(`Amount must be at least ${MIN_AMOUNT_PAISE} paise`);
    error.statusCode = 400;
    throw error;
  }

  const client = getRazorpayClient();
  if (!client) {
    return {
      configured: false,
      mock: true,
      order: {
        id: `order_mock_${Date.now()}`,
        amount: amountPaise,
        currency,
        receipt: receipt || `rcpt_${Date.now()}`,
        status: 'created',
        notes
      }
    };
  }

  try {
    const order = await client.orders.create({
      amount: amountPaise,
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
      notes
    });

    return {
      configured: true,
      mock: false,
      order
    };
  } catch (error) {
    logger.error('Razorpay create order error:', error);
    throw normalizeRazorpayError(error);
  }
};

const createOrder = async ({
  amountInr,
  currency = 'INR',
  receipt,
  notes = {}
}) => {
  const amountPaise = toPaise(amountInr);
  return createOrderByPaise({
    amount: amountPaise,
    currency,
    receipt,
    notes
  });
};

const verifyPaymentSignature = ({ orderId, paymentId, signature }) => {
  const { keySecret, isConfigured } = getCredentials();
  if (!isConfigured) {
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    return Boolean(orderId && paymentId);
  }

  if (!orderId || !paymentId || !signature) {
    return false;
  }

  const payload = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(payload)
    .digest('hex');

  return expected === signature;
};

const verifyWebhookSignature = (rawBody, signature) => {
  const { webhookSecret, isConfigured } = getCredentials();
  if (!isConfigured || !webhookSecret) {
    logger.warn('Razorpay webhook received but webhook secret is not configured');
    return false;
  }

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  return expected === signature;
};

const getPublicKeyId = () => getCredentials().keyId || null;

module.exports = {
  createOrder,
  createOrderByPaise,
  verifyPaymentSignature,
  verifyWebhookSignature,
  getPublicKeyId,
  getCredentials,
  getRazorpayClient,
  resetRazorpayClient,
  toPaise,
  MIN_AMOUNT_PAISE,
  RAZORPAY_API_BASE
};
