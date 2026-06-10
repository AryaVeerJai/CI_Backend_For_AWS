const mongoose = require('mongoose');

const userPrivacyRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['access', 'deletion', 'rectification', 'portability', 'restriction', 'withdraw_consent'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'rejected'],
    default: 'pending',
    index: true
  },
  description: {
    type: String,
    required: true
  },
  response: {
    type: String,
    default: ''
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

userPrivacyRequestSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('UserPrivacyRequest', userPrivacyRequestSchema);
