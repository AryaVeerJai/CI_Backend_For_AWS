const BillingModuleConfig = require('../models/BillingModuleConfig');
const UserBillingProfile = require('../models/UserBillingProfile');
const BillingPayment = require('../models/BillingPayment');
const { getDefaultBillingMethods, getDefaultFixedPlans } = require('../config/billingDefaults');
const {
  GST_RATE,
  USAGE_PRICING,
  ENTERPRISE_PRICING_FRAMEWORK,
  CHANNEL_PRICING,
  PRICING_GUIDANCE,
  getPlanLimits,
  resolvePlanTier,
  resolveCanonicalPlanId,
  getPublicFixedPlans
} = require('../config/pricingCatalog');

const mergeCatalogPlans = (existingPlans = []) => {
  const catalogPlans = getPublicFixedPlans();
  const byId = new Map(
    (Array.isArray(existingPlans) ? existingPlans : []).map((plan) => [plan.planId, plan])
  );
  catalogPlans.forEach((catalogPlan) => {
    if (!byId.has(catalogPlan.planId)) {
      byId.set(catalogPlan.planId, {
        planId: catalogPlan.planId,
        name: catalogPlan.name,
        description: catalogPlan.description,
        amountInr: catalogPlan.amountInr,
        interval: catalogPlan.interval,
        isActive: catalogPlan.isActive !== false
      });
    }
  });
  return Array.from(byId.values()).filter((plan) => plan.planId !== 'msme_enterprise_yearly');
};
const { getMsmePaymentQuote } = require('./msmePaymentQuoteService');
const razorpayService = require('./razorpayService');
const {
  buildActivationPayloadFromPayment,
  resolveMsmeEntitlements
} = require('./planEntitlementService');

const VIEW_ROLE = 'view';
const MSME_ROLE = 'msme';

const isBillingRoleApplicable = (role) => role === MSME_ROLE;

const getBillingModuleConfig = async () => {
  let config = await BillingModuleConfig.findOne().lean();
  if (!config) {
    const created = await BillingModuleConfig.create({
      moduleEnabled: true,
      provider: 'razorpay',
      informationalOnly: true,
      methods: getDefaultBillingMethods(),
      fixedPlans: getDefaultFixedPlans()
    });
    config = created.toObject();
  }

  if (!Array.isArray(config.fixedPlans) || config.fixedPlans.length === 0) {
    config.fixedPlans = getDefaultFixedPlans();
  } else {
    config.fixedPlans = mergeCatalogPlans(config.fixedPlans);
  }

  return config;
};

const getOrCreateBillingProfile = async ({ userId, msmeId, role }) => {
  if (!isBillingRoleApplicable(role)) {
    return null;
  }

  return UserBillingProfile.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        userId,
        informationalOnly: true
      },
      $set: {
        msmeId: msmeId || null
      }
    },
    { new: true, upsert: true }
  ).lean();
};

const resolveFixedPlan = (config, planId) => {
  const plans = Array.isArray(config.fixedPlans) ? config.fixedPlans : [];
  return plans.find((plan) => plan.planId === planId && plan.isActive !== false) || null;
};

const resolveCheckoutAmount = async ({
  pricingModel,
  planId,
  msmeId,
  config
}) => {
  if (pricingModel === 'fixed_plan') {
    const canonicalPlanId = resolveCanonicalPlanId(planId);
    const plan = resolveFixedPlan(config, canonicalPlanId) || resolveFixedPlan(config, planId);
    if (!plan) {
      const error = new Error('Selected plan is not available');
      error.statusCode = 400;
      throw error;
    }
    if (!plan.amountInr || plan.amountInr <= 0) {
      const error = new Error('This plan does not require payment. Continue on the free tier or choose a paid plan.');
      error.statusCode = 400;
      throw error;
    }
    return {
      amountInr: plan.amountInr,
      currency: 'INR',
      planInterval: plan.interval,
      breakdown: {
        planId: plan.planId,
        planName: plan.name,
        interval: plan.interval,
        amountInr: plan.amountInr,
        tier: resolvePlanTier(plan.planId),
        limits: getPlanLimits(plan.planId)
      }
    };
  }

  const usageQuote = await getMsmePaymentQuote(msmeId);
  if (!usageQuote) {
    const error = new Error('MSME profile not found');
    error.statusCode = 404;
    throw error;
  }

  return {
    amountInr: usageQuote.paymentAmount,
    currency: usageQuote.currency || 'INR',
    planInterval: null,
    breakdown: usageQuote
  };
};

const buildBillingStatus = async ({ userId, msmeId, role }) => {
  if (!isBillingRoleApplicable(role)) {
    return {
      billingApplicable: false,
      role,
      informationalOnly: true,
      message: role === 'partner'
        ? 'Partner billing is handled through contract invoicing in the partner portal; direct payment checkout is for MSME accounts.'
        : 'Billing checkout is only available for MSME accounts.'
    };
  }

  const config = await getBillingModuleConfig();
  const razorpay = razorpayService.getCredentials();

  const [profile, recentPayments, usageQuote] = await Promise.all([
    getOrCreateBillingProfile({ userId, msmeId, role }),
    BillingPayment.find({ userId }).sort({ createdAt: -1 }).limit(10).lean(),
    msmeId ? getMsmePaymentQuote(msmeId) : null
  ]);

  const activePlans = (config.fixedPlans || []).filter((plan) => plan.isActive !== false);
  const entitlements = await resolveMsmeEntitlements({
    userId,
    msmeId,
    role
  });

  return {
    billingApplicable: true,
    role,
    informationalOnly: config.informationalOnly !== false,
    enforcementActive: entitlements.enforcementActive,
    moduleEnabled: config.moduleEnabled === true,
    provider: config.provider || 'razorpay',
    paymentsEnabled: config.moduleEnabled === true && razorpay.isConfigured,
    razorpayKeyId: razorpay.isConfigured ? razorpayService.getPublicKeyId() : null,
    methods: config.methods || getDefaultBillingMethods(),
    profile,
    entitlements: {
      tier: entitlements.tier,
      limits: entitlements.limits,
      paidUntil: entitlements.paidUntil,
      isExpired: entitlements.isExpired,
      selectedPlanId: entitlements.selectedPlanId
    },
    usageQuote,
    fixedPlans: activePlans,
    recentPayments
  };
};

const createCheckout = async ({
  userId,
  msmeId,
  role,
  pricingModel,
  planId
}) => {
  if (!isBillingRoleApplicable(role)) {
    const error = new Error('Only MSME accounts can initiate payments');
    error.statusCode = 403;
    throw error;
  }

  const config = await getBillingModuleConfig();
  if (!config.moduleEnabled) {
    const error = new Error('Billing module is not enabled');
    error.statusCode = 403;
    throw error;
  }

  const normalizedPricingModel = pricingModel === 'fixed_plan' ? 'fixed_plan' : 'usage_based';
  if (normalizedPricingModel === 'fixed_plan' && !planId) {
    const error = new Error('planId is required for fixed plan checkout');
    error.statusCode = 400;
    throw error;
  }

  const { amountInr, currency, planInterval, breakdown } = await resolveCheckoutAmount({
    pricingModel: normalizedPricingModel,
    planId,
    msmeId,
    config
  });

  if (!amountInr || amountInr <= 0) {
    const error = new Error('Invalid payment amount');
    error.statusCode = 400;
    throw error;
  }

  const receipt = `msme_${String(msmeId).slice(-8)}_${Date.now()}`;
  const orderResult = await razorpayService.createOrder({
    amountInr,
    currency,
    receipt,
    notes: {
      userId: String(userId),
      msmeId: String(msmeId),
      pricingModel: normalizedPricingModel,
      planId: planId || '',
      planInterval: planInterval || ''
    }
  });

  const order = orderResult.order;
  const paymentRecord = await BillingPayment.create({
    userId,
    msmeId,
    pricingModel: normalizedPricingModel,
    planId: planId || null,
    planInterval: planInterval || null,
    amount: amountInr,
    currency,
    razorpayOrderId: order.id,
    status: 'pending',
    notes: breakdown
  });

  await UserBillingProfile.findOneAndUpdate(
    { userId },
    {
      $set: {
        msmeId,
        pricingModel: normalizedPricingModel,
        selectedPlanId: planId || null,
        planInterval: planInterval || null,
        status: 'pending',
        lastQuotedAmount: amountInr,
        lastQuotedCurrency: currency,
        lastQuotedAt: new Date(),
        lastQuotedBreakdown: breakdown,
        informationalOnly: config.informationalOnly !== false
      }
    },
    { upsert: true, new: true }
  );

  return {
    informationalOnly: config.informationalOnly !== false,
    paymentsEnabled: orderResult.configured,
    mockCheckout: orderResult.mock === true,
    razorpayKeyId: razorpayService.getPublicKeyId(),
    order: {
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt
    },
    paymentId: paymentRecord._id,
    amountInr,
    currency,
    pricingModel: normalizedPricingModel,
    planId: planId || null,
    planInterval: planInterval || null
  };
};

const markPaymentPaid = async ({
  orderId,
  paymentId,
  signature
}) => {
  const paymentRecord = await BillingPayment.findOne({ razorpayOrderId: orderId });
  if (!paymentRecord) {
    const error = new Error('Payment record not found');
    error.statusCode = 404;
    throw error;
  }

  if (paymentRecord.status === 'paid') {
    return paymentRecord;
  }

  const isValid = razorpayService.verifyPaymentSignature({
    orderId,
    paymentId,
    signature
  });

  if (!isValid) {
    const error = new Error('Invalid payment signature');
    error.statusCode = 400;
    throw error;
  }

  paymentRecord.razorpayPaymentId = paymentId;
  paymentRecord.razorpaySignature = signature;
  paymentRecord.status = 'paid';
  paymentRecord.paidAt = new Date();
  await paymentRecord.save();

  const activation = buildActivationPayloadFromPayment(paymentRecord, paymentRecord.paidAt);

  await UserBillingProfile.findOneAndUpdate(
    { userId: paymentRecord.userId },
    {
      $set: {
        ...activation,
        lastPaymentId: paymentId
      }
    },
    { upsert: true }
  );

  return paymentRecord;
};

const handleWebhookEvent = async (event) => {
  const eventName = event?.event;
  const paymentEntity = event?.payload?.payment?.entity;
  if (!paymentEntity?.order_id) {
    return { handled: false, reason: 'missing_order' };
  }

  if (eventName === 'payment.captured' || eventName === 'payment.authorized') {
    const paidAt = new Date();
    const record = await BillingPayment.findOneAndUpdate(
      { razorpayOrderId: paymentEntity.order_id },
      {
        $set: {
          razorpayPaymentId: paymentEntity.id,
          status: 'paid',
          paidAt
        }
      },
      { new: true }
    ).lean();

    if (record) {
      const activation = buildActivationPayloadFromPayment(record, paidAt);
      await UserBillingProfile.findOneAndUpdate(
        { userId: record.userId },
        {
          $set: {
            ...activation,
            lastPaymentId: paymentEntity.id
          }
        },
        { upsert: true }
      );
    }

    return { handled: true, event: eventName };
  }

  if (eventName === 'payment.failed') {
    await BillingPayment.findOneAndUpdate(
      { razorpayOrderId: paymentEntity.order_id },
      { $set: { status: 'failed' } }
    );
    return { handled: true, event: eventName };
  }

  return { handled: false, reason: 'ignored_event' };
};

const enrichPublicPlan = (plan) => {
  const tier = resolvePlanTier(plan.planId);
  const limits = getPlanLimits(plan.planId);
  const amountInr = Number(plan.amountInr) || 0;
  return {
    planId: plan.planId,
    name: plan.name,
    description: plan.description || '',
    amountInr,
    amountInrInclGst: amountInr > 0 ? Math.round(amountInr * (1 + GST_RATE)) : 0,
    interval: plan.interval,
    tier,
    requiresPayment: amountInr > 0,
    limits,
    isPopular: plan.planId === PRICING_GUIDANCE.recommendedPopularPlanId
  };
};

const buildPublicPricing = async () => {
  const config = await getBillingModuleConfig();
  const activePlans = (config.fixedPlans || [])
    .filter((plan) => plan.isActive !== false && plan.planId !== 'msme_enterprise_yearly');

  return {
    currency: 'INR',
    pricesExclusiveOfGst: true,
    gstRate: GST_RATE,
    moduleEnabled: config.moduleEnabled === true,
    informationalOnly: config.informationalOnly !== false,
    provider: config.provider || 'razorpay',
    paymentMethods: config.methods || getDefaultBillingMethods(),
    guidance: PRICING_GUIDANCE,
    fixedPlans: activePlans.map(enrichPublicPlan),
    usagePricing: {
      currency: 'INR',
      baseAmountInr: USAGE_PRICING.baseAmountInr,
      typicalRangeInr: USAGE_PRICING.typicalRangeInr,
      starterFloorInr: USAGE_PRICING.starterFloorInr,
      overagePerDocumentInr: USAGE_PRICING.overagePerDocumentInr,
      summary:
        'Usage-based fees start from a ₹1,500 platform base, adjust for operational complexity, and are floored at the Starter monthly rate. Exceeding fixed-plan document limits incurs per-document overage.',
      factors: [
        { key: 'baseAmount', label: 'Platform base', description: 'Core workspace access' },
        { key: 'emissionIntensity', label: 'Emission intensity', description: 'Sector-adjusted emissions per activity signal' },
        { key: 'transactions', label: 'Transaction volume', description: 'Imported or captured operational transactions' },
        { key: 'workflow', label: 'Workflow complexity', description: 'Processes, materials, machinery, and sites mapped in Operations' },
        { key: 'overage', label: 'Document overage', description: `₹${USAGE_PRICING.overagePerDocumentInr} per document above plan limits` }
      ]
    },
    enterprisePricing: ENTERPRISE_PRICING_FRAMEWORK,
    channelPricing: CHANNEL_PRICING,
    billingNote:
      'Payments are processed securely in INR via Razorpay (UPI, cards, net banking when enabled). Fixed plans are recommended; usage quotes are for seasonal volume or overage. Platform access is not restricted by payment status unless your administrator changes billing policy.'
  };
};

module.exports = {
  isBillingRoleApplicable,
  getBillingModuleConfig,
  getOrCreateBillingProfile,
  buildBillingStatus,
  buildPublicPricing,
  createCheckout,
  markPaymentPaid,
  handleWebhookEvent,
  resolveFixedPlan,
  buildActivationPayloadFromPayment
};
