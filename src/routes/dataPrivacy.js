const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const User = require('../models/User');
const MSME = require('../models/MSME');
const UserPrivacySettings = require('../models/UserPrivacySettings');
const UserPrivacyRequest = require('../models/UserPrivacyRequest');
const UserPrivacyActivity = require('../models/UserPrivacyActivity');

const ACTIVITY_ACTION = {
  SETTINGS_UPDATED: 'settings_updated',
  CONSENT_UPDATED: 'consent_updated',
  DATA_DOWNLOAD: 'data_download',
  REQUEST_CREATED: 'request_created'
};

const PRIVACY_FIELDS = [
  'dataProcessing',
  'marketingCommunications',
  'thirdPartySharing',
  'analyticsTracking',
  'cookieConsent',
  'dataRetention',
  'twoFactorAuth',
  'sessionTimeout',
  'dataEncryption',
  'auditLogging'
];

const CONSENT_FIELDS = [
  'dataProcessing',
  'marketingCommunications',
  'thirdPartySharing',
  'analyticsTracking',
  'cookieConsent',
  'dataRetention'
];

const sanitizeSettingsUpdate = (body = {}, allowedFields = PRIVACY_FIELDS) => {
  const updates = {};
  allowedFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      updates[field] = body[field];
    }
  });
  return updates;
};

const createActivity = async (req, action, details) => {
  try {
    await UserPrivacyActivity.create({
      userId: req.user.userId,
      action,
      details,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });
  } catch (error) {
    logger.warn('Failed to persist privacy activity', { action, ...clientErrorPayload(error) });
  }
};

// @route   GET /api/data-privacy/settings
// @desc    Get privacy settings for user
// @access  Private
router.get('/settings', auth, async (req, res) => {
  try {
    logger.info('Get privacy settings request', { userId: req.user.userId });
    const settings = await UserPrivacySettings.findOneAndUpdate(
      { userId: req.user.userId },
      { $setOnInsert: { userId: req.user.userId } },
      { new: true, upsert: true }
    ).lean();

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    logger.error('Get privacy settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// @route   PUT /api/data-privacy/settings
// @desc    Update privacy settings for user
// @access  Private
router.put('/settings', auth, async (req, res) => {
  try {
    const updates = sanitizeSettingsUpdate(req.body, PRIVACY_FIELDS);
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid settings provided'
      });
    }

    logger.info('Update privacy settings request', { 
      userId: req.user.userId,
      updates: Object.keys(updates)
    });

    updates.updatedAt = new Date();
    const settings = await UserPrivacySettings.findOneAndUpdate(
      { userId: req.user.userId },
      { $set: updates, $setOnInsert: { userId: req.user.userId } },
      { new: true, upsert: true }
    );

    await createActivity(
      req,
      ACTIVITY_ACTION.SETTINGS_UPDATED,
      `Updated privacy settings: ${Object.keys(updates).join(', ')}`
    );

    res.json({
      success: true,
      message: 'Privacy settings updated successfully',
      data: settings
    });
  } catch (error) {
    logger.error('Update privacy settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// @route   GET /api/data-privacy/requests
// @desc    Get data subject requests for user
// @access  Private
router.get('/requests', auth, async (req, res) => {
  try {
    logger.info('Get data requests request', { userId: req.user.userId });
    const requests = await UserPrivacyRequest.find({ userId: req.user.userId })
      .sort({ requestedAt: -1 })
      .lean();

    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    logger.error('Get data requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// @route   POST /api/data-privacy/requests
// @desc    Submit data subject request
// @access  Private
router.post('/requests', auth, async (req, res) => {
  try {
    const { type, description } = req.body;

    if (!type || !description) {
      return res.status(400).json({
        success: false,
        message: 'Request type and description are required'
      });
    }

    const newRequest = await UserPrivacyRequest.create({
      userId: req.user.userId,
      type,
      status: 'pending',
      description,
      requestedAt: new Date()
    });

    logger.info('Data request submitted', { 
      userId: req.user.userId,
      requestType: type
    });
    await createActivity(req, ACTIVITY_ACTION.REQUEST_CREATED, `Created privacy request: ${type}`);

    res.json({
      success: true,
      message: 'Data request submitted successfully',
      data: newRequest
    });
  } catch (error) {
    logger.error('Submit data request error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// @route   GET /api/data-privacy/activities
// @desc    Get data activities for user
// @access  Private
router.get('/activities', auth, async (req, res) => {
  try {
    logger.info('Get data activities request', { userId: req.user.userId });
    const activities = await UserPrivacyActivity.find({ userId: req.user.userId })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();

    res.json({
      success: true,
      data: activities
    });
  } catch (error) {
    logger.error('Get data activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// @route   GET /api/data-privacy/download
// @desc    Download personal data for user
// @access  Private
router.get('/download', auth, async (req, res) => {
  try {
    logger.info('Download personal data request', { userId: req.user.userId });
    const [user, msme, settings, requests, activities] = await Promise.all([
      User.findById(req.user.userId).select('-password -resetPasswordToken -resetPasswordExpires').lean(),
      MSME.findOne({ userId: req.user.userId }).lean(),
      UserPrivacySettings.findOne({ userId: req.user.userId }).lean(),
      UserPrivacyRequest.find({ userId: req.user.userId }).sort({ requestedAt: -1 }).lean(),
      UserPrivacyActivity.find({ userId: req.user.userId }).sort({ timestamp: -1 }).limit(500).lean()
    ]);

    await createActivity(req, ACTIVITY_ACTION.DATA_DOWNLOAD, 'Downloaded personal data bundle');

    const personalData = {
      user,
      msmeProfile: msme,
      privacySettings: settings,
      dataRequests: requests,
      activities
    };

    res.json({
      success: true,
      data: personalData
    });
  } catch (error) {
    logger.error('Download personal data error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// @route   POST /api/data-privacy/consent
// @desc    Update consent preferences
// @access  Private
router.post('/consent', auth, async (req, res) => {
  try {
    const updates = sanitizeSettingsUpdate(req.body, CONSENT_FIELDS);
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid consent preferences provided'
      });
    }

    logger.info('Update consent preferences', { 
      userId: req.user.userId,
      updates: Object.keys(updates)
    });

    updates.updatedAt = new Date();
    await UserPrivacySettings.findOneAndUpdate(
      { userId: req.user.userId },
      { $set: updates, $setOnInsert: { userId: req.user.userId } },
      { new: true, upsert: true }
    );

    await createActivity(
      req,
      ACTIVITY_ACTION.CONSENT_UPDATED,
      `Updated consent settings: ${Object.keys(updates).join(', ')}`
    );

    res.json({
      success: true,
      message: 'Consent preferences updated successfully',
      data: updates
    });
  } catch (error) {
    logger.error('Update consent preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;