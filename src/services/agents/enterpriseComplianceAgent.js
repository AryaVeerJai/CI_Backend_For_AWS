/**
 * Enterprise compliance agent — maps organization profile to Indian regulatory mandates
 * (SEBI BRSR, BRSR Core value chain, PAT, ICM/Green Credit, CBAM export readiness).
 */
const MANDATE_LIBRARY = [
  {
    id: 'sebi_brsr',
    title: 'SEBI BRSR (Business Responsibility & Sustainability Report)',
    authority: 'SEBI',
    appliesWhen: (profile) => profile.regulatoryMandates?.sebiBrsr !== false
      || ['listed', 'subsidiary_of_listed'].includes(profile.listingStatus),
    requiredSections: ['governance', 'principle_6_emissions', 'assurance_readiness']
  },
  {
    id: 'brsr_core_value_chain',
    title: 'BRSR Core — value chain disclosure',
    authority: 'SEBI',
    appliesWhen: (profile) => profile.regulatoryMandates?.brsrCoreValueChain !== false,
    requiredSections: ['scope3_upstream', 'scope3_downstream', 'supplier_engagement']
  },
  {
    id: 'pat_scheme',
    title: 'Perform, Achieve and Trade (PAT) — energy intensity',
    authority: 'BEE / MoP',
    appliesWhen: (profile) => profile.regulatoryMandates?.patScheme === true,
    requiredSections: ['energy_intensity', 'sector_specific_norms']
  },
  {
    id: 'indian_carbon_market',
    title: 'Indian Carbon Market (ICM) compliance units',
    authority: 'MoEFCC / CEA',
    appliesWhen: (profile) => profile.regulatoryMandates?.indianCarbonMarket === true,
    requiredSections: ['mrv_plan', 'registry_alignment']
  },
  {
    id: 'green_credit',
    title: 'Green Credit Programme',
    authority: 'MoEFCC',
    appliesWhen: (profile) => profile.regulatoryMandates?.greenCreditProgramme === true,
    requiredSections: ['activity_eligibility', 'verification_pathway']
  },
  {
    id: 'cbam_export',
    title: 'EU CBAM — export embedded emissions',
    authority: 'EU / Indian exporters',
    appliesWhen: (profile) => profile.regulatoryMandates?.cbamExport === true,
    requiredSections: ['product_carbon_footprint', 'installation_data']
  }
];

const assessMandates = (enterpriseProfile = {}) => {
  const applicable = MANDATE_LIBRARY.filter((m) => {
    try {
      return m.appliesWhen(enterpriseProfile);
    } catch {
      return false;
    }
  });

  const gaps = [];
  if (!enterpriseProfile.cinNumber) {
    gaps.push({ field: 'cinNumber', severity: 'high', message: 'CIN required for listed entity disclosure' });
  }
  if (!enterpriseProfile.consolidationApproach) {
    gaps.push({ field: 'consolidationApproach', severity: 'high', message: 'GHG consolidation approach not defined' });
  }
  const facilities = Array.isArray(enterpriseProfile.facilities) ? enterpriseProfile.facilities : [];
  if (facilities.length === 0) {
    gaps.push({ field: 'facilities', severity: 'medium', message: 'Register at least one facility for Scope 1–2 inventory' });
  }
  const scope3 = enterpriseProfile.scope3Materiality?.categories || [];
  const materialCount = scope3.filter((c) => c.material).length;
  if (materialCount < 3 && applicable.some((m) => m.id === 'brsr_core_value_chain')) {
    gaps.push({
      field: 'scope3Materiality',
      severity: 'medium',
      message: 'BRSR Core expects material Scope 3 categories to be identified (typically ≥3)'
    });
  }

  return {
    applicableMandates: applicable.map(({ id, title, authority, requiredSections }) => ({
      id,
      title,
      authority,
      requiredSections
    })),
    gaps,
    readinessScore: Math.max(0, Math.min(100, 100 - gaps.length * 12 - (applicable.length === 0 ? 20 : 0)))
  };
};

module.exports = {
  analyzeProfile: assessMandates,
  async execute(task = {}) {
    const { input = {} } = task;
    return assessMandates(input.enterpriseProfile || input);
  }
};
