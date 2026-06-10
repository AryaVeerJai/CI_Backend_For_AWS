const { checkPartnerBillingAccess, PARTNER_BILLING_ENFORCEMENT } = require('../services/partnerBillingService');
const logger = require('../utils/logger');

const enforcePartnerBilling = (req, res, next) => {
  if (!req.partner?._id) {
    return next();
  }

  if (PARTNER_BILLING_ENFORCEMENT() === 'off') {
    return next();
  }

  try {
    const result = checkPartnerBillingAccess(req.partner);
    req.partnerBillingAccess = result.access;

    if (result.allowed) {
      return next();
    }

    if (PARTNER_BILLING_ENFORCEMENT() === 'hard') {
      return res.status(402).json(result.denial);
    }

    res.setHeader('X-Partner-Billing-Warning', result.access.billingStatus || 'inactive');
    logger.warn(`Partner ${req.partner._id} billing inactive under soft enforcement`);
    return next();
  } catch (error) {
    logger.error('Partner billing enforcement error:', error);
    return next();
  }
};

module.exports = enforcePartnerBilling;
