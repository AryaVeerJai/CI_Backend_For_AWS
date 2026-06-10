const mongoose = require('mongoose');

const recommendationSchema = new mongoose.Schema({
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    required: true
  },
  assessmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CarbonAssessment'
  },
  category: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    required: true
  },
  potentialCO2Reduction: {
    type: Number,
    default: 0
  },
  implementationCost: {
    type: Number,
    default: 0
  },
  paybackPeriod: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'dismissed'],
    default: 'pending'
  },
  implementationDate: Date,
  completionDate: Date,
  actualCO2Saved: {
    type: Number,
    default: 0
  },
  userFeedback: {
    rating: { type: Number, min: 1, max: 5 },
    comment: String,
    submittedAt: Date
  },
  followUpRecommendations: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recommendation'
  }],
  source: {
    type: String,
    enum: ['assessment', 'ai_agent', 'manual', 'benchmark'],
    default: 'assessment'
  },
  confidenceScore: {
    type: Number,
    min: 0,
    max: 1,
    default: 0.8
  },
  metadata: mongoose.Schema.Types.Mixed
}, {
  timestamps: true
});

recommendationSchema.index({ msmeId: 1, status: 1 });
recommendationSchema.index({ msmeId: 1, priority: 1 });
recommendationSchema.index({ msmeId: 1, createdAt: -1 });
recommendationSchema.index({ assessmentId: 1 });

module.exports = mongoose.model('Recommendation', recommendationSchema);
