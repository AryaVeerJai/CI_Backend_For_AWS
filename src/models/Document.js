const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    index: true
  },
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME'
  },
  fileName: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  documentType: {
    type: String,
    enum: ['bill', 'receipt', 'invoice', 'statement', 'other'],
    required: true
  },
  status: {
    type: String,
    enum: ['uploaded', 'processing', 'processed', 'failed', 'duplicate'],
    default: 'uploaded'
  },
  extractedData: {
    vendor: {
      name: String,
      address: String,
      phone: String,
      email: String
    },
    amount: Number,
    currency: {
      type: String,
      default: 'INR'
    },
    date: Date,
    description: String,
    category: {
      type: String,
      enum: require('../../../shared/carbonCategoryTaxonomy').DOCUMENT_CATEGORIES
    },
    subcategory: {
  type: String,
  default: 'general'
},
    items: [{
      name: String,
      quantity: Number,
      unit: String,
      price: Number,
      total: Number,
      category: String,
      subcategory: String,
      carbonFootprint: {
        co2Emissions: {
          type: Number,
          default: 0
        },
        emissionFactor: {
          type: Number,
          default: 0
        },
        calculationMethod: String
      }
    }],
    tax: {
      cgst: Number,
      sgst: Number,
      igst: Number,
      total: Number
    },
    gstin: String,
    seller_gstin: String,
    buyer_gstin: String,
    paymentMethod: String,
    referenceNumber: String,
    ocr_validation: mongoose.Schema.Types.Mixed,
    ocr_metadata: mongoose.Schema.Types.Mixed
  },
  ocrValidation: mongoose.Schema.Types.Mixed,
  processingResults: {
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },
    processingTime: Number, // in milliseconds
    errors: [String],
    warnings: [String],
    ocrValidation: mongoose.Schema.Types.Mixed
  },
  duplicateDetection: {
    isDuplicate: {
      type: Boolean,
      default: false
    },
    duplicateType: {
      type: String,
      enum: ['exact', 'near', 'fuzzy',null],
      default: null
    },
    similarityScore: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },
    matchedDocumentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      default: null
    },
    duplicateReasons: [String]
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
    sustainabilityScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    }
  },
  carbonAnalysis: {
    totalCO2Emissions: {
      type: Number,
      default: 0
    },
    totalAmount: {
      type: Number,
      default: 0
    },
    transactionCount: {
      type: Number,
      default: 0
    },
    categoryBreakdown: mongoose.Schema.Types.Mixed,
    breakdown: mongoose.Schema.Types.Mixed,
    esgScopes: mongoose.Schema.Types.Mixed,
    carbonScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    recommendations: [mongoose.Schema.Types.Mixed],
    calculatedAt: Date,
    calculationMethod: String
  },
  metadata: {
    uploadSource: {
      type: String,
      enum: ['web', 'mobile', 'api'],
      default: 'web'
    },
    userAgent: String,
    ipAddress: String,
    processingVersion: String,
    ocr: mongoose.Schema.Types.Mixed,
    selectedProducts: mongoose.Schema.Types.Mixed
  },
  tags: [String],
  notes: String
}, {
  timestamps: true
});


documentSchema.pre('validate', function validateOrgScope(next) {
  if (!this.msmeId && !this.organizationId) {
    this.invalidate('organizationId', 'organizationId or msmeId is required');
  }
  return next();
});

// Indexes for efficient queries
documentSchema.set('strict', false);
documentSchema.index({ organizationId: 1, createdAt: -1 });
documentSchema.index({ msmeId: 1, createdAt: -1 });
documentSchema.index({ documentType: 1, status: 1 });
documentSchema.index({ 'extractedData.amount': -1 });
documentSchema.index({ 'extractedData.date': -1 });
documentSchema.index({ 'duplicateDetection.isDuplicate': 1, msmeId: 1 });
documentSchema.index({ status: 1, msmeId: 1 });
documentSchema.index({ fileName: 'text', 'extractedData.description': 'text' });

module.exports = mongoose.model('Document', documentSchema);