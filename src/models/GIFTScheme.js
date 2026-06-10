const mongoose = require('mongoose');

const giftSchemeSchema = new mongoose.Schema({
  schemeName: {
    type: String,
    required: true,
    trim: true
  },
  schemeCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['technology', 'energy', 'environment', 'manufacturing', 'innovation', 'digital'],
    required: true
  },
  eligibilityCriteria: {
    minCarbonScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    minAnnualTurnover: {
      type: Number,
      required: true,
      min: 0
    },
    maxAnnualTurnover: {
      type: Number,
      required: true
    },
    companyTypes: [{
      type: String,
      enum: ['micro', 'small', 'medium']
    }],
    industries: [String],
    requiredCertifications: [String],
    minEmployees: {
      type: Number,
      default: 1
    },
    maxEmployees: {
      type: Number,
      default: 1000
    }
  },
  benefits: {
    incentiveType: {
      type: String,
      enum: ['subsidy', 'grant', 'tax_benefit', 'loan_subsidy', 'equipment_subsidy'],
      required: true
    },
    incentiveAmount: {
      type: Number,
      required: true,
      min: 0
    },
    incentivePercentage: {
      type: Number,
      min: 0,
      max: 100
    },
    maxIncentiveAmount: {
      type: Number,
      min: 0
    },
    description: String
  },
  applicationProcess: {
    requiredDocuments: [String],
    applicationFee: {
      type: Number,
      default: 0
    },
    processingTime: {
      type: Number,
      required: true,
      min: 1
    },
    validityPeriod: {
      type: Number,
      required: true,
      min: 1
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'expired'],
    default: 'active'
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for efficient queries
giftSchemeSchema.index({ schemeCode: 1 });
giftSchemeSchema.index({ category: 1 });
giftSchemeSchema.index({ status: 1 });
giftSchemeSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model('GIFTScheme', giftSchemeSchema);
