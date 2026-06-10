const Document = require('../models/Document');
const UserBillingProfile = require('../models/UserBillingProfile');
const BillingModuleConfig = require('../models/BillingModuleConfig');
const {
  getPlanLimits,
  resolvePlanTier,
  resolveCanonicalPlanId,
  getRecommendedPlanIdForUsageAmount,
  PLAN_LIMITS
} = require('../config/pricingCatalog');

const MSME_ROLE = 'msme';
const FEATURES = ['complianceHub', 'brsrExports', 'greenFinance', 'carbonCredits'];

const startOfMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), 1);

const addMonths = (date, months) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

const addYears = (date, years) => {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
};

const computePaidUntil = (paidAt, planInterval = 'monthly') => {
  const base = paidAt instanceof Date ? paidAt : new Date(paidAt || Date.now());
  if (planInterval === 'yearly') {
    return addYears(base, 1);
  }
  return addMonths(base, 1);
};

const isPaidPeriodActive = (profile) => {
  if (!profile || profile.status !== 'paid') {
    return false;
  }
  if (!profile.paidUntil) {
    return true;
  }
  return new Date(profile.paidUntil).getTime() >= Date.now();
};

const resolveEffectiveTier = (profile) => {
  if (!isPaidPeriodActive(profile)) {
    return 'free';
  }

  if (profile.selectedPlanId) {
    return resolvePlanTier(resolveCanonicalPlanId(profile.selectedPlanId));
  }

  if (profile.pricingModel === 'usage_based' && profile.lastQuotedBreakdown?.recommendedPlanId) {
    return resolvePlanTier(profile.lastQuotedBreakdown.recommendedPlanId);
  }

  return 'starter';
};

const getBillingModuleConfigCached = async () => {
  let config = await BillingModuleConfig.findOne().lean();
  if (!config) {
    config = { moduleEnabled: true, informationalOnly: true };
  }
  return config;
};

const isMsmeEnforcementActive = async () => {
  const config = await getBillingModuleConfigCached();
  return config.moduleEnabled === true && config.informationalOnly === false;
};

const getMsmeBillingProfile = async (userId) => {
  if (!userId) {
    return null;
  }
  return UserBillingProfile.findOne({ userId }).lean();
};

const resolveMsmeEntitlements = async ({ userId, msmeId, role = MSME_ROLE }) => {
  if (role !== MSME_ROLE) {
    return {
      enforcementActive: false,
      tier: 'free',
      limits: PLAN_LIMITS.free,
      profile: null,
      paidUntil: null,
      isExpired: false
    };
  }

  const [enforcementActive, profile] = await Promise.all([
    isMsmeEnforcementActive(),
    getMsmeBillingProfile(userId)
  ]);

  const tier = resolveEffectiveTier(profile);
  const limits = getPlanLimits(profile?.selectedPlanId || `${tier}_plan`) || PLAN_LIMITS[tier] || PLAN_LIMITS.free;

  return {
    enforcementActive,
    tier,
    limits,
    profile,
    paidUntil: profile?.paidUntil || null,
    isExpired: profile?.status === 'paid' && profile?.paidUntil
      ? new Date(profile.paidUntil).getTime() < Date.now()
      : false,
    selectedPlanId: profile?.selectedPlanId || null,
    pricingModel: profile?.pricingModel || null
  };
};

const countDocumentsThisMonth = async (msmeId) => {
  if (!msmeId) {
    return 0;
  }

  return Document.countDocuments({
    msmeId,
    createdAt: { $gte: startOfMonth() }
  });
};

const buildActivationPayloadFromPayment = (paymentRecord, paidAt = new Date()) => {
  const pricingModel = paymentRecord.pricingModel || 'fixed_plan';
  let selectedPlanId = paymentRecord.planId || null;
  let planInterval = paymentRecord.planInterval || null;

  if (pricingModel === 'usage_based') {
    const breakdown = paymentRecord.notes || {};
    selectedPlanId = breakdown.recommendedPlanId
      || getRecommendedPlanIdForUsageAmount(paymentRecord.amount);
    planInterval = planInterval || 'monthly';
  }

  if (selectedPlanId) {
    selectedPlanId = resolveCanonicalPlanId(selectedPlanId);
  }

  const paidUntil = computePaidUntil(paidAt, planInterval || 'monthly');

  return {
    msmeId: paymentRecord.msmeId || null,
    pricingModel,
    selectedPlanId,
    planInterval: planInterval || 'monthly',
    status: 'paid',
    paidUntil,
    lastPaymentAt: paidAt,
    lastPaymentAmount: paymentRecord.amount,
    lastPaymentId: paymentRecord.razorpayPaymentId || paymentRecord.lastPaymentId || null
  };
};

const planHasFeature = (tier, feature) => {
  if (!FEATURES.includes(feature)) {
    return true;
  }
  const limits = PLAN_LIMITS[tier] || PLAN_LIMITS.free;
  return Boolean(limits[feature]);
};

const buildDenial = ({ code, message, tier, feature, upgradePlanId = 'msme_growth_monthly' }) => ({
  success: false,
  code,
  message,
  tier,
  feature,
  upgradePlanId
});

const assertMsmeFeatureAccess = async ({ userId, msmeId, role, feature }) => {
  const entitlements = await resolveMsmeEntitlements({ userId, msmeId, role });
  if (!entitlements.enforcementActive) {
    return { allowed: true, entitlements };
  }

  if (planHasFeature(entitlements.tier, feature)) {
    return { allowed: true, entitlements };
  }

  return {
    allowed: false,
    entitlements,
    denial: buildDenial({
      code: 'PLAN_FEATURE_REQUIRED',
      message: `${feature} requires a higher plan. Upgrade to Growth or above.`,
      tier: entitlements.tier,
      feature
    })
  };
};

const assertMsmeDocumentUpload = async ({ userId, msmeId, role, additionalCount = 1 }) => {
  const entitlements = await resolveMsmeEntitlements({ userId, msmeId, role });
  if (!entitlements.enforcementActive) {
    return { allowed: true, entitlements, documentsThisMonth: 0 };
  }

  const documentsThisMonth = await countDocumentsThisMonth(msmeId);
  const limit = entitlements.limits.documentsPerMonth ?? PLAN_LIMITS.free.documentsPerMonth;
  const projected = documentsThisMonth + additionalCount;

  if (projected <= limit) {
    return { allowed: true, entitlements, documentsThisMonth, limit };
  }

  return {
    allowed: false,
    entitlements,
    documentsThisMonth,
    limit,
    denial: buildDenial({
      code: 'DOCUMENT_LIMIT_EXCEEDED',
      message: `Document limit reached (${documentsThisMonth}/${limit} this month). Upgrade your plan or wait until next month.`,
      tier: entitlements.tier,
      feature: 'documentsPerMonth'
    })
  };
};

module.exports = {
  FEATURES,
  computePaidUntil,
  isPaidPeriodActive,
  resolveEffectiveTier,
  isMsmeEnforcementActive,
  resolveMsmeEntitlements,
  countDocumentsThisMonth,
  buildActivationPayloadFromPayment,
  planHasFeature,
  assertMsmeFeatureAccess,
  assertMsmeDocumentUpload
};
