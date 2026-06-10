const mongoose = require('mongoose');

const aiExecutionSchema = new mongoose.Schema({
  executionId: {
    type: String,
    required: true,
    unique: true
  },
  workflowId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AIWorkflow',
    required: true
  },
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    required: true
  },
  status: {
    type: String,
    enum: ['running', 'completed', 'failed', 'cancelled', 'paused'],
    default: 'running'
  },
  trigger: {
    type: {
      type: String,
      enum: ['manual', 'scheduled', 'event_based', 'data_driven'],
      required: true
    },
    source: String,
    data: mongoose.Schema.Types.Mixed
  },
  steps: [{
    stepId: String,
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AIAgent'
    },
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AITask'
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'skipped'],
      default: 'pending'
    },
    input: mongoose.Schema.Types.Mixed,
    output: mongoose.Schema.Types.Mixed,
    error: {
      message: String,
      code: String,
      stack: String
    },
    startedAt: Date,
    completedAt: Date,
    duration: Number,
    retryCount: {
      type: Number,
      default: 0
    }
  }],
  results: {
    overall: mongoose.Schema.Types.Mixed,
    stepResults: [{
      stepId: String,
      result: mongoose.Schema.Types.Mixed
    }],
    metrics: {
      totalDuration: Number,
      successRate: Number,
      errorCount: Number,
      resourceUsage: {
        cpu: Number,
        memory: Number
      }
    }
  },
  error: {
    message: String,
    code: String,
    stepId: String,
    timestamp: Date
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  duration: Number,
  metadata: {
    userAgent: String,
    ipAddress: String,
    sessionId: String
  }
}, {
  timestamps: true
});

// Indexes
aiExecutionSchema.index({ workflowId: 1, status: 1 });
aiExecutionSchema.index({ msmeId: 1, startedAt: -1 });
aiExecutionSchema.index({ status: 1, startedAt: -1 });
aiExecutionSchema.index({ 'steps.status': 1 });

module.exports = mongoose.model('AIExecution', aiExecutionSchema);