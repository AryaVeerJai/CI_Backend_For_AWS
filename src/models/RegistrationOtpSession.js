const mongoose = require('mongoose');

const registrationOtpSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  emailOtpHash: {
    type: String,
    default: null
  },
  mobileOtpHash: {
    type: String,
    default: null
  },
  emailOtpRequired: {
    type: Boolean,
    default: true
  },
  mobileOtpRequired: {
    type: Boolean,
    default: true
  },
  requestCount: {
    type: Number,
    default: 0
  },
  resendCount: {
    type: Number,
    default: 0
  },
  verifyAttempts: {
    type: Number,
    default: 0
  },
  lastOtpSentAt: {
    type: Date,
    default: null
  },
  lockedUntil: {
    type: Date,
    default: null
  },
  lockReason: {
    type: String,
    default: null
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  mobileVerified: {
    type: Boolean,
    default: false
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  consumedAt: {
    type: Date,
    default: null
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  }
}, {
  timestamps: true
});

registrationOtpSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RegistrationOtpSession', registrationOtpSessionSchema);
