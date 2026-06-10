const mongoose = require('mongoose');

const giftApplicationSchema = new mongoose.Schema({
  applicationNumber: {
    type: String,
    required: true,
    unique: true
  },
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    required: true
  },
  schemeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GIFTScheme',
    required: true
  },
  projectDetails: {
    projectName: {
      type: String,
      required: true
    },
    projectDescription: {
      type: String,
      required: true
    },
    projectCategory: {
      type: String,
      enum: ['technology', 'energy', 'environment', 'manufacturing', 'innovation', 'digital'],
      required: true
    },
    projectValue: {
      type: Number,
      required: true,
      min: 0
    },
    expectedCarbonReduction: {
      type: Number,
      required: true,
      min: 0
    },
    projectDuration: {
      type: Number,
      required: true,
      min: 1
    },
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    }
  },
  financialDetails: {
    totalProjectCost: {
      type: Number,
      required: true,
      min: 0
    },
    requestedIncentiveAmount: {
      type: Number,
      required: true,
      min: 0
    },
    ownContribution: {
      type: Number,
      required: true,
      min: 0
    },
    bankLoanAmount: {
      type: Number,
      default: 0
    },
    otherSources: {
      type: Number,
      default: 0
    }
  },
  documents: [{
    documentType: {
      type: String,
      required: true
    },
    documentName: {
      type: String,
      required: true
    },
    documentUrl: {
      type: String,
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    verified: {
      type: Boolean,
      default: false
    }
  }],
  status: {
    type: String,
    enum: ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'disbursed', 'completed', 'cancelled'],
    default: 'draft'
  },
  reviewDetails: {
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: Date,
    reviewComments: String,
    reviewScore: {
      type: Number,
      min: 0,
      max: 100
    },
    rejectionReason: String
  },
  disbursementDetails: {
    approvedAmount: {
      type: Number,
      min: 0
    },
    disbursedAmount: {
      type: Number,
      default: 0
    },
    disbursementDate: Date,
    disbursementMethod: String,
    disbursementReference: String
  },
  complianceDetails: {
    isCompliant: {
      type: Boolean,
      default: false
    },
    complianceScore: {
      type: Number,
      min: 0,
      max: 100
    },
    lastComplianceCheck: Date,
    complianceComments: String
  },
  milestones: [{
    milestoneName: {
      type: String,
      required: true
    },
    description: String,
    targetDate: {
      type: Date,
      required: true
    },
    completedDate: Date,
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'delayed'],
      default: 'pending'
    },
    evidence: String
  }]
}, {
  timestamps: true
});

// Index for efficient queries
giftApplicationSchema.index({ applicationNumber: 1 });
giftApplicationSchema.index({ msmeId: 1 });
giftApplicationSchema.index({ schemeId: 1 });
giftApplicationSchema.index({ status: 1 });
giftApplicationSchema.index({ 'projectDetails.projectCategory': 1 });

// Generate application number before saving
giftApplicationSchema.pre('save', async function(next) {
  if (this.isNew && !this.applicationNumber) {
    const count = await this.constructor.countDocuments();
    this.applicationNumber = `GIFT-${Date.now().toString().slice(-6)}-${(count + 1).toString().padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('GIFTApplication', giftApplicationSchema);
