const {
  ICM_PORTAL_BASE_URL,
  ICM_REGISTRY_API_DEFAULT_BASE_URL,
  buildCreditVerificationUrl,
  buildEntityDashboardUrl,
  getPortalLinkCatalog
} = require('../constants/indianCarbonMarket');
const IndianCarbonMarketRegistryClient = require('./indianCarbonMarketRegistryClient');

class IndianCarbonMarketIntegrationService {
  constructor(options = {}) {
    this.registryClient = options.registryClient || new IndianCarbonMarketRegistryClient();
  }

  getRegistryStatus() {
    const status = this.registryClient.getConfigurationStatus();
    return {
      ...status,
      portalBaseUrl: ICM_PORTAL_BASE_URL,
      registryApiDefaultBaseUrl: ICM_REGISTRY_API_DEFAULT_BASE_URL,
      integrationMode: status.configured
        ? 'registry_api'
        : (status.enabled ? 'registry_api_incomplete' : 'portal_links_only')
    };
  }

  buildPortalContext(msme = {}, msmeCredits = null) {
    const msmeId = msme?._id?.toString?.() || msme?.id || null;
    const portalEntityId = (
      msme?.indianCarbonMarket?.portalEntityId
      || msmeCredits?.registryIntegration?.externalAccountId
      || ''
    ).trim();

    const linkCatalog = getPortalLinkCatalog({
      msmeId,
      entityId: portalEntityId || undefined,
      udyamRegistrationNumber: msme?.udyamRegistrationNumber,
      serialNumber: msmeCredits?.registryIntegration?.lastRetirementProof?.serialNumber
    });

    return {
      portalBaseUrl: ICM_PORTAL_BASE_URL,
      portalEntityId: portalEntityId || null,
      udyamRegistrationNumber: msme?.udyamRegistrationNumber || null,
      entityDashboardUrl: buildEntityDashboardUrl({
        entityId: portalEntityId || undefined,
        msmeId,
        udyam: msme?.udyamRegistrationNumber
      }),
      ...linkCatalog
    };
  }

  buildRegistryAlignment(msmeCredits) {
    if (!msmeCredits) {
      return {
        syncEnabled: false,
        lastSyncedAt: null,
        lastSyncStatus: 'never',
        externalAccountId: null,
        remoteBalances: null,
        icmWorkflow: null
      };
    }

    const integration = msmeCredits.registryIntegration || {};
    const workflow = integration.icmWorkflow || null;
    const baselineSet = Number(workflow?.baseline?.co2Emissions) > 0;

    return {
      syncEnabled: Boolean(integration.enabled),
      lastSyncedAt: integration.lastSyncedAt || null,
      lastSyncStatus: integration.lastSyncStatus || 'never',
      lastSyncError: integration.lastSyncError || '',
      externalAccountId: integration.externalAccountId || null,
      remoteBalances: integration.remoteBalances || null,
      icmWorkflow: workflow
        ? {
          workflowId: workflow.workflowId,
          baselineSet,
          baselineCo2Emissions: workflow.baseline?.co2Emissions ?? 0,
          latestReductionKgCO2: workflow.reductionTracking?.latestReductionKgCO2 ?? 0,
          totalQuantifiedCredits: workflow.creditQuantification?.totalQuantifiedCredits ?? 0
        }
        : null,
      lastRetirementProof: integration.lastRetirementProof || null,
      verificationUrl: buildCreditVerificationUrl({
        serialNumber: integration.lastRetirementProof?.serialNumber,
        projectId: integration.lastRetirementProof?.registryProjectId,
        accountId: integration.externalAccountId
      })
    };
  }

  buildCreditInstrumentGuidance() {
    return {
      earnedPoolCredits: {
        instrument: 'ICM compliance pool (platform aggregation)',
        registryRequired: true,
        note:
          'Earned credits should be issued on the national registry before external surrender. Use sync when API access is configured.'
      },
      purchasedOffsets: {
        instrument: 'Voluntary offset (project-based)',
        preferIcmRegistered: true,
        note:
          'Prefer projects listed on indiancarbonmarket.gov.in when operating in India; keep international standards separate in disclosures.'
      }
    };
  }

  buildCompliancePack(context = {}, msmeCredits = null) {
    const msme = context.msme || {};
    const portal = this.buildPortalContext(msme, msmeCredits);
    const registry = this.buildRegistryAlignment(msmeCredits);
    const registryStatus = this.getRegistryStatus();

    return {
      generatedAt: new Date().toISOString(),
      portal,
      registryStatus,
      registryAlignment: registry,
      creditsSummary: context.carbonCreditsSummary || {},
      creditInstruments: this.buildCreditInstrumentGuidance(),
      programmes: ['Indian Carbon Market (compliance market)', 'Green Credit Programme (GCP)'],
      retirementProofFields: [
        'registry_project_id',
        'vintage_year',
        'serial_number',
        'retirement_certificate_url'
      ],
      marketplacePath: '/carbon-marketplace',
      complianceNote:
        'Separate compliance-market obligations from voluntary retirements. Link each retirement to invoice or contract evidence and verify on the national registry when available.'
    };
  }

  async buildAccountIntegration(msmeId, msme, msmeCredits) {
    return {
      ...this.getRegistryStatus(),
      portal: this.buildPortalContext(msme, msmeCredits),
      registryAlignment: this.buildRegistryAlignment(msmeCredits),
      creditInstruments: this.buildCreditInstrumentGuidance()
    };
  }

  extractRetirementProof(registryResponse) {
    const payload = registryResponse?.data || registryResponse?.raw || registryResponse || {};
    const proof = payload.retirementProof || payload.proof || payload;
    return {
      registryProjectId: proof.registryProjectId || proof.projectId || proof.registry_project_id || '',
      serialNumber: proof.serialNumber || proof.serial_number || proof.serial || '',
      vintageYear: proof.vintageYear || proof.vintage_year || proof.vintage || null,
      retirementCertificateUrl:
        proof.retirementCertificateUrl
        || proof.retirement_certificate_url
        || proof.certificateUrl
        || ''
    };
  }

  async persistRetirementProof(msmeCredits, registryResponse) {
    const proof = this.extractRetirementProof(registryResponse);
    const hasProof = Object.values(proof).some((v) => v !== '' && v != null);
    if (!hasProof) {
      return proof;
    }

    msmeCredits.registryIntegration = msmeCredits.registryIntegration || {};
    msmeCredits.registryIntegration.lastRetirementProof = {
      ...proof,
      recordedAt: new Date()
    };
    msmeCredits.markModified('registryIntegration');
    await msmeCredits.save();
    return proof;
  }
}

module.exports = new IndianCarbonMarketIntegrationService();
module.exports.IndianCarbonMarketIntegrationService = IndianCarbonMarketIntegrationService;
