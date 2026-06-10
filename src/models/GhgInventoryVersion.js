const mongoose = require('mongoose');

const ghgInventoryVersionSchema = new mongoose.Schema({
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
  versionLabel: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['draft', 'locked', 'superseded'],
    default: 'draft',
    index: true
  },
  reportingPeriod: {
    startDate: Date,
    endDate: Date
  },
  methodologyVersion: { type: String, trim: true },
  factorRegistryVersion: { type: String, trim: true },
  operationalBoundarySnapshot: { type: mongoose.Schema.Types.Mixed },
  organizationalBoundarySnapshot: { type: mongoose.Schema.Types.Mixed },
  assessmentSnapshot: { type: mongoose.Schema.Types.Mixed },
  inventoryMetadata: { type: mongoose.Schema.Types.Mixed },
  assuranceEvaluation: { type: mongoose.Schema.Types.Mixed },
  governanceOrchestration: { type: mongoose.Schema.Types.Mixed },
  transactionCount: { type: Number, default: 0 },
  excludedTransactionCount: { type: Number, default: 0 },
  lockedAt: Date,
  lockedBy: { type: String, trim: true },
  supersededBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GhgInventoryVersion'
  }
}, {
  timestamps: true,
  collection: 'ghg_inventory_versions'
});

ghgInventoryVersionSchema.index({ msmeId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('GhgInventoryVersion', ghgInventoryVersionSchema);
