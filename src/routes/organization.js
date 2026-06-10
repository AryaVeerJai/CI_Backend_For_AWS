const express = require('express');
const auth = require('../middleware/auth');
const Organization = require('../models/Organization');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/context', auth, async (req, res) => {
  try {
    if (!req.user?.organizationId) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    const organization = await Organization.findById(req.user.organizationId).lean();
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    return res.json({
      success: true,
      data: {
        organizationId: organization._id,
        segment: organization.segment,
        legalName: organization.legalName,
        industry: organization.industry,
        primaryIdentifiers: organization.primaryIdentifiers,
        msmeProfileId: organization.msmeProfileId,
        enterpriseProfileId: organization.enterpriseProfileId,
        role: req.user.role
      }
    });
  } catch (error) {
    logger.error('Get organization context error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
