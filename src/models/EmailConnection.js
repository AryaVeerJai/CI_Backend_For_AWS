const mongoose = require('mongoose');

const emailConnectionSchema = new mongoose.Schema({
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    required: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  imapServer: {
    type: String,
    required: true
  },
  imapPort: {
    type: Number,
    default: 993
  },
  secure: {
    type: Boolean,
    default: true
  },
  encryptedCredentials: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['connected', 'disconnected', 'error'],
    default: 'connected'
  },
  lastSyncAt: Date,
  lastSyncError: {
    type: String,
    default: null
  },
  lastSyncSummary: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  connectedAt: {
    type: Date,
    default: Date.now
  },
  disconnectedAt: Date
}, {
  timestamps: true
});

emailConnectionSchema.index({ msmeId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('EmailConnection', emailConnectionSchema);
