const MSME_SIGNUP_GOALS = [
  'buyer_audit',
  'brsr_compliance',
  'baseline_footprint',
  'green_finance',
  'pat_icm',
  'cost_reduction'
];

const VALID_SIGNUP_GOALS = new Set(MSME_SIGNUP_GOALS);

const GOAL_PRIORITIES = {
  buyer_audit: 1,
  brsr_compliance: 2,
  baseline_footprint: 3,
  green_finance: 4,
  pat_icm: 5,
  cost_reduction: 6
};

module.exports = {
  MSME_SIGNUP_GOALS,
  VALID_SIGNUP_GOALS,
  GOAL_PRIORITIES
};
