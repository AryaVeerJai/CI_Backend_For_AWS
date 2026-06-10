const mongoose = require('mongoose');

const PARTNER_SCOPES = [
  'msme:read',
  'carbon:read',
  'reports:read',
  'transactions:summary',
  'webhooks:manage'
];

const partnerApplicationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  organizationType: {
    type: String,
    enum: [
      'government_accredited_auditor',
      'bank_incentives_partner',
      'verification_agency',
      'integration_partner',
      'other'
    ],
    default: 'integration_partner'
  },
  organizationName: {
    type: String,
    trim: true
  },
  contactEmail: {
    type: String,
    trim: true,
    lowercase: true
  },
  apiKeyPrefix: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  apiKeyHash: {
    type: String,
    required: true
  },
  scopes: [{
    type: String,
    enum: PARTNER_SCOPES
  }],
  linkedUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  webhookUrl: {
    type: String,
    trim: true,
    default: null
  },
  webhookSecret: {
    type: String,
    default: null
  },
  rateLimitTier: {
    type: String,
    enum: ['standard', 'elevated'],
    default: 'standard'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastUsedAt: {
    type: Date,
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  },
  billingPlanId: {
    type: String,
    default: 'api_starter',
    trim: true
  },
  contractAnnualFeeInr: {
    type: Number,
    default: 99000
  },
  billingStatus: {
    type: String,
    enum: ['pending', 'active', 'expired', 'suspended'],
    default: 'active'
  },
  billingActivatedAt: {
    type: Date,
    default: null
  },
  contractPaidUntil: {
    type: Date,
    default: null
  },
  usageLimits: {
    apiCallsPerMonth: { type: Number, default: 100000 },
    webhookEventsPerMonth: { type: Number, default: 10000 },
    reportPullsPerMonth: { type: Number, default: 2000 },
    msmeMonitoredPerYear: { type: Number, default: 500 }
  },
  overageRates: {
    perApiCallInr: { type: Number, default: 0.15 },
    perWebhookInr: { type: Number, default: 0.5 },
    perReportPullInr: { type: Number, default: 5 },
    perMsmeMonthInr: { type: Number, default: 25 }
  }
}, {
  timestamps: true
});

partnerApplicationSchema.index({ isActive: 1, organizationType: 1 });

module.exports = mongoose.model('PartnerApplication', partnerApplicationSchema);
module.exports.PARTNER_SCOPES = PARTNER_SCOPES;
