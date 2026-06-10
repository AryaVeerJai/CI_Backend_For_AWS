const DAY_COUNT_BY_PERIOD = {
  '1month': 30,
  month: 30,
  '3months': 90,
  quarter: 90,
  '6months': 180,
  'half-year': 180,
  '1year': 365,
  year: 365,
  annual: 365
};

/**
 * @param {string} period
 * @param {{ defaultPeriod?: string }} [options]
 */
const getDateRangeFromPeriod = (period, options = {}) => {
  const defaultPeriod = options.defaultPeriod || 'annual';
  const normalizedPeriod = String(period || defaultPeriod).toLowerCase();
  const now = new Date();
  const dayCount = DAY_COUNT_BY_PERIOD[normalizedPeriod] || DAY_COUNT_BY_PERIOD[defaultPeriod] || 365;
  return {
    startDate: new Date(now.getTime() - dayCount * 24 * 60 * 60 * 1000),
    endDate: now,
    period: normalizedPeriod
  };
};

module.exports = {
  DAY_COUNT_BY_PERIOD,
  getDateRangeFromPeriod
};
