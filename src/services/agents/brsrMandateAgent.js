/**
 * BRSR Principle 6 agent — structures disclosure checklist per SEBI BRSR / BRSR Core.
 */
const PRINCIPLE_6_CHECKLIST = [
  { id: 'p6_1', label: 'Details of total Scope 1 and Scope 2 emissions (tCO2e)', required: true },
  { id: 'p6_2', label: 'Scope 3 emissions disclosure (if material)', required: true },
  { id: 'p6_3', label: 'Intensity metrics (per rupee turnover, per unit production)', required: true },
  { id: 'p6_4', label: 'Independent assurance / limited assurance status', required: false },
  { id: 'p6_5', label: 'Value chain partners covered under BRSR Core', required: true }
];

const buildBrsrGuidance = (enterpriseProfile = {}) => {
  const listed = ['listed', 'subsidiary_of_listed', 'public_sector'].includes(
    enterpriseProfile.listingStatus
  );
  const checklist = PRINCIPLE_6_CHECKLIST.map((item) => ({
    ...item,
    status: 'pending',
    agentNote: listed
      ? 'Mandatory for top 1000 listed entities per SEBI circular'
      : 'Recommended for large unlisted corporates preparing for listing'
  }));

  return {
    framework: 'SEBI_BRSR',
    principle: 6,
    reportingEntity: enterpriseProfile.reportingEntityType || 'consolidated',
    financialYearEnd: enterpriseProfile.financialYearEnd || '31-Mar',
    checklist,
    valueChainPackRequired: enterpriseProfile.regulatoryMandates?.brsrCoreValueChain !== false,
    assuranceTier: enterpriseProfile.listingStatus === 'listed' ? 'reasonable_assurance_target' : 'limited_assurance'
  };
};

module.exports = {
  buildBrsrGuidance,
  async execute(task = {}) {
    const { input = {} } = task;
    return buildBrsrGuidance(input.enterpriseProfile || input);
  }
};
