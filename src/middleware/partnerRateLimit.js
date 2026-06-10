const rateLimit = require('express-rate-limit');

const TIER_LIMITS = {
  standard: {
    windowMs: 60 * 1000,
    max: 60
  },
  elevated: {
    windowMs: 60 * 1000,
    max: 300
  }
};

const partnerRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => {
    const tier = req.partner?.rateLimitTier || 'standard';
    return TIER_LIMITS[tier]?.max || TIER_LIMITS.standard.max;
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.partner?._id) {
      return `partner:${String(req.partner._id)}`;
    }
    return req.ip;
  },
  skip: (req) => !req.partner?._id,
  handler: (req, res) => {
    const tier = req.partner?.rateLimitTier || 'standard';
    res.status(429).json({
      success: false,
      message: `Partner API rate limit exceeded for ${tier} tier. Retry after the rate-limit window.`,
      code: 'PARTNER_RATE_LIMIT_EXCEEDED',
      rateLimitTier: tier
    });
  }
});

module.exports = partnerRateLimit;
module.exports.TIER_LIMITS = TIER_LIMITS;
