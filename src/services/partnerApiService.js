const crypto = require('crypto');
const PartnerApplication = require('../models/PartnerApplication');

const API_KEY_PREFIX = 'ci_live';
const API_KEY_BYTES = 24;

const hashApiKey = (rawKey) => crypto.createHash('sha256').update(String(rawKey)).digest('hex');

const generateApiKey = () => {
  const secret = crypto.randomBytes(API_KEY_BYTES).toString('base64url');
  const prefix = `${API_KEY_PREFIX}_${secret.slice(0, 8)}`;
  const fullKey = `${prefix}_${secret}`;
  return { fullKey, prefix, hash: hashApiKey(fullKey) };
};

const maskApiKey = (prefix) => `${prefix}_••••••••••••••••`;

const extractApiKeyFromRequest = (req) => {
  const headerKey = req.header('X-API-Key');
  if (headerKey) {
    return String(headerKey).trim();
  }

  const authHeader = req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.startsWith(`${API_KEY_PREFIX}_`)) {
      return token;
    }
  }

  return null;
};

const findPartnerByApiKey = async (rawKey) => {
  if (!rawKey || !rawKey.startsWith(`${API_KEY_PREFIX}_`)) {
    return null;
  }

  const prefix = rawKey.split('_').slice(0, 3).join('_');
  const partner = await PartnerApplication.findOne({
    apiKeyPrefix: prefix,
    isActive: true
  });

  if (!partner) {
    return null;
  }

  const candidateHash = hashApiKey(rawKey);
  if (candidateHash !== partner.apiKeyHash) {
    return null;
  }

  return partner;
};

const partnerHasScope = (partner, scope) => {
  if (!partner?.scopes?.length) {
    return false;
  }
  return partner.scopes.includes(scope);
};

const sanitizePartnerForResponse = (partner) => ({
  id: partner._id,
  name: partner.name,
  organizationType: partner.organizationType,
  organizationName: partner.organizationName,
  contactEmail: partner.contactEmail,
  scopes: partner.scopes,
  apiKeyPrefix: partner.apiKeyPrefix,
  apiKeyMasked: maskApiKey(partner.apiKeyPrefix),
  webhookUrl: partner.webhookUrl,
  rateLimitTier: partner.rateLimitTier,
  billingPlanId: partner.billingPlanId,
  contractAnnualFeeInr: partner.contractAnnualFeeInr,
  billingStatus: partner.billingStatus,
  billingActivatedAt: partner.billingActivatedAt,
  contractPaidUntil: partner.contractPaidUntil,
  usageLimits: partner.usageLimits,
  overageRates: partner.overageRates,
  isActive: partner.isActive,
  lastUsedAt: partner.lastUsedAt,
  linkedUserId: partner.linkedUserId,
  notes: partner.notes,
  createdAt: partner.createdAt,
  updatedAt: partner.updatedAt
});

const buildMsmePartnerSummary = (msme, latestAssessment = null) => ({
  id: msme._id,
  companyName: msme.companyName,
  industry: msme.industry,
  status: msme.status,
  businessDomain: msme.businessDomain,
  location: {
    state: msme.locationState || msme.location?.state,
    city: msme.locationCity || msme.location?.city,
    country: msme.locationCountry || msme.location?.country
  },
  carbon: latestAssessment ? {
    carbonScore: latestAssessment.carbonScore,
    totalCO2Emissions: latestAssessment.totalCO2Emissions,
    assessmentType: latestAssessment.assessmentType,
    assessmentStatus: latestAssessment.status,
    period: latestAssessment.period,
    updatedAt: latestAssessment.createdAt
  } : null
});

module.exports = {
  API_KEY_PREFIX,
  PARTNER_SCOPES: PartnerApplication.PARTNER_SCOPES,
  hashApiKey,
  generateApiKey,
  maskApiKey,
  extractApiKeyFromRequest,
  findPartnerByApiKey,
  partnerHasScope,
  sanitizePartnerForResponse,
  buildMsmePartnerSummary
};
