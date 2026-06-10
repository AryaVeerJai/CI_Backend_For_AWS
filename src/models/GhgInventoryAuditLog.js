const mongoose = require('mongoose');

/**
 * Append-only audit trail for GHG inventory changes (ISO 14064 recalculation governance).
 */
const ghgInventoryAuditLogSchema = new mongoose.Schema({
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    index: true
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    index: true
  },
  inventoryVersionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GhgInventoryVersion',
    index: true
  },
  eventType: {
    type: String,
    enum: [
      'inventory_calculated',
      'inventory_locked',
      'factor_registry_updated',
      'boundary_applied',
      'recalculation_triggered',
      'assurance_gate_evaluated',
      'brsr_scope_reconciled'
    ],
    required: true
  },
  actorType: {
    type: String,
    enum: ['system', 'user', 'agent'],
    default: 'agent'
  },
  actorId: { type: String, trim: true },
  agentType: { type: String, trim: true },
  orchestrationId: { type: String, trim: true, index: true },
  payloadHash: { type: String, trim: true },
  summary: { type: String, trim: true, required: true },
  beforeSnapshot: { type: mongoose.Schema.Types.Mixed },
  afterSnapshot: { type: mongoose.Schema.Types.Mixed },
  metadata: { type: mongoose.Schema.Types.Mixed }
}, {
  timestamps: true,
  collection: 'ghg_inventory_audit_logs'
});

ghgInventoryAuditLogSchema.index({ createdAt: -1 });
ghgInventoryAuditLogSchema.index({ msmeId: 1, eventType: 1, createdAt: -1 });

module.exports = mongoose.model('GhgInventoryAuditLog', ghgInventoryAuditLogSchema);
