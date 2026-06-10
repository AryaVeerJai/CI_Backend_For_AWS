const mongoose = require('mongoose');

const carbonOffsetSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['renewable_energy', 'reforestation', 'carbon_capture', 'energy_efficiency'],
    required: true
  },
  pricePerTon: {
    type: Number,
    required: true,
    min: 0
  },
  availableCredits: {
    type: Number,
    required: true,
    min: 0
  },
  totalCredits: {
    type: Number,
    required: true,
    min: 0
  },
  verifiedBy: {
    type: String,
    required: true,
    trim: true
  },
  verificationId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  icmRegistry: {
    isRegistered: {
      type: Boolean,
      default: false
    },
    projectId: {
      type: String,
      trim: true,
      default: ''
    },
    methodologyId: {
      type: String,
      trim: true,
      default: ''
    },
    creditInstrument: {
      type: String,
      enum: ['voluntary', 'icm_compliance', 'green_credit', 'international'],
      default: 'voluntary'
    },
    portalProjectUrl: {
      type: String,
      trim: true,
      default: ''
    }
  },
  location: {
    country: {
      type: String,
      required: true,
      trim: true
    },
    state: {
      type: String,
      required: true,
      trim: true
    },
    city: {
      type: String,
      required: true,
      trim: true
    },
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  },
  co2Reduction: {
    type: Number,
    required: true,
    min: 0
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    default: 3
  },
  imageUrl: {
    type: String,
    trim: true
  },
  projectDetails: {
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    },
    projectSize: {
      type: String,
      enum: ['small', 'medium', 'large'],
      required: true
    },
    technology: {
      type: String,
      trim: true
    },
    methodology: {
      type: String,
      trim: true
    },
    additionalBenefits: [{
      type: String,
      trim: true
    }]
  },
  environmentalImpact: {
    biodiversity: {
      type: String,
      enum: ['positive', 'neutral', 'negative'],
      default: 'neutral'
    },
    waterConservation: {
      type: Boolean,
      default: false
    },
    soilHealth: {
      type: String,
      enum: ['improved', 'maintained', 'degraded'],
      default: 'maintained'
    },
    airQuality: {
      type: String,
      enum: ['improved', 'maintained', 'degraded'],
      default: 'maintained'
    }
  },
  socialImpact: {
    jobsCreated: {
      type: Number,
      default: 0
    },
    communityBenefits: [{
      type: String,
      trim: true
    }],
    localParticipation: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium'
    }
  },
  financials: {
    totalInvestment: {
      type: Number,
      required: true,
      min: 0
    },
    fundingSource: {
      type: String,
      enum: ['private', 'public', 'mixed', 'crowdfunded'],
      required: true
    },
    returnOnInvestment: {
      type: Number,
      min: 0,
      max: 100
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationDate: {
    type: Date,
    default: null
  },
  verificationExpiry: {
    type: Date,
    default: null
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
carbonOffsetSchema.index({ type: 1, isActive: 1 });
carbonOffsetSchema.index({ pricePerTon: 1 });
carbonOffsetSchema.index({ rating: -1 });
carbonOffsetSchema.index({ 'location.country': 1, 'location.state': 1 });
carbonOffsetSchema.index({ verifiedBy: 1 });
carbonOffsetSchema.index({ tags: 1 });
carbonOffsetSchema.index({ isVerified: 1, isActive: 1 });

// Text search index
carbonOffsetSchema.index({
  name: 'text',
  description: 'text',
  'location.country': 'text',
  'location.state': 'text',
  'location.city': 'text'
});

// Virtual for availability percentage
carbonOffsetSchema.virtual('availabilityPercentage').get(function() {
  return this.totalCredits > 0 ? (this.availableCredits / this.totalCredits) * 100 : 0;
});

// Virtual for price category
carbonOffsetSchema.virtual('priceCategory').get(function() {
  if (this.pricePerTon < 1000) return 'budget';
  if (this.pricePerTon < 5000) return 'standard';
  if (this.pricePerTon < 10000) return 'premium';
  return 'luxury';
});

// Method to check if credits are available
carbonOffsetSchema.methods.hasAvailableCredits = function(amount) {
  return this.availableCredits >= amount && this.isActive;
};

// Method to reserve credits
carbonOffsetSchema.methods.reserveCredits = function(amount) {
  if (this.hasAvailableCredits(amount)) {
    this.availableCredits -= amount;
    return this.save();
  }
  throw new Error('Insufficient credits available');
};

// Method to release reserved credits
carbonOffsetSchema.methods.releaseCredits = function(amount) {
  this.availableCredits += amount;
  return this.save();
};

// Static method to get offset options by criteria
carbonOffsetSchema.statics.findByCriteria = function(criteria) {
  const query = { isActive: true, isVerified: true };
  
  if (criteria.type) query.type = criteria.type;
  if (criteria.minPrice || criteria.maxPrice) {
    query.pricePerTon = {};
    if (criteria.minPrice) query.pricePerTon.$gte = criteria.minPrice;
    if (criteria.maxPrice) query.pricePerTon.$lte = criteria.maxPrice;
  }
  if (criteria.location) {
    query['location.country'] = new RegExp(criteria.location, 'i');
  }
  if (criteria.minRating) query.rating = { $gte: criteria.minRating };
  if (criteria.tags && criteria.tags.length > 0) {
    query.tags = { $in: criteria.tags };
  }
  
  return this.find(query).sort({ rating: -1, pricePerTon: 1 });
};

module.exports = mongoose.model('CarbonOffset', carbonOffsetSchema);