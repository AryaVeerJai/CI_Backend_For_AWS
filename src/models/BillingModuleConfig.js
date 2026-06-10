const mongoose = require('mongoose');

const fixedPlanSchema = new mongoose.Schema({
  planId: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  amountInr: { type: Number, required: true, min: 0 },
  interval: {
    type: String,
    enum: ['monthly', 'yearly'],
    required: true
  },
  isActive: { type: Boolean, default: true }
}, { _id: false });

const billingModuleConfigSchema = new mongoose.Schema({
  moduleEnabled: {
    type: Boolean,
    default: true
  },
  provider: {
    type: String,
    enum: ['razorpay'],
    default: 'razorpay'
  },
  informationalOnly: {
    type: Boolean,
    default: true
  },
  methods: {
    upi: {
      type: Boolean,
      default: true
    },
    netBanking: {
      type: Boolean,
      default: true
    },
    cards: {
      type: Boolean,
      default: true
    }
  },
  fixedPlans: {
    type: [fixedPlanSchema],
    default: []
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('BillingModuleConfig', billingModuleConfigSchema);
