const mongoose = require('mongoose');

const actionPlanSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    scope: { type: String, enum: ['scope1', 'scope2', 'scope3', 'organization'], default: 'organization' },
    targetReductionPercent: { type: Number, default: 0 },
    startDate: { type: Date },
    dueDate: { type: Date },
    capexInr: { type: Number, default: 0 },
    opexInr: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['planned', 'in_progress', 'completed', 'deferred'],
      default: 'planned'
    },
    outcomeNotes: { type: String, default: '' },
    verifiedSavingsKgCo2e: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const supplierQuestionnaireSchema = new mongoose.Schema(
  {
    buyerName: { type: String, required: true, trim: true },
    buyerContactEmail: { type: String, trim: true },
    framework: {
      type: String,
      enum: ['brsr_core', 'cdp', 'csrd', 'ecovadis', 'custom'],
      default: 'brsr_core'
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'responded', 'accepted', 'revision_requested'],
      default: 'draft'
    },
    dueDate: { type: Date },
    responses: { type: mongoose.Schema.Types.Mixed, default: {} },
    evidenceDocumentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Document' }]
  },
  { timestamps: true }
);

const productFootprintSchema = new mongoose.Schema(
  {
    sku: { type: String, trim: true },
    productName: { type: String, required: true, trim: true },
    functionalUnit: { type: String, default: '1 unit' },
    allocationMethod: {
      type: String,
      enum: ['mass', 'economic', 'physical', 'energy'],
      default: 'mass'
    },
    cradleToGateKgCo2e: { type: Number, default: 0 },
    lifecycleStages: {
      rawMaterials: { type: Number, default: 0 },
      manufacturing: { type: Number, default: 0 },
      distribution: { type: Number, default: 0 },
      usePhase: { type: Number, default: 0 },
      endOfLife: { type: Number, default: 0 }
    },
    exportMarkets: [{ type: String, trim: true }],
    lastCalculatedAt: { type: Date }
  },
  { timestamps: true }
);

const complianceHubRecordSchema = new mongoose.Schema(
  {
    msmeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MSME',
      required: false,
      sparse: true,
      index: true
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: false,
      sparse: true,
      unique: true,
      index: true
    },
    sbtiTargets: {
      baseYear: { type: Number },
      nearTermTargetYear: { type: Number },
      nearTermReductionPercent: { type: Number, default: 0 },
      longTermTargetYear: { type: Number },
      netZeroTargetYear: { type: Number },
      status: {
        type: String,
        enum: ['not_started', 'committed', 'targets_set', 'submitted', 'validated'],
        default: 'not_started'
      },
      flagSectorApplicable: { type: Boolean, default: false },
      notes: { type: String, default: '' }
    },
    assurance: {
      readinessStatus: {
        type: String,
        enum: ['not_ready', 'in_progress', 'ready_for_review', 'assurance_ready'],
        default: 'not_ready'
      },
      intendedAssuranceLevel: {
        type: String,
        enum: ['none', 'limited', 'reasonable'],
        default: 'limited'
      },
      leadReviewer: { type: String, default: '' },
      lastReviewAt: { type: Date },
      evidenceRetentionYears: { type: Number, default: 7 },
      checkpoints: [
        {
          id: String,
          label: String,
          completed: { type: Boolean, default: false },
          completedAt: Date
        }
      ]
    },
    actionPlans: [actionPlanSchema],
    supplierQuestionnaires: [supplierQuestionnaireSchema],
    productFootprints: [productFootprintSchema],
    exportProfile: {
      primaryRegions: [{ type: String, trim: true }],
      cbamGoodsCategories: [{ type: String, trim: true }],
      eudrApplicable: { type: Boolean, default: false },
      ecovadisLastScore: { type: Number },
      ecovadisLastAssessmentAt: { type: Date }
    },
    zedCertification: {
      journeyStatus: {
        type: String,
        enum: ['not_started', 'pledge_taken', 'in_progress', 'ready_for_assessment', 'certified', 'expired'],
        default: 'not_started'
      },
      pledgeTaken: { type: Boolean, default: false },
      pledgeTakenAt: { type: Date },
      targetLevel: {
        type: String,
        enum: ['bronze', 'silver', 'gold'],
        default: 'bronze'
      },
      certifiedLevel: {
        type: String,
        enum: ['bronze', 'silver', 'gold', null],
        default: null
      },
      certifiedAt: { type: Date },
      certificateNumber: { type: String, default: '', trim: true },
      certifyingAgency: { type: String, default: '', trim: true },
      validUntil: { type: Date },
      isWomenOrScStOwned: { type: Boolean, default: false },
      isInPriorityRegion: { type: Boolean, default: false },
      parameterScores: [
        {
          id: String,
          maturityStage: {
            type: String,
            enum: ['not_defined', 'defined', 'implemented', 'monitored', 'reviewed'],
            default: 'not_defined'
          },
          evidence: [{ type: String, trim: true }],
          notes: { type: String, default: '' }
        }
      ],
      notes: { type: String, default: '' }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ComplianceHubRecord', complianceHubRecordSchema);
