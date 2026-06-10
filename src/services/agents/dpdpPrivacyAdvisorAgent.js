/**
 * DPDP Act (India) aligned privacy guidance for MSME data processing.
 */
const DPDP_PURPOSES = [
  { id: 'carbon_accounting', label: 'Carbon footprint calculation', lawfulBasis: 'legitimate_interest' },
  { id: 'compliance_reporting', label: 'Regulatory and buyer reporting', lawfulBasis: 'legal_obligation' },
  { id: 'document_ocr', label: 'Bill and invoice extraction', lawfulBasis: 'consent' },
  { id: 'sms_signals', label: 'SMS transaction signals (mobile)', lawfulBasis: 'consent' },
  { id: 'green_finance', label: 'Green loan and incentive applications', lawfulBasis: 'consent' }
];

const buildDpdpAdvisory = ({
  privacySettings = {},
  processingFlags = {}
}) => {
  const settings = {
    smsProcessing: privacySettings.smsProcessing !== false,
    emailProcessing: privacySettings.emailProcessing !== false,
    documentProcessing: privacySettings.documentProcessing !== false,
    cookieConsent: privacySettings.cookieConsent !== false,
    dataRetention: privacySettings.dataRetention !== false,
    auditLogging: privacySettings.auditLogging !== false,
    marketingCommunications: privacySettings.marketingCommunications === true
  };

  const openIssues = [];
  const recommendations = [];

  if (!settings.dataRetention) {
    openIssues.push('Data retention preference is off — define retention for bills and inventory per DPDP storage limitation.');
    recommendations.push({
      priority: 'high',
      title: 'Enable retention policy',
      action: 'Turn on data retention in Data Privacy and document a 7-year evidence retention for GHG records.',
      path: '/data-privacy'
    });
  }

  if (processingFlags.smsEnabled && !settings.smsProcessing) {
    openIssues.push('SMS ingestion is active but SMS processing consent is disabled — align processing with user consent.');
    recommendations.push({
      priority: 'high',
      title: 'Align SMS consent',
      action: 'Enable SMS processing consent or pause SMS capture on mobile.',
      path: '/data-privacy'
    });
  }

  if (!settings.auditLogging) {
    openIssues.push('Audit logging is disabled — assurance and buyer audits require change history.');
    recommendations.push({
      priority: 'medium',
      title: 'Enable audit logging',
      action: 'Enable audit logging for inventory and consent changes.',
      path: '/data-privacy'
    });
  }

  if (!settings.cookieConsent) {
    recommendations.push({
      priority: 'low',
      title: 'Cookie consent',
      action: 'Confirm cookie consent for analytics if used on marketing pages.',
      path: '/data-privacy'
    });
  }

  const consentMatrix = DPDP_PURPOSES.map((purpose) => ({
    ...purpose,
    status: purpose.id === 'sms_signals'
      ? (settings.smsProcessing ? 'granted' : 'review_required')
      : purpose.id === 'document_ocr'
        ? (settings.documentProcessing ? 'granted' : 'review_required')
        : 'informational',
    msmeNote:
      purpose.id === 'sms_signals'
        ? 'Explicit opt-in required before reading payment SMS on Android.'
        : purpose.id === 'document_ocr'
          ? 'Upload only business bills; PAN and personal data are minimized.'
          : 'Used only for sustainability and compliance features you activate.'
  }));

  const readinessScore = clampScore(
    100
    - (openIssues.length * 20)
    - (!settings.dataRetention ? 15 : 0)
    - (!settings.auditLogging ? 10 : 0)
  );

  return {
    framework: 'DPDP_2023',
    readinessScore,
    status: openIssues.length === 0 ? 'aligned' : 'needs_attention',
    openIssues,
    recommendations,
    consentMatrix,
    retentionGuidance: {
      ghgEvidenceYears: 7,
      note: 'Align with BRSR/ISO evidence retention; honour erasure requests after legal hold periods.'
    },
    dataPrincipalRights: [
      { right: 'access', path: '/data-privacy', label: 'Request copy of your data' },
      { right: 'deletion', path: '/data-privacy', label: 'Request erasure (subject to legal retention)' },
      { right: 'withdraw_consent', path: '/data-privacy', label: 'Withdraw SMS or marketing consent' }
    ]
  };
};

const clampScore = (n) => Math.min(100, Math.max(0, Math.round(n)));

module.exports = {
  DPDP_PURPOSES,
  buildDpdpAdvisory,
  async execute(task = {}) {
    const { input = {} } = task;
    return buildDpdpAdvisory(input);
  }
};
