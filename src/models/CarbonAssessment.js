const mongoose = require('mongoose');

const carbonAssessmentSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    index: true
  },
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    required: false
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  assessmentType: {
    type: String,
    enum: ['manual', 'automatic', 'hybrid', 'ai_comprehensive', 'ai_advanced', 'mobile'],
    required: true
  },
  period: {
    startDate: {
      type: Date,
      required: false
    },
    endDate: {
      type: Date,
      required: false
    }
  },
  totalCO2Emissions: {
    type: Number,
    required: true,
    min: 0
  },
  breakdown: {
    energy: {
      electricity: {
        consumption: Number,
        co2Emissions: Number,
        source: String
      },
      fuel: {
        consumption: Number,
        co2Emissions: Number,
        type: String
      },
      total: Number
    },
    water: {
      consumption: Number,
      co2Emissions: Number,
      treatment: Boolean
    },
    waste: {
      solid: {
        generated: Number,
        co2Emissions: Number,
        recyclingRate: Number
      },
      hazardous: {
        generated: Number,
        co2Emissions: Number
      },
      total: Number
    },
    transportation: {
      distance: Number,
      co2Emissions: Number,
      vehicleCount: Number,
      fuelEfficiency: Number
    },
    materials: {
      consumption: Number,
      co2Emissions: Number,
      type: String,
      supplierDistance: Number
    },
    manufacturing: {
      productionVolume: Number,
      co2Emissions: Number,
      efficiency: Number,
      equipmentAge: Number
    }
  },
  mobileBreakdown: mongoose.Schema.Types.Mixed,
  transactionCount: Number,
  totalAmount: Number,
  source: {
    type: String,
    enum: ['backend', 'mobile'],
    default: 'backend'
  },
  esgScopes: {
    scope1: {
      total: {
        type: Number,
        required: false,
        default: 0,
        min: 0
      },
      percentage: {
        type: Number,
        default: 0
      },
      breakdown: {
        directFuel: Number,
        directTransport: Number,
        directManufacturing: Number,
        fugitiveEmissions: Number,
        processEmissions: Number,
        stationaryCombustion: Number,
        mobileCombustion: Number
      },
      parameters: mongoose.Schema.Types.Mixed,
      description: {
        type: String,
        default: 'Direct emissions from owned or controlled sources'
      }
    },
    scope2: {
      total: {
        type: Number,
        required: false,
        default: 0,
        min: 0
      },
      percentage: {
        type: Number,
        default: 0
      },
      breakdown: {
        electricity: Number,
        heating: Number,
        cooling: Number,
        steam: Number,
        districtHeating: Number,
        districtCooling: Number
      },
      parameters: mongoose.Schema.Types.Mixed,
      description: {
        type: String,
        default: 'Indirect emissions from purchased energy'
      }
    },
    scope3: {
      total: {
        type: Number,
        required: false,
        default: 0,
        min: 0
      },
      percentage: {
        type: Number,
        default: 0
      },
      breakdown: {
        purchasedGoods: Number,
        transportation: Number,
        wasteDisposal: Number,
        businessTravel: Number,
        employeeCommuting: Number,
        leasedAssets: Number,
        investments: Number,
        franchises: Number,
        processingSoldProducts: Number,
        useSoldProducts: Number,
        endLifeDisposal: Number,
        other: Number
      },
      parameters: mongoose.Schema.Types.Mixed,
      description: {
        type: String,
        default: 'All other indirect emissions in the value chain'
      }
    }
  },
  carbonScore: {
    type: Number,
    required: false,
    default: 0,
    min: 0,
    max: 100
  },
  scoreBreakdown: {
    energyEfficiency: Number,
    wasteManagement: Number,
    waterConservation: Number,
    transportation: Number,
    materialSourcing: Number,
    processOptimization: Number,
    environmentalControls: Number
  },
  recommendations: [{
    category: String,
    title: String,
    description: String,
    priority: {
      type: String,
      enum: ['high', 'medium', 'low']
    },
    potentialCO2Reduction: Number,
    implementationCost: Number,
    paybackPeriod: Number,
    isImplemented: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'dismissed'],
      default: 'pending'
    },
    implementationDate: Date,
    actualCO2Saved: {
      type: Number,
      default: 0
    },
    userFeedback: {
      rating: { type: Number, min: 1, max: 5 },
      comment: String,
      submittedAt: Date
    },
    followUpRecommendations: [String]
  }],
  predictions: [{
    month: Date,
    predictedCO2: Number,
    confidenceLower: Number,
    confidenceUpper: Number,
    modelUsed: String,
    generatedAt: {
      type: Date,
      default: Date.now
    }
  }],
  forecastMetadata: {
    modelType: String,
    accuracy: {
      mape: Number,
      rmse: Number,
      mae: Number
    },
    lastForecastDate: Date,
    forecastPeriods: Number
  },
  benchmarks: {
    industryAverage: Number,
    bestInClass: Number,
    previousAssessment: Number
  },
  status: {
    type: String,
    enum: ['draft', 'completed', 'reviewed', 'approved', 'provisional'],
    default: 'draft'
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: Date,
  notes: String
}, {
  timestamps: true
});

// Allow extended granular fields generated by document-batch assessments.
carbonAssessmentSchema.set('strict', false);

carbonAssessmentSchema.pre('validate', function validateOrgScope(next) {
  if (!this.msmeId && !this.organizationId) {
    this.invalidate('organizationId', 'organizationId or msmeId is required');
  }
  return next();
});

// Indexes
carbonAssessmentSchema.index({ organizationId: 1, 'period.startDate': -1 });
carbonAssessmentSchema.index({ msmeId: 1, 'period.startDate': -1 });
carbonAssessmentSchema.index({ userId: 1, createdAt: -1 });
carbonAssessmentSchema.index({ carbonScore: -1 });
carbonAssessmentSchema.index({ status: 1 });

module.exports = mongoose.model('CarbonAssessment', carbonAssessmentSchema);