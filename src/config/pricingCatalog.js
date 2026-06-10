/**
 * Central MSME / enterprise / channel pricing catalog.
 * Admin overrides in BillingModuleConfig.fixedPlans should keep planId values stable.
 */

const { roundTo } = require('../utils/roundTo');

const GST_RATE = 0.18;

const PLAN_LIMITS = {
  free: {
    sites: 1,
    users: 1,
    documentsPerMonth: 25,
    complianceHub: false,
    brsrExports: false,
    greenFinance: false,
    carbonCredits: false
  },
  starter: {
    sites: 1,
    users: 2,
    documentsPerMonth: 50,
    complianceHub: false,
    brsrExports: false,
    greenFinance: false,
    carbonCredits: false
  },
  core: {
    sites: 2,
    users: 3,
    documentsPerMonth: 100,
    complianceHub: false,
    brsrExports: false,
    greenFinance: false,
    carbonCredits: false
  },
  growth: {
    sites: 3,
    users: 5,
    documentsPerMonth: 200,
    complianceHub: true,
    brsrExports: true,
    greenFinance: true,
    carbonCredits: true
  },
  scale: {
    sites: null,
    users: 15,
    documentsPerMonth: 1000,
    complianceHub: true,
    brsrExports: true,
    greenFinance: true,
    carbonCredits: true
  }
};

const STARTER_MONTHLY_INR = 1999;
const CORE_MONTHLY_INR = 3499;
const GROWTH_MONTHLY_INR = 5999;

const USAGE_PRICING = {
  baseAmountInr: 1500,
  typicalRangeInr: { min: 1500, max: 12000 },
  starterFloorInr: STARTER_MONTHLY_INR,
  scaleCeilingInr: 12000,
  overagePerDocumentInr: 12
};

const USAGE_RATE_COEFFICIENTS = {
  emissionIntensity: 22,
  transaction: 8,
  process: 95,
  rawMaterial: 38,
  machinery: 52,
  site: 175
};

const SECTOR_EMISSION_INTENSITY_FACTORS = {
  manufacturing: 1.2,
  logistics: 1.15,
  textiles: 1.12,
  automotive: 1.1,
  construction: 1.1,
  food_processing: 1.08,
  electronics: 1.05,
  export_import: 1.05,
  agriculture: 1.02,
  trading: 1.0,
  retail: 0.98,
  wholesale: 0.99,
  e_commerce: 1.0,
  services: 0.92,
  consulting: 0.9,
  healthcare: 0.96,
  education: 0.9,
  tourism: 0.95,
  handicrafts: 0.94,
  other: 1.0
};

const SCALE_YEARLY_INR = 129990;

const MONTHLY_TIER_AMOUNTS_EXCL = {
  starter: STARTER_MONTHLY_INR,
  core: CORE_MONTHLY_INR,
  growth: GROWTH_MONTHLY_INR,
  scale: Math.round(SCALE_YEARLY_INR / 12)
};

const DEFAULT_FIXED_PLANS = [
  {
    planId: 'msme_free',
    tier: 'free',
    name: 'Free',
    description: 'Onboarding, limited assessment, and document trial',
    amountInr: 0,
    interval: 'monthly',
    requiresPayment: false,
    isActive: true
  },
  {
    planId: 'msme_starter_monthly',
    tier: 'starter',
    name: 'Starter',
    description: 'Core carbon workspace for small MSMEs',
    amountInr: STARTER_MONTHLY_INR,
    interval: 'monthly',
    requiresPayment: true,
    isActive: true
  },
  {
    planId: 'msme_starter_yearly',
    tier: 'starter',
    name: 'Starter (Annual)',
    description: 'Annual Starter with ~17% savings vs monthly',
    amountInr: 19990,
    interval: 'yearly',
    requiresPayment: true,
    isActive: true
  },
  {
    planId: 'msme_core_monthly',
    tier: 'core',
    name: 'Core',
    description: 'Full Scope 1–3 and dashboard without compliance hub',
    amountInr: CORE_MONTHLY_INR,
    interval: 'monthly',
    requiresPayment: true,
    isActive: true
  },
  {
    planId: 'msme_core_yearly',
    tier: 'core',
    name: 'Core (Annual)',
    description: 'Annual Core plan for steady operations',
    amountInr: 34990,
    interval: 'yearly',
    requiresPayment: true,
    isActive: true
  },
  {
    planId: 'msme_growth_monthly',
    tier: 'growth',
    name: 'Growth',
    description: 'Compliance, BRSR exports, green finance, and credits',
    amountInr: GROWTH_MONTHLY_INR,
    interval: 'monthly',
    requiresPayment: true,
    isActive: true
  },
  {
    planId: 'msme_growth_yearly',
    tier: 'growth',
    name: 'Growth (Annual)',
    description: 'Annual Growth with ~23% savings vs monthly',
    amountInr: 54990,
    interval: 'yearly',
    requiresPayment: true,
    isActive: true
  },
  {
    planId: 'msme_scale_yearly',
    tier: 'scale',
    name: 'Scale',
    description: 'Multi-site MSMEs with highest capacity and priority support',
    amountInr: 129990,
    interval: 'yearly',
    requiresPayment: true,
    isActive: true
  },
  {
    planId: 'msme_enterprise_yearly',
    tier: 'scale',
    name: 'Scale (Legacy ID)',
    description: 'Alias for msme_scale_yearly — use Scale for new subscriptions',
    amountInr: 129990,
    interval: 'yearly',
    requiresPayment: true,
    isActive: false
  }
];

const ENTERPRISE_PRICING_FRAMEWORK = {
  currency: 'INR',
  billingModel: 'custom_annual',
  summary:
    'Corporate enterprise programmes are priced by legal entities, supplier scope, and integration depth—not MSME self-serve tiers.',
  packages: [
    {
      id: 'enterprise_programme',
      name: 'Programme',
      description: 'Single legal entity, up to 5 facilities',
      annualRangeInr: { min: 800000, max: 1500000 },
      features: [
        '13 accounting connectors (Tally, Zoho, QuickBooks, ERPNext, Odoo)',
        'Scope 1–3 carbon inventory with automated document capture',
        'Emission hotspot identification and reduction recommendations',
        '12-month carbon forecasting',
        'BRSR Principle 6 and India compliance hub',
        'Automated compliance workflows (BRSR, PAT, GHG boundaries)',
        'Up to 5 facilities and 25 users'
      ]
    },
    {
      id: 'enterprise_portfolio',
      name: 'Portfolio',
      description: 'Multi-entity India operations and portfolio rollups',
      annualRangeInr: { min: 1500000, max: 4000000 },
      features: [
        'Everything in Programme',
        'Multi-entity consolidation and portfolio dashboards',
        'Group-level BRSR and disclosure reporting',
        'CBAM and export compliance packs',
        'Priority implementation and dedicated success manager',
        'Unlimited facilities and extended user seats'
      ]
    },
    {
      id: 'enterprise_supply_chain',
      name: 'Supply chain',
      description: 'Supplier onboarding, scorecards, and scope-3 programmes',
      annualRangeInr: { min: 2500000, max: null },
      unitPricing: { label: 'Active supplier MSME', perUnitInr: 250 },
      features: [
        'Everything in Portfolio',
        'Supplier MSME onboarding and BRSR Core questionnaires',
        'Scope 3 category materiality and value-chain scorecards',
        'Per-supplier emissions tracking and engagement workflows',
        'Bank and anchor channel licensing options'
      ]
    }
  ],
  addOns: [
    { id: 'implementation', name: 'Implementation', oneTimeRangeInr: { min: 300000, max: 1500000 } },
    { id: 'pilot_90d', name: '90-day pilot', oneTimeInr: 750000, creditableToAnnual: true }
  ],
  contactEmail: 'contact@sustainow.in'
};

const CHANNEL_PRICING = {
  currency: 'INR',
  summary:
    'Banks and anchor enterprises license the platform; MSMEs in the programme often receive subsidised or zero list pricing.',
  models: [
    {
      id: 'bank_platform',
      name: 'Bank platform licence',
      description: 'Annual fee by active MSME accounts or loan-book segment',
      annualRangeInr: { min: 500000, max: 5000000 }
    },
    {
      id: 'per_origination',
      name: 'Green loan origination',
      description: 'Fee per qualified green loan file enabled through the platform',
      perUnitInr: 500
    },
    {
      id: 'msme_subsidy',
      name: 'MSME subsidised access',
      description: 'Typical end-user price when bank or anchor sponsors seats',
      msmeMonthlyInr: 0
    }
  ],
  contactEmail: 'contact@sustainow.in'
};

const PRICING_GUIDANCE = {
  defaultPricingModel: 'fixed_plan',
  recommendedPopularPlanId: 'msme_growth_monthly',
  usageRole: 'overage_and_seasonal',
  usageGuidance:
    'Fixed plans are recommended for predictable billing. Usage-based quotes apply floor/cap rules and are best for seasonal volume or overage beyond plan limits.'
};

const LEGACY_PLAN_ALIASES = {
  msme_enterprise_yearly: 'msme_scale_yearly'
};

const resolvePlanTier = (planId = '') => {
  const normalized = LEGACY_PLAN_ALIASES[planId] || planId;
  const plan = DEFAULT_FIXED_PLANS.find((item) => item.planId === normalized);
  if (plan?.tier) {
    return plan.tier;
  }
  if (normalized.includes('scale') || normalized.includes('enterprise')) {
    return 'scale';
  }
  if (normalized.includes('growth')) {
    return 'growth';
  }
  if (normalized.includes('core')) {
    return 'core';
  }
  if (normalized.includes('free')) {
    return 'free';
  }
  return 'starter';
};

const resolveCanonicalPlanId = (planId = '') => LEGACY_PLAN_ALIASES[planId] || planId;

const getPlanLimits = (planId) => PLAN_LIMITS[resolvePlanTier(planId)] || PLAN_LIMITS.starter;

const getPlanById = (planId) => {
  const canonical = resolveCanonicalPlanId(planId);
  return DEFAULT_FIXED_PLANS.find((plan) => plan.planId === canonical && plan.isActive !== false)
    || DEFAULT_FIXED_PLANS.find((plan) => plan.planId === planId);
};

const getCheckoutFixedPlans = () => (
  DEFAULT_FIXED_PLANS.filter((plan) => plan.isActive !== false && plan.requiresPayment !== false)
);

const getPublicFixedPlans = () => (
  DEFAULT_FIXED_PLANS.filter((plan) => plan.isActive !== false && plan.planId !== 'msme_enterprise_yearly')
);


const addGst = (amountExclGst) => roundTo(amountExclGst * (1 + GST_RATE));

const getRecommendedPlanIdForUsageAmount = (amountInr) => {
  const amount = Number(amountInr) || 0;
  if (amount <= STARTER_MONTHLY_INR) {
    return 'msme_starter_monthly';
  }
  if (amount <= CORE_MONTHLY_INR) {
    return 'msme_core_monthly';
  }
  if (amount <= GROWTH_MONTHLY_INR) {
    return 'msme_growth_monthly';
  }
  return 'msme_scale_yearly';
};

/**
 * Apply usage quote floor (nudge to Starter minimum), ceiling, and fixed-plan recommendation.
 */
const applyUsageQuoteAdjustment = (rawAmountInr) => {
  const raw = roundTo(rawAmountInr);
  const floored = Math.max(raw, USAGE_PRICING.starterFloorInr);
  const capped = Math.min(floored, USAGE_PRICING.scaleCeilingInr);
  const recommendedPlanId = getRecommendedPlanIdForUsageAmount(capped);
  const recommendedPlan = getPlanById(recommendedPlanId);

  return {
    rawAmountInr: raw,
    paymentAmount: capped,
    adjustment: {
      appliedFloor: floored > raw,
      appliedCeiling: capped < floored,
      floorInr: USAGE_PRICING.starterFloorInr,
      ceilingInr: USAGE_PRICING.scaleCeilingInr
    },
    recommendedPlanId,
    recommendedPlanAmountInr: recommendedPlan?.amountInr ?? null,
    recommendedPlanName: recommendedPlan?.name ?? null
  };
};

const computeDocumentOverage = ({
  documentsThisMonth = 0,
  billingStatus = 'none',
  selectedPlanId = null
} = {}) => {
  const docs = Math.max(0, Number(documentsThisMonth) || 0);
  const tier = billingStatus === 'paid' && selectedPlanId
    ? resolvePlanTier(selectedPlanId)
    : 'free';
  const docLimit = PLAN_LIMITS[tier]?.documentsPerMonth ?? PLAN_LIMITS.free.documentsPerMonth;
  const overageDocuments = Math.max(0, docs - docLimit);
  const overageChargeInr = roundTo(overageDocuments * USAGE_PRICING.overagePerDocumentInr);

  return {
    tier,
    docLimit,
    documentsThisMonth: docs,
    overageDocuments,
    overageChargeInr
  };
};

module.exports = {
  GST_RATE,
  PLAN_LIMITS,
  USAGE_PRICING,
  USAGE_RATE_COEFFICIENTS,
  SECTOR_EMISSION_INTENSITY_FACTORS,
  MONTHLY_TIER_AMOUNTS_EXCL,
  DEFAULT_FIXED_PLANS,
  ENTERPRISE_PRICING_FRAMEWORK,
  CHANNEL_PRICING,
  PRICING_GUIDANCE,
  STARTER_MONTHLY_INR,
  CORE_MONTHLY_INR,
  GROWTH_MONTHLY_INR,
  resolvePlanTier,
  resolveCanonicalPlanId,
  getPlanLimits,
  getPlanById,
  getCheckoutFixedPlans,
  getPublicFixedPlans,
  addGst,
  roundTo,
  computeDocumentOverage,
  getRecommendedPlanIdForUsageAmount,
  applyUsageQuoteAdjustment
};
