const mongoose = require('mongoose');

const aiAgentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: [
      'carbon_analyzer',
      'data_privacy',
      'document_analyzer',
      'orchestration_agent',
      'recommendation_engine', 
      'data_processor',
      'anomaly_detector',
      'trend_analyzer',
      'compliance_monitor',
      'optimization_advisor',
      'report_generator',
      'iso_evidence_collector',
      'iso_gap_closure_planner',
      'iso_audit_packager',
      'sector_profiler',
      'process_machinery_profiler',
      'organizational_boundary_agent',
      'operational_boundary_agent',
      'ghg_boundary_orchestrator',
      'verified_source_rag',
      'inventory_quality_advisor',
      'buyer_request_advisor',
      'msme_goal_advisor',
      'dpdp_privacy_advisor',
      'environmental_kpi_advisor',
      'enterprise_compliance',
      'brsr_mandate',
      'pat_intensity',
      'boundary_enforcer',
      'assurance_gate',
      'factor_registry',
      'brsr_scope_reconciliation',
      'inventory_governance'
    ],
    required: true
  },
  description: {
    type: String,
    required: true
  },
  capabilities: [{
    type: String,
    required: true
  }],
  status: {
    type: String,
    enum: ['active', 'inactive', 'maintenance', 'error'],
    default: 'active'
  },
  configuration: {
    model: String,
    parameters: mongoose.Schema.Types.Mixed,
    thresholds: mongoose.Schema.Types.Mixed,
    preferences: mongoose.Schema.Types.Mixed
  },
  performance: {
    tasksCompleted: {
      type: Number,
      default: 0
    },
    successRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    averageResponseTime: {
      type: Number,
      default: 0
    },
    lastActivity: Date,
    errorCount: {
      type: Number,
      default: 0
    }
  },
  dependencies: [{
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AIAgent'
    },
    required: {
      type: Boolean,
      default: false
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
aiAgentSchema.index({ type: 1, status: 1 });
aiAgentSchema.index({ isActive: 1 });
aiAgentSchema.index({ 'performance.lastActivity': -1 });

module.exports = mongoose.model('AIAgent', aiAgentSchema);