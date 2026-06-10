const mongoose = require('mongoose');

const carbonTradingSchema = new mongoose.Schema({
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    required: true,
    unique: true
  },
  totalCredits: {
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
  totalInvestment: {
    type: Number,
    default: 0,
    min: 0
  },
  averagePrice: {
    type: Number,
    default: 0,
    min: 0
  },
  lastPurchase: {
    type: Date,
    default: null
  },
  transactions: [{
    type: {
      type: String,
      enum: ['purchase', 'offset', 'transfer', 'refund'],
      required: true
    },
    offsetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CarbonOffset',
      required: function() {
        return this.type === 'purchase';
      }
    },
    offsetName: {
      type: String,
      required: function() {
        return this.type === 'purchase';
      }
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    pricePerTon: {
      type: Number,
      required: function() {
        return this.type === 'purchase';
      },
      min: 0
    },
    totalCost: {
      type: Number,
      required: function() {
        return this.type === 'purchase';
      },
      min: 0
    },
    description: {
      type: String,
      required: function() {
        return this.type === 'offset';
      }
    },
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
  preferences: {
    autoOffset: {
      type: Boolean,
      default: false
    },
    offsetThreshold: {
      type: Number,
      default: 100 // kg CO2
    },
    preferredTypes: [{
      type: String,
      enum: ['renewable_energy', 'reforestation', 'carbon_capture', 'energy_efficiency']
    }],
    maxPricePerTon: {
      type: Number,
      default: 10000 // ₹10,000
    }
  }
}, {
  timestamps: true
});

// Index for efficient queries
carbonTradingSchema.index({ msmeId: 1 });
carbonTradingSchema.index({ 'transactions.timestamp': -1 });
carbonTradingSchema.index({ 'transactions.type': 1 });

// Virtual for calculating portfolio value
carbonTradingSchema.virtual('portfolioValue').get(function() {
  return this.availableCredits * this.averagePrice;
});

// Method to add transaction
carbonTradingSchema.methods.addTransaction = function(transactionData) {
  this.transactions.push(transactionData);
  return this.save();
};

// Method to calculate offset potential
carbonTradingSchema.methods.calculateOffsetPotential = function(currentEmissions) {
  const offsetPercentage = this.availableCredits > 0 
    ? Math.min((this.availableCredits * 1000) / currentEmissions * 100, 100) // Convert tons to kg
    : 0;
  
  return {
    canFullyOffset: offsetPercentage >= 100,
    offsetPercentage: Math.round(offsetPercentage * 100) / 100,
    remainingEmissions: Math.max(currentEmissions - (this.availableCredits * 1000), 0),
    creditsNeeded: Math.max((currentEmissions - (this.availableCredits * 1000)) / 1000, 0)
  };
};

module.exports = mongoose.model('CarbonTrading', carbonTradingSchema);