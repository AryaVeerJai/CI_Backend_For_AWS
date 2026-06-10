const mongoose = require('mongoose');

const enterpriseWorkflowSectionSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed'],
    default: 'pending'
  },
  agentGuidance: { type: mongoose.Schema.Types.Mixed },
  completedAt: Date
}, { _id: false });

const enterpriseSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    sparse: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  companyName: {
    type: String,
    required: true,
    trim: true
  },
  cinNumber: {
    type: String,
    required: true,
    uppercase: true,
    match: /^[A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/
  },
  gstNumber: {
    type: String,
    sparse: true,
    match: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
  },
  panNumber: {
    type: String,
    sparse: true,
    match: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
  },
  listingStatus: {
    type: String,
    enum: ['listed', 'unlisted', 'subsidiary_of_listed', 'public_sector'],
    default: 'unlisted'
  },
  stockExchanges: [{
    type: String,
    enum: ['BSE', 'NSE', 'both', 'none']
  }],
  brsrApplicability: {
    type: String,
    enum: ['mandatory_top1000', 'mandatory_value_chain', 'voluntary', 'not_applicable'],
    default: 'mandatory_top1000'
  },
  reportingEntityType: {
    type: String,
    enum: ['standalone', 'consolidated', 'holding_company'],
    default: 'consolidated'
  },
  consolidationApproach: {
    type: String,
    enum: ['equity_share', 'operational_control', 'financial_control'],
    default: 'operational_control'
  },
  industry: { type: String, required: true, trim: true },
  sector: { type: String, trim: true },
  financialYearEnd: { type: String, default: '31-Mar' },
  contact: {
    email: { type: String, required: true, lowercase: true },
    phone: { type: String, required: true },
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: { type: String, default: 'India' }
    }
  },
  regulatoryMandates: {
    sebiBrsr: { type: Boolean, default: true },
    brsrCoreValueChain: { type: Boolean, default: true },
    patScheme: { type: Boolean, default: false },
    indianCarbonMarket: { type: Boolean, default: false },
    greenCreditProgramme: { type: Boolean, default: false },
    cbamExport: { type: Boolean, default: false }
  },
  facilities: [{
    name: String,
    state: String,
    operationalControl: { type: Boolean, default: true },
    scope1Sources: [String],
    scope2Sources: [String]
  }],
  scope3Materiality: {
    categories: [{
      category: String,
      material: { type: Boolean, default: false },
      coveragePercent: Number
    }],
    lastAssessedAt: Date
  },
  complianceWorkflow: {
    sections: [enterpriseWorkflowSectionSchema],
    lastOrchestratedAt: Date,
    orchestrationRunId: String
  },
  agentInsights: {
    lastRunAt: Date,
    summary: String,
    mandates: [mongoose.Schema.Types.Mixed],
    gaps: [mongoose.Schema.Types.Mixed],
    recommendations: [mongoose.Schema.Types.Mixed]
  },
  carbonScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Enterprise', enterpriseSchema);
