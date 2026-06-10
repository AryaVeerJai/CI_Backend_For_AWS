const mongoose = require('mongoose');

const partnerApiUsageSchema = new mongoose.Schema({
  partnerApplicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PartnerApplication',
    required: true,
    index: true
  },
  occurredAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  method: {
    type: String,
    trim: true
  },
  path: {
    type: String,
    trim: true
  },
  endpointKey: {
    type: String,
    trim: true,
    index: true
  },
  usageCategory: {
    type: String,
    enum: ['api_call', 'report_pull', 'webhook_config', 'webhook_delivery'],
    default: 'api_call',
    index: true
  },
  statusCode: {
    type: Number
  },
  responseTimeMs: {
    type: Number
  },
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    default: null
  }
}, {
  timestamps: false
});

partnerApiUsageSchema.index({ partnerApplicationId: 1, occurredAt: -1 });
partnerApiUsageSchema.index(
  { occurredAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 400 }
);

module.exports = mongoose.model('PartnerApiUsage', partnerApiUsageSchema);
