const User = require('../models/User');
const MSME = require('../models/MSME');
const Enterprise = require('../models/Enterprise');
const logger = require('../utils/logger');
const { verifyJwt } = require('../utils/jwt');
const { resolveOrganizationContext } = require('../services/organizationService');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token, authorization denied'
      });
    }

    const decoded = verifyJwt(token);

    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid'
      });
    }

    if (user.isActive === false) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    const msmeData = await MSME.findOne({ userId: user._id }).select('_id organizationId');
    const enterpriseData = await Enterprise.findOne({ userId: user._id }).select('_id organizationId');

    const baseUser = {
      userId: user._id,
      id: user._id,
      _id: user._id,
      email: user.email,
      role: user.role,
      msmeId: msmeData?._id,
      enterpriseId: enterpriseData?._id
    };

    const orgContext = await resolveOrganizationContext(baseUser);

    req.user = {
      ...baseUser,
      organizationId: orgContext.organizationId,
      segment: orgContext.segment,
      legalName: orgContext.legalName || null
    };

    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Token is not valid'
    });
  }
};

const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  return next();
};

const requireMSMEProfile = (req, res, next) => {
  if (!req.user?.msmeId) {
    return res.status(404).json({
      success: false,
      message: 'MSME profile not found'
    });
  }
  return next();
};

const requireEnterpriseProfile = (req, res, next) => {
  if (!req.user?.enterpriseId) {
    return res.status(404).json({
      success: false,
      message: 'Enterprise profile not found'
    });
  }
  return next();
};

const requireOrganizationProfile = (req, res, next) => {
  if (!req.user?.organizationId) {
    return res.status(404).json({
      success: false,
      message: 'Organization profile not found. Complete registration first.'
    });
  }
  return next();
};

const requireOperationalProfile = (req, res, next) => {
  if (req.user?.role === 'msme' && !req.user?.msmeId) {
    return res.status(404).json({
      success: false,
      message: 'MSME profile not found'
    });
  }
  if (req.user?.role === 'enterprise' && !req.user?.enterpriseId) {
    return res.status(404).json({
      success: false,
      message: 'Enterprise profile not found'
    });
  }
  if (!req.user?.organizationId) {
    return res.status(404).json({
      success: false,
      message: 'Organization profile not found'
    });
  }
  return next();
};

auth.requireRole = requireRole;
auth.requireMSMEProfile = requireMSMEProfile;
auth.requireEnterpriseProfile = requireEnterpriseProfile;
auth.requireOrganizationProfile = requireOrganizationProfile;
auth.requireOperationalProfile = requireOperationalProfile;
module.exports = auth;
