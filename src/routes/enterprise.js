const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const Enterprise = require('../models/Enterprise');
const {
  buildInitialWorkflow,
  runEnterpriseAgentPipeline,
  markWorkflowProgress
} = require('../services/enterpriseEmissionsOrchestrationService');
const { getSectionGuidance } = require('../services/enterpriseWorkflowAgentService');
const orchestrationManagerEventService = require('../services/orchestrationManagerEventService');
const logger = require('../utils/logger');
const { createOrganizationForEnterprise } = require('../services/organizationService');
const {
  buildEnterpriseIntelligence,
  syncConnectorsAndAnalyze
} = require('../services/enterpriseIntelligenceService');
const { ENTERPRISE_PRICING_FRAMEWORK } = require('../config/pricingCatalog');
const { getOperationalProfile } = require('../services/organizationProfileService');
const carbonCalculationService = require('../services/carbonCalculationService');
const Transaction = require('../models/Transaction');
const CarbonAssessment = require('../models/CarbonAssessment');
const Document = require('../models/Document');
const { mergeOrgFilter, withOrgPayload, buildOrgDataFilter } = require('../utils/orgDataScope');
const {
  evaluateEnterpriseSectionEvidence,
  buildEvidenceContext
} = require('../services/enterpriseWorkflowEvidenceService');

const router = express.Router();

const SCOPE3_CATEGORY_NAMES = [
  'Purchased goods and services',
  'Capital goods',
  'Fuel- and energy-related activities',
  'Upstream transportation and distribution',
  'Waste generated in operations',
  'Business travel',
  'Employee commuting',
  'Upstream leased assets',
  'Downstream transportation and distribution',
  'Processing of sold products',
  'Use of sold products',
  'End-of-life treatment of sold products',
  'Downstream leased assets',
  'Franchises',
  'Investments'
];

const defaultScope3Categories = () => SCOPE3_CATEGORY_NAMES.map((category) => ({
  category,
  material: ['Purchased goods and services', 'Upstream transportation and distribution', 'Business travel']
    .includes(category),
  coveragePercent: 0
}));

const CIN_REGEX = /^[A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

const requireEnterpriseRole = auth.requireRole('enterprise');

router.get('/profile', auth, requireEnterpriseRole, async (req, res) => {
  try {
    const profile = await Enterprise.findOne({ userId: req.user.userId });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Enterprise profile not found' });
    }
    return res.json({ success: true, data: profile });
  } catch (error) {
    logger.error('Get enterprise profile error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.post('/register', auth, requireEnterpriseRole, [
  body('companyName').notEmpty().withMessage('Company name is required'),
  body('cinNumber').matches(CIN_REGEX).withMessage('Valid CIN is required'),
  body('industry').notEmpty().withMessage('Industry is required'),
  body('contact.email').isEmail().withMessage('Valid email is required'),
  body('contact.phone').notEmpty().withMessage('Phone is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const existing = await Enterprise.findOne({ userId: req.user.userId });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Enterprise profile already exists' });
    }

    const payload = {
      ...req.body,
      userId: req.user.userId,
      cinNumber: String(req.body.cinNumber).toUpperCase(),
      complianceWorkflow: {
        sections: buildInitialWorkflow()
      }
    };

    const enterprise = await Enterprise.create(payload);

    await createOrganizationForEnterprise(req.user.userId, enterprise);

    await orchestrationManagerEventService.emitEvent('enterprise.registered', {
      userId: req.user.userId,
      enterpriseId: enterprise._id
    });

    return res.status(201).json({ success: true, message: 'Enterprise profile created', data: enterprise });
  } catch (error) {
    logger.error('Enterprise registration error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.put('/profile', auth, requireEnterpriseRole, async (req, res) => {
  try {
    const enterprise = await Enterprise.findOneAndUpdate(
      { userId: req.user.userId },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!enterprise) {
      return res.status(404).json({ success: false, message: 'Enterprise profile not found' });
    }
    return res.json({ success: true, data: enterprise });
  } catch (error) {
    logger.error('Update enterprise profile error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.patch('/operations', auth, requireEnterpriseRole, async (req, res) => {
  try {
    const enterprise = await Enterprise.findOne({ userId: req.user.userId });
    if (!enterprise) {
      return res.status(404).json({ success: false, message: 'Enterprise profile not found' });
    }

    const updates = {};
    if (Array.isArray(req.body.facilities)) {
      updates.facilities = req.body.facilities;
    }
    if (req.body.scope3Materiality) {
      updates.scope3Materiality = {
        ...enterprise.scope3Materiality,
        ...req.body.scope3Materiality,
        lastAssessedAt: new Date()
      };
    }
    ['consolidationApproach', 'reportingEntityType', 'listingStatus', 'brsrApplicability'].forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    Object.assign(enterprise, updates);
    await enterprise.save();

    return res.json({ success: true, data: enterprise });
  } catch (error) {
    logger.error('Update enterprise operations error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.post('/inventory/assess', auth, requireEnterpriseRole, async (req, res) => {
  try {
    const operational = await getOperationalProfile(req.user);
    if (!operational) {
      return res.status(404).json({ success: false, message: 'Enterprise profile not found' });
    }

    const now = new Date();
    const startDate = req.body.startDate
      ? new Date(req.body.startDate)
      : new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endDate = req.body.endDate ? new Date(req.body.endDate) : now;

    const transactions = await Transaction.find(
      mergeOrgFilter(req, {
        date: { $gte: startDate, $lte: endDate },
        isSpam: { $ne: true },
        isDuplicate: { $ne: true }
      })
    ).lean();

    const calculated = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
      operational.profile,
      transactions
    );

    let agentInsights = null;
    if (req.body.runAgents !== false && operational.profile?.enterpriseProfile) {
      const pipelineResult = await runEnterpriseAgentPipeline(operational.profile.enterpriseProfile);
      agentInsights = {
        summary: pipelineResult.summary,
        gaps: pipelineResult.compliance?.gaps,
        mandates: pipelineResult.compliance?.applicableMandates
      };
      await Enterprise.findByIdAndUpdate(req.user.enterpriseId, {
        agentInsights: {
          lastRunAt: new Date(),
          summary: pipelineResult.summary,
          mandates: pipelineResult.compliance?.applicableMandates,
          gaps: pipelineResult.compliance?.gaps,
          recommendations: pipelineResult.orchestrationResults
        },
        carbonScore: pipelineResult.compliance?.readinessScore
      });
    }

    const assessmentPayload = withOrgPayload(req, {
      assessmentType: 'enterprise_inventory',
      period: { startDate, endDate },
      status: 'completed',
      ...calculated
    });

    const assessment = await CarbonAssessment.create(assessmentPayload);

    return res.json({
      success: true,
      data: {
        assessment,
        agentInsights,
        transactionCount: transactions.length
      }
    });
  } catch (error) {
    logger.error('Enterprise inventory assessment error:', error);
    return res.status(500).json({ success: false, message: 'Inventory assessment failed' });
  }
});

router.get('/scope3-template', auth, requireEnterpriseRole, (_req, res) => {
  return res.json({ success: true, data: { categories: defaultScope3Categories() } });
});

router.get('/workflow', auth, requireEnterpriseRole, async (req, res) => {
  try {
    const enterprise = await Enterprise.findOne({ userId: req.user.userId });
    if (!enterprise) {
      return res.status(404).json({ success: false, message: 'Enterprise profile not found' });
    }
    const sections = enterprise.complianceWorkflow?.sections?.length
      ? enterprise.complianceWorkflow.sections
      : buildInitialWorkflow();

    const [transactionCount, documentCount, assessmentCount] = await Promise.all([
      Transaction.countDocuments(mergeOrgFilter(req, {})),
      Document.countDocuments(buildOrgDataFilter(req, {})),
      CarbonAssessment.countDocuments(mergeOrgFilter(req, {}))
    ]);

    const evidenceContext = buildEvidenceContext(enterprise.toObject(), {
      transactionCount,
      documentCount,
      assessmentCount
    });

    const sectionEvidence = sections.reduce((acc, section) => {
      acc[section.key] = evaluateEnterpriseSectionEvidence(section.key, evidenceContext);
      return acc;
    }, {});

    return res.json({
      success: true,
      data: {
        sections,
        sectionEvidence,
        lastOrchestratedAt: enterprise.complianceWorkflow?.lastOrchestratedAt
      }
    });
  } catch (error) {
    logger.error('Get enterprise workflow error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.post('/workflow/section/:sectionKey/guidance', auth, requireEnterpriseRole, async (req, res) => {
  try {
    const enterprise = await Enterprise.findOne({ userId: req.user.userId });
    if (!enterprise) {
      return res.status(404).json({ success: false, message: 'Enterprise profile not found' });
    }
    const guidance = await getSectionGuidance(req.params.sectionKey, enterprise.toObject());
    return res.json({ success: true, data: guidance });
  } catch (error) {
    logger.error('Enterprise section guidance error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.post('/workflow/complete-section', auth, requireEnterpriseRole, [
  body('sectionKey').notEmpty()
], async (req, res) => {
  try {
    const enterprise = await Enterprise.findOne({ userId: req.user.userId });
    if (!enterprise) {
      return res.status(404).json({ success: false, message: 'Enterprise profile not found' });
    }

    const [transactionCount, documentCount, assessmentCount] = await Promise.all([
      Transaction.countDocuments(mergeOrgFilter(req, {})),
      Document.countDocuments(buildOrgDataFilter(req, {})),
      CarbonAssessment.countDocuments(mergeOrgFilter(req, {}))
    ]);

    const evidenceContext = buildEvidenceContext(enterprise.toObject(), {
      transactionCount,
      documentCount,
      assessmentCount
    });

    const evidence = evaluateEnterpriseSectionEvidence(req.body.sectionKey, evidenceContext);
    if (!evidence.canComplete) {
      return res.status(400).json({
        success: false,
        message: 'Section cannot be completed until required evidence is in place',
        data: { missing: evidence.missing, actionPath: evidence.actionPath, actionLabel: evidence.actionLabel }
      });
    }

    const completedKeys = [
      ...(enterprise.complianceWorkflow?.sections || [])
        .filter((s) => s.status === 'completed')
        .map((s) => s.key),
      req.body.sectionKey
    ];
    const uniqueCompleted = [...new Set(completedKeys)];
    const sections = markWorkflowProgress(
      enterprise.complianceWorkflow?.sections?.length
        ? enterprise.complianceWorkflow.sections
        : buildInitialWorkflow(),
      uniqueCompleted
    );

    enterprise.complianceWorkflow = {
      ...enterprise.complianceWorkflow,
      sections
    };
    await enterprise.save();

    return res.json({ success: true, data: { sections } });
  } catch (error) {
    logger.error('Complete enterprise section error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.post('/orchestrate', auth, requireEnterpriseRole, async (req, res) => {
  try {
    const enterprise = await Enterprise.findOne({ userId: req.user.userId });
    if (!enterprise) {
      return res.status(404).json({ success: false, message: 'Enterprise profile not found' });
    }

    const pipelineResult = await runEnterpriseAgentPipeline(enterprise.toObject());
    const allKeys = (enterprise.complianceWorkflow?.sections || buildInitialWorkflow()).map((s) => s.key);
    const sections = markWorkflowProgress(
      enterprise.complianceWorkflow?.sections?.length
        ? enterprise.complianceWorkflow.sections
        : buildInitialWorkflow(),
      allKeys
    );

    enterprise.complianceWorkflow = {
      sections,
      lastOrchestratedAt: new Date(),
      orchestrationRunId: `ent-${Date.now()}`
    };
    enterprise.agentInsights = {
      lastRunAt: new Date(),
      summary: pipelineResult.summary,
      mandates: pipelineResult.compliance?.applicableMandates,
      gaps: pipelineResult.compliance?.gaps,
      recommendations: pipelineResult.orchestrationResults
    };
    enterprise.carbonScore = pipelineResult.compliance?.readinessScore || enterprise.carbonScore;
    await enterprise.save();

    await orchestrationManagerEventService.emitEvent('enterprise.orchestrated', {
      userId: req.user.userId,
      enterpriseId: enterprise._id
    });

    return res.json({ success: true, data: pipelineResult, profile: enterprise });
  } catch (error) {
    logger.error('Enterprise orchestration error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.get('/intelligence', auth, requireEnterpriseRole, async (req, res) => {
  try {
    const enterprise = await Enterprise.findOne({ userId: req.user.userId });
    if (!enterprise) {
      return res.status(404).json({ success: false, message: 'Enterprise profile not found' });
    }

    const data = await buildEnterpriseIntelligence(req, {
      period: req.query.period || 'annual',
      runAgents: req.query.runAgents !== 'false',
      includeForecast: req.query.includeForecast !== 'false'
    });

    if (!data.success) {
      return res.status(400).json({ success: false, message: data.message });
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Enterprise intelligence error:', error);
    return res.status(500).json({ success: false, message: 'Failed to build enterprise intelligence' });
  }
});

router.post('/sync-connectors', auth, requireEnterpriseRole, async (req, res) => {
  try {
    const enterprise = await Enterprise.findOne({ userId: req.user.userId });
    if (!enterprise) {
      return res.status(404).json({ success: false, message: 'Enterprise profile not found' });
    }

    const result = await syncConnectorsAndAnalyze(req);
    return res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Enterprise connector sync error:', error);
    return res.status(500).json({ success: false, message: 'Connector sync failed' });
  }
});

router.get('/pricing', auth, requireEnterpriseRole, async (req, res) => {
  try {
    return res.json({
      success: true,
      data: {
        ...ENTERPRISE_PRICING_FRAMEWORK,
        note: 'Enterprise pricing is annual and sales-led. Contact Sustainow for a formal proposal.'
      }
    });
  } catch (error) {
    logger.error('Enterprise pricing error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load enterprise pricing' });
  }
});

module.exports = router;
