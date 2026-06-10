const mongoose = require('mongoose');

const aiWorkflowSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['standard', 'multi_agent', 'graph'],
    default: 'standard'
  },
  trigger: {
    type: {
      type: String,
      enum: ['manual', 'scheduled', 'event_based', 'data_driven'],
      required: true
    },
    conditions: mongoose.Schema.Types.Mixed,
    schedule: String, // Cron expression for scheduled workflows
    events: [String] // Event types that trigger this workflow
  },
  steps: [{
    stepId: {
      type: String,
      required: true
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AIAgent',
      required: true
    },
    taskType: {
      type: String,
      required: true
    },
    parameters: mongoose.Schema.Types.Mixed,
    dependencies: [String], // Array of stepIds this step depends on
    conditions: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    retryPolicy: {
      maxRetries: {
        type: Number,
        default: 3
      },
      retryDelay: {
        type: Number,
        default: 1000
      }
    },
    timeout: {
      type: Number,
      default: 300000 // 5 minutes
    }
  }],
  coordination: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'inactive', 'archived'],
    default: 'draft'
  },
  version: {
    type: Number,
    default: 1
  },
  isActive: {
    type: Boolean,
    default: true
  },
  executionStats: {
    totalRuns: {
      type: Number,
      default: 0
    },
    successfulRuns: {
      type: Number,
      default: 0
    },
    failedRuns: {
      type: Number,
      default: 0
    },
    averageExecutionTime: {
      type: Number,
      default: 0
    },
    lastRun: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  tags: [String],
  category: String
}, {
  timestamps: true
});

// Indexes
aiWorkflowSchema.index({ status: 1, isActive: 1 });
aiWorkflowSchema.index({ 'trigger.type': 1 });
aiWorkflowSchema.index({ createdBy: 1 });

module.exports = mongoose.model('AIWorkflow', aiWorkflowSchema);