const mongoose = require('mongoose');

const billingPaymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    index: true
  },
  pricingModel: {
    type: String,
    enum: ['usage_based', 'fixed_plan'],
    required: true
  },
  planId: { type: String, trim: true, default: null },
  planInterval: {
    type: String,
    enum: ['monthly', 'yearly', null],
    default: null
  },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  razorpayOrderId: { type: String, trim: true },
  razorpayPaymentId: { type: String, trim: true, sparse: true },
  razorpaySignature: { type: String, trim: true },
  status: {
    type: String,
    enum: ['created', 'pending', 'paid', 'failed'],
    default: 'created'
  },
  notes: { type: mongoose.Schema.Types.Mixed, default: null },
  paidAt: { type: Date, default: null }
}, {
  timestamps: true
});

billingPaymentSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('BillingPayment', billingPaymentSchema);
