const {
  getCheckoutFixedPlans,
  getPublicFixedPlans
} = require('./pricingCatalog');

const getDefaultBillingMethods = () => ({
  upi: true,
  netBanking: true,
  cards: true
});

/** Plans seeded into BillingModuleConfig (includes free; checkout filters paid plans). */
const getDefaultFixedPlans = () => getPublicFixedPlans().map((plan) => ({
  planId: plan.planId,
  name: plan.name,
  description: plan.description,
  amountInr: plan.amountInr,
  interval: plan.interval,
  isActive: plan.isActive !== false
}));

const getPaidFixedPlans = () => getCheckoutFixedPlans().map((plan) => ({
  planId: plan.planId,
  name: plan.name,
  description: plan.description,
  amountInr: plan.amountInr,
  interval: plan.interval,
  isActive: plan.isActive !== false
}));

module.exports = {
  getDefaultBillingMethods,
  getDefaultFixedPlans,
  getPaidFixedPlans
};
