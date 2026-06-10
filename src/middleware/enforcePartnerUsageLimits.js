const {
  getCachedUsageCounts,
  checkUsageQuotaExceeded,
  buildUsageResponseHeaders,
  startOfMonth,
  startOfYear
} = require('../services/partnerUsageService');
const logger = require('../utils/logger');

const ENFORCEMENT_MODE = String(process.env.PARTNER_USAGE_ENFORCEMENT || 'soft').toLowerCase();

const attachPartnerUsageHeaders = async (req, res) => {
  if (!req.partner?._id) {
    return;
  }

  try {
    const monthStart = startOfMonth();
    const yearStart = startOfYear();
    const [monthUsage, yearUsage] = await Promise.all([
      getCachedUsageCounts(req.partner._id, monthStart),
      getCachedUsageCounts(req.partner._id, yearStart)
    ]);

    const headers = buildUsageResponseHeaders(req.partner, monthUsage, yearUsage);
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    req.partnerUsageSnapshot = { monthUsage, yearUsage };
  } catch (error) {
    logger.error('Failed to attach partner usage headers:', error);
  }
};

const enforcePartnerUsageLimits = async (req, res, next) => {
  if (!req.partner?._id) {
    return next();
  }

  if (ENFORCEMENT_MODE === 'off') {
    await attachPartnerUsageHeaders(req, res);
    return next();
  }

  try {
    const monthStart = startOfMonth();
    const yearStart = startOfYear();
    const [monthUsage, yearUsage] = await Promise.all([
      getCachedUsageCounts(req.partner._id, monthStart),
      getCachedUsageCounts(req.partner._id, yearStart)
    ]);

    req.partnerUsageSnapshot = { monthUsage, yearUsage };

    const headers = buildUsageResponseHeaders(req.partner, monthUsage, yearUsage);
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    const exceeded = checkUsageQuotaExceeded(req.partner, monthUsage, yearUsage);
    if (exceeded.length > 0) {
      const exceededMetrics = exceeded.map((q) => q.metric).join(', ');

      if (ENFORCEMENT_MODE === 'hard') {
        return res.status(429).json({
          success: false,
          message: `Partner usage quota exceeded for: ${exceededMetrics}. Contact support@sustainow.in to increase limits.`,
          code: 'PARTNER_QUOTA_EXCEEDED',
          exceeded
        });
      }

      res.setHeader('X-Partner-Usage-Warning', exceededMetrics);
      logger.warn(`Partner ${req.partner._id} exceeded soft quota: ${exceededMetrics}`);
    }

    return next();
  } catch (error) {
    logger.error('Partner usage enforcement error:', error);
    return next();
  }
};

module.exports = enforcePartnerUsageLimits;
module.exports.attachPartnerUsageHeaders = attachPartnerUsageHeaders;
