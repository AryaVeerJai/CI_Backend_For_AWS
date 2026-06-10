const MSME = require('../models/MSME');
const Enterprise = require('../models/Enterprise');

const mapEnterpriseToOperationalProfile = (enterprise) => ({
  _id: enterprise._id,
  companyName: enterprise.companyName,
  companyType: 'medium',
  industry: enterprise.industry,
  businessDomain: enterprise.sector || 'manufacturing',
  gstNumber: enterprise.gstNumber,
  contact: enterprise.contact,
  manufacturingProfile: {
    industrySector: enterprise.sector || enterprise.industry,
    locationState: enterprise.contact?.address?.state,
    locationCountry: enterprise.contact?.address?.country || 'India',
    ghgOrganizationalBoundary: {
      approach: enterprise.consolidationApproach || 'operational_control',
      reportingEntityType: enterprise.reportingEntityType
    }
  },
  operations: {
    facilities: enterprise.facilities || [],
    scope3Materiality: enterprise.scope3Materiality || { categories: [] }
  },
  segment: 'enterprise',
  enterpriseProfile: enterprise
});

/**
 * Load the profile used for carbon calculation and reporting for the current org context.
 */
const getOperationalProfile = async (userContext) => {
  if (userContext.msmeId) {
    const msme = await MSME.findById(userContext.msmeId);
    if (msme) {
      return { profile: msme, segment: 'msme', source: 'msme' };
    }
  }

  if (userContext.enterpriseId) {
    const enterprise = await Enterprise.findById(userContext.enterpriseId);
    if (enterprise) {
      return {
        profile: mapEnterpriseToOperationalProfile(enterprise),
        segment: 'enterprise',
        source: 'enterprise'
      };
    }
  }

  return null;
};

module.exports = {
  getOperationalProfile,
  mapEnterpriseToOperationalProfile
};
