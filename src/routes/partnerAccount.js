const express = require('express');
const { body, validationResult } = require('express-validator');
const { clientErrorPayload } = require('../utils/httpErrors');
const User = require('../models/User');
const PartnerApplication = require('../models/PartnerApplication');
const partnerAccountAuth = require('../middleware/partnerAccountAuth');
const { getPartnerDashboard, getPartnerUsageSummary } = require('../services/partnerUsageService');
const { sanitizePartnerForResponse } = require('../services/partnerApiService');
const { signJwt } = require('../utils/jwt');
const logger = require('../utils/logger');

const router = express.Router();

// @route   GET /api/partner-account/quota
// @access  Partner JWT
router.get('/quota', partnerAccountAuth, async (req, res) => {
  try {
    const summary = await getPartnerUsageSummary(req.partner, { days: 14 });
    res.json({
      success: true,
      data: {
        quotas: summary.quotas,
        period: summary.period,
        rateLimitTier: summary.rateLimitTier
      }
    });
  } catch (error) {
    logger.error('Partner quota error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load usage quotas',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/partner-account/login
// @desc    Partner portal login (JWT)
// @access  Public
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const email = String(req.body.email).toLowerCase().trim();
    const user = await User.findOne({ email });

    if (!user || user.role !== 'partner') {
      return res.status(400).json({
        success: false,
        message: 'Invalid partner credentials'
      });
    }

    const isMatch = await user.comparePassword(req.body.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid partner credentials'
      });
    }

    if (!user.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Partner account is deactivated'
      });
    }

    const partner = await PartnerApplication.findOne({
      linkedUserId: user._id,
      isActive: true
    });

    if (!partner) {
      return res.status(403).json({
        success: false,
        message: 'No active partner application is linked to this account'
      });
    }

    await User.updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } });

    const token = signJwt({
      userId: String(user._id),
      email: user.email,
      role: user.role
    }, { expiresIn: '7d' });

    res.json({
      success: true,
      message: 'Partner login successful',
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          profile: user.profile
        },
        partner: sanitizePartnerForResponse(partner)
      }
    });
  } catch (error) {
    logger.error('Partner login error:', error);
    res.status(500).json({
      success: false,
      message: 'Partner login failed',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/partner-account/me
// @access  Partner JWT
router.get('/me', partnerAccountAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      user: {
        id: req.user.userId,
        email: req.user.email,
        role: req.user.role
      },
      partner: sanitizePartnerForResponse(req.partner)
    }
  });
});

// @route   GET /api/partner-account/dashboard
// @access  Partner JWT
router.get('/dashboard', partnerAccountAuth, async (req, res) => {
  try {
    const dashboard = await getPartnerDashboard(req.partner);
    res.json({ success: true, data: dashboard });
  } catch (error) {
    logger.error('Partner dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load partner dashboard',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/partner-account/usage
// @access  Partner JWT
router.get('/usage', partnerAccountAuth, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 90);
    const summary = await getPartnerUsageSummary(req.partner, { days });

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    logger.error('Partner usage error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load usage data',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/partner-account/billing
// @access  Partner JWT
router.get('/billing', partnerAccountAuth, async (req, res) => {
  try {
    const summary = await getPartnerUsageSummary(req.partner, { days: 14 });

    res.json({
      success: true,
      data: summary.billing
    });
  } catch (error) {
    logger.error('Partner billing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load billing estimate',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/partner-account/statistics
// @access  Partner JWT
router.get('/statistics', partnerAccountAuth, async (req, res) => {
  try {
    const dashboard = await getPartnerDashboard(req.partner);
    res.json({
      success: true,
      data: dashboard.statistics
    });
  } catch (error) {
    logger.error('Partner statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load statistics',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;
