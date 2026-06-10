const {
  assertMsmeFeatureAccess,
  assertMsmeDocumentUpload,
  resolveMsmeEntitlements
} = require('../services/planEntitlementService');
const logger = require('../utils/logger');

const sendDenial = (res, denial, statusCode = 402) => res.status(statusCode).json(denial);

const attachMsmeEntitlements = async (req, res, next) => {
  if (req.user?.role !== 'msme') {
    return next();
  }

  try {
    req.msmeEntitlements = await resolveMsmeEntitlements({
      userId: req.user.userId,
      msmeId: req.user.msmeId,
      role: req.user.role
    });

    if (req.msmeEntitlements.enforcementActive) {
      res.setHeader('X-Plan-Tier', req.msmeEntitlements.tier);
      if (req.msmeEntitlements.paidUntil) {
        res.setHeader('X-Plan-Paid-Until', new Date(req.msmeEntitlements.paidUntil).toISOString());
      }
    }

    return next();
  } catch (error) {
    logger.error('Failed to attach MSME entitlements:', error);
    return next();
  }
};

const requireMsmePlanFeature = (feature) => async (req, res, next) => {
  if (req.user?.role !== 'msme') {
    return next();
  }

  try {
    const result = await assertMsmeFeatureAccess({
      userId: req.user.userId,
      msmeId: req.user.msmeId,
      role: req.user.role,
      feature
    });

    req.msmeEntitlements = result.entitlements;

    if (!result.allowed) {
      return sendDenial(res, result.denial, 403);
    }

    return next();
  } catch (error) {
    logger.error('MSME plan feature enforcement error:', error);
    return next();
  }
};

const requireMsmeDocumentCapacity = (getAdditionalCount = () => 1) => async (req, res, next) => {
  if (req.user?.role !== 'msme') {
    return next();
  }

  try {
    const additionalCount = typeof getAdditionalCount === 'function'
      ? getAdditionalCount(req)
      : Number(getAdditionalCount) || 1;

    const result = await assertMsmeDocumentUpload({
      userId: req.user.userId,
      msmeId: req.user.msmeId,
      role: req.user.role,
      additionalCount
    });

    req.msmeEntitlements = result.entitlements;

    if (!result.allowed) {
      return sendDenial(res, result.denial, 402);
    }

    return next();
  } catch (error) {
    logger.error('MSME document limit enforcement error:', error);
    return next();
  }
};

module.exports = attachMsmeEntitlements;
module.exports.attachMsmeEntitlements = attachMsmeEntitlements;
module.exports.requireMsmePlanFeature = requireMsmePlanFeature;
module.exports.requireMsmeDocumentCapacity = requireMsmeDocumentCapacity;
