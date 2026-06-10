const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  segment: {
    type: String,
    enum: ['msme', 'enterprise'],
    required: true
  },
  legalName: {
    type: String,
    required: true,
    trim: true
  },
  msmeProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    sparse: true
  },
  enterpriseProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Enterprise',
    sparse: true
  },
  primaryIdentifiers: {
    udyam: { type: String, trim: true, uppercase: true },
    cin: { type: String, trim: true, uppercase: true },
    gst: { type: String, trim: true, uppercase: true },
    pan: { type: String, trim: true, uppercase: true }
  },
  industry: { type: String, trim: true },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

organizationSchema.index({ userId: 1 }, { unique: true });
organizationSchema.index({ segment: 1 });
organizationSchema.index({ msmeProfileId: 1 }, { sparse: true });
organizationSchema.index({ enterpriseProfileId: 1 }, { sparse: true });

module.exports = mongoose.model('Organization', organizationSchema);
