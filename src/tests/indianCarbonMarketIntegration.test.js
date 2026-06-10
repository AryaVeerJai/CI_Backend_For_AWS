const {
  buildPortalUrl,
  buildCreditVerificationUrl,
  ICM_PORTAL_BASE_URL
} = require('../constants/indianCarbonMarket');
const {
  IndianCarbonMarketIntegrationService
} = require('../services/indianCarbonMarketIntegrationService');

describe('indianCarbonMarket constants', () => {
  test('buildPortalUrl uses official portal base', () => {
    expect(buildPortalUrl('home')).toBe(`${ICM_PORTAL_BASE_URL}/`);
    expect(buildPortalUrl('msme', { udyam: 'UDYAM-DL-01-0000001' })).toContain('udyam=');
  });

  test('buildCreditVerificationUrl includes serial query', () => {
    const url = buildCreditVerificationUrl({ serialNumber: 'ICM-SN-99' });
    expect(url).toContain('serial=ICM-SN-99');
  });
});

describe('IndianCarbonMarketIntegrationService', () => {
  const service = new IndianCarbonMarketIntegrationService({
    registryClient: {
      getConfigurationStatus: () => ({
        enabled: false,
        configured: false,
        baseUrlConfigured: true,
        apiKeyConfigured: false,
        timeoutMs: 15000
      })
    }
  });

  test('buildCompliancePack includes portal links and marketplace path', () => {
    const pack = service.buildCompliancePack(
      {
        msme: { companyName: 'Test MSME', udyamRegistrationNumber: 'UDYAM-DL-01-0000001' },
        carbonCreditsSummary: { availableCredits: 10 }
      },
      null
    );

    expect(pack.marketplacePath).toBe('/carbon-marketplace');
    expect(pack.portal.links.length).toBeGreaterThan(0);
    expect(pack.portal.portalBaseUrl).toBe(ICM_PORTAL_BASE_URL);
    expect(pack.registryStatus.integrationMode).toBe('portal_links_only');
  });

  test('extractRetirementProof maps registry response fields', () => {
    const proof = service.extractRetirementProof({
      serialNumber: 'SN-1',
      registryProjectId: 'PRJ-9',
      retirementCertificateUrl: 'https://indiancarbonmarket.gov.in/cert/1'
    });
    expect(proof.serialNumber).toBe('SN-1');
    expect(proof.registryProjectId).toBe('PRJ-9');
  });
});
