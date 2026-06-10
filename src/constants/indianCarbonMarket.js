/**
 * Indian Carbon Market (ICM) portal and registry link templates.
 * Official portal: https://indiancarbonmarket.gov.in (Bureau of Energy Efficiency).
 */

const ICM_PORTAL_BASE_URL = (
  process.env.INDIAN_CARBON_PORTAL_BASE_URL || 'https://indiancarbonmarket.gov.in'
).replace(/\/$/, '');

const ICM_REGISTRY_API_DEFAULT_BASE_URL = (
  process.env.INDIAN_CARBON_REGISTRY_BASE_URL || 'https://api.indiancarbonmarket.gov.in'
).replace(/\/$/, '');

const ICM_PORTAL_PATHS = {
  home: '/',
  about: '/about',
  msme: '/msme',
  projects: '/projects',
  registry: '/registry',
  trading: '/trading',
  methodologies: '/methodologies',
  faq: '/faq',
  login: '/login'
};

const buildPortalUrl = (pathKey, query = {}) => {
  const path = ICM_PORTAL_PATHS[pathKey] || ICM_PORTAL_PATHS.home;
  const url = new URL(path, `${ICM_PORTAL_BASE_URL}/`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
};

const buildCreditVerificationUrl = (options = {}) => {
  const { serialNumber, projectId, accountId } = options;
  return buildPortalUrl('registry', {
    serial: serialNumber,
    project: projectId,
    account: accountId
  });
};

const buildEntityDashboardUrl = (options = {}) => {
  const { entityId, msmeId, udyam } = options;
  return buildPortalUrl('msme', {
    entity: entityId,
    ref: msmeId,
    udyam
  });
};

const getPortalLinkCatalog = (options = {}) => {
  const { msmeId, entityId, udyamRegistrationNumber, serialNumber } = options;
  return {
    portalBaseUrl: ICM_PORTAL_BASE_URL,
    registryApiDefaultBaseUrl: ICM_REGISTRY_API_DEFAULT_BASE_URL,
    links: [
      {
        id: 'portal_home',
        label: 'Indian Carbon Market portal',
        description: 'Official BEE carbon market portal',
        url: buildPortalUrl('home')
      },
      {
        id: 'msme_module',
        label: 'MSME programmes',
        description: 'MSME registration and credit programmes on ICM',
        url: buildEntityDashboardUrl({
          entityId,
          msmeId,
          udyam: udyamRegistrationNumber
        })
      },
      {
        id: 'project_submission',
        label: 'Submit a project',
        description: 'Register reduction activities and methodologies',
        url: buildPortalUrl('projects')
      },
      {
        id: 'registry_lookup',
        label: 'Registry lookup',
        description: 'Verify issued credits and retirement certificates',
        url: buildCreditVerificationUrl({ serialNumber, accountId: entityId })
      },
      {
        id: 'trading',
        label: 'Market & trading',
        description: 'Compliance market trading (when live on portal)',
        url: buildPortalUrl('trading')
      },
      {
        id: 'methodologies',
        label: 'Notified methodologies',
        description: 'BEE-approved credit methodologies',
        url: buildPortalUrl('methodologies')
      }
    ]
  };
};

module.exports = {
  ICM_PORTAL_BASE_URL,
  ICM_REGISTRY_API_DEFAULT_BASE_URL,
  ICM_PORTAL_PATHS,
  buildPortalUrl,
  buildCreditVerificationUrl,
  buildEntityDashboardUrl,
  getPortalLinkCatalog
};
