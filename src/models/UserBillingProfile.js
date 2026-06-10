const mongoose = require('mongoose');

const userBillingProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
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
    default: 'usage_based'
  },
  selectedPlanId: {
    type: String,
    trim: true,
    default: null
  },
  planInterval: {
    type: String,
    enum: ['monthly', 'yearly', null],
    default: null
  },
  razorpayCustomerId: {
    type: String,
    trim: true,
    default: null
  },
  status: {
    type: String,
    enum: ['none', 'quoted', 'pending', 'paid', 'failed'],
    default: 'none'
  },
  informationalOnly: {
    type: Boolean,
    default: true
  },
  lastQuotedAmount: { type: Number, default: null },
  lastQuotedCurrency: { type: String, default: 'INR' },
  lastQuotedAt: { type: Date, default: null },
  lastQuotedBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
  lastPaymentAt: { type: Date, default: null },
  lastPaymentAmount: { type: Number, default: null },
  lastPaymentId: { type: String, default: null },
  paidUntil: { type: Date, default: null }
}, {
  timestamps: true
});

module.exports = mongoose.model('UserBillingProfile', userBillingProfileSchema);
