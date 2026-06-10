const MSME = require('../models/MSME');
const CarbonAssessment = require('../models/CarbonAssessment');
const { getOperationalProfile } = require('../services/organizationProfileService');
const { buildOrgDataFilter } = require('./orgDataScope');

/**
 * Load profile and historical assessments for carbon forecasting (MSME or enterprise).
 */
const loadForecastContext = async (req) => {
  const operational = await getOperationalProfile(req.user);
  if (operational) {
    const filter = buildOrgDataFilter(req);
    const historicalAssessments = await CarbonAssessment.find(filter)
      .sort({ 'period.startDate': 1 })
      .limit(24);
    return {
      profile: operational.profile,
      segment: operational.segment,
      historicalAssessments
    };
  }

  const msme = await MSME.findOne({ userId: req.user.userId });
  if (!msme) {
    return null;
  }
  const historicalAssessments = await CarbonAssessment.find({ msmeId: msme._id })
    .sort({ 'period.startDate': 1 })
    .limit(24);
  return {
    profile: msme,
    segment: 'msme',
    historicalAssessments
  };
};

module.exports = { loadForecastContext };
