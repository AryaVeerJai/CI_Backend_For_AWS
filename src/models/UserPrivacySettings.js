const mongoose = require('mongoose');

const privacyActivitySchema = new mongoose.Schema({
  action: { type: String, required: true },
  dataType: { type: String, required: true },
  details: { type: String, default: '' },
  ipAddress: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  occurredAt: { type: Date, default: Date.now }
}, { _id: false });

const dataRequestSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['access', 'deletion', 'rectification', 'portability', 'restriction'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'rejected'],
    default: 'pending'
  },
  description: { type: String, required: true },
  requestedAt: { type: Date, default: Date.now },
  completedAt: Date,
  response: { type: String, default: '' }
}, { timestamps: true });

const userPrivacySettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  settings: {
    dataProcessing: { type: Boolean, default: true },
    marketingCommunications: { type: Boolean, default: false },
    thirdPartySharing: { type: Boolean, default: false },
    analyticsTracking: { type: Boolean, default: true },
    cookieConsent: { type: Boolean, default: true },
    dataRetention: { type: Boolean, default: true },
    twoFactorAuth: { type: Boolean, default: false },
    sessionTimeout: { type: Number, default: 30 },
    dataEncryption: { type: Boolean, default: true },
    auditLogging: { type: Boolean, default: true }
  },
  requests: [dataRequestSchema],
  activities: [privacyActivitySchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('UserPrivacySettings', userPrivacySettingsSchema);
