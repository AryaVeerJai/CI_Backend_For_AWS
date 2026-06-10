const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const MSME = require('../models/MSME');
const { clientErrorPayload } = require('../utils/httpErrors');
const logger = require('../utils/logger');
const { JOURNEY_STAGES, BEE_SECTORS, PHASE1_CLUSTERS } = require('../config/adeetie');
const adeetieService = require('../services/adeetieEligibilityService');
const { normalizeMSMEPayload } = require('../utils/manufacturingProfile');

const router = express.Router();

const loadMsme = async (userId) => MSME.findOne({ userId });

// @route   GET /api/adeetie/scheme
// @desc    ADEETIE scheme metadata (sectors, clusters, rates)
// @access  Public
router.get('/scheme', (req, res) => {
  res.json({
    success: true,
    data: adeetieService.getSchemeMetadata()
  });
});

// @route   GET /api/adeetie/clusters
router.get('/clusters', (req, res) => {
  const { sectorId, state } = req.query;
  let clusters = [...PHASE1_CLUSTERS];
  if (sectorId) {
    clusters = clusters.filter((c) => c.sectorId === sectorId);
  }
  if (state) {
    clusters = clusters.filter(
      (c) => c.state.toLowerCase() === String(state).toLowerCase()
    );
  }
  res.json({ success: true, data: { clusters, sectors: BEE_SECTORS } });
});

// @route   GET /api/adeetie/overview
// @desc    Eligibility + readiness + journey for logged-in MSME
// @access  Private
router.get('/overview', auth, async (req, res) => {
  try {
    const msme = await loadMsme(req.user.userId);
    if (!msme) {
      return res.status(404).json({ success: false, message: 'MSME profile not found' });
    }

    const [readiness, inferredSector] = await Promise.all([
      adeetieService.computeReadinessScore(msme),
      Promise.resolve(adeetieService.inferBeeSector(msme))
    ]);

    if (!msme.manufacturingProfile?.beeSector && inferredSector) {
      msme.manufacturingProfile = msme.manufacturingProfile || {};
      msme.manufacturingProfile.beeSector = inferredSector;
    }

    res.json({
      success: true,
      data: {
        scheme: adeetieService.getSchemeMetadata(),
        eligibility: readiness.eligibility,
        readiness,
        journey: msme.adeetieJourney || { stage: 'not_started', updatedAt: null },
        inferredBeeSector: inferredSector
      }
    });
  } catch (error) {
    logger.error('ADEETIE overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/adeetie/eligibility
router.get('/eligibility', auth, async (req, res) => {
  try {
    const msme = await loadMsme(req.user.userId);
    if (!msme) {
      return res.status(404).json({ success: false, message: 'MSME profile not found' });
    }
    const loanAmount = req.query.loanAmount ? Number(req.query.loanAmount) : undefined;
    res.json({
      success: true,
      data: adeetieService.evaluateEligibility(msme, { loanAmount })
    });
  } catch (error) {
    logger.error('ADEETIE eligibility error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/adeetie/readiness
router.get('/readiness', auth, async (req, res) => {
  try {
    const msme = await loadMsme(req.user.userId);
    if (!msme) {
      return res.status(404).json({ success: false, message: 'MSME profile not found' });
    }
    res.json({
      success: true,
      data: await adeetieService.computeReadinessScore(msme)
    });
  } catch (error) {
    logger.error('ADEETIE readiness error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/adeetie/subvention-calculator
router.post('/subvention-calculator', [
  auth,
  body('loanAmount').isNumeric().withMessage('loanAmount is required'),
  body('nominalInterestRatePercent').optional().isNumeric(),
  body('tenureYears').optional().isNumeric()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    const msme = await loadMsme(req.user.userId);
    if (!msme) {
      return res.status(404).json({ success: false, message: 'MSME profile not found' });
    }

    const result = adeetieService.calculateSubvention({
      loanAmount: req.body.loanAmount,
      companyType: msme.companyType,
      nominalInterestRatePercent: req.body.nominalInterestRatePercent,
      tenureYears: req.body.tenureYears
    });

    const eligibility = adeetieService.evaluateEligibility(msme, {
      loanAmount: req.body.loanAmount
    });

    res.json({
      success: true,
      data: {
        subvention: result,
        eligibility
      }
    });
  } catch (error) {
    logger.error('ADEETIE subvention calculator error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/adeetie/dpr-brief
router.get('/dpr-brief', auth, async (req, res) => {
  try {
    const msme = await loadMsme(req.user.userId);
    if (!msme) {
      return res.status(404).json({ success: false, message: 'MSME profile not found' });
    }
    res.json({
      success: true,
      data: await adeetieService.buildDprBrief(msme)
    });
  } catch (error) {
    logger.error('ADEETIE DPR brief error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PATCH /api/adeetie/profile
router.patch('/profile', [
  auth,
  body('beeSector').optional().isString(),
  body('adeetieClusterId').optional().isString(),
  body('clusterAssociation').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const msme = await loadMsme(req.user.userId);
    if (!msme) {
      return res.status(404).json({ success: false, message: 'MSME profile not found' });
    }

    const normalized = normalizeMSMEPayload(
      { manufacturingProfile: req.body },
      msme.toObject()
    );

    msme.manufacturingProfile = {
      ...(msme.manufacturingProfile?.toObject?.() || msme.manufacturingProfile || {}),
      ...(normalized.manufacturingProfile || {})
    };

    if (req.body.beeSector) {
      const valid = BEE_SECTORS.some((s) => s.id === req.body.beeSector);
      if (!valid) {
        return res.status(400).json({ success: false, message: 'Invalid BEE sector' });
      }
      msme.manufacturingProfile.beeSector = req.body.beeSector;
    }
    if (req.body.adeetieClusterId) {
      const cluster = PHASE1_CLUSTERS.find((c) => c.id === req.body.adeetieClusterId);
      if (!cluster) {
        return res.status(400).json({ success: false, message: 'Invalid ADEETIE cluster' });
      }
      msme.manufacturingProfile.adeetieClusterId = req.body.adeetieClusterId;
      msme.manufacturingProfile.clusterAssociation = cluster.name;
      if (!msme.manufacturingProfile.beeSector) {
        msme.manufacturingProfile.beeSector = cluster.sectorId;
      }
    }
    if (req.body.clusterAssociation) {
      msme.manufacturingProfile.clusterAssociation = req.body.clusterAssociation;
    }

    await msme.save();

    res.json({
      success: true,
      message: 'ADEETIE profile updated',
      data: {
        manufacturingProfile: {
          beeSector: msme.manufacturingProfile.beeSector,
          adeetieClusterId: msme.manufacturingProfile.adeetieClusterId,
          clusterAssociation: msme.manufacturingProfile.clusterAssociation
        }
      }
    });
  } catch (error) {
    logger.error('ADEETIE profile update error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PATCH /api/adeetie/journey
router.patch('/journey', [
  auth,
  body('stage').isIn(JOURNEY_STAGES).withMessage('Invalid journey stage')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const msme = await loadMsme(req.user.userId);
    if (!msme) {
      return res.status(404).json({ success: false, message: 'MSME profile not found' });
    }

    msme.adeetieJourney = {
      stage: req.body.stage,
      notes: req.body.notes || msme.adeetieJourney?.notes || '',
      updatedAt: new Date()
    };
    await msme.save();

    res.json({
      success: true,
      data: msme.adeetieJourney
    });
  } catch (error) {
    logger.error('ADEETIE journey update error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;
