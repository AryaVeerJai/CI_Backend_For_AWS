const mongoose = require('mongoose');

const carbonCreditsSchema = new mongoose.Schema({
  // Aggregated pool for all MSMEs
  poolId: {
    type: String,
    required: true,
    unique: true,
    default: 'indian_carbon_market_pool'
  },
  totalCreditsAvailable: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCreditsIssued: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCreditsUsed: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCreditsRetired: {
    type: Number,
    default: 0,
    min: 0
  },
  // Market pricing
  currentPricePerCredit: {
    type: Number,
    default: 0,
    min: 0
  },
  priceHistory: [{
    date: {
      type: Date,
      default: Date.now
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    volume: {
      type: Number,
      default: 0
    }
  }],
  // Pool statistics
  totalCO2Reduced: {
    type: Number,
    default: 0,
    min: 0
  },
  totalMSMEParticipants: {
    type: Number,
    default: 0,
    min: 0
  },
  lastAggregationDate: {
    type: Date,
    default: null
  },
  // Verification and compliance
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'rejected', 'under_review'],
    default: 'pending'
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: Date,
  verificationNotes: String,
  // Market compliance
  indianCarbonMarketCompliance: {
    isCompliant: {
      type: Boolean,
      default: false
    },
    complianceCertificate: String,
    complianceDate: Date,
    regulatoryBody: {
      type: String,
      default: 'Ministry of Environment, Forest and Climate Change'
    }
  }
}, {
  timestamps: true
});

// Individual MSME carbon credits allocation
const msmeCarbonCreditsSchema = new mongoose.Schema({
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    required: true,
    unique: true
  },
  poolId: {
    type: String,
    required: true,
    default: 'indian_carbon_market_pool'
  },
  // Credits allocated to this MSME
  allocatedCredits: {
    type: Number,
    default: 0,
    min: 0
  },
  availableCredits: {
    type: Number,
    default: 0,
    min: 0
  },
  usedCredits: {
    type: Number,
    default: 0,
    min: 0
  },
  retiredCredits: {
    type: Number,
    default: 0,
    min: 0
  },
  // Carbon savings contribution
  totalCO2Reduced: {
    type: Number,
    default: 0,
    min: 0
  },
  lastContributionDate: Date,
  // Credit allocation based on carbon savings
  allocationHistory: [{
    date: {
      type: Date,
      default: Date.now
    },
    creditsAllocated: {
      type: Number,
      required: true,
      min: 0
    },
    co2Reduced: {
      type: Number,
      required: true,
      min: 0
    },
    allocationMethod: {
      type: String,
      enum: ['proportional', 'performance_based', 'equal_share', 'hybrid'],
      required: true
    },
    assessmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CarbonAssessment'
    }
  }],
  // Credit transactions
  transactions: [{
    type: {
      type: String,
      enum: ['allocation', 'usage', 'transfer', 'retirement', 'expiry'],
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    description: String,
    referenceId: String, // Reference to assessment or other document
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'cancelled'],
      default: 'completed'
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  }],
  // Performance metrics
  performanceMetrics: {
    carbonEfficiency: {
      type: Number,
      default: 0 // Credits per kg CO2 reduced
    },
    participationScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
  // Optional integration snapshot with the external Indian carbon registry API.
  registryIntegration: {
    enabled: {
      type: Boolean,
      default: false
    },
    externalAccountId: {
      type: String,
      default: ''
    },
    lastSyncedAt: {
      type: Date,
      default: null
    },
    lastSyncStatus: {
      type: String,
      enum: ['success', 'failed', 'never'],
      default: 'never'
    },
    lastSyncError: {
      type: String,
      default: ''
    },
    remoteBalances: {
      availableCredits: {
        type: Number,
        default: 0,
        min: 0
      },
      retiredCredits: {
        type: Number,
        default: 0,
        min: 0
      },
      totalCredits: {
        type: Number,
        default: 0,
        min: 0
      },
      lastUpdatedAt: {
        type: Date,
        default: null
      }
    },
    lastSyncPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    lastSyncResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    lastRetirementProof: {
      registryProjectId: { type: String, default: '' },
      serialNumber: { type: String, default: '' },
      vintageYear: { type: mongoose.Schema.Types.Mixed, default: null },
      retirementCertificateUrl: { type: String, default: '' },
      recordedAt: { type: Date, default: null }
    },
    icmWorkflow: {
      workflowId: {
        type: String,
        default: 'icm_platform_workflow'
      },
      baseline: {
        co2Emissions: {
          type: Number,
          default: 0,
          min: 0
        },
        setAt: {
          type: Date,
          default: null
        },
        assessmentId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'CarbonAssessment',
          default: null
        },
        source: {
          type: String,
          default: 'platform'
        },
        notes: {
          type: String,
          default: ''
        }
      },
      reductionTracking: {
        latestCo2Emissions: {
          type: Number,
          default: 0,
          min: 0
        },
        latestReductionKgCO2: {
          type: Number,
          default: 0,
          min: 0
        },
        latestReductionPercent: {
          type: Number,
          default: 0,
          min: 0
        },
        lastEvaluatedAt: {
          type: Date,
          default: null
        },
        history: [{
          measuredAt: {
            type: Date,
            default: Date.now
          },
          co2Emissions: {
            type: Number,
            default: 0,
            min: 0
          },
          reductionKgCO2: {
            type: Number,
            default: 0,
            min: 0
          },
          reductionPercent: {
            type: Number,
            default: 0,
            min: 0
          },
          source: {
            type: String,
            default: 'platform'
          },
          note: {
            type: String,
            default: ''
          }
        }]
      },
      creditQuantification: {
        creditPerKgCO2: {
          type: Number,
          default: 0.1,
          min: 0
        },
        latestQuantifiedCredits: {
          type: Number,
          default: 0,
          min: 0
        },
        totalQuantifiedCredits: {
          type: Number,
          default: 0,
          min: 0
        },
        lastQuantifiedAt: {
          type: Date,
          default: null
        },
        history: [{
          quantifiedAt: {
            type: Date,
            default: Date.now
          },
          method: {
            type: String,
            default: 'baseline_delta'
          },
          reductionKgCO2: {
            type: Number,
            default: 0,
            min: 0
          },
          credits: {
            type: Number,
            default: 0,
            min: 0
          },
          source: {
            type: String,
            default: 'platform'
          }
        }]
      }
    }
  }
}, {
  timestamps: true
});

// Carbon credit market transactions
const carbonCreditTransactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true
  },
  poolId: {
    type: String,
    required: true,
    default: 'indian_carbon_market_pool'
  },
  // Transaction parties
  fromMSME: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME'
  },
  toMSME: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME'
  },
  // Transaction details
  type: {
    type: String,
    enum: ['purchase', 'sale', 'transfer', 'retirement', 'allocation'],
    required: true
  },
  creditsAmount: {
    type: Number,
    required: true,
    min: 0
  },
  pricePerCredit: {
    type: Number,
    required: true,
    min: 0
  },
  totalValue: {
    type: Number,
    required: true,
    min: 0
  },
  // Market details
  marketType: {
    type: String,
    enum: ['primary', 'secondary', 'auction', 'bilateral'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  // Verification
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: Date,
  verificationNotes: String,
  // Compliance
  regulatoryCompliance: {
    isCompliant: {
      type: Boolean,
      default: false
    },
    complianceCertificate: String,
    regulatoryBody: String
  },
  // Metadata
  description: String,
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
carbonCreditsSchema.index({ poolId: 1 });
carbonCreditsSchema.index({ verificationStatus: 1 });
carbonCreditsSchema.index({ 'indianCarbonMarketCompliance.isCompliant': 1 });

msmeCarbonCreditsSchema.index({ msmeId: 1 });
msmeCarbonCreditsSchema.index({ poolId: 1 });
msmeCarbonCreditsSchema.index({ 'allocationHistory.date': -1 });
msmeCarbonCreditsSchema.index({ 'transactions.timestamp': -1 });
msmeCarbonCreditsSchema.index({ 'registryIntegration.externalAccountId': 1 });
msmeCarbonCreditsSchema.index({ 'registryIntegration.lastSyncedAt': -1 });

carbonCreditTransactionSchema.index({ transactionId: 1 });
carbonCreditTransactionSchema.index({ poolId: 1 });
carbonCreditTransactionSchema.index({ fromMSME: 1 });
carbonCreditTransactionSchema.index({ toMSME: 1 });
carbonCreditTransactionSchema.index({ type: 1 });
carbonCreditTransactionSchema.index({ status: 1 });
carbonCreditTransactionSchema.index({ createdAt: -1 });

// Virtual for calculating available credits
carbonCreditsSchema.virtual('availableCredits').get(function() {
  return this.totalCreditsAvailable - this.totalCreditsUsed - this.totalCreditsRetired;
});

// Method to add price to history
carbonCreditsSchema.methods.addPriceHistory = function(price, volume = 0) {
  this.priceHistory.push({
    date: new Date(),
    price,
    volume
  });
  this.currentPricePerCredit = price;
  return this.save();
};

// Method to allocate credits to MSME
msmeCarbonCreditsSchema.methods.allocateCredits = function(amount, co2Reduced, method, assessmentId) {
  this.allocatedCredits += amount;
  this.availableCredits += amount;
  this.totalCO2Reduced += co2Reduced;
  this.lastContributionDate = new Date();
  
  this.allocationHistory.push({
    date: new Date(),
    creditsAllocated: amount,
    co2Reduced,
    allocationMethod: method,
    assessmentId
  });
  
  this.transactions.push({
    type: 'allocation',
    amount,
    description: `Credits allocated based on ${method} method`,
    referenceId: assessmentId,
    status: 'completed'
  });
  
  return this.save();
};

// Method to use credits
msmeCarbonCreditsSchema.methods.useCredits = function(amount, description, referenceId) {
  if (this.availableCredits < amount) {
    throw new Error('Insufficient credits available');
  }
  
  this.availableCredits -= amount;
  this.usedCredits += amount;
  
  this.transactions.push({
    type: 'usage',
    amount,
    description,
    referenceId,
    status: 'completed'
  });
  
  return this.save();
};

// Method to retire credits
msmeCarbonCreditsSchema.methods.retireCredits = function(amount, description) {
  if (this.availableCredits < amount) {
    throw new Error('Insufficient credits available');
  }
  
  this.availableCredits -= amount;
  this.retiredCredits += amount;
  
  this.transactions.push({
    type: 'retirement',
    amount,
    description,
    status: 'completed'
  });
  
  return this.save();
};

// Method to update performance metrics
msmeCarbonCreditsSchema.methods.updatePerformanceMetrics = function() {
  if (this.totalCO2Reduced > 0) {
    this.performanceMetrics.carbonEfficiency = this.allocatedCredits / this.totalCO2Reduced;
  }
  
  // Calculate participation score based on various factors
  const recentAllocations = this.allocationHistory.filter(
    h => h.date > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  );
  
  this.performanceMetrics.participationScore = Math.min(
    (recentAllocations.length * 10) + (this.totalCO2Reduced / 100),
    100
  );
  
  this.performanceMetrics.lastUpdated = new Date();
  return this.save();
};

module.exports = {
  CarbonCredits: mongoose.model('CarbonCredits', carbonCreditsSchema),
  MSMECarbonCredits: mongoose.model('MSMECarbonCredits', msmeCarbonCreditsSchema),
  CarbonCreditTransaction: mongoose.model('CarbonCreditTransaction', carbonCreditTransactionSchema)
};