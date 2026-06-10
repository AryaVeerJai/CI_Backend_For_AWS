const { resolvePartnerPlanDefaults } = require('../config/partnerPricingCatalog');

const PARTNER_BILLING_ENFORCEMENT = () => String(process.env.PARTNER_BILLING_ENFORCEMENT || 'soft').toLowerCase();

const addYears = (date, years) => {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
};

const applyPartnerPlanDefaults = (partnerPayload = {}) => {
  const planDefaults = resolvePartnerPlanDefaults(partnerPayload.billingPlanId);
  return {
    ...partnerPayload,
    contractAnnualFeeInr: partnerPayload.contractAnnualFeeInr ?? planDefaults.contractAnnualFeeInr,
    rateLimitTier: partnerPayload.rateLimitTier || planDefaults.rateLimitTier,
    usageLimits: {
      ...planDefaults.usageLimits,
      ...(partnerPayload.usageLimits || {})
    },
    overageRates: {
      ...planDefaults.overageRates,
      ...(partnerPayload.overageRates || {})
    },
    billingStatus: partnerPayload.billingStatus || 'active'
  };
};

const isPartnerBillingPeriodActive = (partner) => {
  if (!partner?.isActive) {
    return false;
  }

  if (partner.billingStatus === 'suspended' || partner.billingStatus === 'pending') {
    return false;
  }

  if (partner.billingStatus === 'expired') {
    return false;
  }

  if (partner.contractPaidUntil) {
    return new Date(partner.contractPaidUntil).getTime() >= Date.now();
  }

  return partner.billingStatus === 'active';
};

const isPartnerBillingEnforcementActive = () => PARTNER_BILLING_ENFORCEMENT() !== 'off';

const resolvePartnerBillingAccess = (partner) => {
  const enforcementActive = isPartnerBillingEnforcementActive();
  const billingActive = isPartnerBillingPeriodActive(partner);

  return {
    enforcementActive,
    billingActive,
    billingStatus: partner?.billingStatus || 'active',
    contractPaidUntil: partner?.contractPaidUntil || null,
    billingPlanId: partner?.billingPlanId || 'api_starter'
  };
};

const buildPartnerBillingActivation = ({
  billingStatus = 'active',
  contractPaidUntil = null,
  paidAt = new Date()
} = {}) => {
  const activation = {
    billingStatus,
    billingActivatedAt: paidAt
  };

  if (contractPaidUntil) {
    activation.contractPaidUntil = contractPaidUntil;
  } else if (billingStatus === 'active') {
    activation.contractPaidUntil = addYears(paidAt, 1);
  }

  return activation;
};

const checkPartnerBillingAccess = (partner) => {
  const access = resolvePartnerBillingAccess(partner);
  if (!access.enforcementActive || access.billingActive) {
    return { allowed: true, access };
  }

  return {
    allowed: false,
    access,
    denial: {
      success: false,
      code: 'PARTNER_BILLING_INACTIVE',
      message: 'Partner contract is inactive or expired. Contact contact@sustainow.in to renew your partnership.',
      billingStatus: access.billingStatus,
      contractPaidUntil: access.contractPaidUntil
    }
  };
};

module.exports = {
  PARTNER_BILLING_ENFORCEMENT,
  applyPartnerPlanDefaults,
  isPartnerBillingPeriodActive,
  isPartnerBillingEnforcementActive,
  resolvePartnerBillingAccess,
  buildPartnerBillingActivation,
  checkPartnerBillingAccess
};
