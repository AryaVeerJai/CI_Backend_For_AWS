const {
  runEnterpriseAgentPipeline,
  markWorkflowProgress,
  ENTERPRISE_WORKFLOW_SECTIONS
} = require('./enterpriseEmissionsOrchestrationService');
const brsrMandateAgent = require('./agents/brsrMandateAgent');
const patIntensityAgent = require('./agents/patIntensityAgent');
const enterpriseComplianceAgent = require('./agents/enterpriseComplianceAgent');

const SECTION_AGENT_MAP = {
  organization_listing: () => enterpriseComplianceAgent.execute({ input: {} }),
  consolidation_boundaries: () => ({ message: 'Use GHG boundary agents for consolidation approach validation' }),
  scope12_inventory: () => ({ message: 'Map facilities to Scope 1–2 emission sources' }),
  scope3_materiality: () => ({ message: 'Complete 15-category Scope 3 materiality assessment' }),
  brsr_principle6: (profile) => brsrMandateAgent.execute({ input: { enterpriseProfile: profile } }),
  pat_energy_intensity: (profile) => patIntensityAgent.execute({ input: { enterpriseProfile: profile } }),
  review_orchestration: (profile) => runEnterpriseAgentPipeline(profile)
};

const getSectionGuidance = async (sectionKey, enterpriseProfile) => {
  const handler = SECTION_AGENT_MAP[sectionKey];
  if (!handler) {
    return { error: `Unknown section: ${sectionKey}` };
  }
  return handler(enterpriseProfile);
};

module.exports = {
  ENTERPRISE_WORKFLOW_SECTIONS,
  getSectionGuidance,
  markWorkflowProgress
};
