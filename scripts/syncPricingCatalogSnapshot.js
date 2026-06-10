#!/usr/bin/env node
/**
 * Generates src/constants/pricingCatalog.snapshot.json from backend pricingCatalog.js.
 * Run after changing plan amounts, limits, or enterprise/channel copy.
 */
const fs = require('fs');
const path = require('path');
const {
  GST_RATE,
  PLAN_LIMITS,
  USAGE_PRICING,
  PRICING_GUIDANCE,
  ENTERPRISE_PRICING_FRAMEWORK,
  CHANNEL_PRICING,
  getPublicFixedPlans,
  getPlanLimits,
  addGst
} = require('../src/config/pricingCatalog');

const enrichPublicPlan = (plan) => ({
  planId: plan.planId,
  name: plan.name,
  description: plan.description,
  amountInr: plan.amountInr,
  amountInrInclGst: addGst(plan.amountInr),
  interval: plan.interval,
  tier: plan.tier,
  requiresPayment: plan.requiresPayment !== false,
  limits: getPlanLimits(plan.planId),
  isPopular: plan.planId === PRICING_GUIDANCE.recommendedPopularPlanId
});

const usagePricing = {
  currency: 'INR',
  baseAmountInr: USAGE_PRICING.baseAmountInr,
  typicalRangeInr: USAGE_PRICING.typicalRangeInr,
  starterFloorInr: USAGE_PRICING.starterFloorInr,
  overagePerDocumentInr: USAGE_PRICING.overagePerDocumentInr,
  summary:
    'Usage-based fees start from a ₹1,500 platform base, adjust for operational complexity, and are floored at the Starter monthly rate. Exceeding fixed-plan document limits incurs per-document overage.',
  factors: [
    { key: 'baseAmount', label: 'Platform base', description: 'Core workspace access' },
    {
      key: 'emissionIntensity',
      label: 'Emission intensity',
      description: 'Sector-adjusted emissions per activity signal'
    },
    {
      key: 'transactions',
      label: 'Transaction volume',
      description: 'Imported or captured operational transactions'
    },
    {
      key: 'workflow',
      label: 'Workflow complexity',
      description: 'Processes, materials, machinery, and sites mapped in Operations'
    },
    {
      key: 'overage',
      label: 'Document overage',
      description: `₹${USAGE_PRICING.overagePerDocumentInr} per document above plan limits`
    }
  ]
};

const fallbackPublicPricing = {
  currency: 'INR',
  pricesExclusiveOfGst: true,
  gstRate: GST_RATE,
  moduleEnabled: false,
  informationalOnly: true,
  provider: 'razorpay',
  paymentMethods: { upi: true, netBanking: true, cards: true },
  guidance: PRICING_GUIDANCE,
  fixedPlans: getPublicFixedPlans().map(enrichPublicPlan),
  usagePricing,
  enterprisePricing: ENTERPRISE_PRICING_FRAMEWORK,
  channelPricing: CHANNEL_PRICING,
  billingNote:
    'Payments are processed securely in INR when billing is enabled. Fixed plans are recommended; usage quotes are for seasonal volume or overage. Platform access is not restricted by payment status unless your administrator changes billing policy.'
};

const { MONTHLY_TIER_AMOUNTS_EXCL } = require('../src/config/pricingCatalog');

const snapshot = {
  planLimits: PLAN_LIMITS,
  monthlyTierAmountsExcl: MONTHLY_TIER_AMOUNTS_EXCL,
  fallbackPublicPricing
};

const outPath = path.join(__dirname, '../../src/constants/pricingCatalog.snapshot.json');
fs.writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
console.log(`Wrote ${outPath}`);
