const mongoose = require('mongoose');

const greenLoanSchema = new mongoose.Schema({
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    required: true
  },
  bankId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bank',
    required: true
  },
  loanApplication: {
    loanAmount: {
      type: Number,
      required: true,
      min: 100000 // 1 lakh minimum
    },
    purpose: {
      type: String,
      required: true,
      enum: [
        'solar_installation',
        'energy_efficiency_upgrade',
        'waste_management_system',
        'water_treatment_facility',
        'green_equipment_purchase',
        'carbon_offset_projects',
        'sustainable_manufacturing',
        'other_green_initiatives'
      ]
    },
    description: {
      type: String,
      required: true,
      maxLength: 1000
    },
    expectedCarbonReduction: {
      type: Number,
      required: true,
      min: 0
    },
    expectedPaybackPeriod: {
      type: Number,
      required: true,
      min: 6 // months
    },
    documents: [{
      type: {
        type: String,
        required: true
      },
      fileName: {
        type: String,
        required: true
      },
      fileUrl: {
        type: String,
        required: true
      },
      uploadedAt: {
        type: Date,
        default: Date.now
      }
    }]
  },
  carbonAssessment: {
    currentCarbonScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    currentCO2Emissions: {
      type: Number,
      required: true,
      min: 0
    },
    carbonSavings: {
      totalSavings: {
        type: Number,
        default: 0
      },
      periodSavings: {
        type: Number,
        default: 0
      },
      savingsPercentage: {
        type: Number,
        default: 0
      }
    },
    esgScopes: {
      scope1: {
        total: Number,
        breakdown: {
          directFuel: Number,
          directTransport: Number,
          directManufacturing: Number,
          fugitiveEmissions: Number
        }
      },
      scope2: {
        total: Number,
        breakdown: {
          electricity: Number,
          heating: Number,
          cooling: Number,
          steam: Number
        }
      },
      scope3: {
        total: Number,
        breakdown: {
          purchasedGoods: Number,
          transportation: Number,
          wasteDisposal: Number,
          businessTravel: Number,
          employeeCommuting: Number,
          leasedAssets: Number,
          investments: Number,
          other: Number
        }
      }
    }
  },
  loanTerms: {
    approvedAmount: {
      type: Number,
      default: 0
    },
    interestRate: {
      type: Number,
      default: 0
    },
    tenure: {
      type: Number,
      default: 0 // months
    },
    emiAmount: {
      type: Number,
      default: 0
    },
    carbonScoreDiscount: {
      type: Number,
      default: 0
    },
    finalInterestRate: {
      type: Number,
      default: 0
    }
  },
  status: {
    type: String,
    enum: [
      'draft',
      'submitted',
      'under_review',
      'approved',
      'rejected',
      'disbursed',
      'active',
      'completed',
      'defaulted'
    ],
    default: 'draft'
  },
  reviewDetails: {
    reviewedBy: {
      type: String,
      default: null
    },
    reviewedAt: {
      type: Date,
      default: null
    },
    reviewComments: {
      type: String,
      default: null
    },
    rejectionReason: {
      type: String,
      default: null
    }
  },
  disbursementDetails: {
    disbursedAmount: {
      type: Number,
      default: 0
    },
    disbursedAt: {
      type: Date,
      default: null
    },
    disbursementMethod: {
      type: String,
      enum: ['bank_transfer', 'cheque', 'demand_draft'],
      default: null
    },
    transactionReference: {
      type: String,
      default: null
    }
  },
  repaymentSchedule: [{
    installmentNumber: Number,
    dueDate: Date,
    principalAmount: Number,
    interestAmount: Number,
    totalAmount: Number,
    status: {
      type: String,
      enum: ['pending', 'paid', 'overdue'],
      default: 'pending'
    },
    paidAt: Date,
    lateFee: {
      type: Number,
      default: 0
    }
  }],
  carbonMonitoring: {
    quarterlyReports: [{
      quarter: String,
      actualCarbonReduction: Number,
      targetCarbonReduction: Number,
      complianceStatus: {
        type: String,
        enum: ['compliant', 'non_compliant', 'pending'],
        default: 'pending'
      },
      reportDate: Date,
      verifiedBy: String
    }],
    annualCarbonAudit: {
      auditYear: Number,
      auditedBy: String,
      auditDate: Date,
      auditResult: {
        type: String,
        enum: ['passed', 'failed', 'pending'],
        default: 'pending'
      },
      auditReport: String
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries
greenLoanSchema.index({ msmeId: 1 });
greenLoanSchema.index({ bankId: 1 });
greenLoanSchema.index({ status: 1 });
greenLoanSchema.index({ 'carbonAssessment.currentCarbonScore': 1 });
greenLoanSchema.index({ createdAt: -1 });

// Pre-save middleware to update updatedAt
greenLoanSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('GreenLoan', greenLoanSchema);