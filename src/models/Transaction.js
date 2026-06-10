const mongoose = require('mongoose');
const carbonCalculationService = require('../services/carbonCalculationService');
const carbonCategoryTaxonomy = require('../../../shared/carbonCategoryTaxonomy');

const CARBON_RECALCULATION_FIELDS = [
  'amount',
  'category',
  'subcategory',
  'description',
  'currency',
  'sustainability.isGreen',
  'sustainability.greenScore',
  'industry',
  'businessDomain',
  'region',
  'state',
  'location.region',
  'location.state',
  'ownership',
  'emissionBoundary',
  'productAttribution'
];

const EXTRACTION_METHOD_PATTERN = /_extraction$/i;

const toPlainObject = (value) => (
  value && typeof value.toObject === 'function'
    ? value.toObject()
    : value
);

const hasNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const hasPersistedCarbonFootprint = (carbonFootprint = {}) => {
  const co2Emissions = Number(carbonFootprint.co2Emissions);
  const emissionFactor = Number(carbonFootprint.emissionFactor);
  const calculationMethod = carbonFootprint.calculationMethod;

  return (
    Number.isFinite(co2Emissions) &&
    Number.isFinite(emissionFactor) &&
    hasNonEmptyString(calculationMethod) &&
    !EXTRACTION_METHOD_PATTERN.test(calculationMethod.trim())
  );
};

const transactionSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    index: true
  },
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME'
  },
  source: {
    type: String,
    enum: [
      'sms',
      'email',
      'manual',
      'api',
      'excel',
      'tally',
      'zoho',
      'busy',
      'marg',
      'quickbooks',
      'erpnext',
      'odoo',
      'vyapar',
      'khatabook',
      'mybillbook',
      'clear',
      'profitbooks',
      'hostbooks'
    ],
    required: true
  },
  sourceId: {
    type: String, // ID from SMS or email system
    required: true
  },
  transactionType: {
    type: String,
    enum: ['purchase', 'sale', 'expense', 'investment', 'utility', 'transport', 'other'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'INR'
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  vendor: {
    name: String,
    category: String,
    location: String
  },
  category: {
    type: String,
    enum: require('../../../shared/carbonCategoryTaxonomy').TRANSACTION_CATEGORIES,
    required: true
  },
  subcategory: String,
  industry: String,
  businessDomain: String,
  region: String,
  state: String,
  location: {
    region: String,
    state: String,
    country: String
  },
  ownership: String,
  classificationContext: {
    sector: String,
    sectorLabel: String,
    industry: String,
    companyType: String,
    primaryProducts: [String],
    manufacturingUnits: Number,
    processes: [String],
    machinery: [String],
    productSignals: [String],
    matchedProcess: String,
    matchedMachinery: String,
    matchedProducts: [String],
    source: String
  },
  productAttribution: {
    assignedProducts: [{
      productId: {
        type: String,
        trim: true
      },
      productName: {
        type: String,
        trim: true
      },
      allocationPercent: {
        type: Number,
        min: 0,
        max: 100,
        default: 100
      }
    }],
    assignmentMethod: {
      type: String,
      trim: true
    },
    assignmentConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },
    assignmentSource: {
      type: String,
      trim: true
    },
    assignedAt: Date
  },
  emissionBoundary: {
    type: String,
    enum: ['company', 'product'],
    default: 'company'
  },
  emissionClassification: {
    level: {
      type: String,
      enum: ['company', 'product'],
      default: 'company'
    },
    reason: {
      type: String,
      trim: true
    }
  },
  date: {
    type: Date,
    required: true
  },
  carbonFootprint: {
    co2Emissions: {
      type: Number,
      default: 0
    },
    emissionFactor: {
      type: Number,
      default: 0
    },
    calculationMethod: String,
    quantificationMethod: String,
    dataQualityTier: String,
    ghgScope3Category: String,
    factorLineage: mongoose.Schema.Types.Mixed,
    scope2Reporting: mongoose.Schema.Types.Mixed,
    activityQuantity: Number,
    activityUnit: String,
    emissionBreakdown: {
      scope1: { type: Number, default: 0 },
      scope2: { type: Number, default: 0 },
      scope3: { type: Number, default: 0 }
    },
    calculationTimestamp: {
      type: Date,
      default: Date.now
    },
    dataSource: {
      type: String,
      enum: ['measured', 'estimated', 'default_factor', 'ai_calculated'],
      default: 'default_factor'
    }
  },
  sustainability: {
    isGreen: {
      type: Boolean,
      default: false
    },
    greenScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    sustainabilityFactors: [String]
  },
  metadata: {
    originalText: String, // Original SMS/email text
    extractedData: mongoose.Schema.Types.Mixed,
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    }
  },
  isProcessed: {
    type: Boolean,
    default: false
  },
  processedAt: Date,
  tags: [String],

  // Spam detection fields
  isSpam: {
    type: Boolean,
    default: false
  },
  spamScore: {
    type: Number,
    min: 0,
    default: 0
  },
  spamReasons: [String],
  spamConfidence: {
    type: Number,
    min: 0,
    max: 1,
    default: 0
  },

  // Duplicate detection fields
  isDuplicate: {
    type: Boolean,
    default: false
  },
  duplicateType: {
    type: String,
    enum: ['exact', 'near', 'fuzzy', null],
    default: null
  },
  similarityScore: {
    type: Number,
    min: 0,
    max: 1,
    default: 0
  },
  matchedTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null
  },
  duplicateReasons: [String]
}, {
  timestamps: true
});

transactionSchema.pre('validate', function normalizeCarbonTaxonomy(next) {
  if (this.category) {
    this.category = carbonCategoryTaxonomy.normalizeTransactionCategory(this.category);
  }
  if (this.subcategory) {
    this.subcategory = carbonCategoryTaxonomy.normalizeSubcategoryForCategory(
      this.subcategory,
      this.category || 'other'
    );
  }
  return next();
});

transactionSchema.pre('validate', function attachCarbonMetrics(next) {
  const transactionData = this.toObject({ depopulate: true });
  const existingFootprint = toPlainObject(this.carbonFootprint) || {};
  const shouldRecalculateFromFieldChanges = !this.isNew && CARBON_RECALCULATION_FIELDS.some(field => this.isModified(field));
  const shouldRecalculate = !hasPersistedCarbonFootprint(existingFootprint) || shouldRecalculateFromFieldChanges;

  if (shouldRecalculate) {
    const calculatedFootprint = carbonCalculationService.calculateTransactionCarbonFootprint(transactionData);
    this.carbonFootprint = carbonCalculationService.ensureCarbonFootprintMetrics(
      transactionData,
      calculatedFootprint
    );
    return next();
  }

  this.carbonFootprint = carbonCalculationService.ensureCarbonFootprintMetrics(
    transactionData,
    existingFootprint
  );
  return next();
});

transactionSchema.pre('validate', function validateOrgScope(next) {
  if (!this.msmeId && !this.organizationId) {
    this.invalidate('organizationId', 'organizationId or msmeId is required');
  }
  return next();
});

// Indexes for efficient queries
transactionSchema.index({ organizationId: 1, date: -1 });
transactionSchema.index({ msmeId: 1, date: -1 });
transactionSchema.index({ source: 1, sourceId: 1 });
transactionSchema.index({ category: 1, date: -1 });
transactionSchema.index({ 'carbonFootprint.co2Emissions': -1 });
transactionSchema.index({ description: 'text' });
transactionSchema.index({ isSpam: 1, msmeId: 1 });
transactionSchema.index({ isDuplicate: 1, msmeId: 1 });
transactionSchema.index({ msmeId: 1, date: -1, isSpam: 1, isDuplicate: 1 });
transactionSchema.index({ msmeId: 1, 'productAttribution.assignedProducts.productName': 1, date: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);