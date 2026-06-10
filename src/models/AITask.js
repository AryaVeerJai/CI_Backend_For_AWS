const mongoose = require('mongoose');

const aiTaskSchema = new mongoose.Schema({
  taskId: {
    type: String,
    required: true,
    unique: true
  },
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AIAgent',
    required: true
  },
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    required: true
  },
  taskType: {
    type: String,
    enum: [
      'carbon_analysis',
      'recommendation_generation',
      'data_processing',
      'anomaly_detection',
      'trend_analysis',
      'compliance_check',
      'optimization_suggestion',
      'report_generation',
      'transaction_classification',
      'emission_calculation',
      'sustainability_assessment'
    ],
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  input: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  output: {
    type: mongoose.Schema.Types.Mixed
  },
  parameters: {
    type: mongoose.Schema.Types.Mixed
  },
  metadata: {
    source: String,
    category: String,
    tags: [String],
    estimatedDuration: Number,
    actualDuration: Number,
    retryCount: {
      type: Number,
      default: 0
    },
    maxRetries: {
      type: Number,
      default: 3
    }
  },
  error: {
    message: String,
    code: String,
    stack: String,
    timestamp: Date
  },
  dependencies: [{
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AITask'
    },
    required: {
      type: Boolean,
      default: true
    }
  }],
  results: {
    confidence: {
      type: Number,
      min: 0,
      max: 1
    },
    accuracy: {
      type: Number,
      min: 0,
      max: 1
    },
    processingTime: Number,
    resourceUsage: {
      cpu: Number,
      memory: Number
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  startedAt: Date,
  completedAt: Date,
  expiresAt: Date
}, {
  timestamps: true
});

// Indexes
aiTaskSchema.index({ agentId: 1, status: 1 });
aiTaskSchema.index({ msmeId: 1, taskType: 1 });
aiTaskSchema.index({ status: 1, priority: -1, createdAt: 1 });
aiTaskSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AITask', aiTaskSchema);