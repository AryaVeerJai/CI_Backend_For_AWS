const {
  extractApiKeyFromRequest,
  findPartnerByApiKey,
  partnerHasScope
} = require('../services/partnerApiService');
const logger = require('../utils/logger');

const partnerAuth = async (req, res, next) => {
  try {
    const rawKey = extractApiKeyFromRequest(req);
    if (!rawKey) {
      return res.status(401).json({
        success: false,
        message: 'Partner API key required. Use Authorization: Bearer <api_key> or X-API-Key header.'
      });
    }

    const partner = await findPartnerByApiKey(rawKey);
    if (!partner) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or inactive partner API key'
      });
    }

    req.partner = partner;
    return next();
  } catch (error) {
    logger.error('Partner auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Partner authentication failed'
    });
  }
};

const requirePartnerScope = (...scopes) => (req, res, next) => {
  if (!req.partner) {
    return res.status(401).json({
      success: false,
      message: 'Partner authentication required'
    });
  }

  const allowed = scopes.some((scope) => partnerHasScope(req.partner, scope));
  if (!allowed) {
    return res.status(403).json({
      success: false,
      message: `Missing required scope. Need one of: ${scopes.join(', ')}`
    });
  }

  return next();
};

partnerAuth.requirePartnerScope = requirePartnerScope;

module.exports = partnerAuth;
