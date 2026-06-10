const mongoose = require('mongoose');

const bankSchema = new mongoose.Schema({
  bankName: {
    type: String,
    required: true,
    trim: true
  },
  bankCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  contact: {
    email: {
      type: String,
      required: true,
      lowercase: true
    },
    phone: {
      type: String,
      required: true
    },
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: {
        type: String,
        default: 'India'
      }
    }
  },
  greenLoanPolicy: {
    minCarbonScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 60
    },
    maxLoanAmount: {
      type: Number,
      required: true,
      default: 10000000 // 1 crore
    },
    minLoanAmount: {
      type: Number,
      required: true,
      default: 100000 // 1 lakh
    },
    interestRateRange: {
      min: {
        type: Number,
        required: true,
        default: 8.5
      },
      max: {
        type: Number,
        required: true,
        default: 12.5
      }
    },
    tenureRange: {
      min: {
        type: Number,
        required: true,
        default: 12 // months
      },
      max: {
        type: Number,
        required: true,
        default: 60 // months
      }
    },
    carbonScoreDiscounts: [{
      scoreRange: {
        min: Number,
        max: Number
      },
      discountPercentage: Number
    }],
    requiredDocuments: [String],
    eligibilityCriteria: [String]
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries
bankSchema.index({ bankCode: 1 });
bankSchema.index({ bankName: 'text' });
bankSchema.index({ isActive: 1 });

module.exports = mongoose.model('Bank', bankSchema);