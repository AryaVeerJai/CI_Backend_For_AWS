/**
 * Reporting routes accept MSME or enterprise (non-MSME) operational profiles.
 */

const hasReportingProfile = (user = {}) => {
  if (user.role === 'enterprise') {
    return Boolean(user.enterpriseId && user.organizationId);
  }
  return Boolean(user.msmeId);
};

const profileNotFoundPayload = (user = {}) => ({
  success: false,
  message: user.role === 'enterprise'
    ? 'Enterprise profile not found'
    : 'MSME profile not found'
});

const assertReportingProfile = (req, res) => {
  if (!hasReportingProfile(req.user)) {
    res.status(404).json(profileNotFoundPayload(req.user));
    return false;
  }
  return true;
};

module.exports = {
  hasReportingProfile,
  profileNotFoundPayload,
  assertReportingProfile
};
