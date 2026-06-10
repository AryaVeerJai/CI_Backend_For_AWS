const express = require('express');
const auth = require('../middleware/auth');
const { clientErrorPayload } = require('../utils/httpErrors');
const ComplianceHubRecord = require('../models/ComplianceHubRecord');
const complianceHubService = require('../services/complianceHubService');
const { requireMsmePlanFeature } = require('../middleware/enforceMsmePlanLimits');
const logger = require('../utils/logger');

const router = express.Router();

const requireOperational = [
  auth,
  auth.requireRole('msme', 'enterprise'),
  auth.requireOperationalProfile
];

const requireComplianceHub = [...requireOperational, requireMsmePlanFeature('complianceHub')];

router.get('/overview', ...requireComplianceHub, async (req, res) => {
  try {
    const period = req.query.period || 'annual';
    const data = await complianceHubService.getHubOverviewForUser(req.user, period);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Organization profile not found' });
    }
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Compliance hub overview error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load compliance hub overview',
      ...clientErrorPayload(error)
    });
  }
});

router.get('/india', ...requireComplianceHub, async (req, res) => {
  try {
    const period = req.query.period || 'annual';
    const data = await complianceHubService.getIndiaTrackForUser(req.user, period);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Organization profile not found' });
    }
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Compliance hub India track error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load India compliance track',
      ...clientErrorPayload(error)
    });
  }
});

router.get('/export', ...requireComplianceHub, async (req, res) => {
  try {
    const period = req.query.period || 'annual';
    const data = await complianceHubService.getExportTrackForUser(req.user, period);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Organization profile not found' });
    }
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Compliance hub export track error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load export compliance track',
      ...clientErrorPayload(error)
    });
  }
});

router.get('/record', ...requireComplianceHub, async (req, res) => {
  try {
    const record = await complianceHubService.ensureOrgHubRecord(req.user);
    return res.json({ success: true, data: record });
  } catch (error) {
    logger.error('Compliance hub record error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load compliance record',
      ...clientErrorPayload(error)
    });
  }
});

router.put('/sbti-targets', ...requireComplianceHub, async (req, res) => {
  try {
    const record = await complianceHubService.ensureOrgHubRecord(req.user);
    record.set('sbtiTargets', {
      ...(record.sbtiTargets?.toObject?.() || record.sbtiTargets || {}),
      ...req.body
    });
    await record.save();
    return res.json({ success: true, data: record.sbtiTargets });
  } catch (error) {
    logger.error('SBTi targets update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update SBTi targets',
      ...clientErrorPayload(error)
    });
  }
});

router.put('/assurance', ...requireComplianceHub, async (req, res) => {
  try {
    const record = await complianceHubService.ensureOrgHubRecord(req.user);
    const { checkpoints, ...rest } = req.body || {};
    record.set('assurance', {
      ...(record.assurance?.toObject?.() || record.assurance || {}),
      ...rest
    });
    if (Array.isArray(checkpoints)) {
      record.assurance.checkpoints = checkpoints;
    }
    if (rest.readinessStatus === 'assurance_ready') {
      record.assurance.lastReviewAt = new Date();
    }
    await record.save();
    return res.json({ success: true, data: record.assurance });
  } catch (error) {
    logger.error('Assurance update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update assurance workflow',
      ...clientErrorPayload(error)
    });
  }
});

router.put('/export-profile', ...requireComplianceHub, async (req, res) => {
  try {
    const record = await complianceHubService.ensureOrgHubRecord(req.user);
    record.set('exportProfile', {
      ...(record.exportProfile?.toObject?.() || record.exportProfile || {}),
      ...req.body
    });
    await record.save();
    return res.json({ success: true, data: record.exportProfile });
  } catch (error) {
    logger.error('Export profile update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update export profile',
      ...clientErrorPayload(error)
    });
  }
});

router.post('/action-plans', ...requireComplianceHub, async (req, res) => {
  try {
    const record = await complianceHubService.ensureOrgHubRecord(req.user);
    record.actionPlans.push(req.body);
    await record.save();
    return res.status(201).json({ success: true, data: record.actionPlans });
  } catch (error) {
    logger.error('Action plan create error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create action plan',
      ...clientErrorPayload(error)
    });
  }
});

router.patch('/action-plans/:planId', ...requireComplianceHub, async (req, res) => {
  try {
    const record = await complianceHubService.ensureOrgHubRecord(req.user);
    const plan = record.actionPlans.id(req.params.planId);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Action plan not found' });
    }
    Object.assign(plan, req.body);
    await record.save();
    return res.json({ success: true, data: plan });
  } catch (error) {
    logger.error('Action plan update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update action plan',
      ...clientErrorPayload(error)
    });
  }
});

router.post('/supplier-questionnaires', ...requireComplianceHub, async (req, res) => {
  try {
    const record = await complianceHubService.ensureOrgHubRecord(req.user);
    record.supplierQuestionnaires.push(req.body);
    await record.save();
    return res.status(201).json({ success: true, data: record.supplierQuestionnaires });
  } catch (error) {
    logger.error('Supplier questionnaire create error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create supplier questionnaire',
      ...clientErrorPayload(error)
    });
  }
});

router.patch('/supplier-questionnaires/:questionnaireId', ...requireComplianceHub, async (req, res) => {
  try {
    const record = await complianceHubService.ensureOrgHubRecord(req.user);
    const item = record.supplierQuestionnaires.id(req.params.questionnaireId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Questionnaire not found' });
    }
    Object.assign(item, req.body);
    await record.save();
    return res.json({ success: true, data: item });
  } catch (error) {
    logger.error('Supplier questionnaire update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update supplier questionnaire',
      ...clientErrorPayload(error)
    });
  }
});

router.post('/product-footprints', ...requireComplianceHub, async (req, res) => {
  try {
    const record = await complianceHubService.ensureOrgHubRecord(req.user);
    const payload = {
      ...req.body,
      lastCalculatedAt: new Date()
    };
    record.productFootprints.push(payload);
    await record.save();
    return res.status(201).json({ success: true, data: record.productFootprints });
  } catch (error) {
    logger.error('Product footprint create error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create product footprint',
      ...clientErrorPayload(error)
    });
  }
});

router.patch('/product-footprints/:footprintId', ...requireComplianceHub, async (req, res) => {
  try {
    const record = await complianceHubService.ensureOrgHubRecord(req.user);
    const item = record.productFootprints.id(req.params.footprintId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Product footprint not found' });
    }
    Object.assign(item, req.body, { lastCalculatedAt: new Date() });
    await record.save();
    return res.json({ success: true, data: item });
  } catch (error) {
    logger.error('Product footprint update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update product footprint',
      ...clientErrorPayload(error)
    });
  }
});

router.get('/export-pack/:framework', ...requireComplianceHub, async (req, res) => {
  try {
    const period = req.query.period || 'annual';
    const exportTrack = await complianceHubService.getExportTrackForUser(req.user, period);
    if (!exportTrack) {
      return res.status(404).json({ success: false, message: 'Organization profile not found' });
    }

    const key = String(req.params.framework || '').toLowerCase();
    const packMap = {
      cdp: exportTrack.modules.cdpClimate,
      csrd: exportTrack.modules.csrdSupplier,
      tcfd: exportTrack.modules.tcfdIssb,
      issb: exportTrack.modules.tcfdIssb,
      ecovadis: exportTrack.modules.ecovadis,
      eudr: exportTrack.modules.eudr,
      cbam: exportTrack.modules.cbamExporter
    };

    const pack = packMap[key];
    if (!pack) {
      return res.status(400).json({
        success: false,
        message: 'Unknown export pack. Use: cdp, csrd, tcfd, ecovadis, eudr, cbam'
      });
    }

    return res.json({ success: true, data: pack });
  } catch (error) {
    logger.error('Export pack error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate export pack',
      ...clientErrorPayload(error)
    });
  }
});

router.put('/zed-certification', ...requireComplianceHub, async (req, res) => {
  try {
    const record = await complianceHubService.ensureOrgHubRecord(req.user);
    const body = req.body || {};
    const existing = record.zedCertification?.toObject?.() || record.zedCertification || {};

    if (body.pledgeTaken === true && !existing.pledgeTaken) {
      body.pledgeTakenAt = new Date();
      body.journeyStatus = body.journeyStatus || 'pledge_taken';
    }

    if (body.certifiedLevel) {
      body.journeyStatus = 'certified';
      body.certifiedAt = body.certifiedAt || new Date();
    }

    record.set('zedCertification', {
      ...existing,
      ...body,
      parameterScores: Array.isArray(body.parameterScores)
        ? body.parameterScores
        : existing.parameterScores || []
    });
    await record.save();
    return res.json({ success: true, data: record.zedCertification });
  } catch (error) {
    logger.error('ZED certification update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update ZED certification profile',
      ...clientErrorPayload(error)
    });
  }
});

router.get('/india-pack/zed', ...requireComplianceHub, async (req, res) => {
  try {
    const period = req.query.period || 'annual';
    const india = await complianceHubService.getIndiaTrackForUser(req.user, period);
    if (!india) {
      return res.status(404).json({ success: false, message: 'Organization profile not found' });
    }
    return res.json({ success: true, data: india.modules.zedCertification });
  } catch (error) {
    logger.error('ZED readiness pack error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate ZED readiness pack',
      ...clientErrorPayload(error)
    });
  }
});

router.get('/india-pack/brsr-core', ...requireComplianceHub, async (req, res) => {
  try {
    const period = req.query.period || 'annual';
    const india = await complianceHubService.getIndiaTrackForUser(req.user, period);
    if (!india) {
      return res.status(404).json({ success: false, message: 'Organization profile not found' });
    }
    return res.json({ success: true, data: india.modules.brsrCoreSupplierPack });
  } catch (error) {
    logger.error('BRSR core pack error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate BRSR Core supplier pack',
      ...clientErrorPayload(error)
    });
  }
});

router.put('/recalculation-policy', ...requireComplianceHub, async (req, res) => {
  try {
    const MSME = require('../models/MSME');
    const GhgInventoryAuditLog = require('../models/GhgInventoryAuditLog');
    const { policyStatement = '', triggers = [] } = req.body || {};

    const msme = await MSME.findOne({ userId: req.user.userId || req.user._id });
    if (!msme) {
      return res.status(404).json({ success: false, message: 'MSME profile not found' });
    }

    const normalizedTriggers = Array.isArray(triggers)
      ? triggers.map((t) => String(t).trim()).filter(Boolean)
      : [];

    const previous = msme.manufacturingProfile?.recalculationPolicy || {};
    msme.set('manufacturingProfile.recalculationPolicy', {
      policyStatement: String(policyStatement || '').trim(),
      triggers: normalizedTriggers,
      lastUpdatedAt: new Date()
    });
    msme.markModified('manufacturingProfile');
    await msme.save();

    await GhgInventoryAuditLog.create({
      msmeId: msme._id,
      organizationId: msme.organizationId,
      eventType: 'recalculation_triggered',
      actorType: 'user',
      actorId: String(req.user.userId || req.user._id),
      summary: 'Recalculation policy updated',
      beforeSnapshot: previous,
      afterSnapshot: msme.manufacturingProfile.recalculationPolicy,
      metadata: { source: 'compliance_hub_ui' }
    }).catch(() => null);

    return res.json({
      success: true,
      data: msme.manufacturingProfile.recalculationPolicy
    });
  } catch (error) {
    logger.error('Recalculation policy update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update recalculation policy',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;
