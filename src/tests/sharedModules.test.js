const {
  isOtpOrPromotionalSpam,
  isImportantTransactionSms,
  scoreSmsSpamSignals,
} = require('../../../shared/smsSpamPatterns');

const {
  computeEnvironmentalEquivalents,
  computeDataQualityScore,
} = require('../../../shared/sustainabilityUxCore');

describe('shared/smsSpamPatterns', () => {
  test('detects OTP messages as spam', () => {
    expect(isOtpOrPromotionalSpam('Your OTP for login is 482910. Do not share.')).toBe(true);
  });

  test('detects debit alerts as important transactions', () => {
    expect(isImportantTransactionSms('Rs 500 debited from A/C XX1234')).toBe(true);
  });

  test('scoreSmsSpamSignals returns otp signal', () => {
    const result = scoreSmsSpamSignals('OTP 123456 valid for 5 min');
    expect(result.signals).toContain('otp');
  });
});

describe('shared/sustainabilityUxCore', () => {
  test('computeEnvironmentalEquivalents scales kg CO2', () => {
    const eq = computeEnvironmentalEquivalents(210);
    expect(eq.treesEquivalent).toBe(10);
  });

  test('computeDataQualityScore supports web platform fields', () => {
    const result = computeDataQualityScore({
      platform: 'web',
      hasProfile: true,
      hasAssessment: true,
      carbonEmissionsKg: 100,
      transactionCount: 5,
      documentCount: 2,
      hasScopeBreakdown: true,
    });
    expect(result.level).toBe('high');
  });

  test('computeDataQualityScore supports mobile SMS signal', () => {
    const result = computeDataQualityScore({
      platform: 'mobile',
      hasProfile: true,
      hasAssessment: true,
      carbonEmissionsKg: 100,
      transactionCount: 3,
      hasSmsOrLocalData: true,
    });
    expect(result.score).toBeGreaterThanOrEqual(75);
  });
});
