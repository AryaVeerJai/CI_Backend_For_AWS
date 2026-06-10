const auth = require('./auth');
const PartnerApplication = require('../models/PartnerApplication');
const logger = require('../utils/logger');

const partnerAccountAuth = (req, res, next) => {
  auth(req, res, async () => {
    if (res.headersSent) {
      return;
    }

    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      if (req.user.role !== 'partner') {
        return res.status(403).json({
          success: false,
          message: 'Partner portal access only. Sign in with a partner account.'
        });
      }

      const partner = await PartnerApplication.findOne({
        linkedUserId: req.user.userId,
        isActive: true
      });

      if (!partner) {
        return res.status(403).json({
          success: false,
          message: 'No active partner application is linked to this account.'
        });
      }

      req.partner = partner;
      return next();
    } catch (error) {
      logger.error('Partner account auth error:', error);
      return res.status(500).json({
        success: false,
        message: 'Partner authentication failed'
      });
    }
  });
};

module.exports = partnerAccountAuth;
