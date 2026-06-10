const { recordPartnerApiEvent } = require('../services/partnerUsageService');
const logger = require('../utils/logger');

const recordPartnerApiUsage = (req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    if (!req.partner?._id) {
      return;
    }

    const routePath = req.route?.path
      ? `${req.baseUrl || ''}${req.route.path}`.replace(/\/+/g, '/')
      : req.path;

    recordPartnerApiEvent({
      partnerApplicationId: req.partner._id,
      method: req.method,
      path: routePath,
      statusCode: res.statusCode,
      responseTimeMs: Date.now() - startedAt,
      msmeId: req.params?.msmeId || null
    }).catch((error) => {
      logger.error('Failed to record partner API usage:', error);
    });
  });

  next();
};

module.exports = recordPartnerApiUsage;
