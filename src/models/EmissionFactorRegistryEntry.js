const mongoose = require('mongoose');

const emissionFactorRegistryEntrySchema = new mongoose.Schema({
  factorId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  version: {
    type: String,
    required: true,
    trim: true
  },
  effectiveFrom: { type: Date, required: true },
  effectiveTo: { type: Date },
  factor: { type: Number, required: true },
  unit: { type: String, required: true, trim: true },
  gas: {
    type: String,
    enum: ['CO2e', 'CO2', 'CH4', 'N2O'],
    default: 'CO2e'
  },
  source: { type: String, trim: true },
  sourceUrl: { type: String, trim: true },
  relativeUncertainty: { type: Number, min: 0, max: 1 },
  region: { type: String, trim: true, default: 'India' },
  sector: { type: String, trim: true },
  isActive: { type: Boolean, default: true, index: true },
  supersededBy: { type: String, trim: true },
  metadata: { type: mongoose.Schema.Types.Mixed }
}, {
  timestamps: true,
  collection: 'emission_factor_registry'
});

emissionFactorRegistryEntrySchema.index({ factorId: 1, version: 1 }, { unique: true });
emissionFactorRegistryEntrySchema.index({ factorId: 1, isActive: 1, effectiveFrom: -1 });

module.exports = mongoose.model('EmissionFactorRegistryEntry', emissionFactorRegistryEntrySchema);
