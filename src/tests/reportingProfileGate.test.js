const {
  hasReportingProfile,
  profileNotFoundPayload
} = require('../utils/reportingProfileGate');

describe('reportingProfileGate', () => {
  it('accepts MSME users with msmeId', () => {
    expect(hasReportingProfile({ role: 'msme', msmeId: 'abc' })).toBe(true);
  });

  it('accepts enterprise users with enterpriseId and organizationId', () => {
    expect(hasReportingProfile({
      role: 'enterprise',
      enterpriseId: 'ent1',
      organizationId: 'org1'
    })).toBe(true);
  });

  it('rejects enterprise without organization', () => {
    expect(hasReportingProfile({ role: 'enterprise', enterpriseId: 'ent1' })).toBe(false);
  });

  it('returns enterprise-specific not-found message', () => {
    expect(profileNotFoundPayload({ role: 'enterprise' }).message).toMatch(/Enterprise/i);
  });
});
